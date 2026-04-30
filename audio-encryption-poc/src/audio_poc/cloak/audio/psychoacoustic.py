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
    bark = _bark(f).astype(np.float32)
    # spread[k, j] = -10 * |bark[k] - bark[j]|  => threshold[j, t] = max_k psd[k,t] + spread[k,j] - 6
    spread = (-10.0 * np.abs(bark[:, None] - bark[None, :])).astype(np.float32)
    n_frames = psd.shape[1]
    threshold = np.full_like(psd, fill_value=-80.0)
    for ti in range(n_frames):
        col = psd[:, ti].astype(np.float32)
        thr_col = np.max(col[:, None] + spread - 6.0, axis=0)
        threshold[:, ti] = np.maximum(threshold[:, ti], thr_col)
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
    lo_f = min(p_db.shape[0], masking_threshold_db.shape[0])
    lo_t = min(p_db.shape[1], masking_threshold_db.shape[1])
    if lo_f < 1 or lo_t < 1:
        return perturbation_audio.astype(np.float32)
    p_db = p_db[:lo_f, :lo_t]
    masking_threshold_db = masking_threshold_db[:lo_f, :lo_t]
    excess_db = np.maximum(0.0, p_db - masking_threshold_db)
    scale = 10 ** (-excess_db / 20.0)
    P_masked = P[:lo_f, :lo_t] * scale
    _, p_time = signal.istft(P_masked, fs=sample_rate, nperseg=n_fft, noverlap=n_fft - hop)
    m = perturbation_audio.shape[0]
    if p_time.shape[0] < m:
        p_time = np.pad(p_time, (0, m - p_time.shape[0]))
    return p_time[:m].astype(np.float32)


def constrain_modification_psychoacoustic(
    reference_mono: np.ndarray,
    modified_mono: np.ndarray,
    sample_rate: int,
    chunk_seconds: float = 28.0,
) -> np.ndarray:
    """Project (modified - reference) under a short-time masking curve, in time
    chunks, so long clips stay tractable on CPU."""
    ref = np.asarray(reference_mono, dtype=np.float32).reshape(-1)
    cur = np.asarray(modified_mono, dtype=np.float32).reshape(-1)
    n = min(ref.shape[0], cur.shape[0])
    if n == 0:
        return cur
    ref = ref[:n]
    cur = cur[:n]
    delta = cur - ref
    chunk = max(int(chunk_seconds * sample_rate), 8000)
    if n <= chunk:
        _, _, th = global_masking_threshold(ref, sample_rate)
        d_m = project_under_mask(delta, th, sample_rate)
        return (ref + d_m).astype(np.float32)

    pieces: list[np.ndarray] = []
    xfade = min(4096, chunk // 8)
    for start in range(0, n, chunk):
        end = min(n, start + chunk)
        ref_c = ref[start:end]
        d_c = delta[start:end]
        _, _, th = global_masking_threshold(ref_c, sample_rate)
        d_m = project_under_mask(d_c, th, sample_rate)
        seg = ref_c + d_m[: ref_c.shape[0]]
        if pieces and xfade > 0:
            prev = pieces[-1]
            m = min(xfade, prev.shape[0], seg.shape[0])
            if m > 0:
                a = np.linspace(1.0, 0.0, m, dtype=np.float32)
                prev[-m:] = prev[-m:] * a + seg[:m] * (1.0 - a)
                seg = seg[m:]
        if seg.size:
            pieces.append(seg)
    if not pieces:
        return ref
    return np.concatenate(pieces, axis=0).astype(np.float32)
