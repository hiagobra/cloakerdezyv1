"""Gradio interface: phase-stereo protect tab + multimodal cloak tab."""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path

import gradio as gr

from .cloak import list_targets
from .cloak.composer import PROFILES, CloakOptions, cloak_video
from .cloak.targets import TOPIC_TARGETS
from .cloak.verify import run_gemini_verification, run_local_verification
from .presets import PRESETS
from .video_pipeline import process_uploaded_media

APP_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = APP_ROOT / "web-demo" / "outputs"


def _process_protect(file_obj, preset: str):
    if file_obj is None:
        raise gr.Error("Envie um arquivo de video/audio para testar.")
    source_path = getattr(file_obj, "name", None) or str(file_obj)
    try:
        result = process_uploaded_media(source_path, preset=preset, output_dir=OUTPUT_DIR)
    except RuntimeError as exc:
        raise gr.Error(str(exc)) from exc
    return str(result.output_path), result.log_text


_LAYER_FIELDS = [
    ("audio_tts", "Áudio: TTS underlay (rápido)"),
    ("audio_whisper_attack", "Áudio: PGD em Whisper (lento)"),
    ("audio_ensemble", "Áudio: PGD ensemble Whisper+wav2vec2"),
    ("audio_yamnet", "Áudio: PGD em YAMNet (demo)"),
    ("visual_overlay", "Visual: overlay de texto"),
    ("visual_stego", "Visual: steganografia downscale"),
    ("visual_surrogate", "Visual: patch surrogate CLIP (lento)"),
    ("track_srt", "Track: faixa de legenda SRT"),
    ("track_metadata", "Track: metadata MP4"),
]


def _layers_for_profile(profile: str) -> list[bool]:
    flags = PROFILES[profile]
    return [flags.get(k, False) for k, _ in _LAYER_FIELDS]


def _process_cloak(
    file_obj,
    target_preset,
    profile,
    overlay_mode,
    overlay_position,
    whisper_model,
    whisper_iters,
    underlay_host_dbfs,
    underlay_target_dbfs,
    underlay_duck_db,
    *layer_checks,
):
    if file_obj is None:
        raise gr.Error("Envie um vídeo para camuflar.")
    source_path = getattr(file_obj, "name", None) or str(file_obj)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    src = Path(source_path)
    stem = src.stem
    out_path = OUTPUT_DIR / f"{stem}.cloaked.{profile}.{target_preset}.mp4"

    overrides: dict[str, bool] = {}
    base = PROFILES[profile]
    for (key, _label), checked in zip(_LAYER_FIELDS, layer_checks):
        if bool(checked) != base.get(key, False):
            overrides[key] = bool(checked)

    options = CloakOptions(
        overlay_mode=overlay_mode,
        overlay_position=overlay_position,
        whisper_model=whisper_model,
        whisper_iters=int(whisper_iters),
        underlay_host_dbfs=float(underlay_host_dbfs),
        underlay_target_dbfs=float(underlay_target_dbfs),
        underlay_duck_db=float(underlay_duck_db),
    )
    try:
        result = cloak_video(
            input_path=src,
            output_path=out_path,
            target_preset=target_preset,
            profile=profile,
            layer_overrides=overrides or None,
            options=options,
        )
    except (RuntimeError, ValueError) as exc:
        raise gr.Error(str(exc)) from exc

    log_text = "\n".join(result.log)
    metrics_json = json.dumps(result.metrics, indent=2, ensure_ascii=False)
    layers_text = ", ".join(result.layers_applied) or "(nenhuma)"
    return (
        str(result.output_path),
        f"Camadas aplicadas: {layers_text}\n\n--- LOG ---\n{log_text}\n\n--- METRICS ---\n{metrics_json}",
    )


def _verify_local(file_obj, whisper_model: str, language: str):
    if file_obj is None:
        raise gr.Error("Envie o arquivo cloaked.")
    p = getattr(file_obj, "name", None) or str(file_obj)
    rep = run_local_verification(p, whisper_model=whisper_model, language=language or None)
    return json.dumps(asdict(rep), indent=2, ensure_ascii=False)


def _verify_gemini(original_obj, cloaked_obj, api_key: str, model_name: str):
    if cloaked_obj is None or original_obj is None:
        raise gr.Error("Envie o vídeo original e o cloaked.")
    orig = getattr(original_obj, "name", None) or str(original_obj)
    clo = getattr(cloaked_obj, "name", None) or str(cloaked_obj)
    if api_key:
        os.environ["GOOGLE_API_KEY"] = api_key
    try:
        rep = run_gemini_verification(
            original_path=orig,
            cloaked_path=clo,
            api_key=api_key or None,
            model_name=model_name,
        )
    except RuntimeError as exc:
        raise gr.Error(str(exc)) from exc
    return json.dumps(asdict(rep), indent=2, ensure_ascii=False)


def build_app() -> gr.Blocks:
    with gr.Blocks(title="MaskAI - Audio + Multimodal Cloak") as app:
        gr.Markdown(
            """
            # MaskAI - PoC
            Duas abas: **Protect** (degradação não-direcionada de ASR no áudio,
            comportamento original do PoC) e **Cloak Multimodal** (camuflagem
            direcionada de tópico atacando moderação multimodal estilo Gemini).
            """
        )

        with gr.Tab("Protect (áudio)"):
            with gr.Row():
                with gr.Column(scale=2):
                    in_protect = gr.File(label="Upload de video/audio", file_count="single", type="filepath")
                    preset_protect = gr.Dropdown(
                        label="Preset", choices=sorted(PRESETS.keys()), value="balanced"
                    )
                    btn_protect = gr.Button("Processar", variant="primary")
                with gr.Column(scale=3):
                    out_protect = gr.File(label="Arquivo protegido")
                    log_protect = gr.Textbox(label="Log", lines=10, max_lines=20)
            btn_protect.click(_process_protect, [in_protect, preset_protect], [out_protect, log_protect])

        with gr.Tab("Cloak Multimodal"):
            gr.Markdown(
                """
                Empilha camadas (áudio + visual + track + metadata) para shiftar
                o tópico que um moderador multimodal (Gemini, GPT-4o, etc.)
                associa ao vídeo. Cada profile escolhe um conjunto-padrão de
                camadas; você pode override via checkboxes abaixo.
                """
            )
            with gr.Row():
                with gr.Column(scale=2):
                    in_cloak = gr.File(label="Vídeo de entrada (.mp4)", file_count="single", type="filepath")
                    preset_choices = list_targets()
                    target_preset = gr.Dropdown(
                        label="Tópico-alvo",
                        choices=preset_choices,
                        value=preset_choices[0] if preset_choices else None,
                    )
                    profile_dd = gr.Dropdown(
                        label="Profile",
                        choices=sorted(PROFILES.keys()),
                        value="standard",
                    )
                    overlay_mode = gr.Dropdown(
                        label="Modo do overlay visual",
                        choices=["visible", "subtle", "temporal", "flash"],
                        value="subtle",
                    )
                    overlay_position = gr.Dropdown(
                        label="Posição do overlay",
                        choices=["bottom", "top", "center", "corner_tr"],
                        value="bottom",
                    )
                    whisper_model = gr.Dropdown(
                        label="Whisper model (para PGD)",
                        choices=["tiny", "base", "small", "medium"],
                        value="base",
                    )
                    whisper_iters = gr.Slider(label="Iters Whisper PGD", minimum=200, maximum=4000, value=1500, step=100)
                    underlay_host_dbfs = gr.Slider(label="Host dBFS", minimum=-30, maximum=-3, value=-9, step=0.5)
                    underlay_target_dbfs = gr.Slider(label="TTS underlay dBFS", minimum=-40, maximum=-10, value=-22, step=0.5)
                    underlay_duck_db = gr.Slider(label="Sidechain duck dB", minimum=-15, maximum=0, value=-5, step=0.5)

                    gr.Markdown("**Override de camadas (sobrepõe o profile):**")
                    layer_boxes = []
                    default_layers = _layers_for_profile("standard")
                    for (key, label), default_v in zip(_LAYER_FIELDS, default_layers):
                        layer_boxes.append(gr.Checkbox(label=label, value=default_v))

                    btn_cloak = gr.Button("Camuflar", variant="primary")

                with gr.Column(scale=3):
                    out_cloak = gr.File(label="Vídeo cloaked")
                    log_cloak = gr.Textbox(label="Log + metrics", lines=22, max_lines=40)

            def _on_profile_change(profile):
                return [gr.update(value=v) for v in _layers_for_profile(profile)]

            profile_dd.change(_on_profile_change, [profile_dd], layer_boxes)

            btn_cloak.click(
                _process_cloak,
                [
                    in_cloak,
                    target_preset,
                    profile_dd,
                    overlay_mode,
                    overlay_position,
                    whisper_model,
                    whisper_iters,
                    underlay_host_dbfs,
                    underlay_target_dbfs,
                    underlay_duck_db,
                    *layer_boxes,
                ],
                [out_cloak, log_cloak],
            )

        with gr.Tab("Verify"):
            gr.Markdown(
                """
                Re-classifique o vídeo cloaked.

                - **Local**: Whisper transcreve + YAMNet top-5.
                - **Gemini**: pergunta "sobre o que é esse vídeo" para o Gemini
                  no original e no cloaked, mostra os dois lado a lado.
                  Requer `GOOGLE_API_KEY` em variável de ambiente ou no campo abaixo.
                """
            )
            with gr.Tab("Local"):
                with gr.Row():
                    file_local = gr.File(label="Cloaked video", file_count="single", type="filepath")
                    whisper_model_v = gr.Dropdown(
                        label="Whisper model", choices=["tiny", "base", "small"], value="base"
                    )
                    language_v = gr.Textbox(label="Linguagem (ex.: pt, en)", value="pt")
                btn_local = gr.Button("Verificar local", variant="primary")
                out_local = gr.Textbox(label="Relatório", lines=18, max_lines=40)
                btn_local.click(_verify_local, [file_local, whisper_model_v, language_v], [out_local])

            with gr.Tab("Gemini"):
                with gr.Row():
                    file_orig = gr.File(label="Original", file_count="single", type="filepath")
                    file_clo = gr.File(label="Cloaked", file_count="single", type="filepath")
                api_key = gr.Textbox(label="GOOGLE_API_KEY (opcional, lê env)", type="password")
                gemini_model = gr.Dropdown(
                    label="Gemini model",
                    choices=["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
                    value="gemini-2.0-flash",
                )
                btn_gem = gr.Button("Verificar com Gemini", variant="primary")
                out_gem = gr.Textbox(label="Comparativo Original × Cloaked", lines=22, max_lines=40)
                btn_gem.click(_verify_gemini, [file_orig, file_clo, api_key, gemini_model], [out_gem])

        gr.Markdown(
            """
            ---
            **Aviso**: ferramenta de pesquisa em segurança / red-team de moderação
            multimodal. Use apenas em conteúdo próprio ou com autorização.
            Mascarar tópico de mídia para terceiros pode violar ToS de plataformas
            e configurar publicidade enganosa.
            """
        )
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
