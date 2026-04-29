"""Render target-topic text directly onto frames via ffmpeg drawtext.

Why this is the strongest single vector against multimodal moderators:
Gemini / GPT-4V class models OCR every frame and weight visible text *very*
heavily when classifying topics. A small caption saying "Educação Financeira"
in the corner can flip the model's answer even when the spoken audio is about
something else entirely.

We expose four modes balancing perceptibility vs detection by humans:

- ``visible``        : full-time, semi-transparent corner caption (banner-style).
- ``subtle``         : full-time but with very low alpha + small font.
- ``temporal``       : visible only in first/last seconds (humans skim, OCR fires).
- ``flash``          : single-frame flashes of large central text at low alpha.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..ffmpeg_utils import ensure_ffmpeg, probe_media, run_ffmpeg
from ..targets import TopicTarget


@dataclass
class OverlayConfig:
    mode: str = "subtle"  # visible | subtle | temporal | flash
    font_size: int = 24
    alpha: float = 0.85
    box: bool = True
    box_color: str = "black@0.45"
    text_color: str = "white"
    position: str = "bottom"  # bottom | top | center | corner_tr
    flash_every_seconds: float = 1.5
    flash_duration_seconds: float = 0.08
    temporal_head_seconds: float = 2.0
    temporal_tail_seconds: float = 1.5


def _font_path() -> str | None:
    candidates = [
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("/Library/Fonts/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    ]
    for p in candidates:
        if p.exists():
            return str(p).replace("\\", "/").replace(":", "\\:")
    return None


def _escape_drawtext(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace(",", "\\,")
        .replace("[", "\\[")
        .replace("]", "\\]")
        .replace("%", "\\%")
    )


def _position_xy(position: str) -> tuple[str, str]:
    if position == "top":
        return "(w-text_w)/2", "h*0.06"
    if position == "center":
        return "(w-text_w)/2", "(h-text_h)/2"
    if position == "corner_tr":
        return "w-text_w-h*0.03", "h*0.05"
    return "(w-text_w)/2", "h-text_h-h*0.05"


def _drawtext_filter(
    text: str,
    cfg: OverlayConfig,
    duration_seconds: float,
    extra_enable: str | None = None,
) -> str:
    font = _font_path()
    text_esc = _escape_drawtext(text)
    x_expr, y_expr = _position_xy(cfg.position)

    parts = [
        f"text='{text_esc}'",
        f"fontsize={cfg.font_size}",
        f"fontcolor={cfg.text_color}@{cfg.alpha:.3f}",
        f"x={x_expr}",
        f"y={y_expr}",
    ]
    if font:
        parts.append(f"fontfile='{font}'")
    if cfg.box:
        parts.append("box=1")
        parts.append(f"boxcolor={cfg.box_color}")
        parts.append("boxborderw=8")

    if extra_enable:
        parts.append(f"enable='{extra_enable}'")

    return "drawtext=" + ":".join(parts)


def _build_filtergraph(
    lines: tuple[str, ...],
    cfg: OverlayConfig,
    duration: float,
) -> str:
    if not lines:
        return ""

    if cfg.mode == "visible":
        per_line_dur = max(2.0, duration / len(lines))
        filters = []
        for i, line in enumerate(lines):
            start = i * per_line_dur
            end = min(duration, start + per_line_dur)
            enable = f"between(t,{start:.2f},{end:.2f})"
            filters.append(_drawtext_filter(line, cfg, duration, extra_enable=enable))
        return ",".join(filters)

    if cfg.mode == "subtle":
        sub_cfg = OverlayConfig(
            mode="subtle",
            font_size=max(12, cfg.font_size - 8),
            alpha=min(cfg.alpha, 0.18),
            box=False,
            text_color=cfg.text_color,
            position=cfg.position,
        )
        per_line_dur = max(2.0, duration / len(lines))
        filters = []
        for i, line in enumerate(lines):
            start = i * per_line_dur
            end = min(duration, start + per_line_dur)
            enable = f"between(t,{start:.2f},{end:.2f})"
            filters.append(_drawtext_filter(line, sub_cfg, duration, extra_enable=enable))
        return ",".join(filters)

    if cfg.mode == "temporal":
        head_end = min(cfg.temporal_head_seconds, duration / 2)
        tail_start = max(0.0, duration - cfg.temporal_tail_seconds)
        line_h = lines[0]
        line_t = lines[-1] if len(lines) > 1 else lines[0]
        head_filter = _drawtext_filter(
            line_h, cfg, duration, extra_enable=f"between(t,0,{head_end:.2f})"
        )
        tail_filter = _drawtext_filter(
            line_t, cfg, duration, extra_enable=f"between(t,{tail_start:.2f},{duration:.2f})"
        )
        return head_filter + "," + tail_filter

    if cfg.mode == "flash":
        flash_cfg = OverlayConfig(
            mode="flash",
            font_size=cfg.font_size + 22,
            alpha=min(cfg.alpha, 0.10),
            box=False,
            text_color=cfg.text_color,
            position="center",
        )
        n_flashes = max(1, int(duration / cfg.flash_every_seconds))
        filters = []
        for i in range(n_flashes):
            t0 = i * cfg.flash_every_seconds
            t1 = t0 + cfg.flash_duration_seconds
            if t1 > duration:
                break
            line = lines[i % len(lines)]
            filters.append(
                _drawtext_filter(line, flash_cfg, duration, extra_enable=f"between(t,{t0:.2f},{t1:.2f})")
            )
        if not filters:
            filters.append(_drawtext_filter(lines[0], flash_cfg, duration))
        return ",".join(filters)

    raise ValueError(f"Unknown overlay mode: {cfg.mode}")


def apply_text_overlay(
    video_in: str | Path,
    target: TopicTarget,
    video_out: str | Path,
    cfg: OverlayConfig | None = None,
    crf: int = 20,
) -> Path:
    """Render target.overlay_lines onto video frames according to cfg.mode."""
    ensure_ffmpeg()
    cfg = cfg or OverlayConfig()
    info = probe_media(video_in)
    if not info.has_video:
        raise RuntimeError("Arquivo de entrada não tem stream de vídeo.")

    filtergraph = _build_filtergraph(target.overlay_lines, cfg, info.duration)
    if not filtergraph:
        raise RuntimeError("Filtergraph vazio — preset sem overlay_lines?")

    out = Path(video_out)
    out.parent.mkdir(parents=True, exist_ok=True)

    args = [
        "ffmpeg", "-y",
        "-i", str(video_in),
        "-vf", filtergraph,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
        "-c:a", "copy",
        str(out),
    ]
    run_ffmpeg(args)
    return out
