"""TTS underlay: cheap, robust, audio-only topic shift.

Pipeline:
  1. Synthesize the target transcript via offline TTS (pyttsx3 -- works on
     Windows/macOS/Linux with no GPU and no API key).
  2. Loop / time-stretch the TTS to match the duration of the host audio.
  3. Sidechain-duck the original a few dB whenever the TTS is loud enough
     so the moderator's ASR latches onto the underlay text without obviously
     overwriting the original to humans.
  4. Mix at a level that is audible to ASR but feels like background to humans
     (typical: original at ``-9 dBFS``, underlay at ``-22 dBFS``).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

from ..ffmpeg_utils import ensure_ffmpeg, run_ffmpeg
from ..targets import TopicTarget


_VOICE_LANG_HINTS = {
    "pt": ("portuguese", "brasil", "brazilian"),
    "en": ("english",),
    "es": ("spanish", "español", "espanol"),
}


def _select_voice(engine, language_iso2: str):
    hints = _VOICE_LANG_HINTS.get(language_iso2, ())
    voices = engine.getProperty("voices")
    for v in voices:
        meta = " ".join(
            str(getattr(v, attr, "") or "")
            for attr in ("name", "id", "languages")
        ).lower()
        if any(h in meta for h in hints):
            return v.id
    return None


def synthesize_tts(text: str, language_iso2: str, dst_wav: str | Path, rate: int = 175) -> Path:
    try:
        import pyttsx3
    except ImportError as exc:
        raise RuntimeError(
            "pyttsx3 não instalado. Rode: pip install pyttsx3"
        ) from exc

    engine = pyttsx3.init()
    voice_id = _select_voice(engine, language_iso2)
    if voice_id:
        engine.setProperty("voice", voice_id)
    engine.setProperty("rate", rate)

    out = Path(dst_wav)
    out.parent.mkdir(parents=True, exist_ok=True)
    engine.save_to_file(text, str(out))
    engine.runAndWait()
    engine.stop()
    if not out.exists() or out.stat().st_size < 1024:
        raise RuntimeError("TTS gerou arquivo vazio. Verifique pyttsx3/voices instaladas.")
    return out


def _read_mono(path: str | Path, target_sr: int) -> np.ndarray:
    audio, sr = sf.read(str(path), always_2d=True, dtype="float32")
    audio = audio.mean(axis=1)
    if sr != target_sr:
        n_new = int(audio.shape[0] * target_sr / sr)
        audio = signal.resample(audio, n_new).astype(np.float32)
    return audio


def _moving_rms(x: np.ndarray, win_samples: int) -> np.ndarray:
    win_samples = max(8, int(win_samples))
    kernel = np.ones(win_samples, dtype=np.float32) / win_samples
    return np.sqrt(np.convolve(x**2, kernel, mode="same") + 1e-10)


def _normalize_to_dbfs(x: np.ndarray, target_dbfs: float) -> np.ndarray:
    rms = float(np.sqrt(np.mean(x**2) + 1e-10))
    if rms < 1e-8:
        return x
    target = 10 ** (target_dbfs / 20.0)
    return x * (target / rms)


def _loop_to_length(x: np.ndarray, n: int) -> np.ndarray:
    if x.shape[0] >= n:
        return x[:n]
    repeats = int(np.ceil(n / x.shape[0]))
    return np.tile(x, repeats)[:n]


def mix_underlay_into_audio(
    host_stereo: np.ndarray,
    sample_rate: int,
    underlay_mono: np.ndarray,
    underlay_sr: int,
    host_target_dbfs: float = -9.0,
    underlay_target_dbfs: float = -22.0,
    duck_db: float = -5.0,
    duck_attack_ms: float = 8.0,
    duck_release_ms: float = 180.0,
) -> np.ndarray:
    if underlay_sr != sample_rate:
        n_new = int(underlay_mono.shape[0] * sample_rate / underlay_sr)
        underlay_mono = signal.resample(underlay_mono, n_new).astype(np.float32)

    n = host_stereo.shape[0]
    underlay_mono = _loop_to_length(underlay_mono, n)

    host = host_stereo.astype(np.float32).copy()
    host_mono_for_norm = host.mean(axis=1)
    host_rms = float(np.sqrt(np.mean(host_mono_for_norm**2) + 1e-10))
    if host_rms > 1e-8:
        host *= (10 ** (host_target_dbfs / 20.0)) / host_rms

    underlay = _normalize_to_dbfs(underlay_mono, underlay_target_dbfs)

    win_attack = max(4, int(sample_rate * duck_attack_ms / 1000.0))
    win_release = max(8, int(sample_rate * duck_release_ms / 1000.0))
    underlay_env = _moving_rms(underlay, win_attack)
    smoothed = _moving_rms(underlay_env, win_release)
    env_norm = smoothed / (smoothed.max() + 1e-8)

    duck_lin = 10 ** (duck_db / 20.0)
    duck_curve = 1.0 - (1.0 - duck_lin) * env_norm
    duck_curve = duck_curve.astype(np.float32)

    ducked = host * duck_curve[:, None]
    underlay_stereo = np.stack([underlay, underlay], axis=1) * 0.85
    underlay_stereo[:, 1] *= 0.92

    mixed = ducked + underlay_stereo
    peak = float(np.max(np.abs(mixed)) + 1e-8)
    if peak > 0.99:
        mixed *= 0.99 / peak
    return mixed.astype(np.float32)


def mix_swap_full(
    host_stereo: np.ndarray,
    sample_rate: int,
    underlay_mono: np.ndarray,
    underlay_sr: int,
    host_target_dbfs: float = -32.0,
    target_dbfs: float = -8.0,
) -> np.ndarray:
    """Swap mode: TTS-target becomes the dominant audio, host is reduced to
    near-silence (kept as faint room tone so the track is not literally muted).

    Designed to flip ASR transcripts produced by Gemini / Whisper / wav2vec2 to
    the target topic when the original audio cannot be allowed to dominate.
    """
    if underlay_sr != sample_rate:
        n_new = int(underlay_mono.shape[0] * sample_rate / underlay_sr)
        underlay_mono = signal.resample(underlay_mono, n_new).astype(np.float32)

    n = host_stereo.shape[0]
    underlay_mono = _loop_to_length(underlay_mono, n)

    host = host_stereo.astype(np.float32).copy()
    host_mono_for_norm = host.mean(axis=1)
    host_rms = float(np.sqrt(np.mean(host_mono_for_norm**2) + 1e-10))
    if host_rms > 1e-8:
        host *= (10 ** (host_target_dbfs / 20.0)) / host_rms

    underlay = _normalize_to_dbfs(underlay_mono, target_dbfs)
    underlay_stereo = np.stack([underlay, underlay], axis=1) * 0.95
    underlay_stereo[:, 1] *= 0.97

    mixed = host + underlay_stereo
    peak = float(np.max(np.abs(mixed)) + 1e-8)
    if peak > 0.99:
        mixed *= 0.99 / peak
    return mixed.astype(np.float32)


def mix_swap_intro_outro(
    host_stereo: np.ndarray,
    sample_rate: int,
    underlay_mono: np.ndarray,
    underlay_sr: int,
    intro_seconds: float = 5.0,
    outro_seconds: float = 3.0,
    crossfade_ms: float = 200.0,
    host_swap_dbfs: float = -32.0,
    target_swap_dbfs: float = -8.0,
    host_underlay_dbfs: float = -9.0,
    target_underlay_dbfs: float = -22.0,
    duck_db: float = -5.0,
) -> np.ndarray:
    """Hybrid: full swap during intro/outro windows, classic underlay in the
    middle. Useful when the host audio carries music or atmosphere worth
    keeping in the body of the clip while still dominating the windows that
    Gemini samples most heavily (start/end).
    """
    n = host_stereo.shape[0]
    intro_n = max(0, min(n, int(intro_seconds * sample_rate)))
    outro_n = max(0, min(n - intro_n, int(outro_seconds * sample_rate)))
    crossfade_n = max(8, int(crossfade_ms * sample_rate / 1000.0))

    swap_full = mix_swap_full(
        host_stereo=host_stereo,
        sample_rate=sample_rate,
        underlay_mono=underlay_mono,
        underlay_sr=underlay_sr,
        host_target_dbfs=host_swap_dbfs,
        target_dbfs=target_swap_dbfs,
    )
    underlay_mix = mix_underlay_into_audio(
        host_stereo=host_stereo,
        sample_rate=sample_rate,
        underlay_mono=underlay_mono,
        underlay_sr=underlay_sr,
        host_target_dbfs=host_underlay_dbfs,
        underlay_target_dbfs=target_underlay_dbfs,
        duck_db=duck_db,
    )

    weight = np.zeros(n, dtype=np.float32)
    if intro_n > 0:
        weight[:intro_n] = 1.0
        fade_end = min(intro_n + crossfade_n, n)
        fade_len = fade_end - intro_n
        if fade_len > 0:
            ramp = np.linspace(1.0, 0.0, fade_len, dtype=np.float32)
            weight[intro_n:fade_end] = np.maximum(weight[intro_n:fade_end], ramp)
    if outro_n > 0:
        weight[n - outro_n :] = 1.0
        fade_start = max(0, n - outro_n - crossfade_n)
        fade_len = (n - outro_n) - fade_start
        if fade_len > 0:
            ramp = np.linspace(0.0, 1.0, fade_len, dtype=np.float32)
            weight[fade_start : n - outro_n] = np.maximum(
                weight[fade_start : n - outro_n], ramp
            )

    weight2 = weight[:, None]
    mixed = swap_full * weight2 + underlay_mix * (1.0 - weight2)
    peak = float(np.max(np.abs(mixed)) + 1e-8)
    if peak > 0.99:
        mixed *= 0.99 / peak
    return mixed.astype(np.float32)


def generate_tts_underlay(
    target: TopicTarget,
    workdir: str | Path,
    sample_rate: int = 48000,
) -> tuple[np.ndarray, int]:
    work = Path(workdir)
    work.mkdir(parents=True, exist_ok=True)
    tts_wav = work / f"tts_{target.key}.wav"
    synthesize_tts(target.transcript, target.language, tts_wav)
    audio = _read_mono(tts_wav, sample_rate)
    return audio, sample_rate


def apply_tts_underlay_to_video(
    video_in: str | Path,
    target: TopicTarget,
    video_out: str | Path,
    workdir: str | Path,
    host_target_dbfs: float = -9.0,
    underlay_target_dbfs: float = -22.0,
    duck_db: float = -5.0,
) -> Path:
    """End-to-end: extract audio, mix underlay, remux."""
    from ..ffmpeg_utils import extract_audio_wav, remux_audio_into_video

    ensure_ffmpeg()
    work = Path(workdir)
    work.mkdir(parents=True, exist_ok=True)

    src_wav = work / "host.wav"
    extract_audio_wav(video_in, src_wav, sample_rate=48000)
    host, sr = sf.read(str(src_wav), always_2d=True, dtype="float32")
    if host.shape[1] == 1:
        host = np.repeat(host, 2, axis=1)
    elif host.shape[1] > 2:
        host = host[:, :2]

    underlay, u_sr = generate_tts_underlay(target, work, sample_rate=sr)
    mixed = mix_underlay_into_audio(
        host_stereo=host,
        sample_rate=sr,
        underlay_mono=underlay,
        underlay_sr=u_sr,
        host_target_dbfs=host_target_dbfs,
        underlay_target_dbfs=underlay_target_dbfs,
        duck_db=duck_db,
    )

    mixed_wav = work / "host_with_underlay.wav"
    sf.write(str(mixed_wav), mixed, sr)

    out = Path(video_out)
    remux_audio_into_video(video_in, mixed_wav, out)
    return out
