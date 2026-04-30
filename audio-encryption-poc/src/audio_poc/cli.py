"""Command-line interface for the audio protection PoC + multimodal cloaker."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .asr import evaluate_asr_impact
from .cloak import list_targets
from .cloak.composer import PROFILES, CloakOptions, cloak_video
from .cloak.verify import run_gemini_verification, run_local_verification
from .io_utils import read_audio_stereo, write_audio
from .metrics import snr_db
from .pipeline import apply_protection_pipeline
from .presets import PRESETS


def _cmd_protect(args: argparse.Namespace) -> None:
    audio, sr = read_audio_stereo(args.input)
    result = apply_protection_pipeline(
        audio_stereo=audio,
        sample_rate=sr,
        preset_name=args.preset,
        seed=args.seed,
    )
    write_audio(args.output, result.audio, result.sample_rate)

    ref = audio[:, :2]
    est = result.audio[:, :2]
    metrics = {
        "input": str(Path(args.input).resolve()),
        "output": str(Path(args.output).resolve()),
        "preset": args.preset,
        "snr_db": snr_db(ref, est),
        "pipeline_snr_db_estimate": result.snr_db_estimate,
    }
    print(json.dumps(metrics, indent=2, ensure_ascii=True))


def _cmd_eval_asr(args: argparse.Namespace) -> None:
    reference_text = None
    if args.reference_text_file:
        reference_text = Path(args.reference_text_file).read_text(encoding="utf-8").strip()

    report = evaluate_asr_impact(
        original_path=args.original,
        protected_path=args.protected,
        reference_text=reference_text,
        backend=args.backend,
        model_name=args.model,
        language=args.language,
    )
    print(json.dumps(report, indent=2, ensure_ascii=True))


def _parse_layer_overrides(value: str | None) -> dict[str, bool] | None:
    if not value:
        return None
    overrides: dict[str, bool] = {}
    for entry in value.split(","):
        entry = entry.strip()
        if not entry:
            continue
        key = entry.lstrip("+-")
        flag = not entry.startswith("-")
        overrides[key] = flag
    return overrides


def _cmd_cloak(args: argparse.Namespace) -> None:
    options = CloakOptions(
        overlay_mode=args.overlay_mode,
        overlay_position=args.overlay_position,
        overlay_font_size=args.overlay_font_size,
        whisper_model=args.whisper_model,
        whisper_epsilon=args.whisper_epsilon,
        whisper_iters=args.whisper_iters,
        ensemble_iters=args.ensemble_iters,
        surrogate_iters=args.surrogate_iters,
        surrogate_patch_size=args.surrogate_patch_size,
        underlay_host_dbfs=args.underlay_host_dbfs,
        underlay_target_dbfs=args.underlay_target_dbfs,
        underlay_duck_db=args.underlay_duck_db,
        audio_swap_mode=args.audio_swap_mode,
        swap_host_dbfs=args.swap_host_dbfs,
        swap_target_dbfs=args.swap_target_dbfs,
        swap_intro_seconds=args.swap_intro_seconds,
        swap_outro_seconds=args.swap_outro_seconds,
        injection_bed_dbfs=args.injection_bed_dbfs,
        mel_epsilon=args.mel_epsilon,
        more_length_factor=args.more_length_factor,
        more_length_alpha=args.more_length_alpha,
        prompt_inject_strength=args.prompt_inject_strength,
        formant_depth_db=args.formant_depth_db,
        formant_q=args.formant_q,
        brand_overlay_position=args.brand_overlay_position,
        brand_overlay_opacity=args.brand_overlay_opacity,
        brand_overlay_width_ratio=args.brand_overlay_width_ratio,
        surrogate_patch_cache_dir=args.surrogate_cache_dir,
        surrogate_force_recompute=args.surrogate_force_recompute,
        visual_keyframes_only=args.keyframes_only,
        visual_keyframe_window_seconds=args.keyframe_window_seconds,
        keep_workdir=args.keep_workdir,
    )
    overrides = _parse_layer_overrides(args.layers)

    result = cloak_video(
        input_path=args.input,
        output_path=args.output,
        target_preset=args.target_preset,
        profile=args.profile,
        layer_overrides=overrides,
        options=options,
        workdir=args.workdir,
    )

    summary = {
        "output": str(result.output_path),
        "layers_applied": result.layers_applied,
        "metrics": result.metrics,
        "log_tail": result.log[-10:],
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    if args.verify_with == "local":
        report = run_local_verification(result.output_path, whisper_model=args.whisper_model)
        print("\n--- LOCAL VERIFY ---")
        print(json.dumps(asdict(report), indent=2, ensure_ascii=False))
    elif args.verify_with == "gemini":
        if not args.original_for_verify:
            args.original_for_verify = args.input
        gem = run_gemini_verification(
            original_path=args.original_for_verify,
            cloaked_path=result.output_path,
            api_key=args.gemini_api_key,
            model_name=args.gemini_model,
        )
        print("\n--- GEMINI VERIFY ---")
        print(json.dumps(asdict(gem), indent=2, ensure_ascii=False))


def _cmd_verify_cloak(args: argparse.Namespace) -> None:
    if args.backend == "local":
        rep = run_local_verification(args.cloaked, whisper_model=args.whisper_model, language=args.language)
        print(json.dumps(asdict(rep), indent=2, ensure_ascii=False))
    elif args.backend == "gemini":
        rep = run_gemini_verification(
            original_path=args.original,
            cloaked_path=args.cloaked,
            api_key=args.gemini_api_key,
            model_name=args.gemini_model,
        )
        print(json.dumps(asdict(rep), indent=2, ensure_ascii=False))
    else:
        raise SystemExit(f"backend desconhecido: {args.backend}")


def _cmd_cloak_audio_art(args: argparse.Namespace) -> None:
    """Opt-in: run ART's ImperceptibleASRPyTorch on a single audio file.

    Requires the `[art]` extra (``pip install -e .[art]``) and is intended as
    an A/B alternative to ``whisper_attack``. DeepSpeech2 backend only.
    """
    import numpy as np
    import soundfile as sf

    from .cloak.audio.art_imperceptible import cloak_to_target_imperceptible

    audio, sr = sf.read(args.input, always_2d=True, dtype="float32")
    mono = audio.mean(axis=1).astype(np.float32) if audio.shape[1] > 1 else audio[:, 0]

    res = cloak_to_target_imperceptible(
        audio_np=mono,
        sample_rate=sr,
        target_text=args.target_text,
        pretrained_model=args.pretrained_model,
        max_iter_1st_stage=args.max_iter_1st,
        max_iter_2nd_stage=args.max_iter_2nd,
        learning_rate_1st_stage=args.lr_1st,
        learning_rate_2nd_stage=args.lr_2nd,
        epsilon=args.epsilon,
        device_type=args.device,
    )

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), res.audio_mono, res.sample_rate)

    summary = {
        "engine": "art_imperceptible",
        "output": str(out_path.resolve()),
        "sample_rate": res.sample_rate,
        "iterations": res.iterations,
        "epsilon": res.epsilon,
        "target_text": res.target_text,
        "decoded_text": res.decoded_text,
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))


def _cmd_cloak_audio_more(args: argparse.Namespace) -> None:
    """Run MORE-style length-explosion PGD against Whisper on a single audio file.

    This is a behavioral approximation of MORE (ICLR 2026), not a 1:1 reproduction.
    """
    import numpy as np
    import soundfile as sf

    from .cloak.audio.whisper_attack import cloak_to_target_more
    from .cloak.targets import get_target

    audio, sr = sf.read(args.input, always_2d=True, dtype="float32")
    mono = audio.mean(axis=1).astype(np.float32) if audio.shape[1] > 1 else audio[:, 0]

    if args.target_text:
        target_text = args.target_text
        language = args.language
    elif args.target_preset:
        t = get_target(args.target_preset)
        target_text = t.transcript
        language = t.language
    else:
        raise SystemExit("Forneça --target-text ou --target-preset.")

    res = cloak_to_target_more(
        audio_np=mono,
        sample_rate=sr,
        target_text=target_text,
        language=language,
        model_name=args.whisper_model,
        epsilon=args.epsilon,
        iters=args.iters,
        length_factor=args.length_factor,
        length_alpha=args.length_alpha,
        progress_callback=lambda s, n, l: print(f"  step {s}/{n} loss={l:.3f}") if s % 100 == 0 else None,
    )

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    stereo = np.stack([res.audio_mono, res.audio_mono], axis=1)
    sf.write(str(out_path), stereo, res.sample_rate)

    summary = {
        "engine": "whisper_more",
        "output": str(out_path.resolve()),
        "sample_rate": res.sample_rate,
        "iterations": res.iterations,
        "epsilon": res.epsilon,
        "target_text": res.target_text,
        "decoded_text": res.decoded_text,
        "final_loss": res.final_loss,
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))


def _cmd_list_targets(_args: argparse.Namespace) -> None:
    from .cloak.targets import TOPIC_TARGETS
    rows = []
    for k in list_targets():
        t = TOPIC_TARGETS[k]
        rows.append({"key": k, "language": t.language, "description": t.description})
    print(json.dumps(rows, indent=2, ensure_ascii=False))


def _cmd_precompute_patches(args: argparse.Namespace) -> None:
    """Pre-compute the universal surrogate patch PNG for one or all presets.

    The patch is a deterministic function of (preset.vlm_caption, model,
    seed) so we cache it under ``audio-encryption-poc/assets/patches/`` and
    reuse it for every job. Run this once on a machine with torch/transformers
    installed; afterwards the regular cloak pipeline becomes ~50x faster on
    the visual_surrogate layer.
    """
    from .cloak.targets import TOPIC_TARGETS
    from .cloak.visual.surrogate_patch import (
        default_patch_cache_dir,
        precompute_patch_for_target,
    )

    cache_dir = (
        Path(args.cache_dir).resolve() if args.cache_dir else default_patch_cache_dir()
    )
    if args.target_preset == "all":
        keys = list_targets()
    else:
        if args.target_preset not in TOPIC_TARGETS:
            raise SystemExit(
                f"target preset desconhecido: {args.target_preset!r} (use 'all' ou um de {list_targets()})"
            )
        keys = [args.target_preset]

    rows = []
    for key in keys:
        target = TOPIC_TARGETS[key]
        cached = cache_dir / f"{key}.png"
        was_cached = cached.exists() and not args.force
        out = precompute_patch_for_target(
            target,
            cache_dir=cache_dir,
            patch_size=args.patch_size,
            iters=args.iters,
            force_recompute=args.force,
        )
        rows.append(
            {
                "key": key,
                "path": str(out),
                "from_cache": was_cached,
            }
        )
        status = "cache" if was_cached else "computed"
        print(f"[{status}] {key} -> {out}")

    print()
    print(json.dumps({"cache_dir": str(cache_dir), "patches": rows}, indent=2, ensure_ascii=False))


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="audio-poc",
        description=(
            "Audio protection PoC + multimodal video topic cloaker (audio + "
            "visual + track + verify)."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_protect = sub.add_parser("protect", help="Apply baseline phase-stereo audio protection.")
    p_protect.add_argument("--input", required=True)
    p_protect.add_argument("--output", required=True)
    p_protect.add_argument("--preset", default="balanced", choices=sorted(PRESETS.keys()))
    p_protect.add_argument("--seed", type=int, default=None)
    p_protect.set_defaults(func=_cmd_protect)

    p_eval = sub.add_parser("eval-asr", help="Evaluate ASR impact (before vs after).")
    p_eval.add_argument("--original", required=True)
    p_eval.add_argument("--protected", required=True)
    p_eval.add_argument("--reference-text-file", default=None)
    p_eval.add_argument("--backend", default="whisper")
    p_eval.add_argument("--model", default="base")
    p_eval.add_argument("--language", default=None)
    p_eval.set_defaults(func=_cmd_eval_asr)

    p_cloak = sub.add_parser(
        "cloak",
        help="Multimodal topic cloak: audio + visual + track injection.",
    )
    p_cloak.add_argument("--input", required=True)
    p_cloak.add_argument("--output", required=True)
    p_cloak.add_argument("--target-preset", required=True, choices=list_targets())
    p_cloak.add_argument(
        "--profile",
        default="standard",
        choices=sorted(PROFILES.keys()),
        help="Stack profile: minimal / standard / aggressive / paranoid.",
    )
    p_cloak.add_argument(
        "--layers",
        default=None,
        help="Override layers, e.g. '+visual_overlay,-audio_tts,+track_srt'.",
    )
    p_cloak.add_argument("--overlay-mode", default="subtle", choices=["visible", "subtle", "temporal", "flash"])
    p_cloak.add_argument("--overlay-position", default="bottom", choices=["bottom", "top", "center", "corner_tr"])
    p_cloak.add_argument("--overlay-font-size", type=int, default=22)
    p_cloak.add_argument("--whisper-model", default="base")
    p_cloak.add_argument("--whisper-epsilon", type=float, default=0.005)
    p_cloak.add_argument("--whisper-iters", type=int, default=1500)
    p_cloak.add_argument("--ensemble-iters", type=int, default=1000)
    p_cloak.add_argument("--surrogate-iters", type=int, default=500)
    p_cloak.add_argument("--surrogate-patch-size", type=int, default=96)
    p_cloak.add_argument("--underlay-host-dbfs", type=float, default=-9.0)
    p_cloak.add_argument("--underlay-target-dbfs", type=float, default=-22.0)
    p_cloak.add_argument("--underlay-duck-db", type=float, default=-5.0)
    p_cloak.add_argument(
        "--audio-swap-mode",
        choices=["auto", "underlay", "intro_outro", "full"],
        default="auto",
        help=(
            "How TTS-target interacts with host audio. "
            "auto = per-profile default (standard=underlay, aggressive/paranoid=full). "
            "full = TTS dominates, host abafado. "
            "intro_outro = swap nos primeiros/ultimos segundos, underlay no meio."
        ),
    )
    p_cloak.add_argument(
        "--swap-host-dbfs",
        type=float,
        default=-32.0,
        help="Host level (dBFS) during a full/intro_outro swap. Lower = more silenced.",
    )
    p_cloak.add_argument(
        "--swap-target-dbfs",
        type=float,
        default=-8.0,
        help="TTS-target level (dBFS) during a full/intro_outro swap.",
    )
    p_cloak.add_argument(
        "--swap-intro-seconds",
        type=float,
        default=5.0,
        help="Length of the intro window when --audio-swap-mode=intro_outro.",
    )
    p_cloak.add_argument(
        "--swap-outro-seconds",
        type=float,
        default=3.0,
        help="Length of the outro window when --audio-swap-mode=intro_outro.",
    )
    p_cloak.add_argument(
        "--injection-bed-dbfs",
        type=float,
        default=-34.0,
        help="Level of the keyword injection bed under the host audio.",
    )
    p_cloak.add_argument(
        "--mel-epsilon",
        type=float,
        default=None,
        help="Clipped Mel Attack budget in log-mel space (e.g. 0.5). None = disabled.",
    )
    p_cloak.add_argument(
        "--more-length-factor",
        type=float,
        default=5.0,
        help="MORE-style: how many times to repeat target text in the attack target.",
    )
    p_cloak.add_argument(
        "--more-length-alpha",
        type=float,
        default=0.05,
        help="MORE-style: weight of the diffuse-features penalty.",
    )
    p_cloak.add_argument(
        "--prompt-inject-strength",
        choices=["auto", "none", "soft", "hard"],
        default="auto",
        help="Prompt-injection visual layer strength (auto resolves per profile).",
    )
    p_cloak.add_argument(
        "--formant-depth-db",
        type=float,
        default=-14.0,
        help="dB attenuation applied to the speaker formant bands (-14 = strong, 0 = off).",
    )
    p_cloak.add_argument(
        "--formant-q",
        type=float,
        default=12.0,
        help="Q factor of each notch filter used by formant_suppress.",
    )
    p_cloak.add_argument(
        "--brand-overlay-position",
        choices=["corner_br", "corner_bl", "corner_tr", "corner_tl"],
        default="corner_br",
    )
    p_cloak.add_argument(
        "--brand-overlay-opacity",
        type=float,
        default=0.85,
        help="Opacity (0-1) of the brand-logo badge overlay.",
    )
    p_cloak.add_argument(
        "--brand-overlay-width-ratio",
        type=float,
        default=0.14,
        help="Brand badge width as fraction of video width (0.14 = 14%%).",
    )
    p_cloak.add_argument(
        "--surrogate-cache-dir",
        default=None,
        help="Directory used to cache pre-computed surrogate patches per preset.",
    )
    p_cloak.add_argument(
        "--surrogate-force-recompute",
        action="store_true",
        help="Recompute the surrogate patch even if a cached PNG already exists.",
    )
    p_cloak.add_argument(
        "--keyframes-only",
        action="store_true",
        help="Apply brand overlay and surrogate patch only on a small window around each I-frame.",
    )
    p_cloak.add_argument(
        "--keyframe-window-seconds",
        type=float,
        default=0.12,
        help="Width of the keyframe window when --keyframes-only is on.",
    )
    p_cloak.add_argument("--workdir", default=None, help="Persist intermediate files for debug.")
    p_cloak.add_argument("--keep-workdir", action="store_true")
    p_cloak.add_argument("--verify-with", choices=["none", "local", "gemini"], default="none")
    p_cloak.add_argument("--gemini-api-key", default=None)
    p_cloak.add_argument("--gemini-model", default="gemini-2.0-flash")
    p_cloak.add_argument("--original-for-verify", default=None)
    p_cloak.set_defaults(func=_cmd_cloak)

    p_verify = sub.add_parser("verify-cloak", help="Re-classify a cloaked file (local or via Gemini).")
    p_verify.add_argument("--cloaked", required=True)
    p_verify.add_argument("--original", default=None)
    p_verify.add_argument("--backend", choices=["local", "gemini"], default="local")
    p_verify.add_argument("--whisper-model", default="base")
    p_verify.add_argument("--language", default=None)
    p_verify.add_argument("--gemini-api-key", default=None)
    p_verify.add_argument("--gemini-model", default="gemini-2.0-flash")
    p_verify.set_defaults(func=_cmd_verify_cloak)

    p_list = sub.add_parser("list-targets", help="List available topic-target presets.")
    p_list.set_defaults(func=_cmd_list_targets)

    p_pre = sub.add_parser(
        "precompute-patches",
        help=(
            "Pre-compute the universal CLIP-aligned surrogate patch PNG per "
            "target preset and cache it under audio-encryption-poc/assets/patches/. "
            "Run once on a machine with torch+transformers; afterwards every "
            "cloak job reuses the cached patch (orders of magnitude faster)."
        ),
    )
    p_pre.add_argument(
        "--target-preset",
        default="all",
        help="Either 'all' or a single preset key (see list-targets).",
    )
    p_pre.add_argument(
        "--cache-dir",
        default=None,
        help="Override the default audio-encryption-poc/assets/patches/ cache dir.",
    )
    p_pre.add_argument("--patch-size", type=int, default=96)
    p_pre.add_argument("--iters", type=int, default=1500)
    p_pre.add_argument(
        "--force",
        action="store_true",
        help="Recompute even if a cached PNG already exists.",
    )
    p_pre.set_defaults(func=_cmd_precompute_patches)

    p_art = sub.add_parser(
        "cloak-audio-art",
        help=(
            "Opt-in: imperceptible audio adversarial via ART (DeepSpeech2). "
            "Requires `pip install -e .[art]`."
        ),
    )
    p_art.add_argument("--input", required=True, help="Input audio (any format soundfile reads).")
    p_art.add_argument("--output", required=True, help="Output WAV (16 kHz mono).")
    p_art.add_argument(
        "--target-text",
        required=True,
        help="Text the model should be coerced into transcribing.",
    )
    p_art.add_argument("--pretrained-model", default="librispeech")
    p_art.add_argument("--max-iter-1st", type=int, default=1000)
    p_art.add_argument("--max-iter-2nd", type=int, default=4000)
    p_art.add_argument("--lr-1st", type=float, default=5e-3)
    p_art.add_argument("--lr-2nd", type=float, default=5e-4)
    p_art.add_argument("--epsilon", type=float, default=0.005)
    p_art.add_argument("--device", default="cpu", choices=["cpu", "gpu"])
    p_art.set_defaults(func=_cmd_cloak_audio_art)

    p_more = sub.add_parser(
        "cloak-audio-more",
        help=(
            "MORE-style length-explosion PGD on Whisper (white-box). "
            "Behavioral approximation of MORE (ICLR 2026)."
        ),
    )
    p_more.add_argument("--input", required=True)
    p_more.add_argument("--output", required=True)
    p_more.add_argument(
        "--target-preset",
        default=None,
        choices=list_targets(),
        help="Use the transcript+language of this target preset.",
    )
    p_more.add_argument(
        "--target-text",
        default=None,
        help="Direct target text (overrides --target-preset).",
    )
    p_more.add_argument("--language", default="pt")
    p_more.add_argument("--whisper-model", default="base")
    p_more.add_argument("--epsilon", type=float, default=0.005)
    p_more.add_argument("--iters", type=int, default=1500)
    p_more.add_argument("--length-factor", type=float, default=5.0)
    p_more.add_argument("--length-alpha", type=float, default=0.05)
    p_more.set_defaults(func=_cmd_cloak_audio_more)

    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
