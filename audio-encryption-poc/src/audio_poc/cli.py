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
        prompt_inject_strength=args.prompt_inject_strength,
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


def _cmd_list_targets(_args: argparse.Namespace) -> None:
    from .cloak.targets import TOPIC_TARGETS
    rows = []
    for k in list_targets():
        t = TOPIC_TARGETS[k]
        rows.append({"key": k, "language": t.language, "description": t.description})
    print(json.dumps(rows, indent=2, ensure_ascii=False))


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
        "--prompt-inject-strength",
        choices=["auto", "none", "soft", "hard"],
        default="auto",
        help="Prompt-injection visual layer strength (auto resolves per profile).",
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
