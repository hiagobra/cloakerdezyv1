"""Audio cloaking layer.

Modules:

- ``tts_underlay``      : cheap & robust mix of a TTS read of the target transcript
                          underneath the original audio with sidechain ducking.
- ``injection_bed``     : low-level keyword-dense bed track (~-34 dBFS) that
                          biases ASR n-gram posteriors without obvious parallel
                          speech.
- ``formant_suppress``  : narrow notch filters at the host speaker's formant
                          bands; degrades ASR intelligibility while keeping
                          enough timbre that humans still hear a voice.
- ``whisper_attack``    : white-box targeted PGD on OpenAI Whisper, with optional
                          RIR robustness (Qin et al. style) and clipped-mel
                          budget (2026 style) and length-explosion mode (MORE).
- ``ensemble``          : ensemble PGD across Whisper + wav2vec2 for transferability.
- ``yamnet_attack``     : white-box PGD on YAMNet (sound-event level demo).
- ``psychoacoustic``    : Qin et al. masking thresholds + post-projection.
- ``art_imperceptible`` : opt-in ART ImperceptibleASRPyTorch (DeepSpeech2).
"""

from .formant_suppress import suppress_formants
from .injection_bed import mix_injection_bed, synthesize_bed
from .tts_underlay import (
    generate_tts_underlay,
    mix_swap_full,
    mix_swap_intro_outro,
    mix_underlay_into_audio,
)

__all__ = [
    "generate_tts_underlay",
    "mix_injection_bed",
    "mix_swap_full",
    "mix_swap_intro_outro",
    "mix_underlay_into_audio",
    "suppress_formants",
    "synthesize_bed",
]
