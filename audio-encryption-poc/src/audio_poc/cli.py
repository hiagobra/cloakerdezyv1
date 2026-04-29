"""Command-line interface for the audio protection PoC."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .asr import evaluate_asr_impact
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


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="audio-poc",
        description="PoC phase-stereo audio protection pipeline for ASR degradation tests.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_protect = sub.add_parser("protect", help="Apply audio protection pipeline.")
    p_protect.add_argument("--input", required=True, help="Input audio file path.")
    p_protect.add_argument("--output", required=True, help="Output protected audio file path.")
    p_protect.add_argument(
        "--preset",
        default="balanced",
        choices=sorted(PRESETS.keys()),
        help="Protection intensity preset.",
    )
    p_protect.add_argument("--seed", type=int, default=None, help="Optional random seed.")
    p_protect.set_defaults(func=_cmd_protect)

    p_eval = sub.add_parser("eval-asr", help="Evaluate ASR impact (before vs after).")
    p_eval.add_argument("--original", required=True, help="Original audio file path.")
    p_eval.add_argument("--protected", required=True, help="Protected audio file path.")
    p_eval.add_argument(
        "--reference-text-file",
        default=None,
        help="Optional text file with ground-truth transcript.",
    )
    p_eval.add_argument("--backend", default="whisper", help="ASR backend (currently: whisper).")
    p_eval.add_argument("--model", default="base", help="ASR model name.")
    p_eval.add_argument("--language", default=None, help="Language code, e.g. pt or en.")
    p_eval.set_defaults(func=_cmd_eval_asr)

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
