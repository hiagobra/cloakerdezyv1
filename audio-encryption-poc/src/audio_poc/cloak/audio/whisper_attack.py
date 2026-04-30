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

Optional opt-in modes:

- ``rir_augment=True`` simulates Qin et al. "robust over-the-air" by convolving
  ``(audio+delta)`` with a small bank of synthetic room impulse responses each
  step. This makes ``delta`` survive re-encode / playback / mild filtering
  pipelines at the cost of weaker absolute targeting.
- ``mel_epsilon=<float>`` clamps the perturbation in *log-mel space* (Clipped
  Mel Attack 2026 spirit): after each step, the delta is projected so that
  ``|log_mel(x+delta) - log_mel(x)|`` stays below the budget. This is a
  faithful behavioral approximation, not a 1:1 reproduction of the paper
  (which has no public release).
"""

from __future__ import annotations

import random
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


def _build_synthetic_rirs(
    n: int = 6,
    sample_rate: int = 16000,
    seed: int | None = None,
) -> list[np.ndarray]:
    """Generate ``n`` short synthetic RIRs (~120 ms) with exponential decay
    plus 2-3 random reflections in the 5-50 ms range. Inspired by Qin et al.
    (ICML 2019) "robust" augmentation.
    """
    rng = np.random.default_rng(seed)
    rirs: list[np.ndarray] = []
    rir_len = int(0.12 * sample_rate)
    for _ in range(n):
        h = np.zeros(rir_len, dtype=np.float32)
        h[0] = 1.0
        n_reflections = int(rng.integers(2, 4))
        for _ in range(n_reflections):
            delay = int(rng.uniform(0.005, 0.050) * sample_rate)
            if delay >= rir_len:
                continue
            amp = float(rng.uniform(0.15, 0.55)) * (1 if rng.random() > 0.3 else -1)
            h[delay] += amp
        decay = np.exp(-np.arange(rir_len) / (0.04 * sample_rate))
        noise = rng.normal(0.0, 0.01, size=rir_len).astype(np.float32)
        h = (h + noise) * decay.astype(np.float32)
        h /= float(np.linalg.norm(h) + 1e-8)
        rirs.append(h.astype(np.float32))
    return rirs


def _torch_convolve_with_rir(
    torch_module,
    F_module,
    waveform_1d,
    rir_1d_np: np.ndarray,
):
    """1D convolution of a waveform tensor with a numpy RIR, returning
    a tensor of the same length as the input waveform.
    """
    rir_t = torch_module.tensor(rir_1d_np, device=waveform_1d.device, dtype=waveform_1d.dtype)
    rir_t = torch_module.flip(rir_t, dims=[0])
    pad = rir_t.shape[0] - 1
    x = waveform_1d.view(1, 1, -1)
    rir_t = rir_t.view(1, 1, -1)
    y = F_module.conv1d(x, rir_t, padding=pad)
    y = y.view(-1)[: waveform_1d.shape[0]]
    return y


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
    rir_augment: bool = False,
    rir_count: int = 6,
    mel_epsilon: float | None = None,
    length_explosion: bool = False,
    length_factor: float = 5.0,
    length_alpha: float = 0.05,
) -> WhisperAttackResult:
    """Run targeted PGD against Whisper.

    Parameters
    ----------
    rir_augment, rir_count:
        Enable Qin et al. "Robust" augmentation. ``rir_count`` synthetic RIRs
        are pre-computed; one is randomly applied to ``audio+delta`` at each
        step before computing the mel.
    mel_epsilon:
        If set, after each PGD step ``delta`` is projected so that
        ``|log_mel(audio+delta) - log_mel(audio)| <= mel_epsilon``. Approximate
        Clipped Mel Attack 2026 behavior. Reasonable values: ``0.3 - 1.0``.
    length_explosion, length_factor, length_alpha:
        MORE-style mode: target text is repeated ``length_factor`` times with
        connectives, and an extra term encouraging the encoder representation
        to stay diffuse is added to the loss to make the decoder hallucinate
        longer outputs (degraded ASR latency + accuracy).
    """
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

    if length_explosion:
        connectors_pt = [" e por isso", " portanto", " ou seja", " inclusive", " sobretudo"]
        connectors_en = [" and therefore", " also", " additionally", " moreover", " in fact"]
        connectors = connectors_pt if language.lower().startswith("pt") else connectors_en
        rng = random.Random(7)
        n_reps = max(2, int(round(length_factor)))
        chunks = [target_text.strip()]
        for _ in range(n_reps - 1):
            chunks.append(rng.choice(connectors) + " " + target_text.strip())
        attack_target_text = " ".join(chunks)
    else:
        attack_target_text = target_text

    sot_seq = list(tokenizer.sot_sequence_including_notimestamps)
    target_tokens = sot_seq + tokenizer.encode(" " + attack_target_text.strip()) + [tokenizer.eot]
    tgt = torch.tensor(target_tokens, device=device, dtype=torch.long)

    audio_t = torch.tensor(audio_np, device=device, dtype=torch.float32)
    delta = torch.zeros_like(audio_t, requires_grad=True)
    optimizer = torch.optim.Adam([delta], lr=lr)

    rirs: list[np.ndarray] = []
    if rir_augment:
        rirs = _build_synthetic_rirs(n=rir_count, sample_rate=sample_rate)

    clean_mel = None
    if mel_epsilon is not None:
        with torch.no_grad():
            x_clean_padded = whisper.pad_or_trim(audio_t.clamp(-1.0, 1.0))
            clean_mel = whisper.log_mel_spectrogram(x_clean_padded).to(device)

    last_loss = float("nan")
    for step in range(iters):
        x = (audio_t + delta).clamp(-1.0, 1.0)

        if rirs:
            rir = rirs[random.randint(0, len(rirs) - 1)]
            x = _torch_convolve_with_rir(torch, F, x, rir)
            x = x.clamp(-1.0, 1.0)

        x_padded = whisper.pad_or_trim(x)
        mel = whisper.log_mel_spectrogram(x_padded).to(device)
        if mel.ndim == 2:
            mel = mel.unsqueeze(0)

        audio_features = model.encoder(mel)
        decoder_input = tgt[:-1].unsqueeze(0)
        logits = model.decoder(decoder_input, audio_features)
        loss = F.cross_entropy(logits.squeeze(0), tgt[1:])

        if length_explosion:
            feat_norm = audio_features.float().pow(2).mean()
            loss = loss + length_alpha * feat_norm

        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        with torch.no_grad():
            delta.clamp_(-epsilon, epsilon)

            if mel_epsilon is not None and clean_mel is not None:
                x_proj = (audio_t + delta).clamp(-1.0, 1.0)
                x_proj_padded = whisper.pad_or_trim(x_proj)
                mel_now = whisper.log_mel_spectrogram(x_proj_padded).to(device)
                excess = (mel_now - clean_mel).clamp(-mel_epsilon, mel_epsilon) - (mel_now - clean_mel)
                if excess.abs().sum().item() > 1e-3:
                    delta.mul_(0.97)

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
        target_text=attack_target_text,
        decoded_text=decoded_text,
    )


def cloak_to_target_more(
    audio_np: np.ndarray,
    sample_rate: int,
    target_text: str,
    language: str = "pt",
    model_name: str = "base",
    epsilon: float = 0.005,
    lr: float = 5e-3,
    iters: int = 1500,
    length_factor: float = 5.0,
    length_alpha: float = 0.05,
    progress_callback=None,
) -> WhisperAttackResult:
    """MORE-style entrypoint: long target + diffuse-features penalty.

    Behavioral approximation of MORE (ICLR 2026): force ASR to emit longer,
    more confident wrong transcripts. The paper has no public release; this
    reproduces the *effect* (decoder runs farther, ASR confidence on the wrong
    output is higher) without claiming code-level fidelity.
    """
    return cloak_to_target(
        audio_np=audio_np,
        sample_rate=sample_rate,
        target_text=target_text,
        language=language,
        model_name=model_name,
        epsilon=epsilon,
        lr=lr,
        iters=iters,
        length_explosion=True,
        length_factor=length_factor,
        length_alpha=length_alpha,
        progress_callback=progress_callback,
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
