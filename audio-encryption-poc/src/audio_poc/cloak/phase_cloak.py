"""Phase-cancel cloak (modo Maximo / anti-AssemblyAI) — replica do Maskai.

Engenharia reversa do output real do Maskai (``strategy:"dual"`` + ``audioEncryption``):
medimos o arquivo deles e a tecnica e a mais limpa possivel — **anti-fase pura**:

    L = +voz
    R = -voz

O downmix mono que TODA ASR usa por padrao (Whisper, AssemblyAI, Gemini),
``(L+R)/2 = (v + (-v))/2 = 0`` -> a voz **se cancela** -> transcricao vazia/lixo.
O humano em estereo (fone/celular) recupera a voz intacta via ``(L-R)/2 = v``.

Medicao do arquivo do Maskai que confirma isso:
- correlacao L/R = -0.99 (anti-fase quase perfeita)
- MID (L+R)/2 = -51 dBFS (silencio -> ASR nao ouve nada)
- SIDE (L-R)/2 = -26 dBFS (voz no nivel original -> humano ouve normal)
- HF balanceado, sem ruido extra, sem scrub: **e so fase**.

Por isso, por padrao NAO adicionamos decoy, ruido HF nem notch de consoante — eles
deixariam residuo audivel no mono (a ASR transcreveria) e/ou sujariam a voz pro
humano. Esses extras existem como parametros opcionais para A/B, mas ficam OFF.

Sem torch / sem Whisper: roda em CPU em segundos.

Trade-off honesto (mesmo do Maskai): em playback estritamente MONO (somando L+R)
a voz some. Em estereo/fone (a esmagadora maioria) o humano ouve perfeito; o
pipeline de moderacao/transcricao baixa pra mono e nao ouve nada.
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


# Notches anti-consoante (smudge "Lyric Scrub"): (freq_hz, largura_hz). OPCIONAL.
_CONSONANT_NOTCHES = ((1500.0, 300.0), (2800.0, 400.0), (4500.0, 500.0))


def _consonant_scrub(mono: np.ndarray, sr: int, depth: float = 0.6) -> np.ndarray:
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
    decoy_mono: np.ndarray | None = None,
    decoy_sr: int | None = None,
    *,
    decoy_dbfs: float | None = None,
    voice_dbfs: float | None = None,
    pink_dbfs: float | None = None,
    scrub_depth: float = 0.0,
    seed: int = 1234,
) -> np.ndarray:
    """Monta o estereo anti-fase puro (estilo Maskai). Retorna array (n, 2) float32.

    Por padrao (todos os extras None/0): ``L = v``, ``R = -v`` — a voz some no mono.

    Parametros opcionais (OFF por padrao, so pra A/B):
    - ``decoy_dbfs``: se setado + ``decoy_mono`` dado, soma o decoy EM FASE nos dois
      canais (sobrevive ao mono -> ASR transcreve o decoy em vez de silencio).
    - ``pink_dbfs``: se setado, soma ruido HF (14-18 kHz) em fase nos dois canais.
    - ``scrub_depth``: 0..1, notcha consoantes da voz.
    - ``voice_dbfs``: se setado, normaliza a voz por RMS; None = mantem o nivel
      original (o que o Maskai faz — SIDE fica no mesmo nivel da entrada).
    """
    v = host_stereo.mean(axis=1).astype(np.float32)
    if scrub_depth and scrub_depth > 0:
        v = _consonant_scrub(v, sr, depth=scrub_depth)
    if voice_dbfs is not None:
        v = _rms_normalize(v, voice_dbfs)
    n = v.shape[0]

    left = v.copy()
    right = -v.copy()

    # Componente EM FASE (sobrevive ao downmix mono). OFF por padrao pra bater
    # com o Maskai, que deixa o mono em silencio.
    common = np.zeros(n, dtype=np.float32)
    if decoy_dbfs is not None and decoy_mono is not None:
        d = decoy_mono.astype(np.float32)
        if decoy_sr is not None and decoy_sr != sr:
            m = int(d.shape[0] * sr / decoy_sr)
            d = sp_signal.resample(d, m).astype(np.float32)
        d = _loop_to_length(d, n)
        common = common + _rms_normalize(d, decoy_dbfs)
    if pink_dbfs is not None:
        common = common + _bandlimited_noise(n, sr, 14000.0, 18000.0, pink_dbfs, seed)

    if np.any(common):
        left = left + common
        right = right + common

    out = np.stack([left, right], axis=1).astype(np.float32)
    peak = float(np.max(np.abs(out)) + 1e-9)
    if peak > 0.99:
        out *= 0.99 / peak
    return out.astype(np.float32)


def _encode_audio(src_wav: Path, dst: Path) -> None:
    """Codifica MANTENDO estereo (critico pro phase-cancel) e bitrate alto.

    AAC joint-stereo (M/S) representa exatamente mid/side: com anti-fase o mid e
    ~silencio (barato) e o side carrega tudo, entao a inversao de fase sobrevive
    ao codec (confirmado: o proprio Maskai entrega AAC com corr -0.99).
    """
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
    """Remuxa o audio anti-fase no video original.

    NAO usa ``-shortest``: alguns criativos tem o stream de video mais curto que
    o audio (ex.: end-card congelado com locucao continuando). ``-shortest``
    cortaria no fim do video e perderia segundos de audio. Igual ao Maskai,
    preservamos a duracao total do audio e o player segura o ultimo frame.
    """
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
            str(dst),
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
    *,
    decoy_dbfs: float | None = None,
    voice_dbfs: float | None = None,
    scrub_depth: float = 0.0,
    pink_dbfs: float | None = None,
    tts_speech_rate: int = 170,
    progress: ProgressFn = None,
) -> dict[str, Any]:
    """Phase-cancel cloak para AUDIO ou VIDEO (detecta automaticamente).

    Default = Maskai puro (anti-fase, sem decoy/ruido/scrub). O ``target_preset``
    so e usado se ``decoy_dbfs`` for setado (modo A/B com isca audivel no mono).
    """
    ensure_ffmpeg()
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

        decoy = None
        dsr = None
        if decoy_dbfs is not None:
            _emit(progress, 30, "gerando decoy (TTS do topico-alvo)")
            target = get_target(target_preset)
            decoy, dsr = generate_tts_underlay(
                target, wd, sample_rate=sr, tts_speech_rate=tts_speech_rate
            )

        _emit(progress, 60, "montando anti-fase estereo")
        out = build_phase_cancel(
            host, sr, decoy, dsr,
            decoy_dbfs=decoy_dbfs, voice_dbfs=voice_dbfs,
            pink_dbfs=pink_dbfs, scrub_depth=scrub_depth,
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
        "technique": "phase_cancel_pure" if decoy_dbfs is None else "phase_cancel_decoy",
    }
