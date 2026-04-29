"""Gemini-based black-box verification.

We upload both the original and cloaked videos to Gemini 2.x and ask the model
"what is this video about?". Then we diff the answers to measure whether the
cloak shifted Gemini's perception. This is exactly the test the user is trying
to pass with the tool.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class GeminiVerifyReport:
    model: str = ""
    original_path: str = ""
    cloaked_path: str = ""
    original_answer: str = ""
    cloaked_answer: str = ""
    classification_shifted: bool | None = None
    notes: list[str] = field(default_factory=list)


PROMPT_PT = (
    "Olha esse vídeo. Em uma frase curta (máximo 20 palavras), descreva o "
    "tópico principal e classifique-o em uma única categoria temática "
    "(ex.: saúde, finanças, tecnologia, culinária, fitness, entretenimento). "
    "Responda no formato:\n"
    "Tópico: <descrição em uma frase>\n"
    "Categoria: <uma palavra>"
)


def _ensure_genai(api_key: str | None):
    try:
        import google.generativeai as genai
    except ImportError as exc:
        raise RuntimeError(
            "google-generativeai não instalado. "
            "Rode: pip install google-generativeai"
        ) from exc
    key = api_key or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError(
            "GOOGLE_API_KEY (ou GEMINI_API_KEY) ausente. "
            "Defina a variável de ambiente ou passe api_key= ."
        )
    genai.configure(api_key=key)
    return genai


def _ask_about_video(genai_module, model_name: str, video_path: Path, prompt: str) -> str:
    uploaded = genai_module.upload_file(path=str(video_path))

    deadline = time.time() + 180
    while uploaded.state.name == "PROCESSING" and time.time() < deadline:
        time.sleep(3)
        uploaded = genai_module.get_file(uploaded.name)

    if uploaded.state.name != "ACTIVE":
        raise RuntimeError(f"Gemini não conseguiu processar o arquivo: estado={uploaded.state.name}")

    model = genai_module.GenerativeModel(model_name)
    resp = model.generate_content([prompt, uploaded])
    try:
        genai_module.delete_file(uploaded.name)
    except Exception:
        pass
    return (resp.text or "").strip()


def _categorize(answer: str) -> str:
    for line in answer.splitlines():
        if line.lower().startswith("categoria"):
            _, _, val = line.partition(":")
            return val.strip().lower()
    return ""


def run_gemini_verification(
    original_path: str | Path,
    cloaked_path: str | Path,
    api_key: str | None = None,
    model_name: str = "gemini-2.0-flash",
    prompt: str = PROMPT_PT,
) -> GeminiVerifyReport:
    genai = _ensure_genai(api_key)
    report = GeminiVerifyReport(
        model=model_name,
        original_path=str(original_path),
        cloaked_path=str(cloaked_path),
    )
    try:
        report.original_answer = _ask_about_video(genai, model_name, Path(original_path), prompt)
    except Exception as exc:
        report.notes.append(f"original falhou: {exc}")
    try:
        report.cloaked_answer = _ask_about_video(genai, model_name, Path(cloaked_path), prompt)
    except Exception as exc:
        report.notes.append(f"cloaked falhou: {exc}")

    cat_orig = _categorize(report.original_answer)
    cat_cloak = _categorize(report.cloaked_answer)
    if cat_orig and cat_cloak:
        report.classification_shifted = cat_orig != cat_cloak
    return report
