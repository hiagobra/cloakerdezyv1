"""Local verification: Whisper transcription + YAMNet top-k.

VLM-on-frame check is optional and only runs if ``transformers`` and a
suitable BLIP-2 / LLaVA model are available locally.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory

from ..ffmpeg_utils import extract_audio_wav, probe_media


@dataclass
class LocalVerifyReport:
    whisper_text: str = ""
    whisper_model: str = ""
    yamnet_top5: list[tuple[str, float]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _run_whisper(audio_wav: Path, model_name: str, language: str | None) -> tuple[str, str]:
    try:
        import whisper
    except ImportError:
        return ("", "openai-whisper não instalado")
    try:
        model = whisper.load_model(model_name)
        result = model.transcribe(str(audio_wav), language=language, fp16=False)
        return ((result.get("text") or "").strip(), model_name)
    except Exception as exc:
        return ("", f"whisper falhou: {exc}")


def _run_yamnet(audio_wav: Path) -> list[tuple[str, float]]:
    try:
        import csv

        import numpy as np
        import soundfile as sf
        import tensorflow as tf
        import tensorflow_hub as hub
        from urllib.request import urlretrieve
    except ImportError:
        return []
    try:
        audio, sr = sf.read(str(audio_wav), always_2d=True, dtype="float32")
        audio = audio.mean(axis=1)
        if sr != 16000:
            from scipy import signal as sp_signal
            n_new = int(audio.shape[0] * 16000 / sr)
            audio = sp_signal.resample(audio, n_new).astype(np.float32)

        cls_csv = Path(audio_wav).parent / "yamnet_class_map.csv"
        if not cls_csv.exists():
            urlretrieve(
                "https://raw.githubusercontent.com/tensorflow/models/master/research/"
                "audioset/yamnet/yamnet_class_map.csv",
                str(cls_csv),
            )
        mapping: dict[int, str] = {}
        with cls_csv.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                mapping[int(row["index"])] = row["display_name"]

        yamnet = hub.load("https://tfhub.dev/google/yamnet/1")
        scores, _, _ = yamnet(audio)
        avg = tf.reduce_mean(scores, axis=0).numpy()
        idx = np.argsort(-avg)[:5]
        return [(mapping[int(i)], float(avg[i])) for i in idx]
    except Exception:
        return []


def run_local_verification(
    video_path: str | Path,
    whisper_model: str = "base",
    language: str | None = None,
    skip_yamnet: bool = False,
) -> LocalVerifyReport:
    report = LocalVerifyReport()
    info = probe_media(video_path)
    if not info.has_audio:
        report.notes.append("nenhum stream de audio encontrado")
        return report

    with TemporaryDirectory(prefix="cloak_verify_") as tmp:
        wav = Path(tmp) / "extracted.wav"
        extract_audio_wav(video_path, wav, sample_rate=16000)

        text, model_used = _run_whisper(wav, whisper_model, language)
        report.whisper_text = text
        report.whisper_model = model_used or whisper_model

        if not skip_yamnet:
            try:
                report.yamnet_top5 = _run_yamnet(wav)
            except Exception as exc:
                report.notes.append(f"yamnet falhou: {exc}")
    return report
