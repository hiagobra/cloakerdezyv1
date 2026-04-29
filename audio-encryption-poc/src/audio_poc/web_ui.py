"""Gradio interface for quick upload-and-test workflow."""

from __future__ import annotations

from pathlib import Path

import gradio as gr

from .presets import PRESETS
from .video_pipeline import process_uploaded_media

APP_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = APP_ROOT / "web-demo" / "outputs"


def _process_file(file_obj, preset: str):
    if file_obj is None:
        raise gr.Error("Envie um arquivo de video/audio para testar.")

    source_path = getattr(file_obj, "name", None) or str(file_obj)
    try:
        result = process_uploaded_media(source_path, preset=preset, output_dir=OUTPUT_DIR)
    except RuntimeError as exc:
        raise gr.Error(str(exc)) from exc
    return str(result.output_path), result.log_text


def build_app() -> gr.Blocks:
    with gr.Blocks(title="Audio Encryption PoC") as app:
        gr.Markdown(
            """
            # Audio Encryption PoC - Teste Rapido
            Faça upload do seu video (ou audio), escolha um preset e gere a versao protegida.
            """
        )
        with gr.Row():
            with gr.Column(scale=2):
                input_file = gr.File(
                    label="Upload de video/audio",
                    file_count="single",
                    type="filepath",
                )
                preset = gr.Dropdown(
                    label="Preset",
                    choices=sorted(PRESETS.keys()),
                    value="balanced",
                )
                run_btn = gr.Button("Processar", variant="primary")
            with gr.Column(scale=3):
                output_file = gr.File(label="Arquivo protegido (download)")
                logs = gr.Textbox(
                    label="Log de processamento",
                    lines=10,
                    max_lines=20,
                )

        gr.Markdown(
            """
            **Notas**
            - Para video, o app extrai audio, aplica protecao e remonta com o video original.
            - É necessario ter `ffmpeg` instalado e no PATH para processar videos.
            - Saidas ficam em `web-demo/outputs`.
            """
        )
        run_btn.click(fn=_process_file, inputs=[input_file, preset], outputs=[output_file, logs])
    return app


def main() -> None:
    app = build_app()
    app.launch(
        server_name="127.0.0.1",
        server_port=7860,
        show_error=True,
        theme=gr.themes.Soft(),
    )


if __name__ == "__main__":
    main()
