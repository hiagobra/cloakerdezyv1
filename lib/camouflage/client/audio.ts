"use client";

import { loadFFmpeg, fetchFile, getFfmpegLog, clearFfmpegLog, parseFFmpegError } from "./ffmpeg";

export type AudioMode = "leve" | "maximo";

const MAX_BYTES = 150 * 1024 * 1024;
const SR = 48000;

/**
 * Camuflagem de áudio anti-IA (DSP, estilo maskai.co). Tudo no FFmpeg WASM.
 *
 * - leve:   imperceptível. timing jitter + pitch sutil + mascaramento
 *           pink/HF. Disfarça fingerprint sem mexer na percepção.
 * - maximo: nível maskai. Além do acima, mistura uma camada REVERSA + ECO da
 *           própria voz (scrambler) + notches nas bandas de consoante. O
 *           downmix mono que a ASR (Whisper/Gemini) usa fica dominado por fala
 *           reversa/eco não-transcrevível, mas a voz original SOBREVIVE no mono
 *           (toca em celular) e o humano entende via separação cognitiva.
 *           Aceita um leve eco audível — é o trade-off pra realmente enganar a IA.
 */
interface ModeCfg {
  monoBase: boolean;
  jitter: number; // 0..1
  pitchPercent: number;
  notches: boolean;
  scramblerDb: number | null; // null = sem camada reversa
  pinkDb: number; // -100 = off
  brownDb: number;
  hfDb: number;
  launder: number; // 0..1
  stereoOut: boolean; // força saída estéreo (dual-mono)
}

const MODES: Record<AudioMode, ModeCfg> = {
  leve: {
    monoBase: false,
    jitter: 0.5,
    pitchPercent: 0.4,
    notches: false,
    scramblerDb: null,
    pinkDb: -54,
    brownDb: -100,
    hfDb: -50,
    launder: 0,
    stereoOut: false,
  },
  maximo: {
    monoBase: true,
    jitter: 0.4,
    pitchPercent: 1.0,
    notches: true,
    scramblerDb: -6,
    pinkDb: -48,
    brownDb: -52,
    hfDb: -44,
    launder: 0.2,
    stereoOut: true,
  },
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

  const maxJitter = 0.04 * intensity;
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
  needsPink: boolean;
  needsBrown: boolean;
  needsHf: boolean;
}

function buildGraph(cfg: ModeCfg, duration: number, audioLabel = "[0:a]", lavfiStart = 1): Graph {
  const useJitter = cfg.jitter > 0.01 && duration > 1.5;
  const usePink = cfg.pinkDb > -99;
  const useBrown = cfg.brownDb > -99;
  const useHf = cfg.hfDb > -99;
  const useScrambler = cfg.scramblerDb !== null;

  const parts: string[] = [];
  parts.push(cfg.monoBase ? `${audioLabel}aresample=${SR},aformat=channel_layouts=mono[base]` : `${audioLabel}aresample=${SR}[base]`);
  let cur = "[base]";

  if (useJitter) {
    parts.push(buildJitter(duration, cfg.jitter, cur, "[jit]"));
    cur = "[jit]";
  }

  // processamento comum: declick → pitch → launder
  const proc: string[] = ["adeclick"];
  if (cfg.pitchPercent !== 0) {
    const ratio = 1 + cfg.pitchPercent / 100;
    proc.push(`asetrate=${Math.round(SR * ratio)}`, `aresample=${SR}`, `atempo=${(1 / ratio).toFixed(6)}`);
  }
  if (cfg.launder > 0.01) {
    const lp = Math.round(20000 - 14000 * cfg.launder);
    const bits = (16 - 6 * cfg.launder).toFixed(2);
    proc.push(`lowpass=f=${lp}`, `acrusher=bits=${bits}:samples=1:mode=lin:level_in=1:level_out=1`);
  }
  parts.push(`${cur}${proc.join(",")}[proc]`);
  cur = "[proc]";

  if (useScrambler) {
    // deriva a camada reversa+eco da voz processada; aplica notches na voz principal
    parts.push(`[proc]asplit=2[main][scr]`);
    const notches = cfg.notches
      ? ",bandreject=f=1500:width_type=h:w=250,bandreject=f=2800:width_type=h:w=350,bandreject=f=4500:width_type=h:w=450"
      : "";
    parts.push(`[main]anull${notches}[voxN]`);
    parts.push(
      `[scr]areverse,aecho=in_gain=1:out_gain=0.85:delays=90|180:decays=0.5|0.3,highpass=f=250,lowpass=f=3600,volume=${cfg.scramblerDb}dB[scram]`,
    );
    parts.push(`[voxN][scram]amix=inputs=2:duration=first:normalize=0[mix]`);
    cur = "[mix]";
  }

  // alocação de inputs lavfi (após os inputs reais)
  let idx = lavfiStart;
  const pinkIdx = usePink ? idx++ : -1;
  const brownIdx = useBrown ? idx++ : -1;
  const hfIdx = useHf ? idx++ : -1;

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

  return { complex: parts.join(";"), needsPink: usePink, needsBrown: useBrown, needsHf: useHf };
}

function lavfiInput(color: "pink" | "brown"): string[] {
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
  // webm mantém libopus; mp4/mov usam aac
  const videoAudioCodec = /\.webm$/i.test(inputExt) ? "libopus" : "aac";

  onProgress?.("Analisando arquivo...");
  const duration = await getDurationFromFile(file);
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  // ---- tentativa principal: cadeia anti-IA via filter_complex ----
  try {
    clearFfmpegLog();
    onProgress?.(mode === "maximo" ? "Camuflando áudio (anti-IA)..." : "Camuflando áudio...");

    const graph = buildGraph(cfg, duration);
    const inputs: string[] = ["-i", inputName];
    if (graph.needsPink) inputs.push(...lavfiInput("pink"));
    if (graph.needsBrown) inputs.push(...lavfiInput("brown"));
    if (graph.needsHf) inputs.push(...lavfiInput("pink"));

    const channels = cfg.stereoOut ? ["-ac", "2"] : [];
    const fullArgs = isVideo
      ? [...inputs, "-filter_complex", graph.complex, "-map", "0:v:0", "-map", "[out]", "-c:v", "copy", "-c:a", videoAudioCodec, "-b:a", "160k", ...channels, "-map_metadata", "-1", "-movflags", "+faststart", "-y", outputFile]
      : [...inputs, "-filter_complex", graph.complex, "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", ...channels, "-map_metadata", "-1", "-y", outputFile];

    const code = await ffmpeg.exec(fullArgs);
    if (code !== 0) throw new Error(parseFFmpegError(getFfmpegLog()));

    const data = await ffmpeg.readFile(outputFile);
    if (!(data instanceof Uint8Array) || data.length === 0) throw new Error("Saída vazia.");
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
      ? ["-i", inputName, "-af", simple, "-c:v", "copy", "-c:a", videoAudioCodec, "-b:a", "160k", "-map_metadata", "-1", "-movflags", "+faststart", "-y", outputFile]
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

/**
 * Remuxa o áudio do arquivo ORIGINAL (opcionalmente camuflado anti-IA) dentro
 * do vídeo já camuflado visualmente. Usado pela aba Vídeo: o vídeo é gravado
 * sem áudio (a captura via canvas não é confiável) e o áudio vem direto da
 * fonte original aqui — assim nunca some.
 *
 * @param videoBlob vídeo camuflado visualmente (sem áudio), do MediaRecorder
 * @param original  arquivo original (fonte de áudio)
 * @param mode      AudioMode pra processar o áudio, ou null pra só recolocar o original
 */
export async function protectVideoAudio(
  videoBlob: Blob,
  original: File,
  mode: AudioMode | null,
  onProgress?: (msg: string) => void,
): Promise<{ blob: Blob; outputName: string }> {
  const ffmpeg = await loadFFmpeg(onProgress);
  const isWebm = /webm/i.test(videoBlob.type);
  const vExt = isWebm ? ".webm" : ".mp4";
  const audioCodec = isWebm ? "libopus" : "aac";
  const vName = `cam${vExt}`;
  const aName = `orig${getExtension(original.name)}`;
  const outName = `final${vExt}`;
  const base = original.name.replace(/\.[^.]+$/, "");
  const outputName = `${base}_camuflado${vExt}`;
  const outType = isWebm ? "video/webm" : "video/mp4";

  await ffmpeg.writeFile(vName, await fetchFile(videoBlob));
  await ffmpeg.writeFile(aName, await fetchFile(original));

  const cleanup = () =>
    Promise.allSettled([ffmpeg.deleteFile(vName), ffmpeg.deleteFile(aName), ffmpeg.deleteFile(outName)]);

  // remux simples: copia vídeo, recoloca o áudio original (sem anti-IA)
  const plainArgs = [
    "-i", vName, "-i", aName,
    "-map", "0:v:0", "-map", "1:a:0?",
    "-c:v", "copy", "-c:a", audioCodec, "-b:a", "160k", "-ac", "2",
    "-map_metadata", "-1", "-movflags", "+faststart", "-shortest", "-y", outName,
  ];

  try {
    clearFfmpegLog();
    if (mode === null) {
      onProgress?.("Recolocando áudio...");
      const code = await ffmpeg.exec(plainArgs);
      if (code !== 0) throw new Error(parseFFmpegError(getFfmpegLog()));
    } else {
      onProgress?.(mode === "maximo" ? "Protegendo áudio (anti-IA)..." : "Protegendo áudio...");
      const cfg = MODES[mode];
      const duration = await getDurationFromFile(original);
      const graph = buildGraph(cfg, duration, "[1:a]", 2);
      const inputs = ["-i", vName, "-i", aName];
      if (graph.needsPink) inputs.push(...lavfiInput("pink"));
      if (graph.needsBrown) inputs.push(...lavfiInput("brown"));
      if (graph.needsHf) inputs.push(...lavfiInput("pink"));
      const code = await ffmpeg.exec([
        ...inputs, "-filter_complex", graph.complex,
        "-map", "0:v:0", "-map", "[out]",
        "-c:v", "copy", "-c:a", audioCodec, "-b:a", "160k", "-ac", "2",
        "-map_metadata", "-1", "-movflags", "+faststart", "-shortest", "-y", outName,
      ]);
      if (code !== 0) throw new Error(parseFFmpegError(getFfmpegLog()));
    }

    const data = await ffmpeg.readFile(outName);
    if (!(data instanceof Uint8Array) || data.length === 0) throw new Error("Saída vazia.");
    const blob = new Blob([new Uint8Array(data.buffer as ArrayBuffer)], { type: outType });
    await cleanup();
    return { blob, outputName };
  } catch (err) {
    // fallback: pelo menos recoloca o áudio original pra não perder o som
    try {
      clearFfmpegLog();
      const code = await ffmpeg.exec(plainArgs);
      if (code === 0) {
        const data = await ffmpeg.readFile(outName);
        if (data instanceof Uint8Array && data.length > 0) {
          const blob = new Blob([new Uint8Array(data.buffer as ArrayBuffer)], { type: outType });
          await cleanup();
          return { blob, outputName };
        }
      }
    } catch {
      /* cai pro throw abaixo */
    }
    await cleanup();
    throw err instanceof Error ? err : new Error("Falha ao proteger o áudio do vídeo.");
  }
}
