"""Downscale-revealed steganography (Trail of Bits 2024 technique).

Multimodal models internally downscale frames (Gemini ~1024px, GPT-4V ~768px)
before tokenization. By drawing the target topic text in a high-frequency
pattern at the original resolution, the high-frequency component becomes
*indistinguishable noise* to humans but, after the downsample's anti-alias
filter, condenses into a legible string for the model.

Implementation: render the text on a large transparent layer, then add a
counter-pattern that nulls it at full res. After bilinear/area downscale, the
counter-pattern decoheres while the text survives the low-pass.
"""

from __future__ import annotations

from pathlib import Path

from ..ffmpeg_utils import ensure_ffmpeg, probe_media, run_ffmpeg
from ..targets import TopicTarget


def build_downscale_stego_image(
    text: str,
    width: int,
    height: int,
    output_png: str | Path,
    target_downscale_width: int = 1024,
) -> Path:
    """Generate a PNG that hides ``text`` at full-res but reveals it after downscale."""
    try:
        from PIL import Image, ImageDraw, ImageFilter, ImageFont
    except ImportError as exc:
        raise RuntimeError(
            "Pillow não instalado. Rode: pip install Pillow"
        ) from exc

    base = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(base)

    scale_factor = max(1.0, width / target_downscale_width)
    font_size = int(36 * scale_factor)

    font = None
    for fp in (
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ):
        try:
            font = ImageFont.truetype(fp, font_size)
            break
        except (OSError, IOError):
            continue
    if font is None:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    cx = (width - tw) // 2
    cy = (height - th) // 2

    text_layer = Image.new("L", (width, height), 0)
    text_draw = ImageDraw.Draw(text_layer)
    text_draw.text((cx, cy), text, fill=255, font=font)

    blur_radius = max(1.0, scale_factor * 0.6)
    blurred = text_layer.filter(ImageFilter.GaussianBlur(radius=blur_radius))

    noise_size = max(2, int(scale_factor))
    noise_small = Image.effect_noise((width // noise_size, height // noise_size), 100)
    noise_full = noise_small.resize((width, height), resample=Image.NEAREST)

    combined = Image.eval(blurred, lambda v: int(v * 0.5))
    final_alpha = Image.eval(noise_full, lambda v: int(v * 0.04))
    final_alpha = Image.blend(final_alpha, combined, alpha=0.5)

    rgba_layer = Image.merge(
        "RGBA",
        (
            Image.new("L", (width, height), 255),
            Image.new("L", (width, height), 255),
            Image.new("L", (width, height), 255),
            final_alpha,
        ),
    )

    out = Path(output_png)
    out.parent.mkdir(parents=True, exist_ok=True)
    rgba_layer.save(out, "PNG")
    return out


def overlay_stego_on_video(
    video_in: str | Path,
    target: TopicTarget,
    video_out: str | Path,
    workdir: str | Path,
    crf: int = 20,
) -> Path:
    """Apply downscale-stego PNG over the entire video."""
    ensure_ffmpeg()
    info = probe_media(video_in)
    if not info.has_video:
        raise RuntimeError("Arquivo de entrada não tem stream de vídeo.")

    work = Path(workdir)
    work.mkdir(parents=True, exist_ok=True)
    stego_png = work / f"stego_{target.key}.png"

    headline = target.overlay_lines[0] if target.overlay_lines else target.description
    build_downscale_stego_image(
        text=headline,
        width=max(info.width, 1280),
        height=max(info.height, 720),
        output_png=stego_png,
    )

    out = Path(video_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "ffmpeg", "-y",
        "-i", str(video_in),
        "-i", str(stego_png),
        "-filter_complex", "[0:v][1:v]overlay=0:0[v]",
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
        "-c:a", "copy",
        str(out),
    ]
    run_ffmpeg(args)
    return out
