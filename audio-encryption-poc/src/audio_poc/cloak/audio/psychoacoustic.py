"""Optional Qin et al. style psychoacoustic masking.

Computes a global masking threshold per STFT frame and clamps the perturbation
spectrum below it so the perturbation is provably inaudible to a calibrated
listener. Use as a post-processor after L_inf PGD if perceptual quality
matters more than strict L_inf bounds.
"""

from __future__ import annotations

import numpy as np
from scipy import signal


def _bark(freq: np.ndarray) -> np.ndarray:
    f = np.maximum(freq, 1e-3)
    return 13.0 * np.arctan(0.00076 * f) + 3.5 * np.arctan((f / 7500.0) ** 2)


def global_masking_threshold(
    reference_audio: np.ndarray,
    sample_rate: int,
    n_fft: int = 2048,
    hop: int = 512,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Returns (freqs, times, threshold_db) for the masking floor of the reference."""
    f, t, Z = signal.stft(reference_audio, fs=sample_rate, nperseg=n_fft, noverlap=n_fft - hop)
    psd = 10 * np.log10(np.abs(Z) ** 2 + 1e-12)
    bark = _bark(f)

    threshold = np.full_like(psd, fill_value=-80.0)
    for ti in range(psd.shape[1]):
        col = psd[:, ti]
        for fi in range(len(f)):
            spread = -10.0 * np.abs(bark - bark[fi])
            contribution = col + spread - 6.0
            threshold[fi, ti] = max(threshold[fi, ti], np.max(contribution))
    return f, t, threshold


def project_under_mask(
    perturbation_audio: np.ndarray,
    masking_threshold_db: np.ndarray,
    sample_rate: int,
    n_fft: int = 2048,
    hop: int = 512,
) -> np.ndarray:
    f, t, P = signal.stft(perturbation_audio, fs=sample_rate, nperseg=n_fft, noverlap=n_fft - hop)
    p_db = 10 * np.log10(np.abs(P) ** 2 + 1e-12)
    excess_db = np.maximum(0.0, p_db - masking_threshold_db)
    scale = 10 ** (-excess_db / 20.0)
    P_masked = P * scale
    _, p_time = signal.istft(P_masked, fs=sample_rate, nperseg=n_fft, noverlap=n_fft - hop)
    return p_time[: perturbation_audio.shape[0]]
