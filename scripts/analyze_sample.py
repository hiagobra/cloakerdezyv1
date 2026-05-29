"""Analisa o 'fingerprint de cloak' de um arquivo de audio/video.

Uso:
    python scripts/analyze_sample.py samples/maskai.mp4
    python scripts/analyze_sample.py samples/original.mp4 samples/maskai.mp4

Revela se o arquivo usa cancelamento de fase dual-channel (estilo Maskai):
- nº de canais, sample rate, codec
- correlacao de fase entre L e R (negativa forte => phase-cancel)
- energia do MID (L+R)/2 [o que a ASR ouve] vs SIDE (L-R)/2 [o que o humano ouve]
- energia HF acima de 14 kHz (poison de fingerprint)
- metadados do container

Precisa de ffmpeg/ffprobe no PATH + numpy + scipy + soundfile.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy import signal as sp_signal
import soundfile as sf


def _ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True,
    )
    try:
        return json.loads(out.stdout)
    except Exception:
        return {}


def _decode_stereo(path: Path, sr: int = 48000) -> tuple[np.ndarray, int]:
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "x.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(path), "-vn", "-ac", "2", "-ar", str(sr), "-c:a", "pcm_s16le", str(wav)],
            capture_output=True, text=True,
        )
        audio, real_sr = sf.read(str(wav), always_2d=True, dtype="float32")
    return audio, real_sr


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x**2) + 1e-12))


def _dbfs(x: np.ndarray) -> float:
    r = _rms(x)
    return 20.0 * np.log10(r + 1e-12)


def _hf_energy_db(mono: np.ndarray, sr: int, lo: float = 14000.0) -> float:
    nyq = sr / 2.0
    if lo >= nyq:
        return -120.0
    sos = sp_signal.butter(4, lo / nyq, btype="high", output="sos")
    hf = sp_signal.sosfilt(sos, mono).astype(np.float32)
    return _dbfs(hf)


def analyze(path: Path) -> None:
    print(f"\n=== {path.name} ===")
    if not path.exists():
        print("  (arquivo nao encontrado)")
        return

    probe = _ffprobe(path)
    for s in probe.get("streams", []):
        if s.get("codec_type") == "audio":
            print(f"  audio codec : {s.get('codec_name')} | canais declarados: {s.get('channels')} | layout: {s.get('channel_layout')} | sr: {s.get('sample_rate')}")
        if s.get("codec_type") == "video":
            print(f"  video codec : {s.get('codec_name')} | {s.get('width')}x{s.get('height')}")
    tags = (probe.get("format", {}) or {}).get("tags", {}) or {}
    if tags:
        print(f"  metadata    : {tags}")
    else:
        print("  metadata    : (vazio / strip)")

    audio, sr = _decode_stereo(path)
    L = audio[:, 0]
    R = audio[:, 1] if audio.shape[1] > 1 else audio[:, 0]
    mid = (L + R) / 2.0
    side = (L - R) / 2.0

    corr = float(np.corrcoef(L, R)[0, 1]) if audio.shape[1] > 1 else 1.0
    print(f"  L/R corr    : {corr:+.4f}   (perto de -1 => phase-cancel dual-channel)")
    print(f"  MID (L+R)/2 : {_dbfs(mid):.1f} dBFS   <- o que a ASR/mono ouve")
    print(f"  SIDE (L-R)/2: {_dbfs(side):.1f} dBFS   <- o que o humano ouve em estereo")
    print(f"  side - mid  : {(_dbfs(side) - _dbfs(mid)):+.1f} dB   (positivo grande => voz real fica no side, some no mono)")
    print(f"  HF >14kHz   : MID {_hf_energy_db(mid, sr):.1f} dBFS | SIDE {_hf_energy_db(side, sr):.1f} dBFS")

    verdict = []
    if audio.shape[1] > 1 and corr < -0.3:
        verdict.append("DUAL-CHANNEL PHASE-CANCEL detectado")
    if _dbfs(side) - _dbfs(mid) > 6:
        verdict.append("conteudo dominante no SIDE (some no mono) — assinatura maskai")
    if _hf_energy_db(mid, sr) > -55:
        verdict.append("ruido/poison HF presente no mono")
    print(f"  >> {' | '.join(verdict) if verdict else 'sem assinatura de phase-cancel obvia'}")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print("uso: python scripts/analyze_sample.py <arquivo> [arquivo2 ...]")
        sys.exit(1)
    for a in args:
        analyze(Path(a))


if __name__ == "__main__":
    main()
