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
# Sem 'noise' de proposito: o gerador de ruido por pixel/frame e o filtro mais
# caro de todos (dominava o tempo de encode em 4K). O shift geometrico (zoom+
# recrop), o ajuste de cor (eq/hue) e o proprio re-encode ja mudam a matriz de
# pixels o suficiente pra quebrar perceptual-hash, sem custo de CPU relevante.
def _main_video_filter(w: int, h: int) -> str:
    return (
        f"scale=iw*1.02:ih*1.02,crop={w}:{h},"
        "eq=brightness=0.012:contrast=1.025:saturation=1.03:gamma=1.012,"
        "hue=h=2,setsar=1"
    )


_AAC = ["-c:a", "aac", "-b:a", "128k"]
_AFMT = "aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=48000"


def _source_kbps(in_path: Path, duration: float) -> int | None:
    """Taxa de bits media aproximada da entrada (kbps), via tamanho/duracao.

    Usada pra capar a saida perto do original e evitar que o re-encode infle o
    arquivo (o objetivo e uma alteracao leve, nao subir a qualidade/bitrate)."""
    try:
        size_bytes = in_path.stat().st_size
    except OSError:
        return None
    if duration <= 0 or size_bytes <= 0:
        return None
    return int(size_bytes * 8 / duration / 1000)


def _x264_args(target_kbps: int | None) -> list[str]:
    """libx264 'constrained quality': CRF pela qualidade + maxrate capando o
    tamanho perto do original. preset veryfast = bom equilibrio velocidade/peso."""
    args = [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-threads", "0",
    ]
    if target_kbps and target_kbps > 0:
        # headroom de 15% sobre a media da entrada (que inclui audio); bufsize 2x.
        maxrate = max(300, int(target_kbps * 1.15))
        args += ["-maxrate", f"{maxrate}k", "-bufsize", f"{maxrate * 2}k"]
    return args


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
    x264 = _x264_args(_source_kbps(in_path, info.duration))
    cover_path = Path(cover).resolve() if cover else None
    if cover_path is not None and not cover_path.exists():
        cover_path = None

    if cover_path is None:
        _emit(progress, 35, "aplicando filtro imperceptivel")
        args = ["ffmpeg", "-y", "-i", str(in_path), "-vf", main_vf, *x264]
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
        *x264,
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
