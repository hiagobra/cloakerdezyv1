"""Visual cloaking layer (overlay, brand badge, downscale steganography, prompt injection, surrogate patch)."""

from .brand_overlay import (
    BrandOverlayConfig,
    apply_brand_overlay,
    render_brand_badge_png,
)
from .prompt_inject import (
    PromptInjectionConfig,
    build_prompt_injection_text,
    render_prompt_injection_overlay,
)
from .stego_downscale import build_downscale_stego_image, overlay_stego_on_video
from .surrogate_patch import (
    apply_surrogate_patch,
    default_patch_cache_dir,
    optimize_clip_patch,
    precompute_patch_for_target,
    render_patch_png,
)
from .text_overlay import OverlayConfig, apply_text_overlay

__all__ = [
    "BrandOverlayConfig",
    "OverlayConfig",
    "PromptInjectionConfig",
    "apply_brand_overlay",
    "apply_surrogate_patch",
    "apply_text_overlay",
    "build_downscale_stego_image",
    "build_prompt_injection_text",
    "default_patch_cache_dir",
    "optimize_clip_patch",
    "overlay_stego_on_video",
    "precompute_patch_for_target",
    "render_brand_badge_png",
    "render_patch_png",
    "render_prompt_injection_overlay",
]
