"""IBM ART ImperceptibleASRPyTorch wrapper (opt-in, requires the [art] extra).

The Adversarial Robustness Toolbox (ART) packages a faithful PyTorch
implementation of Qin et al. 2019 ICML "Imperceptible, Robust, and Targeted
Adversarial Examples for Automatic Speech Recognition" with psychoacoustic
masking. This is generally considered the strongest reproducible white-box
imperceptible audio attack as of 2024-2026.

ART's ``ImperceptibleASRPyTorch`` only ships with a DeepSpeech2 backend out of
the box. That's both its strength (battle-tested) and its limitation (you
cannot point it at Whisper directly). For Whisper-targeted attacks, prefer
``whisper_attack.py``; this module is exposed strictly as an *opt-in alternate
engine* so the user can A/B against the canonical academic implementation.

Usage:

    from audio_poc.cloak.audio.art_imperceptible import (
        cloak_to_target_imperceptible,
    )

    res = cloak_to_target_imperceptible(
        audio_np=mono_float32,
        sample_rate=16000,
        target_text="this is a finance video",
    )
    sf.write("out.wav", res.audio_mono, res.sample_rate)

Install the extra first:

    pip install -e .[art]
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass
class ArtImperceptibleResult:
    """Compatible-shape result with ``whisper_attack.WhisperAttackResult``.

    ``decoded_text`` is best-effort ("" if the underlying model can't decode
    cheaply) so the composer can still log a metric without forcing another
    Whisper inference pass.
    """

    audio_mono: np.ndarray
    sample_rate: int
    final_loss: float
    iterations: int
    epsilon: float
    target_text: str
    decoded_text: str = ""


def _lazy_import_art() -> Any:
    """Import ART only on demand; emit an actionable error otherwise."""
    try:
        import torch  # noqa: F401
        from art.attacks.evasion import ImperceptibleASRPyTorch
        from art.estimators.speech_recognition import PyTorchDeepSpeech
    except ImportError as exc:  # pragma: no cover - depends on extras
        raise RuntimeError(
            "ART imperceptible attack requires the [art] extra. "
            "Run: pip install -e .[art]\n"
            "(adversarial-robustness-toolbox + torch must be importable.)"
        ) from exc
    return torch, ImperceptibleASRPyTorch, PyTorchDeepSpeech


def _resample_to_16k(audio_np: np.ndarray, sample_rate: int) -> tuple[np.ndarray, int]:
    if sample_rate == 16000:
        return audio_np.astype(np.float32, copy=False), 16000
    from scipy import signal as sp_signal

    n_new = int(round(audio_np.shape[0] * 16000 / sample_rate))
    if n_new <= 0:
        raise ValueError("Input audio too short to resample to 16 kHz.")
    out = sp_signal.resample(audio_np, n_new).astype(np.float32)
    return out, 16000


def cloak_to_target_imperceptible(
    audio_np: np.ndarray,
    sample_rate: int,
    target_text: str,
    pretrained_model: str = "librispeech",
    max_iter_1st_stage: int = 1000,
    max_iter_2nd_stage: int = 4000,
    learning_rate_1st_stage: float = 5e-3,
    learning_rate_2nd_stage: float = 5e-4,
    epsilon: float = 0.005,
    device_type: str = "cpu",
) -> ArtImperceptibleResult:
    """Run ART's Imperceptible ASR PGD against PyTorchDeepSpeech.

    Notes
    -----
    - Input is auto-resampled to 16 kHz mono float32 (DeepSpeech2 expectation).
    - GPU is strongly recommended; CPU runs but takes minutes per second of
      audio with the default iteration counts.
    - The 2-stage attack first fits the perturbation, then minimizes its
      psychoacoustic budget under masking thresholds; that's where most of the
      "imperceptible" property comes from.
    """
    torch, ImperceptibleASRPyTorch, PyTorchDeepSpeech = _lazy_import_art()

    audio16, sr16 = _resample_to_16k(audio_np.astype(np.float32, copy=False), sample_rate)
    audio_batch = audio16.reshape(1, -1)
    target_batch = np.asarray([target_text], dtype=object)

    estimator = PyTorchDeepSpeech(
        pretrained_model=pretrained_model,
        device_type=device_type,
    )

    attack = ImperceptibleASRPyTorch(
        estimator=estimator,
        eps=epsilon,
        max_iter_1st_stage=max_iter_1st_stage,
        max_iter_2nd_stage=max_iter_2nd_stage,
        learning_rate_1st_stage=learning_rate_1st_stage,
        learning_rate_2nd_stage=learning_rate_2nd_stage,
        batch_size=1,
    )

    adv = attack.generate(x=audio_batch, y=target_batch)
    adv_mono = np.asarray(adv[0], dtype=np.float32).flatten()

    decoded_text = ""
    try:
        pred = estimator.predict(adv_mono.reshape(1, -1), batch_size=1)
        if isinstance(pred, np.ndarray) and pred.size > 0:
            decoded_text = str(pred[0])
        elif isinstance(pred, list) and pred:
            decoded_text = str(pred[0])
    except Exception:
        decoded_text = ""

    return ArtImperceptibleResult(
        audio_mono=adv_mono,
        sample_rate=sr16,
        final_loss=float("nan"),
        iterations=max_iter_1st_stage + max_iter_2nd_stage,
        epsilon=epsilon,
        target_text=target_text,
        decoded_text=decoded_text,
    )
