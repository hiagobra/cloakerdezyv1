"""Shared ffmpeg helpers (probe, run, extract, remux)."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class MediaInfo:
    duration: float
    width: int
    height: int
    fps: float
    has_video: bool
    has_audio: bool


def ensure_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        raise RuntimeError(
            "ffmpeg/ffprobe não encontrados no PATH. Instale ffmpeg e tente novamente."
        )


def run_ffmpeg(args: list[str]) -> None:
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"ffmpeg falhou: {err[-1500:]}")


def run_ffprobe(args: list[str]) -> str:
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"ffprobe falhou: {err[-1500:]}")
    return proc.stdout


def probe_media(path: str | Path) -> MediaInfo:
    ensure_ffmpeg()
    out = run_ffprobe(
        [
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_streams", "-show_format", str(path),
        ]
    )
    data = json.loads(out)
    streams = data.get("streams", [])
    fmt = data.get("format", {})

    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)

    duration = float(fmt.get("duration", 0.0) or 0.0)
    width = int(video.get("width", 0)) if video else 0
    height = int(video.get("height", 0)) if video else 0

    fps = 0.0
    if video and video.get("r_frame_rate"):
        try:
            num, den = video["r_frame_rate"].split("/")
            den_f = float(den)
            fps = float(num) / den_f if den_f != 0 else 0.0
        except (ValueError, ZeroDivisionError):
            fps = 0.0

    return MediaInfo(
        duration=duration,
        width=width,
        height=height,
        fps=fps,
        has_video=video is not None,
        has_audio=audio is not None,
    )


def extract_audio_wav(src: str | Path, dst: str | Path, sample_rate: int = 48000) -> None:
    ensure_ffmpeg()
    run_ffmpeg(
        [
            "ffmpeg", "-y", "-i", str(src),
            "-vn", "-ac", "2", "-ar", str(sample_rate),
            "-c:a", "pcm_s16le", str(dst),
        ]
    )


def remux_audio_into_video(
    video_src: str | Path,
    audio_src: str | Path,
    dst: str | Path,
    audio_codec: str = "aac",
    audio_bitrate: str = "192k",
) -> None:
    ensure_ffmpeg()
    run_ffmpeg(
        [
            "ffmpeg", "-y",
            "-i", str(video_src),
            "-i", str(audio_src),
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy", "-c:a", audio_codec, "-b:a", audio_bitrate,
            "-shortest", str(dst),
        ]
    )
