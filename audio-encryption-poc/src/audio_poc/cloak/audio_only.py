"""Audio-only cloak: reaproveita as camadas de audio do composer em um arquivo
de audio puro (sem video).

- mode="fast" (CPU, sem torch): TTS underlay + injection bed + DSP cloak +
  projecao psicoacustica. Desloca o "topico" que a ASR percebe, mantendo o
  audio subtil pro humano. ~segundos por arquivo.
- mode="max" (precisa de [whisper]+torch): formant suppress + TTS underlay +
  injection bed + PGD white-box no Whisper + projecao psicoacustica. A
  transcricao vira lixo/alvo continuando ~imperceptivel. ~minutos por arquivo.

Emite linhas ``PROGRESS <pct> <msg>`` no stdout (consumidas pelo worker) e, no
fim, um JSON com os layers aplicados.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Callable

import numpy as np
import soundfile as sf

from .composer import CloakOptions, _profile_audio_tuning
from .ffmpeg_utils import ensure_ffmpeg, run_ffmpeg
from .targets import get_target


ProgressFn = Callable[[int, str], None] | None


def _emit(progress: ProgressFn, pct: int, msg: str) -> None:
    if progress is not None:
        progress(pct, msg)


def _encode_output(src_wav: Path, dst: Path) -> None:
    """Codifica o WAV processado no formato pedido pela extensao do destino."""
    ext = dst.suffix.lower()
    if ext in (".m4a", ".aac", ".mp4"):
        codec = ["-c:a", "aac", "-b:a", "192k"]
    elif ext == ".wav":
        codec = ["-c:a", "pcm_s16le"]
    else:  # mp3 como default
        codec = ["-c:a", "libmp3lame", "-b:a", "192k"]
    dst.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(
        [
            "ffmpeg", "-y", "-i", str(src_wav),
            "-vn", "-ac", "2", "-map_metadata", "-1",
            *codec, str(dst),
        ]
    )


@dataclass
class AudioCloakResult:
    output_path: Path
    layers_applied: list[str] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)


def cloak_audio(
    input_path: str | Path,
    output_path: str | Path,
    target_preset: str,
    mode: str = "fast",
    whisper_model: str = "tiny",
    whisper_iters: int = 80,
    progress: ProgressFn = None,
) -> AudioCloakResult:
    ensure_ffmpeg()
    if mode not in ("fast", "max"):
        raise ValueError(f"mode invalido: {mode!r} (use fast|max)")

    target = get_target(target_preset)
    profile = "standard" if mode == "fast" else "aggressive"
    opts = _profile_audio_tuning(
        profile,
        CloakOptions(whisper_model=whisper_model, whisper_iters=whisper_iters),
    )

    in_path = Path(input_path).resolve()
    out_path = Path(output_path).resolve()
    if not in_path.exists():
        raise FileNotFoundError(in_path)

    result = AudioCloakResult(output_path=out_path)
    _emit(progress, 5, "extraindo audio")

    with TemporaryDirectory(prefix="cloak_audio_") as td:
        wd = Path(td)
        src_wav = wd / "host.wav"
        run_ffmpeg(
            [
                "ffmpeg", "-y", "-i", str(in_path),
                "-vn", "-ac", "2", "-ar", "48000",
                "-c:a", "pcm_s16le", str(src_wav),
            ]
        )
        host, sr = sf.read(str(src_wav), always_2d=True, dtype="float32")
        if host.shape[1] == 1:
            host = np.repeat(host, 2, axis=1)
        elif host.shape[1] > 2:
            host = host[:, :2]
        host_clean = host.copy()

        if mode == "max":
            _emit(progress, 15, "formant suppress")
            from .audio.formant_suppress import suppress_formants

            host = suppress_formants(
                host_stereo=host,
                sample_rate=sr,
                depth_db=opts.formant_depth_db,
                q=opts.formant_q,
            )
            result.layers_applied.append("audio_formant_suppress")

        _emit(progress, 25, "TTS underlay")
        from .audio.tts_underlay import generate_tts_underlay, mix_underlay_into_audio

        underlay, u_sr = generate_tts_underlay(
            target, wd, sample_rate=sr, tts_speech_rate=opts.tts_speech_rate
        )
        host = mix_underlay_into_audio(
            host_stereo=host,
            sample_rate=sr,
            underlay_mono=underlay,
            underlay_sr=u_sr,
            host_target_dbfs=opts.underlay_host_dbfs,
            underlay_target_dbfs=opts.underlay_target_dbfs,
            duck_db=opts.underlay_duck_db,
        )
        result.layers_applied.append("audio_tts_underlay")

        _emit(progress, 40, "injection bed")
        try:
            from .audio.injection_bed import mix_injection_bed

            host = mix_injection_bed(
                host_stereo=host,
                sample_rate=sr,
                target=target,
                workdir=wd,
                bed_dbfs=opts.injection_bed_dbfs,
            )
            result.layers_applied.append("audio_injection_bed")
        except RuntimeError:
            # injection bed depende de TTS; se falhar, segue sem ela.
            pass

        if mode == "fast":
            _emit(progress, 60, "DSP cloak (fase stereo + ruido)")
            from ..pipeline import apply_protection_pipeline
            from ..presets import PRESETS

            preset_name = (opts.dsp_cloak_preset or "cloak_subtle").strip()
            if preset_name not in PRESETS:
                preset_name = "cloak_subtle" if "cloak_subtle" in PRESETS else "light"
            pl = apply_protection_pipeline(host.astype(np.float32), sr, preset_name=preset_name)
            host = pl.audio.astype(np.float32)
            result.layers_applied.append(f"audio_dsp_cloak_{preset_name}")
        else:
            _emit(progress, 55, "PGD no Whisper (pode demorar)")
            from .audio.whisper_attack import cloak_to_target

            mono = host.mean(axis=1).astype(np.float32)

            def _wprog(s: int, n: int, loss: float) -> None:
                if s % 20 == 0 or s + 1 >= n:
                    pct = 55 + int(30 * s / max(1, n))
                    _emit(progress, min(85, pct), f"whisper {s}/{n} loss={loss:.2f}")

            attack = cloak_to_target(
                audio_np=mono,
                sample_rate=sr,
                target_text=target.transcript,
                language=target.language,
                model_name=opts.whisper_model,
                epsilon=opts.whisper_epsilon,
                iters=opts.whisper_iters,
                progress_callback=_wprog,
            )
            from scipy import signal as sp_signal

            if attack.sample_rate != sr:
                n_new = int(attack.audio_mono.shape[0] * sr / attack.sample_rate)
                adv_mono = sp_signal.resample(attack.audio_mono, n_new).astype(np.float32)
            else:
                adv_mono = attack.audio_mono
            n = min(host.shape[0], adv_mono.shape[0])
            host = np.stack([adv_mono[:n], adv_mono[:n]], axis=1)
            result.metrics["whisper_attack_decoded"] = attack.decoded_text
            result.layers_applied.append("audio_whisper_attack")

        _emit(progress, 88, "projecao psicoacustica")
        try:
            from .audio.psychoacoustic import constrain_modification_psychoacoustic

            ref_mono = host_clean.mean(axis=1).astype(np.float32)
            cur_mono = host.mean(axis=1).astype(np.float32)
            new_mono = constrain_modification_psychoacoustic(ref_mono, cur_mono, sample_rate=sr)
            host = np.stack([new_mono, new_mono], axis=1)
            result.layers_applied.append("audio_psycho_post")
        except Exception:
            # projecao e best-effort; se falhar, mantem o audio processado.
            pass

        _emit(progress, 94, "codificando saida")
        peak = float(np.max(np.abs(host)) + 1e-8)
        if peak > 0.99:
            host = host * (0.99 / peak)
        out_wav = wd / "out.wav"
        sf.write(str(out_wav), host.astype(np.float32), sr)
        _encode_output(out_wav, out_path)

    _emit(progress, 100, "concluido")
    return result
