"""Semantic audio injection bed (cheap ASR bias without gradient optimization).

Different from ``tts_underlay``: instead of synthesizing the full target
transcript at speech volume (~-22 dBFS), this module synthesizes a *dense bag
of target-topic keywords* (overlay lines + title + first sentence of the
description) and loops it at a much lower level (~-34 dBFS) underneath
everything. The goal is to push the n-gram posterior of any downstream ASR
toward the target topic without producing audible parallel speech.

Why both layers? They reinforce each other:

- ``tts_underlay`` is the "narrator" track — explicit prose at moderate volume.
- ``injection_bed`` is the "keyword soup" track — louder where keywords matter,
  quieter overall, and far below the Whisper PGD perturbation level.

Order in the composer: TTS underlay first (volumetric), then injection bed
(keyword density), then Whisper PGD (so PGD optimizes on top of the already
biased mixture).

This is the audio analogue of a multimodal prompt-injection layer: it tries to
*inject* topic vocabulary that downstream pipelines (ASR -> classifier) read as
context, without producing perceptually obvious speech.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

from ..targets import TopicTarget
from .tts_underlay import _loop_to_length, _normalize_to_dbfs, synthesize_tts


def _phrase_for_bed(target: TopicTarget, max_chars: int = 420) -> str:
    """Build a keyword-dense phrase that loops well as a bed track."""
    title = str(target.mp4_metadata.get("title") or "").strip()
    overlay = " ; ".join(target.overlay_lines).strip()
    desc = (target.description or "").strip()[:200]
    parts = [p for p in (title, overlay, desc) if p]
    text = " . ".join(parts)
    if len(text) > max_chars:
        text = text[: max_chars - 3] + "..."
    if not text:
        text = target.transcript[:max_chars]
    return text


def synthesize_bed(
    target: TopicTarget,
    workdir: str | Path,
    sample_rate: int = 48000,
) -> tuple[np.ndarray, int]:
    """Generate the keyword-bed mono waveform via offline TTS."""
    work = Path(workdir)
    work.mkdir(parents=True, exist_ok=True)
    bed_wav = work / f"injection_bed_{target.key}.wav"
    phrase = _phrase_for_bed(target)
    synthesize_tts(phrase, target.language, bed_wav)
    audio, sr = sf.read(str(bed_wav), always_2d=True, dtype="float32")
    audio = audio.mean(axis=1)
    if sr != sample_rate:
        n_new = int(audio.shape[0] * sample_rate / sr)
        audio = signal.resample(audio, n_new).astype(np.float32)
    return audio, sample_rate


def mix_injection_bed(
    host_stereo: np.ndarray,
    sample_rate: int,
    target: TopicTarget,
    workdir: str | Path,
    bed_dbfs: float = -34.0,
) -> np.ndarray:
    """Mix a looping low-level keyword bed under ``host_stereo``.

    Parameters
    ----------
    host_stereo:
        Float32 array of shape ``(n_samples, 2)``. Already at its own normalized
        level (e.g. after ``mix_underlay_into_audio``).
    sample_rate:
        Sample rate of ``host_stereo``.
    target:
        TopicTarget describing the desired output classification.
    workdir:
        Scratch directory for the synthesized TTS file.
    bed_dbfs:
        Target RMS level for the bed track. ``-34 dBFS`` is the sweet spot
        where most ASRs still pick up the keywords but the bed is below
        speech-presence detection thresholds.
    """
    bed, _ = synthesize_bed(target, workdir, sample_rate=sample_rate)

    n = host_stereo.shape[0]
    bed = _loop_to_length(bed, n)
    bed = _normalize_to_dbfs(bed, bed_dbfs).astype(np.float32)

    bed_stereo = np.stack([bed, bed * 0.94], axis=1).astype(np.float32)
    mixed = host_stereo.astype(np.float32) + bed_stereo
    peak = float(np.max(np.abs(mixed)) + 1e-8)
    if peak > 0.99:
        mixed *= 0.99 / peak
    return mixed.astype(np.float32)
