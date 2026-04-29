"""Ensemble PGD across Whisper + wav2vec2 (CTC).

Same recipe as ``whisper_attack`` but the loss is a weighted sum of the
Whisper teacher-forcing CE and a CTC loss against the target text computed via
a multilingual wav2vec2 model. Joint optimization makes ``delta`` survive the
loss landscape of more than one ASR family, which improves transfer to
black-box closed ASRs that share architectural lineage with at least one of
the surrogates.

Heavy dep: torch + transformers + openai-whisper.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class EnsembleAttackResult:
    audio_mono: np.ndarray
    sample_rate: int
    final_loss: float
    iterations: int
    epsilon: float
    target_text: str
    whisper_decoded: str
    wav2vec2_decoded: str


def _ensure_deps():
    try:
        import torch
        import torch.nn.functional as F
        import whisper
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
    except ImportError as exc:
        raise RuntimeError(
            "Ensemble requer torch + openai-whisper + transformers. "
            "Rode: pip install torch openai-whisper transformers"
        ) from exc
    return torch, F, whisper, Wav2Vec2ForCTC, Wav2Vec2Processor


def cloak_to_target_ensemble(
    audio_np: np.ndarray,
    sample_rate: int,
    target_text: str,
    language: str = "pt",
    whisper_model: str = "base",
    wav2vec2_model: str = "facebook/wav2vec2-large-xlsr-53",
    epsilon: float = 0.006,
    lr: float = 4e-3,
    iters: int = 1200,
    weight_whisper: float = 1.0,
    weight_wav2vec2: float = 0.6,
    progress_callback=None,
) -> EnsembleAttackResult:
    torch, F, whisper, Wav2Vec2ForCTC, Wav2Vec2Processor = _ensure_deps()

    if audio_np.ndim == 2:
        audio_np = audio_np.mean(axis=1)
    audio_np = audio_np.astype(np.float32)

    if sample_rate != 16000:
        from scipy import signal as sp_signal
        n_new = int(audio_np.shape[0] * 16000 / sample_rate)
        audio_np = sp_signal.resample(audio_np, n_new).astype(np.float32)
        sample_rate = 16000

    device = "cuda" if torch.cuda.is_available() else "cpu"

    w_model = whisper.load_model(whisper_model, device=device).eval()
    for p in w_model.parameters():
        p.requires_grad = False
    w_tok = whisper.tokenizer.get_tokenizer(
        w_model.is_multilingual, language=language, task="transcribe"
    )
    sot_seq = list(w_tok.sot_sequence_including_notimestamps)
    target_tokens = sot_seq + w_tok.encode(" " + target_text.strip()) + [w_tok.eot]
    tgt = torch.tensor(target_tokens, device=device, dtype=torch.long)

    w2v_processor = Wav2Vec2Processor.from_pretrained(wav2vec2_model)
    w2v_model = Wav2Vec2ForCTC.from_pretrained(wav2vec2_model).to(device).eval()
    for p in w2v_model.parameters():
        p.requires_grad = False

    with w2v_processor.as_target_processor():
        ctc_labels = w2v_processor(target_text.strip().lower(), return_tensors="pt").input_ids.to(device)
    target_lengths = torch.tensor([ctc_labels.shape[1]], device=device, dtype=torch.long)

    audio_t = torch.tensor(audio_np, device=device, dtype=torch.float32)
    delta = torch.zeros_like(audio_t, requires_grad=True)
    optimizer = torch.optim.Adam([delta], lr=lr)

    last_loss = float("nan")
    for step in range(iters):
        x = (audio_t + delta).clamp(-1.0, 1.0)

        x_padded = whisper.pad_or_trim(x)
        mel = whisper.log_mel_spectrogram(x_padded).to(device)
        if mel.ndim == 2:
            mel = mel.unsqueeze(0)
        feats_w = w_model.encoder(mel)
        logits_w = w_model.decoder(tgt[:-1].unsqueeze(0), feats_w)
        loss_w = F.cross_entropy(logits_w.squeeze(0), tgt[1:])

        w2v_inputs = (x - x.mean()) / (x.std() + 1e-7)
        w2v_logits = w2v_model(w2v_inputs.unsqueeze(0)).logits
        log_probs = F.log_softmax(w2v_logits, dim=-1).transpose(0, 1)
        input_lengths = torch.tensor([w2v_logits.shape[1]], device=device, dtype=torch.long)
        loss_ctc = F.ctc_loss(
            log_probs, ctc_labels, input_lengths, target_lengths,
            blank=w2v_processor.tokenizer.pad_token_id,
            zero_infinity=True,
        )

        loss = weight_whisper * loss_w + weight_wav2vec2 * loss_ctc
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        with torch.no_grad():
            delta.clamp_(-epsilon, epsilon)

        last_loss = float(loss.item())
        if progress_callback and step % 100 == 0:
            progress_callback(step, iters, last_loss)

    with torch.no_grad():
        adv = (audio_t + delta).clamp(-1.0, 1.0).cpu().numpy().astype(np.float32)

    whisper_text = ""
    try:
        whisper_text = (w_model.transcribe(adv, language=language, fp16=False).get("text") or "").strip()
    except Exception:
        whisper_text = "<failed>"

    w2v_text = ""
    try:
        with torch.no_grad():
            inp = torch.tensor(adv, device=device).unsqueeze(0)
            inp = (inp - inp.mean()) / (inp.std() + 1e-7)
            pred_ids = w2v_model(inp).logits.argmax(dim=-1)
            w2v_text = w2v_processor.batch_decode(pred_ids)[0]
    except Exception:
        w2v_text = "<failed>"

    return EnsembleAttackResult(
        audio_mono=adv,
        sample_rate=sample_rate,
        final_loss=last_loss,
        iterations=iters,
        epsilon=epsilon,
        target_text=target_text,
        whisper_decoded=whisper_text,
        wav2vec2_decoded=w2v_text,
    )
