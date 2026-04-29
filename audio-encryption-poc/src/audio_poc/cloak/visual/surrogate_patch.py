"""Optimize an adversarial visual patch on a surrogate VLM (CLIP) and overlay it.

Idea: PGD over a 64x64 patch's pixels to maximize cosine-similarity between the
patch's CLIP image embedding and the target_caption's CLIP text embedding.
A patch with high alignment to "an educational personal finance video" steers
*any* CLIP-derived classifier (and partially transfers to Gemini's vision
encoder, which shares architecture lineage).

Heavy: requires torch + transformers. Lazy-imported.
"""

from __future__ import annotations

from pathlib import Path

from ..ffmpeg_utils import ensure_ffmpeg, probe_media, run_ffmpeg
from ..targets import TopicTarget


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


def apply_surrogate_patch(
    video_in: str | Path,
    target: TopicTarget,
    video_out: str | Path,
    workdir: str | Path,
    patch_size: int = 96,
    iters: int = 600,
    crf: int = 20,
) -> Path:
    """Optimize a CLIP-aligned patch and overlay it in the bottom-right corner."""
    ensure_ffmpeg()
    info = probe_media(video_in)
    work = Path(workdir)
    work.mkdir(parents=True, exist_ok=True)

    arr = optimize_clip_patch(
        target_caption=target.vlm_caption,
        patch_size=patch_size,
        iters=iters,
    )
    patch_png = render_patch_png(arr, work / f"surrogate_patch_{target.key}.png")

    out = Path(video_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "ffmpeg", "-y",
        "-i", str(video_in),
        "-i", str(patch_png),
        "-filter_complex", "[0:v][1:v]overlay=W-w-20:H-h-20[v]",
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
        "-c:a", "copy",
        str(out),
    ]
    run_ffmpeg(args)
    return out
