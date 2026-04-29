"""Cloak verification: re-classify the cloaked output to measure success.

Two backends:

- ``local``  : Whisper transcription + YAMNet classification on the audio,
               plus a question to a vision-language model on a frame sample.
- ``gemini`` : Calls Gemini 2.x via google-generativeai with the actual video
               file ("what is this video about?") on both original and cloaked.
"""

from .local import LocalVerifyReport, run_local_verification
from .gemini import GeminiVerifyReport, run_gemini_verification

__all__ = [
    "LocalVerifyReport",
    "GeminiVerifyReport",
    "run_local_verification",
    "run_gemini_verification",
]
