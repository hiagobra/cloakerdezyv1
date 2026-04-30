"""Optimize an adversarial visual patch on a surrogate VLM (CLIP) and overlay it.

Idea: PGD over a 64x64 patch's pixels to maximize cosine-similarity between the
patch's CLIP image embedding and the target_caption's CLIP text embedding.
A patch with high alignment to "an educational personal finance video" steers
*any* CLIP-derived classifier (and partially transfers to Gemini's vision
encoder, which shares architecture lineage).

Heavy: requires torch + transformers. Lazy-imported.

Caching:
    The optimized patch is **deterministic per (preset, caption, model)** so
    we cache it as a PNG under ``audio-encryption-poc/assets/patches/`` and
    reuse it across every job for that preset (Universal Adversarial Patch
    style, lineage of Moosavi-Dezfooli 2017 + Brown 2017). This turns the
    expensive optimization into a one-shot offline computation that turns the
    per-video cost into a single ffmpeg overlay call.

Sparse keyframes:
    When ``keyframes_only=True`` the overlay only fires on a small window
    around each I-frame (lineage of Wei et al. AAAI 2019 sparse video
    attack), which is what VLMs sample most heavily.
"""

from __future__ import annotations

from pathlib import Path

from ..ffmpeg_utils import (
    build_keyframe_enable_expression,
    ensure_ffmpeg,
    list_keyframe_times,
    probe_media,
    run_ffmpeg,
)
from ..targets import TopicTarget


def default_patch_cache_dir() -> Path:
    """``audio-encryption-poc/assets/patches/`` resolved relative to this file."""
    return Path(__file__).resolve().parents[3] / "assets" / "patches"


def optimize_clip_patch(
    target_caption: str,
    patch_size: int = 64,
    iters: int = 600,
    lr: float = 0.05,
    seed: int = 1234,
    model_name: str = "openai/clip-vit-base-patch32",
):
    """Return a (patch_size, patch_size, 3) uint8 numpy array."""
    try:
        import numpy as np
        import torch
        from transformers import CLIPModel, CLIPProcessor
    except ImportError as exc:
        raise RuntimeError(
            "Surrogate patch requer torch + transformers. "
            "Rode: pip install torch transformers"
        ) from exc

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = CLIPModel.from_pretrained(model_name).to(device).eval()
    processor = CLIPProcessor.from_pretrained(model_name)

    text_inputs = processor(text=[target_caption], return_tensors="pt", padding=True).to(device)
    with torch.no_grad():
        text_emb = model.get_text_features(**text_inputs)
        text_emb = text_emb / text_emb.norm(dim=-1, keepdim=True)

    torch.manual_seed(seed)
    image_size = processor.image_processor.size.get("shortest_edge", 224)
    patch = torch.rand((1, 3, patch_size, patch_size), device=device, requires_grad=True)
    opt = torch.optim.Adam([patch], lr=lr)

    mean = torch.tensor(processor.image_processor.image_mean, device=device).view(1, 3, 1, 1)
    std = torch.tensor(processor.image_processor.image_std, device=device).view(1, 3, 1, 1)

    for step in range(iters):
        upscaled = torch.nn.functional.interpolate(
            patch.clamp(0.0, 1.0),
            size=(image_size, image_size),
            mode="bilinear",
            align_corners=False,
        )
        normalized = (upscaled - mean) / std
        img_emb = model.get_image_features(pixel_values=normalized)
        img_emb = img_emb / img_emb.norm(dim=-1, keepdim=True)
        sim = (img_emb * text_emb).sum(dim=-1)
        loss = -sim.mean()

        opt.zero_grad()
        loss.backward()
        opt.step()
        with torch.no_grad():
            patch.clamp_(0.0, 1.0)

    final = patch.clamp(0.0, 1.0).detach().cpu().squeeze(0).permute(1, 2, 0).numpy()
    return (final * 255.0).astype(np.uint8)


def render_patch_png(patch_array, dst: str | Path) -> Path:
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Pillow ausente. Rode: pip install Pillow") from exc
    img = Image.fromarray(patch_array, mode="RGB")
    out = Path(dst)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG")
    return out


def precompute_patch_for_target(
    target: TopicTarget,
    cache_dir: str | Path | None = None,
    patch_size: int = 96,
    iters: int = 1500,
    force_recompute: bool = False,
) -> Path:
    """Compute (or reuse) the surrogate patch PNG for ``target`` and return its
    path. Safe to call from CLI workflows ahead of time.
    """
    cache = Path(cache_dir) if cache_dir else default_patch_cache_dir()
    cache.mkdir(parents=True, exist_ok=True)
    dst = cache / f"{target.key}.png"
    if dst.exists() and not force_recompute:
        return dst
    arr = optimize_clip_patch(
        target_caption=target.vlm_caption,
        patch_size=patch_size,
        iters=iters,
    )
    return render_patch_png(arr, dst)


def apply_surrogate_patch(
    video_in: str | Path,
    target: TopicTarget,
    video_out: str | Path,
    workdir: str | Path,
    patch_size: int = 96,
    iters: int = 600,
    crf: int = 20,
    cache_dir: str | Path | None = None,
    force_recompute: bool = False,
    keyframes_only: bool = False,
    keyframe_window_seconds: float = 0.12,
) -> Path:
    """Optimize a CLIP-aligned patch (or reuse cache) and overlay it in the
    bottom-right corner."""
    ensure_ffmpeg()
    info = probe_media(video_in)
    work = Path(workdir)
    work.mkdir(parents=True, exist_ok=True)

    cache = Path(cache_dir) if cache_dir else default_patch_cache_dir()
    cache.mkdir(parents=True, exist_ok=True)
    cached_png = cache / f"{target.key}.png"

    if cached_png.exists() and not force_recompute:
        patch_png = cached_png
    else:
        arr = optimize_clip_patch(
            target_caption=target.vlm_caption,
            patch_size=patch_size,
            iters=iters,
        )
        patch_png = render_patch_png(arr, cached_png)

    enable_expr: str | None = None
    if keyframes_only:
        try:
            kf_times = list_keyframe_times(video_in, max_keyframes=200)
            enable_expr = build_keyframe_enable_expression(
                kf_times,
                window_seconds=keyframe_window_seconds,
            )
        except RuntimeError:
            enable_expr = None

    overlay_filter = "[0:v][1:v]overlay=W-w-20:H-h-20"
    if enable_expr:
        overlay_filter += f":enable='{enable_expr}'"
    overlay_filter += "[v]"

    out = Path(video_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "ffmpeg", "-y",
        "-i", str(video_in),
        "-i", str(patch_png),
        "-filter_complex", overlay_filter,
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
        "-c:a", "copy",
        str(out),
    ]
    run_ffmpeg(args)
    return out
