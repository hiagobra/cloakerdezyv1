"""Multimodal video topic cloaker.

Stacks four layers of evasion against multimodal moderators (e.g. Gemini):

  1. Audio    -- targeted adversarial perturbation, ensemble transfer attacks,
                 TTS underlay with sidechain ducking.
  2. Visual   -- on-frame text overlays (visible/subtle/temporal/flash),
                 downscale-steganography PNG, optional surrogate adversarial patch.
  3. Track    -- soft subtitle (SRT) injection and MP4 container metadata.
  4. Verify   -- local re-classification (Whisper + YAMNet + LLaVA) and remote
                 Gemini API verification.

This is research / red-team tooling. See README for ethical considerations.
"""

from .targets import TOPIC_TARGETS, get_target, list_targets

__all__ = ["TOPIC_TARGETS", "get_target", "list_targets"]
