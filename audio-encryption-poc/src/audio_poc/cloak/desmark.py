"""Desmark de criativo: filtro imperceptivel + frame inicial opcional.

Objetivo: "desmarcar" um video pro algoritmo da plataforma achar que e outro
criativo (quebrar perceptual-hash / fingerprint) sem mudanca visivel pro humano.

Tecnica (nivel unico, automatico):
- shift geometrico leve: zoom 2% + recrop pro tamanho original (desloca os pixels);
- ajuste de cor minimo: eq (brilho/contraste/saturacao/gamma) + hue ~2 graus;
- ruido temporal leve;
- re-encode (libx264) + strip de metadados + faststart -> muda o hash do arquivo.

Opcional: prependa uma imagem como NOVO primeiro frame por ``intro_seconds`` (a
duracao aumenta um pouco). O audio do criativo e preservado (re-encode AAC).

Sem torch: roda em CPU via ffmpeg.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .ffmpeg_utils import ensure_ffmpeg, run_ffmpeg, probe_media


ProgressFn = Callable[[int, str], None] | None


def _emit(progress: ProgressFn, pct: int, msg: str) -> None:
    if progress is not None:
        progress(pct, msg)


# Filtro imperceptivel aplicado ao video original. {W}/{H} = dimensoes originais.
def _main_video_filter(w: int, h: int) -> str:
    return (
        f"scale=iw*1.02:ih*1.02,crop={w}:{h},"
        "eq=brightness=0.012:contrast=1.025:saturation=1.03:gamma=1.012,"
        "hue=h=2,noise=alls=5:allf=t,setsar=1"
    )


_X264 = ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
_AAC = ["-c:a", "aac", "-b:a", "192k"]
_AFMT = "aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000"


def desmark_video(
    input_path: str | Path,
    output_path: str | Path,
    cover: str | Path | None = None,
    intro_seconds: float = 0.4,
    progress: ProgressFn = None,
) -> dict[str, Any]:
    ensure_ffmpeg()
    in_path = Path(input_path).resolve()
    out_path = Path(output_path).resolve()
    if not in_path.exists():
        raise FileNotFoundError(in_path)

    _emit(progress, 10, "analisando video")
    info = probe_media(in_path)
    if not info.has_video:
        raise RuntimeError("Input nao tem faixa de video.")
    w = info.width if info.width > 0 else 720
    h = info.height if info.height > 0 else 1280
    fps = info.fps if info.fps and info.fps > 0 else 30.0
    has_audio = info.has_audio
    out_path.parent.mkdir(parents=True, exist_ok=True)

    main_vf = _main_video_filter(w, h)
    cover_path = Path(cover).resolve() if cover else None
    if cover_path is not None and not cover_path.exists():
        cover_path = None

    if cover_path is None:
        _emit(progress, 35, "aplicando filtro imperceptivel")
        args = ["ffmpeg", "-y", "-i", str(in_path), "-vf", main_vf, *_X264]
        if has_audio:
            args += _AAC
        else:
            args += ["-an"]
        args += ["-map_metadata", "-1", "-movflags", "+faststart", str(out_path)]
        run_ffmpeg(args)
        _emit(progress, 100, "concluido")
        return {
            "output": str(out_path),
            "kind": "filter",
            "technique": "desmark_filter",
            "cover": False,
        }

    # Com capa: prepend de um novo primeiro frame por intro_seconds.
    _emit(progress, 35, "inserindo frame inicial + filtro")
    fps_s = f"{fps:.5f}"
    intro = max(0.1, float(intro_seconds))
    parts = [
        f"[0:v]scale={w}:{h},setsar=1,fps={fps_s},format=yuv420p[intro]",
        f"[1:v]{main_vf},fps={fps_s},format=yuv420p[main]",
        "[intro][main]concat=n=2:v=1:a=0[v]",
    ]
    maps = ["-map", "[v]"]
    audio_codec: list[str] = ["-an"]
    if has_audio:
        parts += [
            f"anullsrc=r=48000:cl=stereo,atrim=0:{intro:.3f},{_AFMT}[sil]",
            f"[1:a]{_AFMT}[aa]",
            "[sil][aa]concat=n=2:v=0:a=1[a]",
        ]
        maps += ["-map", "[a]"]
        audio_codec = _AAC

    filter_complex = ";".join(parts)
    args = [
        "ffmpeg", "-y",
        "-loop", "1", "-t", f"{intro:.3f}", "-i", str(cover_path),
        "-i", str(in_path),
        "-filter_complex", filter_complex,
        *maps,
        *_X264,
        *audio_codec,
        "-map_metadata", "-1", "-movflags", "+faststart",
        str(out_path),
    ]
    run_ffmpeg(args)
    _emit(progress, 100, "concluido")
    return {
        "output": str(out_path),
        "kind": "filter",
        "technique": "desmark_filter_intro",
        "cover": True,
    }
