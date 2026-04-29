"""Batch benchmark for protection presets with optional ASR metrics."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from tqdm import tqdm

from audio_poc.asr import evaluate_asr_impact
from audio_poc.io_utils import read_audio_stereo, write_audio
from audio_poc.metrics import snr_db
from audio_poc.pipeline import apply_protection_pipeline
from audio_poc.presets import PRESETS


def run_benchmark(
    input_dir: Path,
    output_dir: Path,
    presets: list[str],
    run_asr: bool = False,
    language: str | None = None,
    model: str = "base",
) -> pd.DataFrame:
    files = sorted([p for p in input_dir.iterdir() if p.suffix.lower() in {".wav", ".flac", ".ogg"}])
    rows: list[dict] = []
    output_dir.mkdir(parents=True, exist_ok=True)

    for f in tqdm(files, desc="Benchmark files"):
        audio, sr = read_audio_stereo(f)
        for preset in presets:
            result = apply_protection_pipeline(audio, sr, preset_name=preset)
            out_path = output_dir / f"{f.stem}.{preset}.wav"
            write_audio(out_path, result.audio, sr)

            row = {
                "file": str(f),
                "preset": preset,
                "output_file": str(out_path),
                "snr_db": snr_db(audio, result.audio),
            }
            if run_asr:
                asr_report = evaluate_asr_impact(
                    original_path=f,
                    protected_path=out_path,
                    reference_text=None,
                    backend="whisper",
                    model_name=model,
                    language=language,
                )
                row.update(
                    {
                        "proxy_wer_vs_original_text": asr_report.get("proxy_wer_vs_original_text"),
                        "proxy_cer_vs_original_text": asr_report.get("proxy_cer_vs_original_text"),
                    }
                )
            rows.append(row)

    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run batch benchmark for audio protection presets.")
    parser.add_argument("--input-dir", required=True, help="Directory with source audio files.")
    parser.add_argument("--output-dir", required=True, help="Directory for protected outputs and reports.")
    parser.add_argument(
        "--presets",
        nargs="+",
        default=list(PRESETS.keys()),
        choices=sorted(PRESETS.keys()),
        help="Presets to benchmark.",
    )
    parser.add_argument("--run-asr", action="store_true", help="Enable ASR proxy metrics using whisper.")
    parser.add_argument("--language", default=None, help="ASR language code.")
    parser.add_argument("--model", default="base", help="Whisper model name.")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    report = run_benchmark(
        input_dir=input_dir,
        output_dir=output_dir,
        presets=args.presets,
        run_asr=args.run_asr,
        language=args.language,
        model=args.model,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "benchmark_report.csv"
    json_path = output_dir / "benchmark_report.json"
    report.to_csv(csv_path, index=False)
    report.to_json(json_path, orient="records", indent=2)

    summary = {
        "rows": len(report),
        "csv": str(csv_path.resolve()),
        "json": str(json_path.resolve()),
        "mean_snr_by_preset": report.groupby("preset")["snr_db"].mean().to_dict() if len(report) else {},
    }
    print(json.dumps(summary, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
