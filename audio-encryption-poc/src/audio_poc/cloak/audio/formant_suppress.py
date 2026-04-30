"""Formant suppression on the host audio.

Lateral to Schoenherr/Qin (psychoacoustic, items 2.4 and 2.5 of pesquisa.md):
ASR systems latch onto **formant frequencies** of the speaker (the resonant
peaks of the vocal tract) to identify phonemes. By applying narrow notch
filters at the four main formant regions (~500-3500 Hz), we can carve out
~10-14 dB of energy from the bands the ASR cares about while keeping enough
of the original timbre that humans still perceive a (degraded) voice.

This is intentionally a soft filter, not a hard mute: the goal is to
**reinforce ``audio_swap_mode=full``**. Even when a residual gap in the swap
mix lets some of the original speaker bleed through, the ASR has much less
phoneme signal to grab onto.

Usage:
    from .formant_suppress import suppress_formants
    host_quiet = suppress_formants(host_stereo, sample_rate=48000,
                                   depth_db=-14.0, q=12.0)
"""

from __future__ import annotations

import numpy as np


_DEFAULT_FORMANTS_HZ = (700.0, 1220.0, 2600.0, 3500.0)


def _safe_freq(f0: float, sample_rate: int) -> float:
    nyq = sample_rate / 2.0
    return min(max(50.0, f0), nyq * 0.95)


def suppress_formants(
    host_stereo: np.ndarray,
    sample_rate: int,
    notch_freqs: tuple[float, ...] = _DEFAULT_FORMANTS_HZ,
    q: float = 12.0,
    depth_db: float = -14.0,
) -> np.ndarray:
    """Apply a parallel mix of (host) and (host through cascaded notches).

    ``depth_db`` controls how much of the notched signal replaces the original.
    ``-14 dB`` removes most of the formant energy while keeping ~80% of the
    overall envelope.
    """
    if host_stereo.ndim == 1:
        host = host_stereo[:, None]
        was_mono = True
    else:
        host = host_stereo
        was_mono = False

    if host.dtype != np.float32:
        host = host.astype(np.float32)

    try:
        from scipy.signal import iirnotch, sosfiltfilt, tf2sos
    except ImportError as exc:
        raise RuntimeError("scipy ausente. Rode: pip install scipy") from exc

    out = host.copy()
    # ``depth_db`` is interpreted as "how much of the formant energy remains"
    # in the output: 0 dB = pass-through, -14 dB ~= keep only ~20% of formant
    # energy, -infinity = full removal. We mix (mostly notched) + (a little
    # dry) so that the **formant region** is attenuated by ``depth_db`` while
    # the rest of the spectrum stays close to the original.
    dry_gain = float(np.clip(10 ** (depth_db / 20.0), 0.0, 1.0))
    wet_gain = max(0.0, 1.0 - dry_gain)

    n_channels = out.shape[1]
    for ch in range(n_channels):
        notched = out[:, ch].astype(np.float32)
        for f0 in notch_freqs:
            f0_safe = _safe_freq(f0, sample_rate)
            b, a = iirnotch(f0_safe, q, fs=sample_rate)
            sos = tf2sos(b, a)
            notched = sosfiltfilt(sos, notched).astype(np.float32)
        out[:, ch] = (out[:, ch] * dry_gain + notched * wet_gain).astype(np.float32)

    peak = float(np.max(np.abs(out)) + 1e-8)
    if peak > 0.99:
        out *= 0.99 / peak

    if was_mono:
        return out[:, 0]
    return out
