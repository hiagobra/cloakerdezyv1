"""Naturalistic brand-logo overlay (lineage of MVPatch / Adv-Makeup, item 3.10
of pesquisa.md).

Why this layer exists:
VLMs (Gemini included) put much heavier weight on **brand cues** than on
generic topic text overlays. A small, plausible-looking badge in the corner
("EduInvest BR", "Nutri Macros", "GymLab Pro") biases the captioning model
toward the target topic far more efficiently than the same number of pixels
spent on a sentence.

The badge is rendered procedurally with PIL (no shipped art assets) using:

- A rounded rectangle background filled in dark slate.
- A 2 px accent border in ``target.brand_color``.
- Two text rows: a small ``"BRAND"`` label in the accent color, and the
  ``brand_label`` itself in white.

The PNG is then composited on the video corner via ffmpeg's ``overlay``
filter with optional ``enable=`` expression to limit it to keyframes (sparse
mode, item 3.14 Wei et al.).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..ffmpeg_utils import ensure_ffmpeg, probe_media, run_ffmpeg
from ..targets import TopicTarget


_POSITION_TO_OVERLAY_XY = {
    "corner_br": "W-w-24:H-h-24",
    "corner_bl": "24:H-h-24",
    "corner_tr": "W-w-24:24",
    "corner_tl": "24:24",
}


@dataclass
class BrandOverlayConfig:
    position: str = "corner_br"
    opacity: float = 0.85
    width_ratio: float = 0.14
    keyframes_enable: str | None = None


def _hex_to_rgb(color: str) -> tuple[int, int, int]:
    color = color.strip().lstrip("#")
    if len(color) == 3:
        color = "".join(c * 2 for c in color)
    if len(color) != 6:
        return (157, 107, 255)
    return (
        int(color[0:2], 16),
        int(color[2:4], 16),
        int(color[4:6], 16),
    )


def _load_font(size: int):
    from PIL import ImageFont

    candidates = [
        "/Library/Fonts/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf",
    ]
    for c in candidates:
        try:
            return ImageFont.truetype(c, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_brand_badge_png(
    target: TopicTarget,
    dst: str | Path,
    badge_width: int = 320,
) -> Path:
    """Render the brand badge as a transparent PNG sized roughly badge_width."""
    try:
        from PIL import Image, ImageDraw
    except ImportError as exc:
        raise RuntimeError("Pillow ausente. Rode: pip install Pillow") from exc

    label = (target.brand_label or "").strip()
    if not label:
        raise ValueError(f"target {target.key!r} sem brand_label definido")

    accent = _hex_to_rgb(target.brand_color or "#9d6bff")
    badge_w = max(160, int(badge_width))
    badge_h = max(56, int(badge_w * 0.32))

    img = Image.new("RGBA", (badge_w, badge_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    radius = int(badge_h * 0.32)
    bg = (18, 18, 26, 235)
    draw.rounded_rectangle((0, 0, badge_w - 1, badge_h - 1), radius=radius, fill=bg)

    border_alpha = (*accent, 255)
    draw.rounded_rectangle(
        (1, 1, badge_w - 2, badge_h - 2),
        radius=radius - 1,
        outline=border_alpha,
        width=2,
    )

    pad_x = int(badge_h * 0.32)
    accent_dot_r = max(4, int(badge_h * 0.16))
    cy = badge_h // 2
    draw.ellipse(
        (pad_x, cy - accent_dot_r, pad_x + 2 * accent_dot_r, cy + accent_dot_r),
        fill=border_alpha,
    )

    label_x = pad_x + 2 * accent_dot_r + int(badge_h * 0.28)
    label_font_size = max(14, int(badge_h * 0.42))
    sub_font_size = max(9, int(badge_h * 0.22))
    label_font = _load_font(label_font_size)
    sub_font = _load_font(sub_font_size)

    sub_y = int(badge_h * 0.16)
    label_y = sub_y + sub_font_size + int(badge_h * 0.04)

    sub_text = "OFFICIAL CHANNEL"
    draw.text((label_x, sub_y), sub_text, font=sub_font, fill=(*accent, 230))
    draw.text((label_x, label_y), label, font=label_font, fill=(245, 245, 250, 240))

    out = Path(dst)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG")
    return out


def apply_brand_overlay(
    video_in: str | Path,
    target: TopicTarget,
    video_out: str | Path,
    workdir: str | Path,
    cfg: BrandOverlayConfig | None = None,
    crf: int = 20,
) -> Path:
    """Render badge for ``target`` and composite it onto ``video_in``.

    No-op (just copies the file) if ``target.brand_label`` is empty.
    """
    ensure_ffmpeg()
    out = Path(video_out)
    out.parent.mkdir(parents=True, exist_ok=True)

    label = (target.brand_label or "").strip()
    if not label:
        import shutil

        shutil.copy2(video_in, out)
        return out

    cfg = cfg or BrandOverlayConfig()
    work = Path(workdir)
    work.mkdir(parents=True, exist_ok=True)

    info = probe_media(video_in)
    badge_w = max(180, int(info.width * cfg.width_ratio))
    badge_png = render_brand_badge_png(
        target,
        work / f"brand_badge_{target.key}.png",
        badge_width=badge_w,
    )

    xy = _POSITION_TO_OVERLAY_XY.get(cfg.position, _POSITION_TO_OVERLAY_XY["corner_br"])
    opacity = max(0.0, min(1.0, float(cfg.opacity)))

    overlay_filter = (
        f"[1:v]format=rgba,colorchannelmixer=aa={opacity:.3f}[badge];"
        f"[0:v][badge]overlay={xy}"
    )
    if cfg.keyframes_enable:
        overlay_filter += f":enable='{cfg.keyframes_enable}'"
    overlay_filter += "[v]"

    args = [
        "ffmpeg", "-y",
        "-i", str(video_in),
        "-i", str(badge_png),
        "-filter_complex", overlay_filter,
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
        "-c:a", "copy",
        str(out),
    ]
    run_ffmpeg(args)
    return out
