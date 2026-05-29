"""Phase-cancel cloak (modo Maximo / anti-AssemblyAI).

Tecnica principal (do repo Cloaker-de-Audio-e-Video): monta um estereo onde

    L = decoy + original
    R = decoy - original

O downmix mono que TODA ASR usa por padrao (Whisper, AssemblyAI, Gemini),
``(L+R)/2``, vira **somente o decoy** — as palavras reais se cancelam
matematicamente. O humano em estereo recupera o original via ``(L-R)/2``.

Camadas extras:
- ruido HF (14-18 kHz) somado *em fase* nos dois canais -> sobrevive ao mono
  (polui fingerprint) e some no canal lateral (humano nao escuta).
- notches anti-consoante (1500/2800/4500 Hz, do smudge "Lyric Scrub") aplicados
  de leve no original, pra degradar qualquer vazamento de transcricao caso a ASR
  processe os canais separadamente.

Sem torch / sem Whisper: roda em CPU em segundos.

Trade-off honesto: em playback MONO (alguns alto-falantes de celular) o humano
ouve so o decoy. Em estereo/fone, ouve o original. E o jeito do maskai/Meta-ads.
"""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Callable

import numpy as np
import soundfile as sf
from scipy import signal as sp_signal

from .ffmpeg_utils import ensure_ffmpeg, run_ffmpeg, probe_media
from .targets import get_target
from .audio.tts_underlay import generate_tts_underlay


ProgressFn = Callable[[int, str], None] | None


def _emit(progress: ProgressFn, pct: int, msg: str) -> None:
    if progress is not None:
        progress(pct, msg)


def _rms_normalize(x: np.ndarray, target_dbfs: float) -> np.ndarray:
    rms = float(np.sqrt(np.mean(x**2) + 1e-12))
    if rms < 1e-9:
        return x.astype(np.float32)
    return (x * (10 ** (target_dbfs / 20.0) / rms)).astype(np.float32)


def _loop_to_length(x: np.ndarray, n: int) -> np.ndarray:
    if x.shape[0] >= n:
        return x[:n]
    reps = int(np.ceil(n / max(1, x.shape[0])))
    return np.tile(x, reps)[:n]


def _bandlimited_noise(n: int, sr: int, lo: float, hi: float, target_dbfs: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    white = rng.standard_normal(n).astype(np.float32)
    nyq = sr / 2.0
    hi = min(hi, nyq - 500.0)
    if hi <= lo:
        return np.zeros(n, dtype=np.float32)
    sos = sp_signal.butter(4, [lo / nyq, hi / nyq], btype="band", output="sos")
    band = sp_signal.sosfilt(sos, white).astype(np.float32)
    return _rms_normalize(band, target_dbfs)


# Notches anti-consoante (smudge "Lyric Scrub"): (freq_hz, largura_hz).
_CONSONANT_NOTCHES = ((1500.0, 300.0), (2800.0, 400.0), (4500.0, 500.0))


def _consonant_scrub(mono: np.ndarray, sr: int, depth: float = 0.6) -> np.ndarray:
    """Atenua bandas de consoante (mix dry/wet) pra degradar ASR sem destruir
    a inteligibilidade pro humano. ``depth`` 0..1 = quanto do sinal notchado
    substitui o original."""
    if depth <= 0:
        return mono
    nyq = sr / 2.0
    wet = mono.astype(np.float32).copy()
    for f, bw in _CONSONANT_NOTCHES:
        if f >= nyq:
            continue
        q = max(1.0, f / max(1.0, bw))
        b, a = sp_signal.iirnotch(f / nyq, q)
        wet = sp_signal.filtfilt(b, a, wet).astype(np.float32)
    return ((1.0 - depth) * mono + depth * wet).astype(np.float32)


def build_phase_cancel(
    host_stereo: np.ndarray,
    sr: int,
    decoy_mono: np.ndarray,
    decoy_sr: int,
    decoy_dbfs: float = -18.0,
    orig_dbfs: float = -1.0,
    pink_dbfs: float = -50.0,
    scrub_depth: float = 0.6,
    seed: int = 1234,
) -> np.ndarray:
    """Monta o estereo phase-cancel. Retorna array (n, 2) float32."""
    orig = host_stereo.mean(axis=1).astype(np.float32)
    if scrub_depth > 0:
        orig = _consonant_scrub(orig, sr, depth=scrub_depth)
    orig = _rms_normalize(orig, orig_dbfs)
    n = orig.shape[0]

    if decoy_sr != sr:
        m = int(decoy_mono.shape[0] * sr / decoy_sr)
        decoy_mono = sp_signal.resample(decoy_mono, m).astype(np.float32)
    decoy = _loop_to_length(decoy_mono.astype(np.float32), n)
    decoy = _rms_normalize(decoy, decoy_dbfs)

    noise = _bandlimited_noise(n, sr, 14000.0, 18000.0, pink_dbfs, seed)

    left = decoy + orig + noise
    right = decoy - orig + noise
    out = np.stack([left, right], axis=1).astype(np.float32)
    peak = float(np.max(np.abs(out)) + 1e-9)
    if peak > 0.99:
        out *= 0.99 / peak
    return out.astype(np.float32)


def _encode_audio(src_wav: Path, dst: Path) -> None:
    """Codifica MANTENDO estereo (critico pro phase-cancel) e bitrate alto
    (reduz vazamento do original no mono por causa do codec lossy)."""
    ext = dst.suffix.lower()
    if ext in (".m4a", ".aac", ".mp4"):
        codec = ["-c:a", "aac", "-b:a", "256k"]
    elif ext == ".wav":
        codec = ["-c:a", "pcm_s16le"]
    else:
        codec = ["-c:a", "libmp3lame", "-b:a", "256k"]
    dst.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(
        ["ffmpeg", "-y", "-i", str(src_wav), "-ac", "2", "-map_metadata", "-1", *codec, str(dst)]
    )


def _remux_phase_into_video(video_src: Path, audio_wav: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(
        [
            "ffmpeg", "-y",
            "-i", str(video_src),
            "-i", str(audio_wav),
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "256k", "-ac", "2",
            "-map_metadata", "-1", "-movflags", "+faststart",
            "-shortest", str(dst),
        ]
    )


def _extract_host(in_path: Path, dst_wav: Path) -> None:
    run_ffmpeg(
        [
            "ffmpeg", "-y", "-i", str(in_path),
            "-vn", "-ac", "2", "-ar", "48000",
            "-c:a", "pcm_s16le", str(dst_wav),
        ]
    )


def cloak_phase(
    input_path: str | Path,
    output_path: str | Path,
    target_preset: str,
    decoy_dbfs: float = -18.0,
    orig_dbfs: float = -1.0,
    scrub_depth: float = 0.6,
    tts_speech_rate: int = 170,
    progress: ProgressFn = None,
) -> dict[str, Any]:
    """Phase-cancel cloak para AUDIO ou VIDEO (detecta automaticamente).

    Para video: extrai audio -> phase-cancel -> remuxa no container original +
    limpa metadados. Para audio: gera o arquivo phase-cancel direto.
    """
    ensure_ffmpeg()
    target = get_target(target_preset)
    in_path = Path(input_path).resolve()
    out_path = Path(output_path).resolve()
    if not in_path.exists():
        raise FileNotFoundError(in_path)

    info = probe_media(in_path)
    if not info.has_audio:
        raise RuntimeError("Input nao tem faixa de audio.")
    is_video = info.has_video

    _emit(progress, 8, "extraindo audio")
    with TemporaryDirectory(prefix="phase_") as td:
        wd = Path(td)
        src_wav = wd / "host.wav"
        _extract_host(in_path, src_wav)
        host, sr = sf.read(str(src_wav), always_2d=True, dtype="float32")
        if host.shape[1] == 1:
            host = np.repeat(host, 2, axis=1)
        elif host.shape[1] > 2:
            host = host[:, :2]

        _emit(progress, 30, "gerando decoy (TTS do topico-alvo)")
        decoy, dsr = generate_tts_underlay(target, wd, sample_rate=sr, tts_speech_rate=tts_speech_rate)

        _emit(progress, 60, "montando phase-cancel estereo")
        out = build_phase_cancel(
            host, sr, decoy, dsr,
            decoy_dbfs=decoy_dbfs, orig_dbfs=orig_dbfs, scrub_depth=scrub_depth,
        )
        out_wav = wd / "phase.wav"
        sf.write(str(out_wav), out, sr)

        _emit(progress, 85, "codificando saida")
        if is_video:
            _remux_phase_into_video(in_path, out_wav, out_path)
        else:
            _encode_audio(out_wav, out_path)

    _emit(progress, 100, "concluido")
    return {
        "output": str(out_path),
        "kind": "video" if is_video else "audio",
        "target_preset": target_preset,
        "technique": "phase_cancel_stereo",
    }
