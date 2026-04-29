"""Helpers to run protection pipeline on video/audio uploads."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from .io_utils import read_audio_stereo, write_audio
from .pipeline import apply_protection_pipeline

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac"}


@dataclass
class ProcessingResult:
    output_path: Path
    log_text: str


def _ensure_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            "ffmpeg nao encontrado no PATH. Instale ffmpeg e reinicie o terminal."
        )


def _run_ffmpeg(args: list[str]) -> None:
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"ffmpeg falhou: {err[:1200]}")


def process_uploaded_media(
    source_path: str | Path,
    preset: str,
    output_dir: str | Path,
) -> ProcessingResult:
    source = Path(source_path)
    suffix = source.suffix.lower()
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now().strftime("%Y%m%d_%H%M%S")
    target_stem = f"{source.stem}.protected.{preset}.{now}"
    out_audio = out_dir / f"{target_stem}.wav"
    out_video = out_dir / f"{target_stem}.mp4"

    logs: list[str] = [f"arquivo: {source.name}", f"preset: {preset}"]
    is_video = suffix in VIDEO_EXTENSIONS
    is_audio = suffix in AUDIO_EXTENSIONS
    if not is_video and not is_audio:
        raise RuntimeError(f"Formato nao suportado: {suffix or 'sem extensao'}")

    with TemporaryDirectory(prefix="audio_protect_") as tmp:
        tmp_dir = Path(tmp)
        extracted_wav = tmp_dir / "extracted.wav"
        protected_wav = tmp_dir / "protected.wav"

        if is_video:
            _ensure_ffmpeg()
            logs.append("etapa: extraindo audio do video")
            _run_ffmpeg(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(source),
                    "-vn",
                    "-ac",
                    "2",
                    "-ar",
                    "48000",
                    "-c:a",
                    "pcm_s16le",
                    str(extracted_wav),
                ]
            )
            input_audio_path = extracted_wav
        else:
            input_audio_path = source

        logs.append("etapa: aplicando pipeline de protecao")
        audio, sr = read_audio_stereo(input_audio_path)
        result = apply_protection_pipeline(audio, sr, preset_name=preset)
        write_audio(protected_wav, result.audio, sr)
        logs.append(f"snr_estimado_db: {result.snr_db_estimate:.2f}")

        if is_video:
            logs.append("etapa: remontando video com audio protegido")
            _run_ffmpeg(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(source),
                    "-i",
                    str(protected_wav),
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-c:v",
                    "copy",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-shortest",
                    str(out_video),
                ]
            )
            final_path = out_video
        else:
            write_audio(out_audio, result.audio, sr)
            final_path = out_audio

    return ProcessingResult(output_path=final_path, log_text="\n".join(logs))
