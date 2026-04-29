"""DSP stages for phase-stereo perturbation and masking noise."""

from __future__ import annotations

import numpy as np
from scipy import signal


def _safe_div(num: float, den: float, eps: float = 1e-8) -> float:
    return float(num / (den + eps))


def _moving_rms(x: np.ndarray, window: int) -> np.ndarray:
    window = max(8, int(window))
    kernel = np.ones(window, dtype=np.float32) / window
    power = np.convolve(x**2, kernel, mode="same")
    return np.sqrt(np.maximum(power, 1e-10))


def phase_stereo_perturbation(
    audio_stereo: np.ndarray,
    sample_rate: int,
    strength: float = 0.4,
    nperseg: int = 1024,
) -> np.ndarray:
    """
    Perturb side channel phase in STFT domain while preserving mid channel.
    This targets ASR feature extraction without strong perceptual artifacts.
    """
    left = audio_stereo[:, 0]
    right = audio_stereo[:, 1]
    mid = 0.5 * (left + right)
    side = 0.5 * (left - right)

    freqs, times, side_stft = signal.stft(
        side, fs=sample_rate, nperseg=nperseg, noverlap=nperseg // 2
    )
    if side_stft.size == 0:
        return audio_stereo

    rng = np.random.default_rng()
    # Smooth random field over time/frequency for stable perturbation.
    rand_field = rng.standard_normal(side_stft.shape).astype(np.float32)
    smooth_t = signal.convolve2d(
        rand_field, np.ones((1, 9), dtype=np.float32) / 9, mode="same", boundary="symm"
    )
    smooth_tf = signal.convolve2d(
        smooth_t, np.ones((7, 1), dtype=np.float32) / 7, mode="same", boundary="symm"
    )

    # Emphasize speech-sensitive band.
    band_weight = np.interp(freqs, [0, 500, 1500, 4000, 8000, sample_rate / 2], [0.0, 0.3, 1.0, 1.0, 0.5, 0.2])
    band_weight = band_weight[:, None].astype(np.float32)
    phase_shift = np.clip(smooth_tf * strength * band_weight, -0.9, 0.9)

    side_mod = side_stft * np.exp(1j * phase_shift)
    _, side_out = signal.istft(side_mod, fs=sample_rate, nperseg=nperseg, noverlap=nperseg // 2)
    side_out = side_out[: mid.shape[0]]
    if side_out.shape[0] < mid.shape[0]:
        side_out = np.pad(side_out, (0, mid.shape[0] - side_out.shape[0]))

    left_out = mid + side_out
    right_out = mid - side_out
    return np.stack([left_out, right_out], axis=1).astype(np.float32)


def dynamic_band_noise(
    audio_stereo: np.ndarray,
    sample_rate: int,
    base_gain: float,
    dynamic_gain: float,
    low_hz: float,
    high_hz: float,
) -> np.ndarray:
    """Inject band-shaped dynamic noise modulated by signal energy."""
    mono_ref = np.mean(audio_stereo, axis=1)
    rms_env = _moving_rms(mono_ref, window=int(0.04 * sample_rate))
    env_norm = rms_env / (np.max(rms_env) + 1e-8)
    gain_curve = base_gain + dynamic_gain * env_norm

    rng = np.random.default_rng()
    noise_l = rng.standard_normal(mono_ref.shape[0]).astype(np.float32)
    noise_r = rng.standard_normal(mono_ref.shape[0]).astype(np.float32)

    b, a = signal.butter(
        N=4,
        Wn=[max(30.0, low_hz), min(high_hz, 0.49 * sample_rate)],
        btype="bandpass",
        fs=sample_rate,
    )
    shaped_l = signal.lfilter(b, a, noise_l)
    shaped_r = signal.lfilter(b, a, noise_r)
    stereo_noise = np.stack([shaped_l, shaped_r], axis=1)

    # Slight anti-correlation strengthens stereo masking against mono ASR features.
    stereo_noise[:, 1] *= -0.8
    return (audio_stereo + stereo_noise * gain_curve[:, None]).astype(np.float32)


def loudness_guard(
    audio_stereo: np.ndarray,
    target_peak_dbfs: float = -1.0,
    target_rms_dbfs: float = -19.0,
) -> np.ndarray:
    """Normalize RMS then clamp to target peak to avoid clipping artifacts."""
    x = audio_stereo.astype(np.float32).copy()
    rms = np.sqrt(np.mean(x**2) + 1e-10)
    target_rms = 10 ** (target_rms_dbfs / 20.0)
    rms_scale = _safe_div(target_rms, rms)
    x *= rms_scale

    peak = float(np.max(np.abs(x)) + 1e-8)
    target_peak = 10 ** (target_peak_dbfs / 20.0)
    if peak > target_peak:
        x *= _safe_div(target_peak, peak)
    return np.clip(x, -1.0, 1.0)
