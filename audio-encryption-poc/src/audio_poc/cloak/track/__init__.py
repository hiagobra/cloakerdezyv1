"""Track-level cloaking layer (subtitles + container metadata)."""

from .mp4_metadata import write_mp4_metadata
from .srt_injector import build_srt_for_target, inject_soft_subtitle

__all__ = ["build_srt_for_target", "inject_soft_subtitle", "write_mp4_metadata"]
