"""End-to-end protection pipeline orchestration."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .dsp import dynamic_band_noise, loudness_guard, phase_stereo_perturbation
from .presets import PRESETS


@dataclass
class PipelineResult:
    audio: np.ndarray
    sample_rate: int
    preset: str
    snr_db_estimate: float


def apply_protection_pipeline(
    audio_stereo: np.ndarray,
    sample_rate: int,
    preset_name: str = "balanced",
    seed: int | None = None,
) -> PipelineResult:
    if preset_name not in PRESETS:
        raise ValueError(f"Unknown preset: {preset_name}. Valid: {list(PRESETS)}")

    if seed is not None:
        np.random.seed(seed)

    cfg = PRESETS[preset_name]
    base = audio_stereo.astype(np.float32)

    phase = phase_stereo_perturbation(
        base,
        sample_rate=sample_rate,
        strength=float(cfg["phase_strength"]),
    )
    noisy = dynamic_band_noise(
        phase,
        sample_rate=sample_rate,
        base_gain=float(cfg["noise_base"]),
        dynamic_gain=float(cfg["noise_dynamic"]),
        low_hz=float(cfg["noise_low_hz"]),
        high_hz=float(cfg["noise_high_hz"]),
    )
    out = loudness_guard(
        noisy,
        target_peak_dbfs=float(cfg["target_peak_dbfs"]),
        target_rms_dbfs=float(cfg["target_rms_dbfs"]),
    )

    n = min(len(base), len(out))
    ref = np.mean(base[:n], axis=1)
    est = np.mean(out[:n], axis=1)
    noise = ref - est
    snr_db_estimate = float(10 * np.log10((np.mean(ref**2) + 1e-9) / (np.mean(noise**2) + 1e-9)))

    return PipelineResult(audio=out, sample_rate=sample_rate, preset=preset_name, snr_db_estimate=snr_db_estimate)
