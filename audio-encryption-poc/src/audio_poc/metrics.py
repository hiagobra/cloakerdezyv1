"""Objective metrics for before/after comparisons."""

from __future__ import annotations

import numpy as np
from jiwer import cer, wer


def snr_db(reference: np.ndarray, estimate: np.ndarray) -> float:
    n = min(reference.shape[0], estimate.shape[0])
    r = reference[:n]
    e = estimate[:n]
    noise = r - e
    p_signal = float(np.mean(r**2) + 1e-10)
    p_noise = float(np.mean(noise**2) + 1e-10)
    return 10.0 * np.log10(p_signal / p_noise)


def text_error_metrics(reference_text: str, hypothesis_text: str) -> dict[str, float]:
    return {
        "wer": float(wer(reference_text, hypothesis_text)),
        "cer": float(cer(reference_text, hypothesis_text)),
    }
