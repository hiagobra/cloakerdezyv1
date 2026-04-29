"""Visual cloaking layer (overlay, downscale steganography, prompt injection)."""

from .prompt_inject import (
    PromptInjectionConfig,
    build_prompt_injection_text,
    render_prompt_injection_overlay,
)
from .stego_downscale import build_downscale_stego_image, overlay_stego_on_video
from .text_overlay import OverlayConfig, apply_text_overlay

__all__ = [
    "OverlayConfig",
    "PromptInjectionConfig",
    "apply_text_overlay",
    "build_downscale_stego_image",
    "build_prompt_injection_text",
    "overlay_stego_on_video",
    "render_prompt_injection_overlay",
]
