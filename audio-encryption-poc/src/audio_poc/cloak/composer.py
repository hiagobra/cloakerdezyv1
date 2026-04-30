"""Orchestrate the four cloak layers in the right order.

Pipeline order (each step takes the previous output as input):

  1. Audio layer (TTS underlay or adversarial PGD) -- produces a new WAV.
  2. Remux: original video container with the new audio track.
  3. Visual layer (text_overlay -> stego_downscale -> surrogate_patch).
  4. Track layer: SRT injection.
  5. Track layer: MP4 metadata atoms.
  6. Optional verify (local + gemini).

Order matters: visual filters re-encode video, so we can't run them after
metadata is set on the container; we set metadata as the very last step on the
final container so it sticks.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field, replace
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import numpy as np
import soundfile as sf

from .ffmpeg_utils import (
    ensure_ffmpeg,
    extract_audio_wav,
    probe_media,
    remux_audio_into_video,
)
from .targets import TopicTarget, get_target


PROFILES: dict[str, dict[str, bool]] = {
    "minimal": {
        "audio_tts": False,
        "audio_injection_bed": False,
        "audio_whisper_attack": False,
        "audio_ensemble": False,
        "audio_yamnet": False,
        "audio_rir_robust": False,
        "audio_mel_budget": False,
        "audio_more_length": False,
        "audio_dsp_cloak": False,
        "audio_psycho_post": False,
        "audio_formant_suppress": False,
        "visual_overlay": True,
        "visual_prompt_inject": False,
        "visual_brand_overlay": False,
        "visual_stego": False,
        "visual_surrogate": False,
        "visual_keyframes_only": False,
        "track_srt": True,
        "track_metadata": True,
    },
    "standard": {
        "audio_tts": True,
        "audio_injection_bed": True,
        "audio_whisper_attack": False,
        "audio_ensemble": False,
        "audio_yamnet": False,
        "audio_rir_robust": False,
        "audio_mel_budget": False,
        "audio_more_length": False,
        "audio_dsp_cloak": True,
        "audio_psycho_post": True,
        "audio_formant_suppress": False,
        "visual_overlay": True,
        "visual_prompt_inject": True,
        "visual_brand_overlay": True,
        "visual_stego": False,
        "visual_surrogate": False,
        "visual_keyframes_only": False,
        "track_srt": True,
        "track_metadata": True,
    },
    "aggressive": {
        "audio_tts": True,
        "audio_injection_bed": True,
        "audio_whisper_attack": True,
        "audio_ensemble": False,
        "audio_yamnet": False,
        # RIR + mel por step multiplicam custo do PGD; desligado no default para
        # vídeos longos terminarem no tempo esperado (pesquisa.md: trade-off robustez x CPU).
        "audio_rir_robust": False,
        "audio_mel_budget": False,
        "audio_more_length": False,
        "audio_dsp_cloak": False,
        "audio_psycho_post": True,
        "audio_formant_suppress": True,
        "visual_overlay": True,
        "visual_prompt_inject": True,
        "visual_brand_overlay": True,
        "visual_stego": True,
        "visual_surrogate": False,
        "visual_keyframes_only": True,
        "track_srt": True,
        "track_metadata": True,
    },
    "paranoid": {
        "audio_tts": True,
        "audio_injection_bed": True,
        "audio_whisper_attack": True,
        "audio_ensemble": True,
        "audio_yamnet": False,
        "audio_rir_robust": True,
        "audio_mel_budget": True,
        "audio_more_length": True,
        "audio_dsp_cloak": False,
        "audio_psycho_post": True,
        "audio_formant_suppress": True,
        "visual_overlay": True,
        "visual_prompt_inject": True,
        "visual_brand_overlay": True,
        "visual_stego": True,
        "visual_surrogate": True,
        "visual_keyframes_only": True,
        "track_srt": True,
        "track_metadata": True,
    },
}


# Default prompt-injection visual mode per profile when CloakOptions
# leaves ``prompt_inject_strength="auto"``. ``"none"`` disables it even if
# the boolean flag in PROFILES is True (kept consistent with how a user might
# toggle the flag manually).
_PROMPT_INJECT_DEFAULTS: dict[str, str] = {
    "minimal": "none",
    "standard": "soft",
    "aggressive": "hard",
    "paranoid": "hard",
}


# How the TTS-target track interacts with the host audio when the TTS layer is
# enabled. ``underlay`` is the historical behavior (target mixed below host).
# ``intro_outro`` swaps the first/last seconds and underlays the middle.
# ``full`` makes the TTS-target the dominant audio and reduces the host to
# near-silence so Gemini/Whisper transcripts read the target topic.
_AUDIO_SWAP_DEFAULTS: dict[str, str] = {
    "minimal": "underlay",
    "standard": "underlay",
    "aggressive": "full",
    "paranoid": "full",
}
_AUDIO_SWAP_MODES = ("underlay", "intro_outro", "full")


@dataclass
class CloakOptions:
    overlay_mode: str = "subtle"
    overlay_position: str = "bottom"
    overlay_font_size: int = 22
    whisper_model: str = "base"
    whisper_epsilon: float = 0.005
    # Custo ~ linear em iters; 420 + eps maior costuma bastar p/ base no GPU/CPU médio.
    whisper_iters: int = 1500
    # pyttsx3: valores ~160–175 soam mais naturais em underlay “medio”.
    tts_speech_rate: int = 175
    # Preset em `audio_poc.presets` (ex.: cloak_subtle, light) para fase+ruído mascarado.
    dsp_cloak_preset: str = "cloak_subtle"
    ensemble_iters: int = 1000
    surrogate_iters: int = 500
    surrogate_patch_size: int = 96
    underlay_host_dbfs: float = -9.0
    underlay_target_dbfs: float = -22.0
    underlay_duck_db: float = -5.0
    # ``auto`` resolves to the per-profile default in _AUDIO_SWAP_DEFAULTS.
    # Allowed manual values: "underlay" | "intro_outro" | "full".
    audio_swap_mode: str = "auto"
    swap_host_dbfs: float = -32.0
    swap_target_dbfs: float = -8.0
    swap_intro_seconds: float = 5.0
    swap_outro_seconds: float = 3.0
    # Audio reinforcement layers (Plan: audio adversarial reforcado).
    injection_bed_dbfs: float = -34.0
    mel_epsilon: float | None = 0.5
    more_length_factor: float = 5.0
    more_length_alpha: float = 0.05
    # ``auto`` resolves to the per-profile default in _PROMPT_INJECT_DEFAULTS.
    # Allowed manual values: "none" | "soft" | "hard".
    prompt_inject_strength: str = "auto"
    # Formant suppression on the original audio (pesquisa.md item 2.4/2.5
    # lateral). Default applied when ``audio_formant_suppress`` flag is on.
    formant_depth_db: float = -14.0
    formant_q: float = 12.0
    # Brand-logo overlay (pesquisa.md item 3.10 MVPatch lineage).
    brand_overlay_position: str = "corner_br"
    brand_overlay_opacity: float = 0.85
    brand_overlay_width_ratio: float = 0.14
    # Surrogate patch caching + sparse keyframe attack (pesquisa.md items 3.2
    # universal patch, 3.14 Wei et al. sparse video).
    surrogate_patch_cache_dir: str | None = None
    surrogate_force_recompute: bool = False
    visual_keyframes_only: bool = False
    visual_keyframe_window_seconds: float = 0.12
    keep_workdir: bool = False


@dataclass
class CloakResult:
    output_path: Path
    layers_applied: list[str] = field(default_factory=list)
    log: list[str] = field(default_factory=list)
    audio_artifact: Path | None = None
    metrics: dict[str, Any] = field(default_factory=dict)


def _log(result: CloakResult, msg: str) -> None:
    result.log.append(msg)


def _profile_audio_tuning(profile: str, opts: CloakOptions) -> CloakOptions:
    """Níveis de mix, orçamento PGD e preset DSP por perfil (defaults do produto)."""
    if profile == "standard":
        return replace(
            opts,
            underlay_target_dbfs=-24.0,
            underlay_duck_db=-3.0,
            injection_bed_dbfs=-44.0,
            dsp_cloak_preset="cloak_subtle",
            tts_speech_rate=168,
        )
    if profile == "aggressive":
        return replace(
            opts,
            whisper_iters=min(420, opts.whisper_iters),
            whisper_epsilon=max(opts.whisper_epsilon, 0.006),
            injection_bed_dbfs=-40.0,
        )
    return opts


def _resolve_layers(profile: str, layer_overrides: dict[str, bool] | None) -> dict[str, bool]:
    if profile not in PROFILES:
        raise ValueError(f"Profile desconhecido: {profile!r}. Use {sorted(PROFILES)}.")
    base = dict(PROFILES[profile])
    if layer_overrides:
        for k, v in layer_overrides.items():
            if k not in base:
                raise ValueError(f"Override desconhecido: {k!r}.")
            base[k] = bool(v)
    return base


def _audio_layer(
    video_in: Path,
    target: TopicTarget,
    flags: dict[str, bool],
    opts: CloakOptions,
    workdir: Path,
    result: CloakResult,
) -> Path:
    """Returns a video file with the (possibly cloaked) audio remuxed in."""
    if not (
        flags.get("audio_tts")
        or flags.get("audio_injection_bed")
        or flags.get("audio_whisper_attack")
        or flags.get("audio_ensemble")
        or flags.get("audio_yamnet")
        or flags.get("audio_formant_suppress")
        or flags.get("audio_dsp_cloak")
    ):
        return video_in

    src_wav = workdir / "host.wav"
    extract_audio_wav(video_in, src_wav, sample_rate=48000)
    host, sr = sf.read(str(src_wav), always_2d=True, dtype="float32")
    if host.shape[1] == 1:
        host = np.repeat(host, 2, axis=1)
    elif host.shape[1] > 2:
        host = host[:, :2]

    host_clean = host.copy()
    current_audio_path: Path = src_wav

    if flags.get("audio_formant_suppress"):
        try:
            from .audio.formant_suppress import suppress_formants
            _log(
                result,
                (
                    f"[audio] formant suppress depth={opts.formant_depth_db:.1f} dB"
                    f" q={opts.formant_q:.1f} (degrada ASR sobre o original)"
                ),
            )
            host = suppress_formants(
                host_stereo=host,
                sample_rate=sr,
                depth_db=opts.formant_depth_db,
                q=opts.formant_q,
            )
            current_audio_path = workdir / "audio_after_formant.wav"
            sf.write(str(current_audio_path), host, sr)
            result.layers_applied.append("audio_formant_suppress")
        except RuntimeError as exc:
            _log(result, f"[audio] aviso: formant_suppress falhou ({exc})")

    if flags.get("audio_tts"):
        from .audio.tts_underlay import (
            generate_tts_underlay,
            mix_swap_full,
            mix_swap_intro_outro,
            mix_underlay_into_audio,
        )

        swap_mode = (opts.audio_swap_mode or "auto").lower()
        if swap_mode not in _AUDIO_SWAP_MODES:
            _log(
                result,
                f"[audio] audio_swap_mode invalido={swap_mode!r}; usando underlay",
            )
            swap_mode = "underlay"

        _log(result, f"[audio] gerando TTS (mode={swap_mode}, rate={opts.tts_speech_rate})")
        underlay, u_sr = generate_tts_underlay(
            target,
            workdir,
            sample_rate=sr,
            tts_speech_rate=opts.tts_speech_rate,
        )

        if swap_mode == "full":
            mixed = mix_swap_full(
                host_stereo=host,
                sample_rate=sr,
                underlay_mono=underlay,
                underlay_sr=u_sr,
                host_target_dbfs=opts.swap_host_dbfs,
                target_dbfs=opts.swap_target_dbfs,
            )
        elif swap_mode == "intro_outro":
            mixed = mix_swap_intro_outro(
                host_stereo=host,
                sample_rate=sr,
                underlay_mono=underlay,
                underlay_sr=u_sr,
                intro_seconds=opts.swap_intro_seconds,
                outro_seconds=opts.swap_outro_seconds,
                host_swap_dbfs=opts.swap_host_dbfs,
                target_swap_dbfs=opts.swap_target_dbfs,
                host_underlay_dbfs=opts.underlay_host_dbfs,
                target_underlay_dbfs=opts.underlay_target_dbfs,
                duck_db=opts.underlay_duck_db,
            )
        else:
            mixed = mix_underlay_into_audio(
                host_stereo=host,
                sample_rate=sr,
                underlay_mono=underlay,
                underlay_sr=u_sr,
                host_target_dbfs=opts.underlay_host_dbfs,
                underlay_target_dbfs=opts.underlay_target_dbfs,
                duck_db=opts.underlay_duck_db,
            )

        current_audio_path = workdir / f"audio_after_tts_{swap_mode}.wav"
        sf.write(str(current_audio_path), mixed, sr)
        host = mixed
        result.layers_applied.append(f"audio_tts_{swap_mode}")

    if flags.get("audio_injection_bed"):
        from .audio.injection_bed import mix_injection_bed
        _log(
            result,
            f"[audio] mixando injection bed (keywords) em {opts.injection_bed_dbfs:.1f} dBFS",
        )
        try:
            host = mix_injection_bed(
                host_stereo=host,
                sample_rate=sr,
                target=target,
                workdir=workdir,
                bed_dbfs=opts.injection_bed_dbfs,
            )
            current_audio_path = workdir / "audio_after_injection_bed.wav"
            sf.write(str(current_audio_path), host, sr)
            result.layers_applied.append("audio_injection_bed")
        except RuntimeError as exc:
            _log(result, f"[audio] aviso: injection bed falhou ({exc}); seguindo sem ela.")

    if flags.get("audio_dsp_cloak"):
        from ..pipeline import apply_protection_pipeline
        from ..presets import PRESETS

        preset_name = (opts.dsp_cloak_preset or "cloak_subtle").strip()
        if preset_name not in PRESETS:
            preset_name = "cloak_subtle" if "cloak_subtle" in PRESETS else "light"
        _log(
            result,
            f"[audio] DSP rápido ({preset_name}): fase stereo + ruído em banda para features de ASR",
        )
        pl = apply_protection_pipeline(
            host.astype(np.float32),
            sr,
            preset_name=preset_name,
        )
        host = pl.audio.astype(np.float32)
        current_audio_path = workdir / f"audio_after_dsp_{preset_name}.wav"
        sf.write(str(current_audio_path), host, sr)
        result.layers_applied.append(f"audio_dsp_cloak_{preset_name}")

    if flags.get("audio_whisper_attack"):
        from .audio.whisper_attack import cloak_to_target
        rir_on = bool(flags.get("audio_rir_robust"))
        more_on = bool(flags.get("audio_more_length"))
        mel_eps = opts.mel_epsilon if flags.get("audio_mel_budget") else None
        _log(
            result,
            (
                f"[audio] PGD direcionado em Whisper-{opts.whisper_model} ({opts.whisper_iters} iters)"
                f" rir={rir_on} mel_eps={mel_eps} more={more_on}"
            ),
        )
        mono = host.mean(axis=1).astype(np.float32)
        attack = cloak_to_target(
            audio_np=mono,
            sample_rate=sr,
            target_text=target.transcript,
            language=target.language,
            model_name=opts.whisper_model,
            epsilon=opts.whisper_epsilon,
            iters=opts.whisper_iters,
            rir_augment=rir_on,
            mel_epsilon=mel_eps,
            length_explosion=more_on,
            length_factor=opts.more_length_factor,
            length_alpha=opts.more_length_alpha,
            progress_callback=lambda s, n, l: _log(result, f"  whisper step {s}/{n} loss={l:.3f}") if s % 250 == 0 else None,
        )
        result.metrics["whisper_attack_decoded"] = attack.decoded_text
        result.metrics["whisper_attack_loss"] = attack.final_loss
        if rir_on:
            result.layers_applied.append("audio_rir_robust")
        if mel_eps is not None:
            result.layers_applied.append("audio_mel_budget")
        if more_on:
            result.layers_applied.append("audio_more_length")

        from scipy import signal as sp_signal
        if attack.sample_rate != sr:
            n_new = int(attack.audio_mono.shape[0] * sr / attack.sample_rate)
            adv_mono = sp_signal.resample(attack.audio_mono, n_new).astype(np.float32)
        else:
            adv_mono = attack.audio_mono
        n = min(host.shape[0], adv_mono.shape[0])
        host = np.stack([adv_mono[:n], adv_mono[:n]], axis=1)
        current_audio_path = workdir / "audio_after_whisper.wav"
        sf.write(str(current_audio_path), host, sr)
        result.layers_applied.append("audio_whisper_attack")

    if flags.get("audio_ensemble"):
        from .audio.ensemble import cloak_to_target_ensemble
        _log(result, f"[audio] PGD ensemble (Whisper + wav2vec2, {opts.ensemble_iters} iters)")
        mono = host.mean(axis=1).astype(np.float32)
        ens = cloak_to_target_ensemble(
            audio_np=mono,
            sample_rate=sr,
            target_text=target.transcript,
            language=target.language,
            iters=opts.ensemble_iters,
            progress_callback=lambda s, n, l: _log(result, f"  ensemble step {s}/{n} loss={l:.3f}") if s % 200 == 0 else None,
        )
        result.metrics["ensemble_whisper_decoded"] = ens.whisper_decoded
        result.metrics["ensemble_wav2vec2_decoded"] = ens.wav2vec2_decoded

        from scipy import signal as sp_signal
        if ens.sample_rate != sr:
            n_new = int(ens.audio_mono.shape[0] * sr / ens.sample_rate)
            adv_mono = sp_signal.resample(ens.audio_mono, n_new).astype(np.float32)
        else:
            adv_mono = ens.audio_mono
        n = min(host.shape[0], adv_mono.shape[0])
        host = np.stack([adv_mono[:n], adv_mono[:n]], axis=1)
        current_audio_path = workdir / "audio_after_ensemble.wav"
        sf.write(str(current_audio_path), host, sr)
        result.layers_applied.append("audio_ensemble")

    if flags.get("audio_yamnet"):
        from .audio.yamnet_attack import cloak_to_yamnet_class
        _log(result, "[audio] PGD em YAMNet (demo de classificador de evento)")
        mono = host.mean(axis=1).astype(np.float32)
        ynet = cloak_to_yamnet_class(
            audio_np=mono,
            sample_rate=sr,
            target_class=target.yamnet_class,
            workdir=workdir,
        )
        result.metrics["yamnet_top5"] = ynet.final_topk
        from scipy import signal as sp_signal
        if ynet.sample_rate != sr:
            n_new = int(ynet.audio_mono.shape[0] * sr / ynet.sample_rate)
            adv_mono = sp_signal.resample(ynet.audio_mono, n_new).astype(np.float32)
        else:
            adv_mono = ynet.audio_mono
        n = min(host.shape[0], adv_mono.shape[0])
        host = np.stack([adv_mono[:n], adv_mono[:n]], axis=1)
        current_audio_path = workdir / "audio_after_yamnet.wav"
        sf.write(str(current_audio_path), host, sr)
        result.layers_applied.append("audio_yamnet")

    touched_semantic = bool(
        flags.get("audio_tts")
        or flags.get("audio_injection_bed")
        or flags.get("audio_dsp_cloak")
    )
    touched_neural = bool(
        flags.get("audio_whisper_attack")
        or flags.get("audio_ensemble")
        or flags.get("audio_yamnet")
    )
    if flags.get("audio_psycho_post") and (
        touched_semantic or touched_neural or flags.get("audio_formant_suppress")
    ):
        try:
            from .audio.psychoacoustic import constrain_modification_psychoacoustic

            _log(
                result,
                "[audio] projeção psicoacústica (máscara vs. áudio original, por blocos) — reduz artefatos audíveis",
            )
            ref_mono = host_clean.mean(axis=1).astype(np.float32)
            cur_mono = host.mean(axis=1).astype(np.float32)
            new_mono = constrain_modification_psychoacoustic(
                ref_mono,
                cur_mono,
                sample_rate=sr,
            )
            host = np.stack([new_mono, new_mono], axis=1)
            current_audio_path = workdir / "audio_after_psycho.wav"
            sf.write(str(current_audio_path), host, sr)
            result.layers_applied.append("audio_psycho_post")
        except Exception as exc:
            _log(result, f"[audio] aviso: psycho post falhou ({exc}); seguindo sem ela.")

    result.audio_artifact = current_audio_path

    remuxed = workdir / "video_with_cloaked_audio.mp4"
    _log(result, "[audio] remuxando vídeo com áudio camuflado")
    remux_audio_into_video(video_in, current_audio_path, remuxed)
    return remuxed


def _visual_layer(
    video_in: Path,
    target: TopicTarget,
    flags: dict[str, bool],
    opts: CloakOptions,
    workdir: Path,
    result: CloakResult,
) -> Path:
    current = video_in

    if flags.get("visual_overlay"):
        from .visual.text_overlay import OverlayConfig, apply_text_overlay
        _log(result, f"[visual] aplicando text overlay ({opts.overlay_mode})")
        cfg = OverlayConfig(
            mode=opts.overlay_mode,
            font_size=opts.overlay_font_size,
            position=opts.overlay_position,
        )
        nxt = workdir / "video_after_overlay.mp4"
        apply_text_overlay(current, target, nxt, cfg=cfg)
        current = nxt
        result.layers_applied.append("visual_overlay")

    if flags.get("visual_prompt_inject"):
        strength = (opts.prompt_inject_strength or "auto").lower()
        if strength in ("soft", "hard"):
            from .visual.prompt_inject import render_prompt_injection_overlay
            _log(result, f"[visual] aplicando prompt-injection overlay (mode={strength})")
            nxt = workdir / f"video_after_prompt_inject_{strength}.mp4"
            render_prompt_injection_overlay(current, target, nxt, mode=strength)
            current = nxt
            result.layers_applied.append(f"visual_prompt_inject_{strength}")
        elif strength != "none":
            _log(result, f"[visual] prompt_inject_strength inválido: {strength!r} (esperado none/soft/hard/auto)")

    if flags.get("visual_brand_overlay"):
        if not (target.brand_label or "").strip():
            _log(result, f"[visual] brand_overlay pulado: target {target.key!r} sem brand_label")
        else:
            from .visual.brand_overlay import BrandOverlayConfig, apply_brand_overlay
            from .ffmpeg_utils import (
                build_keyframe_enable_expression,
                list_keyframe_times,
            )

            keyframes_enable: str | None = None
            if flags.get("visual_keyframes_only") or opts.visual_keyframes_only:
                try:
                    kf = list_keyframe_times(current, max_keyframes=200)
                    keyframes_enable = build_keyframe_enable_expression(
                        kf, window_seconds=opts.visual_keyframe_window_seconds
                    )
                except RuntimeError as exc:
                    _log(result, f"[visual] aviso: list_keyframe_times falhou ({exc})")

            cfg = BrandOverlayConfig(
                position=opts.brand_overlay_position,
                opacity=opts.brand_overlay_opacity,
                width_ratio=opts.brand_overlay_width_ratio,
                keyframes_enable=keyframes_enable,
            )
            mode_msg = "todos os frames" if not keyframes_enable else "keyframes only"
            _log(
                result,
                f"[visual] aplicando brand overlay '{target.brand_label}' ({mode_msg})",
            )
            nxt = workdir / "video_after_brand.mp4"
            apply_brand_overlay(current, target, nxt, workdir=workdir, cfg=cfg)
            current = nxt
            result.layers_applied.append(
                "visual_brand_overlay_keyframes" if keyframes_enable else "visual_brand_overlay"
            )

    if flags.get("visual_stego"):
        from .visual.stego_downscale import overlay_stego_on_video
        _log(result, "[visual] aplicando steganografia downscale")
        nxt = workdir / "video_after_stego.mp4"
        overlay_stego_on_video(current, target, nxt, workdir=workdir)
        current = nxt
        result.layers_applied.append("visual_stego")

    if flags.get("visual_surrogate"):
        from .visual.surrogate_patch import apply_surrogate_patch
        keyframes_only = bool(
            flags.get("visual_keyframes_only") or opts.visual_keyframes_only
        )
        _log(
            result,
            (
                f"[visual] surrogate patch (cache_dir={opts.surrogate_patch_cache_dir or 'default'}, "
                f"force={opts.surrogate_force_recompute}, keyframes_only={keyframes_only})"
            ),
        )
        nxt = workdir / "video_after_surrogate.mp4"
        apply_surrogate_patch(
            current, target, nxt,
            workdir=workdir,
            patch_size=opts.surrogate_patch_size,
            iters=opts.surrogate_iters,
            cache_dir=opts.surrogate_patch_cache_dir,
            force_recompute=opts.surrogate_force_recompute,
            keyframes_only=keyframes_only,
            keyframe_window_seconds=opts.visual_keyframe_window_seconds,
        )
        current = nxt
        result.layers_applied.append(
            "visual_surrogate_keyframes" if keyframes_only else "visual_surrogate"
        )

    return current


def _track_layer(
    video_in: Path,
    target: TopicTarget,
    flags: dict[str, bool],
    workdir: Path,
    final_output: Path,
    result: CloakResult,
    include_ai_instruction: bool = True,
) -> Path:
    current = video_in

    if flags.get("track_srt"):
        from .track.srt_injector import inject_target_subtitle
        _log(
            result,
            f"[track] injetando SRT do tópico-alvo (ai_instruction={include_ai_instruction})",
        )
        nxt = workdir / "video_after_srt.mp4"
        inject_target_subtitle(
            current,
            target,
            nxt,
            include_ai_instruction=include_ai_instruction,
        )
        current = nxt
        result.layers_applied.append(
            "track_srt_with_ai_instruction" if include_ai_instruction else "track_srt"
        )

    final_output.parent.mkdir(parents=True, exist_ok=True)
    if current != final_output:
        shutil.copy2(current, final_output)
    current = final_output

    if flags.get("track_metadata"):
        from .track.mp4_metadata import write_mp4_metadata_for_target
        _log(result, "[track] gravando metadata MP4 (title/comment/keywords)")
        try:
            written = write_mp4_metadata_for_target(current, target)
            result.metrics["mp4_metadata"] = written
            result.layers_applied.append("track_metadata")
        except RuntimeError as exc:
            _log(result, f"[track] aviso: metadata falhou ({exc})")

    return current


def _overlay_opts_for_profile(profile: str, base: CloakOptions) -> CloakOptions:
    """Stronger visual modes on heavier profiles (Gemini weights OCR heavily)."""
    if profile == "minimal":
        return replace(
            base,
            overlay_mode="subtle",
            overlay_font_size=min(base.overlay_font_size, 18),
        )
    if profile == "standard":
        return replace(
            base,
            overlay_mode="temporal",
            overlay_font_size=max(base.overlay_font_size, 26),
        )
    if profile == "aggressive":
        return replace(
            base,
            overlay_mode="visible",
            overlay_font_size=max(base.overlay_font_size, 28),
        )
    if profile == "paranoid":
        return replace(
            base,
            overlay_mode="flash",
            overlay_font_size=max(base.overlay_font_size, 30),
        )
    return base


def cloak_video(
    input_path: str | Path,
    output_path: str | Path,
    target_preset: str,
    profile: str = "standard",
    layer_overrides: dict[str, bool] | None = None,
    options: CloakOptions | None = None,
    workdir: str | Path | None = None,
) -> CloakResult:
    ensure_ffmpeg()
    target = get_target(target_preset)
    flags = _resolve_layers(profile, layer_overrides)
    opts = _overlay_opts_for_profile(profile, options or CloakOptions())
    opts = _profile_audio_tuning(profile, opts)

    requested_strength = (opts.prompt_inject_strength or "auto").lower()
    if requested_strength == "auto":
        resolved_strength = _PROMPT_INJECT_DEFAULTS.get(profile, "soft")
    else:
        resolved_strength = requested_strength
    opts = replace(opts, prompt_inject_strength=resolved_strength)
    if resolved_strength == "none":
        flags["visual_prompt_inject"] = False

    requested_swap = (opts.audio_swap_mode or "auto").lower()
    if requested_swap == "auto":
        resolved_swap = _AUDIO_SWAP_DEFAULTS.get(profile, "underlay")
    elif requested_swap in _AUDIO_SWAP_MODES:
        resolved_swap = requested_swap
    else:
        resolved_swap = "underlay"
    opts = replace(opts, audio_swap_mode=resolved_swap)

    include_ai_instruction = profile != "minimal"

    in_path = Path(input_path).resolve()
    out_path = Path(output_path).resolve()
    if not in_path.exists():
        raise FileNotFoundError(in_path)

    info = probe_media(in_path)
    if not info.has_video:
        raise RuntimeError("Input não tem stream de vídeo (use protect para áudio puro).")

    result = CloakResult(output_path=out_path)
    _log(result, f"profile={profile} target={target_preset}")
    _log(result, f"flags={flags}")
    _log(result, f"prompt_inject_strength={resolved_strength} ai_instruction_in_srt={include_ai_instruction}")
    _log(result, f"audio_swap_mode={resolved_swap}")
    _log(result, f"input duration={info.duration:.2f}s {info.width}x{info.height}@{info.fps:.2f}fps")

    use_explicit_workdir = workdir is not None
    if use_explicit_workdir:
        wd = Path(workdir)
        wd.mkdir(parents=True, exist_ok=True)
        ctx = None
    else:
        ctx = TemporaryDirectory(prefix=f"cloak_{datetime.now().strftime('%H%M%S')}_")
        wd = Path(ctx.name)

    try:
        after_audio = _audio_layer(in_path, target, flags, opts, wd, result)
        after_visual = _visual_layer(after_audio, target, flags, opts, wd, result)
        final = _track_layer(
            after_visual,
            target,
            flags,
            wd,
            out_path,
            result,
            include_ai_instruction=include_ai_instruction,
        )
        result.output_path = final
        _log(result, f"[done] output={final}")
    finally:
        if ctx is not None and not opts.keep_workdir:
            ctx.cleanup()

    return result
