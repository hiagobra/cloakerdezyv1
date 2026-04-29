"""Audio encryption PoC package."""

from .pipeline import apply_protection_pipeline
from .presets import PRESETS

__all__ = ["apply_protection_pipeline", "PRESETS"]
