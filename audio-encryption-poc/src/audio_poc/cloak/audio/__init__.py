"""Audio cloaking layer.

Modules:

- ``tts_underlay``    : cheap & robust mix of a TTS read of the target transcript
                        underneath the original audio with sidechain ducking.
- ``whisper_attack``  : white-box targeted PGD on OpenAI Whisper.
- ``ensemble``        : ensemble PGD across Whisper + wav2vec2 for transferability.
- ``yamnet_attack``   : white-box PGD on YAMNet (sound-event level demo).
- ``psychoacoustic``  : Qin et al. masking thresholds (optional inaudible mode).
"""

from .tts_underlay import generate_tts_underlay, mix_underlay_into_audio

__all__ = ["generate_tts_underlay", "mix_underlay_into_audio"]
