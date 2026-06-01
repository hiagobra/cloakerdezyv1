"""Redimensionamento de criativo (aba Redimensionar).

Objetivo: entregar o video no formato recomendado pra subir campanhas, em 720p:
- ``tiktok`` -> 9:16 (720x1280);
- ``square`` -> 1:1 (720x720).

Encaixe por crop: a imagem preenche o quadro (sem barras pretas), cortando o
excesso das bordas. Re-encode leve (libx264 veryfast) + faststart. Audio
preservado (AAC 128k) ou ausente. Sem torch: roda em CPU via ffmpeg.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .ffmpeg_utils import ensure_ffmpeg, run_ffmpeg, probe_media


ProgressFn = Callable[[int, str], None] | None

# Formatos suportados -> (largura, altura) em 720p.
FORMATS: dict[str, tuple[int, int]] = {
    "tiktok": (720, 1280),
    "square": (720, 720),
}


def _emit(progress: ProgressFn, pct: int, msg: str) -> None:
    if progress is not None:
        progress(pct, msg)


def _scale_crop_filter(w: int, h: int) -> str:
    # Escala cobrindo o quadro alvo (force_original_aspect_ratio=increase) e
    # corta o excedente no centro -> preenche sem barras pretas.
    return (
        f"scale={w}:{h}:force_original_aspect_ratio=increase,"
        f"crop={w}:{h},setsar=1"
    )


def resize_video(
    input_path: str | Path,
    output_path: str | Path,
    fmt: str = "tiktok",
    progress: ProgressFn = None,
) -> dict[str, Any]:
    ensure_ffmpeg()
    in_path = Path(input_path).resolve()
    out_path = Path(output_path).resolve()
    if not in_path.exists():
        raise FileNotFoundError(in_path)

    w, h = FORMATS.get(fmt, FORMATS["tiktok"])

    _emit(progress, 10, "analisando video")
    info = probe_media(in_path)
    if not info.has_video:
        raise RuntimeError("Input nao tem faixa de video.")
    has_audio = info.has_audio
    out_path.parent.mkdir(parents=True, exist_ok=True)

    _emit(progress, 35, f"redimensionando para {w}x{h}")
    args = [
        "ffmpeg", "-y",
        "-i", str(in_path),
        "-vf", _scale_crop_filter(w, h),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-threads", "0",
    ]
    if has_audio:
        args += ["-c:a", "aac", "-b:a", "128k"]
    else:
        args += ["-an"]
    args += ["-map_metadata", "-1", "-movflags", "+faststart", str(out_path)]
    run_ffmpeg(args)

    _emit(progress, 100, "concluido")
    return {
        "output": str(out_path),
        "kind": "resize",
        "format": fmt,
        "width": w,
        "height": h,
    }
