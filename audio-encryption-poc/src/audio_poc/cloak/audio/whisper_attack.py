"""White-box targeted PGD attack on OpenAI Whisper.

We want Whisper to transcribe ``target_text`` regardless of what was actually
spoken. Strategy:

  1. Tokenize the target text with Whisper's BPE tokenizer, prepending the
     standard SOT sequence.
  2. Build a perturbation ``delta`` of the same length as the input waveform.
  3. Loop: compute mel of ``audio + delta``, run Whisper encoder, then run the
     decoder under teacher forcing on ``target_tokens[:-1]``, and minimize
     cross-entropy against ``target_tokens[1:]``.
  4. Project ``delta`` back into the L_inf ball after each step so the
     perturbation stays imperceptible (epsilon ~= 0.005 ~= -46 dBFS).

This is essentially the targeted Carlini-and-Wagner / Qin et al. recipe ported
to Whisper. White-box: works against the exact loaded model size only.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class WhisperAttackResult:
    audio_mono: np.ndarray
    sample_rate: int
    final_loss: float
    iterations: int
    epsilon: float
    target_text: str
    decoded_text: str


def _ensure_torch_whisper():
    try:
        import torch
        import torch.nn.functional as F
        import whisper
    except ImportError as exc:
        raise RuntimeError(
            "Whisper attack requer torch + openai-whisper. "
            "Rode: pip install torch openai-whisper"
        ) from exc
    return torch, F, whisper


def cloak_to_target(
    audio_np: np.ndarray,
    sample_rate: int,
    target_text: str,
    language: str = "pt",
    model_name: str = "base",
    epsilon: float = 0.005,
    lr: float = 5e-3,
    iters: int = 1500,
    log_every: int = 100,
    progress_callback=None,
) -> WhisperAttackResult:
    torch, F, whisper = _ensure_torch_whisper()

    if sample_rate != whisper.audio.SAMPLE_RATE:
        from scipy import signal as sp_signal
        n_new = int(audio_np.shape[0] * whisper.audio.SAMPLE_RATE / sample_rate)
        audio_np = sp_signal.resample(audio_np, n_new).astype(np.float32)
        sample_rate = whisper.audio.SAMPLE_RATE

    if audio_np.ndim == 2:
        audio_np = audio_np.mean(axis=1)
    audio_np = audio_np.astype(np.float32)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = whisper.load_model(model_name, device=device)
    model.eval()
    for p in model.parameters():
        p.requires_grad = False

    tokenizer = whisper.tokenizer.get_tokenizer(
        model.is_multilingual,
        language=language,
        task="transcribe",
    )
    sot_seq = list(tokenizer.sot_sequence_including_notimestamps)
    target_tokens = sot_seq + tokenizer.encode(" " + target_text.strip()) + [tokenizer.eot]
    tgt = torch.tensor(target_tokens, device=device, dtype=torch.long)

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

        audio_features = model.encoder(mel)
        decoder_input = tgt[:-1].unsqueeze(0)
        logits = model.decoder(decoder_input, audio_features)
        loss = F.cross_entropy(logits.squeeze(0), tgt[1:])

        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        with torch.no_grad():
            delta.clamp_(-epsilon, epsilon)

        last_loss = float(loss.item())
        if progress_callback and (step % log_every == 0 or step == iters - 1):
            progress_callback(step, iters, last_loss)

    with torch.no_grad():
        adv_audio = (audio_t + delta).clamp(-1.0, 1.0).cpu().numpy().astype(np.float32)

    decoded_text = ""
    try:
        result = model.transcribe(adv_audio, language=language, fp16=False)
        decoded_text = (result.get("text") or "").strip()
    except Exception:
        decoded_text = "<transcribe failed>"

    return WhisperAttackResult(
        audio_mono=adv_audio,
        sample_rate=sample_rate,
        final_loss=last_loss,
        iterations=iters,
        epsilon=epsilon,
        target_text=target_text,
        decoded_text=decoded_text,
    )


def cloak_audio_file(
    src_audio: str | Path,
    dst_audio: str | Path,
    target_text: str,
    language: str = "pt",
    model_name: str = "base",
    epsilon: float = 0.005,
    iters: int = 1500,
    progress_callback=None,
) -> WhisperAttackResult:
    import soundfile as sf

    audio, sr = sf.read(str(src_audio), always_2d=True, dtype="float32")
    audio = audio.mean(axis=1)
    result = cloak_to_target(
        audio_np=audio,
        sample_rate=sr,
        target_text=target_text,
        language=language,
        model_name=model_name,
        epsilon=epsilon,
        iters=iters,
        progress_callback=progress_callback,
    )
    out = Path(dst_audio)
    out.parent.mkdir(parents=True, exist_ok=True)
    stereo = np.stack([result.audio_mono, result.audio_mono], axis=1)
    sf.write(str(out), stereo, result.sample_rate)
    return result
