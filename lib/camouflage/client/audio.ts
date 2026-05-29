"use client";

import { loadFFmpeg, fetchFile, getFfmpegLog, clearFfmpegLog, parseFFmpegError } from "./ffmpeg";

export type AudioMode = "leve" | "forte";

const MAX_BYTES = 150 * 1024 * 1024;
const SR = 48000;

/**
 * Camuflagem de áudio inspirada no smudge-audio + thorn + Cloaker DSP,
 * portada pra FFmpeg WASM. Tudo IMPERCEPTÍVEL pro ouvido humano, mas
 * embaralha a impressão digital pra máquinas (fingerprint, ASR/transcrição):
 *
 *   - timing jitter: micro variações de tempo por trecho (±%), destroem
 *     fingerprints baseados em timing sem alterar a percepção
 *   - pitch sutil compensado: desloca o voiceprint
 *   - mascaramento pink + brown noise: piso de ruído sub-audível
 *   - poison HF 14-18kHz: ruído inaudível (>16kHz a maioria não ouve) que
 *     suja o espectro de alta frequência usado por hashers
 *   - camada reversa anti-ASR (modo forte): cópia invertida a -18dB, mascarada
 *     pro humano mas envenena transcrição automática
 *   - codec laundering (modo forte): lowpass + acrusher leve, desloca os picos
 *     de espectrograma que detectores usam
 */
interface ModeCfg {
  jitter: number; // 0..1 (0 = off)
  pitchPercent: number; // ex.: 0.4 → +0.4%
  pinkDb: number; // -100 = off
  brownDb: number;
  hfDb: number; // poison HF; -100 = off
  reverseDb: number | null; // null = off
  launder: number; // 0..1 (0 = off)
}

const MODES: Record<AudioMode, ModeCfg> = {
  leve: { jitter: 0.5, pitchPercent: 0.4, pinkDb: -54, brownDb: -100, hfDb: -50, reverseDb: null, launder: 0 },
  forte: { jitter: 0.85, pitchPercent: 1.0, pinkDb: -48, brownDb: -52, hfDb: -44, reverseDb: -18, launder: 0.25 },
};

function getExtension(filename: string): string {
  const m = filename.match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : ".mp4";
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name);
}

function getDurationFromFile(file: File): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(isVideoFile(file) ? "video" : "audio");
    const url = URL.createObjectURL(file);
    let settled = false;
    const done = (d: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(0);
    el.src = url;
    setTimeout(() => done(el.duration || 0), 6000);
  });
}

// PRNG determinístico: mesmo input + params → mesma sequência de jitter.
function makeRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildJitter(duration: number, intensity: number, src: string, out: string): string {
  const MAX_CHUNKS = 400;
  let chunk = 1.0;
  let n = Math.ceil(duration / chunk);
  if (n > MAX_CHUNKS) {
    chunk = duration / MAX_CHUNKS;
    n = MAX_CHUNKS;
  }
  if (n < 2) return `${src}anull${out}`;

  const maxJitter = 0.04 * intensity; // até ±4% por trecho
  const rand = makeRand(Math.floor(duration * 1000));
  const splits: string[] = [];
  for (let i = 0; i < n; i++) splits.push(`[c${i}]`);

  const lines: string[] = [`${src}asplit=${n}${splits.join("")}`];
  const trimmed: string[] = [];
  for (let i = 0; i < n; i++) {
    const start = (i * chunk).toFixed(6);
    const end = ((i + 1) * chunk).toFixed(6);
    const ratio = (1 + (rand() * 2 - 1) * maxJitter).toFixed(4);
    lines.push(`[c${i}]atrim=${start}:${end},asetpts=PTS-STARTPTS,atempo=${ratio}[t${i}]`);
    trimmed.push(`[t${i}]`);
  }
  lines.push(`${trimmed.join("")}concat=n=${n}:a=1:v=0${out}`);
  return lines.join(";");
}

interface Graph {
  complex: string;
  needsReverse: boolean;
  needsPink: boolean;
  needsBrown: boolean;
  needsHf: boolean;
}

function buildGraph(cfg: ModeCfg, duration: number): Graph {
  const useJitter = cfg.jitter > 0.01 && duration > 1.5;
  const usePink = cfg.pinkDb > -99;
  const useBrown = cfg.brownDb > -99;
  const useHf = cfg.hfDb > -99;
  const useReverse = cfg.reverseDb !== null;
  const useLaunder = cfg.launder > 0.01;

  // alocação de índices de input: 0 main; reverse; pink; brown; hf
  let idx = 1;
  const reverseIdx = useReverse ? idx++ : -1;
  const pinkIdx = usePink ? idx++ : -1;
  const brownIdx = useBrown ? idx++ : -1;
  const hfIdx = useHf ? idx++ : -1;

  const parts: string[] = [];
  parts.push(`[0:a]aresample=${SR}[base]`);
  let cur = "[base]";

  if (useJitter) {
    parts.push(buildJitter(duration, cfg.jitter, cur, "[jit]"));
    cur = "[jit]";
  }

  // cadeia linear: declick → pitch → launder
  const linear: string[] = ["adeclick"];
  if (cfg.pitchPercent !== 0) {
    const ratio = 1 + cfg.pitchPercent / 100;
    const tempo = (1 / ratio).toFixed(6);
    linear.push(`asetrate=${Math.round(SR * ratio)}`, `aresample=${SR}`, `atempo=${tempo}`);
  }
  if (useLaunder) {
    const lp = Math.round(20000 - 14000 * cfg.launder); // 20k → ~16k
    const bits = (16 - 6 * cfg.launder).toFixed(2); // 16 → ~14.5
    linear.push(`lowpass=f=${lp}`, `acrusher=bits=${bits}:samples=1:mode=lin:level_in=1:level_out=1`);
  }
  parts.push(`${cur}${linear.join(",")}[lin]`);
  cur = "[lin]";

  // camada reversa anti-ASR
  if (useReverse) {
    parts.push(`[${reverseIdx}:a]aresample=${SR},areverse,volume=${cfg.reverseDb}dB[rev]`);
    parts.push(`${cur}[rev]amix=inputs=2:duration=first:normalize=0[vox]`);
    cur = "[vox]";
  }

  // camadas de ruído de mascaramento
  const noise: string[] = [];
  if (usePink) {
    parts.push(`[${pinkIdx}:a]volume=${cfg.pinkDb}dB[nzP]`);
    noise.push("[nzP]");
  }
  if (useBrown) {
    parts.push(`[${brownIdx}:a]volume=${cfg.brownDb}dB[nzB]`);
    noise.push("[nzB]");
  }
  if (useHf) {
    parts.push(`[${hfIdx}:a]highpass=f=14000,lowpass=f=18000,volume=${cfg.hfDb}dB[nzH]`);
    noise.push("[nzH]");
  }

  if (noise.length > 0) {
    parts.push(`${cur}${noise.join("")}amix=inputs=${1 + noise.length}:duration=first:normalize=0[out]`);
  } else {
    parts.push(`${cur}anull[out]`);
  }

  return {
    complex: parts.join(";"),
    needsReverse: useReverse,
    needsPink: usePink,
    needsBrown: useBrown,
    needsHf: useHf,
  };
}

function lavfiInput(color: "pink" | "brown" | "white"): string[] {
  return ["-f", "lavfi", "-i", `anoisesrc=color=${color}:amplitude=1.0`];
}

export interface AudioCamouflageResult {
  blob: Blob;
  outputName: string;
}

export async function camouflageAudio(
  file: File,
  mode: AudioMode = "leve",
  onProgress?: (msg: string) => void,
): Promise<AudioCamouflageResult> {
  if (file.size > MAX_BYTES) {
    throw new Error("Arquivo muito grande para processar no navegador (máx 150MB).");
  }

  const ffmpeg = await loadFFmpeg(onProgress);
  const cfg = MODES[mode];
  const inputExt = getExtension(file.name);
  const inputName = `input${inputExt}`;
  const isVideo = isVideoFile(file);
  const outputExt = isVideo ? inputExt : ".mp3";
  const outputFile = `output${outputExt}`;
  const outputName = `${file.name.replace(/\.[^.]+$/, "")}_camuflado${outputExt}`;

  onProgress?.("Analisando arquivo...");
  const duration = await getDurationFromFile(file);

  await ffmpeg.writeFile(inputName, await fetchFile(file));

  // ---- tentativa principal: cadeia rica via filter_complex ----
  try {
    clearFfmpegLog();
    onProgress?.("Camuflando áudio (multicamada)...");

    const graph = buildGraph(cfg, duration);
    const inputs: string[] = ["-i", inputName];
    if (graph.needsReverse) inputs.push("-i", inputName);
    if (graph.needsPink) inputs.push(...lavfiInput("pink"));
    if (graph.needsBrown) inputs.push(...lavfiInput("brown"));
    if (graph.needsHf) inputs.push(...lavfiInput("pink"));

    const fullArgs = isVideo
      ? [...inputs, "-filter_complex", graph.complex, "-map", "0:v:0", "-map", "[out]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-map_metadata", "-1", "-movflags", "+faststart", "-y", outputFile]
      : [...inputs, "-filter_complex", graph.complex, "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", "-map_metadata", "-1", "-y", outputFile];

    const code = await ffmpeg.exec(fullArgs);
    if (code !== 0) throw new Error(parseFFmpegError(getFfmpegLog()));

    const data = await ffmpeg.readFile(outputFile);
    if (!(data instanceof Uint8Array) || data.length === 0) {
      throw new Error("Saída vazia.");
    }
    onProgress?.("Finalizando...");
    const blob = new Blob([new Uint8Array(data.buffer as ArrayBuffer)], {
      type: isVideo ? file.type || "video/mp4" : "audio/mpeg",
    });
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputFile)]);
    return { blob, outputName };
  } catch {
    // ---- fallback robusto: pitch-shift simples (nunca quebra) ----
    onProgress?.("Aplicando camuflagem (modo seguro)...");
    clearFfmpegLog();
    const ratio = 1 + cfg.pitchPercent / 100;
    const simple = `asetrate=${Math.round(SR * ratio)},aresample=${SR},atempo=${(1 / ratio).toFixed(6)}`;
    const args = isVideo
      ? ["-i", inputName, "-af", simple, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-map_metadata", "-1", "-movflags", "+faststart", "-y", outputFile]
      : ["-i", inputName, "-af", simple, "-c:a", "libmp3lame", "-b:a", "192k", "-map_metadata", "-1", "-y", outputFile];
    const code = await ffmpeg.exec(args);
    if (code !== 0) {
      await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputFile)]);
      throw new Error(parseFFmpegError(getFfmpegLog()));
    }
    const data = await ffmpeg.readFile(outputFile);
    const blob = new Blob([new Uint8Array((data as Uint8Array).buffer as ArrayBuffer)], {
      type: isVideo ? file.type || "video/mp4" : "audio/mpeg",
    });
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputFile)]);
    return { blob, outputName };
  }
}
