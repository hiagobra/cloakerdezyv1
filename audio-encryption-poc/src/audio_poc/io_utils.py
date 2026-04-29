"""I/O helpers for stereo audio handling."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf


def read_audio_stereo(path: str | Path) -> tuple[np.ndarray, int]:
    """Read audio as float32 stereo matrix [n_samples, 2]."""
    audio, sr = sf.read(str(path), always_2d=True, dtype="float32")
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    elif audio.shape[1] > 2:
        audio = audio[:, :2]
    return audio.astype(np.float32), int(sr)


def write_audio(path: str | Path, audio: np.ndarray, sample_rate: int) -> None:
    """Write normalized float audio, preserving stereo channels."""
    clipped = np.clip(audio, -1.0, 1.0)
    sf.write(str(path), clipped, sample_rate)
