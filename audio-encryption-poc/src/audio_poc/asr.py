"""ASR helpers for optional baseline-vs-protected evaluation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .metrics import text_error_metrics


@dataclass
class AsrResult:
    backend: str
    text: str


def transcribe_with_whisper(
    audio_path: str | Path,
    model_name: str = "base",
    language: str | None = None,
) -> AsrResult:
    try:
        import whisper  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "Whisper backend not installed. Run: pip install openai-whisper"
        ) from exc

    model = whisper.load_model(model_name)
    output = model.transcribe(str(audio_path), language=language)
    return AsrResult(backend=f"whisper:{model_name}", text=output.get("text", "").strip())


def evaluate_asr_impact(
    original_path: str | Path,
    protected_path: str | Path,
    reference_text: str | None = None,
    backend: str = "whisper",
    model_name: str = "base",
    language: str | None = None,
) -> dict:
    if backend != "whisper":
        raise ValueError(f"Unsupported backend: {backend}")

    original = transcribe_with_whisper(original_path, model_name=model_name, language=language)
    protected = transcribe_with_whisper(protected_path, model_name=model_name, language=language)

    if reference_text:
        orig_errors = text_error_metrics(reference_text, original.text)
        prot_errors = text_error_metrics(reference_text, protected.text)
        return {
            "reference_mode": "ground_truth",
            "original": {"text": original.text, **orig_errors},
            "protected": {"text": protected.text, **prot_errors},
            "delta_wer": prot_errors["wer"] - orig_errors["wer"],
            "delta_cer": prot_errors["cer"] - orig_errors["cer"],
        }

    proxy_errors = text_error_metrics(original.text, protected.text)
    return {
        "reference_mode": "proxy_original_transcript",
        "original": {"text": original.text},
        "protected": {"text": protected.text},
        "proxy_wer_vs_original_text": proxy_errors["wer"],
        "proxy_cer_vs_original_text": proxy_errors["cer"],
    }
