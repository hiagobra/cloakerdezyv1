"use client";

import { loadFFmpeg, fetchFile, getFfmpegLog, clearFfmpegLog, parseFFmpegError, runExclusive, nextFileId } from "./ffmpeg";

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
 *
 * Gain-staging (corrige o bug de "som não sai" no maximo): a voz passa por
 * `acompressor` (fica densa/dominante), o scrambler entra ~8 dB ABAIXO, e a
 * cadeia termina num `alimiter` que impede a saturação que o `aecho` causava
 * (o que destruía/zerava o áudio). Há ainda uma trava de silêncio em runtime:
 * se a saída sair muda (mean_volume < -50 dB), cai automático no fallback.
 */
interface ModeCfg {
  monoBase: boolean;
  jitter: number; // 0..1
  pitchPercent: number;
  notches: boolean;
  scramblerDb: number | null; // null = sem camada reversa
  compress: boolean; // acompressor na voz pra ela dominar o mix
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
    compress: false,
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
    scramblerDb: -8,
    compress: true,
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
    // notches nas bandas de consoante (destroem pistas de fonema pra ASR)
    const notches = cfg.notches
      ? ",bandreject=f=1500:width_type=h:w=220,bandreject=f=2800:width_type=h:w=320,bandreject=f=4200:width_type=h:w=420"
      : "";
    // acompressor deixa a voz densa e dominante (anti "voz some sob o eco")
    const comp = cfg.compress
      ? ",acompressor=threshold=-18dB:ratio=3:attack=20:release=200:makeup=2"
      : "";
    parts.push(`[main]anull${notches}${comp}[voxN]`);
    // out_gain<1 e scrambler ~8 dB abaixo: confunde a ASR sem saturar / sem cobrir a voz
    parts.push(
      `[scr]areverse,aecho=in_gain=1:out_gain=0.6:delays=80|160:decays=0.4|0.25,highpass=f=300,lowpass=f=3400,volume=${cfg.scramblerDb}dB[scram]`,
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

  let mixed: string;
  if (noise.length > 0) {
    parts.push(`${cur}${noise.join("")}amix=inputs=${1 + noise.length}:duration=first:normalize=0[premix]`);
    mixed = "[premix]";
  } else {
    mixed = cur;
  }
  // alimiter final: barra os picos do eco/mix (era a saturação que zerava/destruía o áudio)
  parts.push(`${mixed}alimiter=level_in=1:level_out=1:limit=0.9[out]`);

  return { complex: parts.join(";"), needsPink: usePink, needsBrown: useBrown, needsHf: useHf };
}

/**
 * Input lavfi de ruído. `duration` (s) é OBRIGATÓRIO pra robustez: sem ele o
 * `anoisesrc` é infinito e, somado via `amix` ao lado do `areverse` (que só
 * emite no EOF), pode TRAVAR o WASM. Bounded = a cadeia sempre termina.
 */
function lavfiInput(color: "pink" | "brown", duration: number): string[] {
  const dur = duration > 0 ? `:duration=${(duration + 1).toFixed(3)}` : "";
  return ["-f", "lavfi", "-i", `anoisesrc=color=${color}:amplitude=1.0${dur}`];
}

/**
 * Clona a config desativando o scrambler (areverse) quando o áudio é muito
 * longo: `areverse` bufferiza o stream inteiro e estoura a memória do WASM em
 * áudios/vídeos longos (causa de travamento). Mantém o resto da camuflagem.
 */
const REVERSE_MAX_SECONDS = 150;
function effectiveCfg(cfg: ModeCfg, duration: number): ModeCfg {
  if (cfg.scramblerDb !== null && duration > REVERSE_MAX_SECONDS) {
    return { ...cfg, scramblerDb: null };
  }
  return cfg;
}

/**
 * Mede o volume médio (dBFS) da trilha de áudio de um arquivo já no FS do
 * FFmpeg via `volumedetect`. Usado como trava de silêncio: se a cadeia anti-IA
 * produzir uma saída muda (bug do maximo), detectamos aqui e caímos no fallback.
 * Retorna null se não conseguir medir (nesse caso, não bloqueia).
 */
async function meanVolumeDb(
  ffmpeg: Awaited<ReturnType<typeof loadFFmpeg>>,
  fileName: string,
): Promise<number | null> {
  clearFfmpegLog();
  // saída pra um arquivo-sink (NÃO usar "-": stdout não funciona no FFmpeg WASM)
  const sink = `vd_${nextFileId()}.null`;
  try {
    await ffmpeg.exec(["-i", fileName, "-vn", "-af", "volumedetect", "-f", "null", "-y", sink]);
  } catch {
    await ffmpeg.deleteFile(sink).catch(() => {});
    return null;
  }
  await ffmpeg.deleteFile(sink).catch(() => {});
  const m = getFfmpegLog().match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  return m ? parseFloat(m[1]) : null;
}

// Abaixo disso é "praticamente mudo" (só ruído de mascaramento ou nada).
const SILENCE_FLOOR_DB = -45;

/**
 * Filtro da VOZ processada (sem overlay reverso e sem ruído): mono base →
 * jitter → declick → pitch → launder → notches → compressor. É a cadeia que
 * SEMPRE tem som; serve de base do mix e de rede de segurança no `maximo`.
 */
function buildVoiceComplex(cfg: ModeCfg, duration: number, label = "[0:a]"): string {
  const parts: string[] = [];
  parts.push(cfg.monoBase ? `${label}aresample=${SR},aformat=channel_layouts=mono[base]` : `${label}aresample=${SR}[base]`);
  let cur = "[base]";
  if (cfg.jitter > 0.01 && duration > 1.5) {
    parts.push(buildJitter(duration, cfg.jitter, cur, "[jit]"));
    cur = "[jit]";
  }
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
  if (cfg.notches) {
    proc.push(
      "bandreject=f=1500:width_type=h:w=220",
      "bandreject=f=2800:width_type=h:w=320",
      "bandreject=f=4200:width_type=h:w=420",
    );
  }
  if (cfg.compress) {
    proc.push("acompressor=threshold=-18dB:ratio=3:attack=20:release=200:makeup=2");
  }
  parts.push(`${cur}${proc.join(",")}[out]`);
  return parts.join(";");
}

/** Filtro -af que deriva a camada reversa+eco da voz já processada. */
function scramblerAf(cfg: ModeCfg): string {
  return `areverse,aecho=in_gain=1:out_gain=0.6:delays=80|160:decays=0.4|0.25,highpass=f=300,lowpass=f=3400,volume=${cfg.scramblerDb}dB`;
}

// Nível da copia white relativo à voz principal (dB). A white fica logo abaixo
// da voz pro humano focar na real, mas como a voz vai NOTCHADA na banda de
// consoante e a white entra LIMPA, a ASR trava na white (transcreve ela).
const WHITE_REL_DB = -3;

/**
 * Mix do `maximo` com COPIA WHITE (técnica maskai): voz real degradada (input
 * 0) + fala white limpa nivelada (input 1) + ruído (2..N). A ASR transcreve a
 * white; o humano segue a voz real no foco.
 */
function buildWhiteMixComplex(cfg: ModeCfg, whiteGainDb: number): { complex: string; needsPink: boolean; needsBrown: boolean; needsHf: boolean } {
  const usePink = cfg.pinkDb > -99;
  const useBrown = cfg.brownDb > -99;
  const useHf = cfg.hfDb > -99;
  const parts: string[] = [`[1:a]volume=${whiteGainDb.toFixed(2)}dB[wht]`];
  const labels: string[] = ["[0:a]", "[wht]"];
  let idx = 2;
  if (usePink) {
    parts.push(`[${idx}:a]volume=${cfg.pinkDb}dB[nzP]`);
    labels.push("[nzP]");
    idx++;
  }
  if (useBrown) {
    parts.push(`[${idx}:a]volume=${cfg.brownDb}dB[nzB]`);
    labels.push("[nzB]");
    idx++;
  }
  if (useHf) {
    parts.push(`[${idx}:a]highpass=f=14000,lowpass=f=18000,volume=${cfg.hfDb}dB[nzH]`);
    labels.push("[nzH]");
    idx++;
  }
  parts.push(`${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0[premix]`);
  parts.push(`[premix]alimiter=level_in=1:level_out=1:limit=0.95[out]`);
  return { complex: parts.join(";"), needsPink: usePink, needsBrown: useBrown, needsHf: useHf };
}

/**
 * Mix final do `maximo`: voz (input 0) + scrambler (input 1) + ruído (inputs
 * 2..N, finitos). Como TODOS são arquivos/streams finitos, o `amix` nunca
 * descarta a voz (era a causa do "sem áudio" no grafo único do WASM).
 */
function buildMixComplex(cfg: ModeCfg): { complex: string; needsPink: boolean; needsBrown: boolean; needsHf: boolean } {
  const usePink = cfg.pinkDb > -99;
  const useBrown = cfg.brownDb > -99;
  const useHf = cfg.hfDb > -99;
  const parts: string[] = [];
  const labels: string[] = ["[0:a]", "[1:a]"];
  let idx = 2;
  if (usePink) {
    parts.push(`[${idx}:a]volume=${cfg.pinkDb}dB[nzP]`);
    labels.push("[nzP]");
    idx++;
  }
  if (useBrown) {
    parts.push(`[${idx}:a]volume=${cfg.brownDb}dB[nzB]`);
    labels.push("[nzB]");
    idx++;
  }
  if (useHf) {
    parts.push(`[${idx}:a]highpass=f=14000,lowpass=f=18000,volume=${cfg.hfDb}dB[nzH]`);
    labels.push("[nzH]");
    idx++;
  }
  parts.push(`${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0[premix]`);
  parts.push(`[premix]alimiter=level_in=1:level_out=1:limit=0.9[out]`);
  return { complex: parts.join(";"), needsPink: usePink, needsBrown: useBrown, needsHf: useHf };
}

/**
 * Processa o áudio de `srcName` (já no FS do FFmpeg) e devolve o nome de um WAV
 * PCM camuflado. NUNCA devolve áudio mudo:
 *  - `leve` / scrambler off → passe único (voz + ruído + limiter);
 *  - `maximo` → 3 passes (voz → scrambler → mix), e se o overlay falhar/mudar
 *    no WASM, devolve a VOZ LIMPA processada (sempre audível).
 * Lança erro só se nem a voz base processar (aí o chamador faz o fallback simples).
 */
async function renderAudioWav(
  ffmpeg: Awaited<ReturnType<typeof loadFFmpeg>>,
  srcName: string,
  mode: AudioMode,
  duration: number,
  id: string,
  whiteName: string | null = null,
): Promise<string> {
  const cfg = effectiveCfg(MODES[mode], duration);
  const hasWhite = !!whiteName;

  // ---- caso simples: sem scrambler E sem white (leve) → passe único ----
  if (cfg.scramblerDb === null && !hasWhite) {
    const outWav = `cw_${id}.wav`;
    const graph = buildGraph(cfg, duration, "[0:a]", 1);
    const inputs = ["-i", srcName];
    if (graph.needsPink) inputs.push(...lavfiInput("pink", duration));
    if (graph.needsBrown) inputs.push(...lavfiInput("brown", duration));
    if (graph.needsHf) inputs.push(...lavfiInput("pink", duration));
    const channels = cfg.stereoOut ? ["-ac", "2"] : [];
    const code = await ffmpeg.exec([...inputs, "-filter_complex", graph.complex, "-map", "[out]", ...channels, "-c:a", "pcm_s16le", "-y", outWav]);
    if (code !== 0) throw new Error(parseFFmpegError(getFfmpegLog()));
    const mean = await meanVolumeDb(ffmpeg, outWav);
    if (mean !== null && mean < SILENCE_FLOOR_DB) throw new Error("Saída praticamente muda.");
    return outWav;
  }

  // ---- PASS 1 — voz processada (degradada pra ASR, sempre com som) ----
  // Com white copy, força notches/compress (degrada a voz real pra ASR travar na white).
  const voiceCfg: ModeCfg = hasWhite ? { ...cfg, notches: true, compress: true, monoBase: true } : cfg;
  const voiceWav = `cv_${id}.wav`;
  const vcode = await ffmpeg.exec(["-i", srcName, "-filter_complex", buildVoiceComplex(voiceCfg, duration), "-map", "[out]", "-c:a", "pcm_s16le", "-y", voiceWav]);
  if (vcode !== 0) throw new Error(parseFFmpegError(getFfmpegLog()));
  const vmean = await meanVolumeDb(ffmpeg, voiceWav);
  if (vmean !== null && vmean < SILENCE_FLOOR_DB) throw new Error("Voz processada ficou muda.");

  const outWav = `cw_${id}.wav`;

  // ---- CAMINHO A: COPIA WHITE (técnica maskai) ----
  if (hasWhite && whiteName) {
    const whiteWav = `ch_${id}.wav`;
    try {
      // processa a white: loopa pra cobrir a duração, limita à banda de voz e nivela dinâmica
      const loopIn = duration > 1 ? ["-stream_loop", "-1", "-i", whiteName, "-t", duration.toFixed(3)] : ["-i", whiteName];
      const wcode = await ffmpeg.exec([
        ...loopIn,
        "-af", "aresample=48000,aformat=channel_layouts=mono,highpass=f=180,lowpass=f=6500,acompressor=threshold=-20dB:ratio=4:attack=10:release=180:makeup=4",
        "-c:a", "pcm_s16le", "-y", whiteWav,
      ]);
      if (wcode !== 0) throw new Error("white falhou");

      // nivela a white ~WHITE_REL_DB abaixo da voz (por medição de mean)
      const mMean = (await meanVolumeDb(ffmpeg, voiceWav)) ?? -20;
      const wMean = (await meanVolumeDb(ffmpeg, whiteWav)) ?? -20;
      let gain = mMean + WHITE_REL_DB - wMean;
      gain = Math.max(-24, Math.min(18, gain)); // clamp pra não estourar/sumir

      const mix = buildWhiteMixComplex(cfg, gain);
      const inputs = ["-i", voiceWav, "-i", whiteWav];
      if (mix.needsPink) inputs.push(...lavfiInput("pink", duration));
      if (mix.needsBrown) inputs.push(...lavfiInput("brown", duration));
      if (mix.needsHf) inputs.push(...lavfiInput("pink", duration));
      const mcode = await ffmpeg.exec([...inputs, "-filter_complex", mix.complex, "-map", "[out]", "-ac", "2", "-c:a", "pcm_s16le", "-y", outWav]);
      if (mcode !== 0) throw new Error("mix white falhou");

      const omean = await meanVolumeDb(ffmpeg, outWav);
      if (omean !== null && omean < SILENCE_FLOOR_DB) throw new Error("mix white ficou mudo");

      await Promise.allSettled([ffmpeg.deleteFile(whiteWav), ffmpeg.deleteFile(voiceWav)]);
      return outWav;
    } catch {
      // white falhou → cai pro scrambler reverso abaixo (ainda anti-IA), sem perder o som
      await Promise.allSettled([ffmpeg.deleteFile(whiteWav)]);
    }
  }

  // ---- CAMINHO B: scrambler reverso+eco (quando não há white, ou white falhou) ----
  const scramWav = `cs_${id}.wav`;
  try {
    const scrCfg = cfg.scramblerDb === null ? { ...cfg, scramblerDb: -8 } : cfg;
    const scode = await ffmpeg.exec(["-i", voiceWav, "-af", scramblerAf(scrCfg), "-c:a", "pcm_s16le", "-y", scramWav]);
    if (scode !== 0) throw new Error("scrambler falhou");

    const mix = buildMixComplex(cfg);
    const inputs = ["-i", voiceWav, "-i", scramWav];
    if (mix.needsPink) inputs.push(...lavfiInput("pink", duration));
    if (mix.needsBrown) inputs.push(...lavfiInput("brown", duration));
    if (mix.needsHf) inputs.push(...lavfiInput("pink", duration));
    const mcode = await ffmpeg.exec([...inputs, "-filter_complex", mix.complex, "-map", "[out]", "-ac", "2", "-c:a", "pcm_s16le", "-y", outWav]);
    if (mcode !== 0) throw new Error("mix falhou");

    const omean = await meanVolumeDb(ffmpeg, outWav);
    if (omean !== null && omean < SILENCE_FLOOR_DB) throw new Error("mix ficou mudo");

    await Promise.allSettled([ffmpeg.deleteFile(scramWav), ffmpeg.deleteFile(voiceWav)]);
    return outWav;
  } catch {
    // overlay anti-IA falhou no WASM → entrega a voz limpa (jitter+pitch+notches): tem som garantido
    await Promise.allSettled([ffmpeg.deleteFile(scramWav), ffmpeg.deleteFile(outWav)]);
    return voiceWav;
  }
}

export interface AudioCamouflageResult {
  blob: Blob;
  outputName: string;
}

export async function camouflageAudio(
  file: File,
  mode: AudioMode = "leve",
  onProgress?: (msg: string) => void,
  whiteCopy?: File | null,
): Promise<AudioCamouflageResult> {
  if (file.size > MAX_BYTES) {
    throw new Error("Arquivo muito grande para processar no navegador (máx 150MB).");
  }

  const ffmpeg = await loadFFmpeg(onProgress);
  const cfg = MODES[mode];
  const inputExt = getExtension(file.name);
  const isVideo = isVideoFile(file);
  const outputExt = isVideo ? inputExt : ".mp3";
  const id = nextFileId();
  const inputName = `in_${id}${inputExt}`;
  const whiteName = whiteCopy ? `wc_${id}${getExtension(whiteCopy.name)}` : null;
  const outputFile = `out_${id}${outputExt}`;
  const outputName = `${file.name.replace(/\.[^.]+$/, "")}_camuflado${outputExt}`;
  // webm mantém libopus; mp4/mov usam aac
  const videoAudioCodec = /\.webm$/i.test(inputExt) ? "libopus" : "aac";

  onProgress?.("Analisando arquivo...");
  const duration = await getDurationFromFile(file);

  // Tudo que toca o FFmpeg roda serializado (uma instância single-thread só).
  return runExclusive(async () => {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    if (whiteCopy && whiteName) await ffmpeg.writeFile(whiteName, await fetchFile(whiteCopy));
    let procWav: string | null = null;
    const cleanup = () =>
      Promise.allSettled([
        ffmpeg.deleteFile(inputName),
        ffmpeg.deleteFile(outputFile),
        ...(whiteName ? [ffmpeg.deleteFile(whiteName)] : []),
        ...(procWav ? [ffmpeg.deleteFile(procWav)] : []),
      ]);

    // ---- tentativa principal: camuflagem em passes (robusta no WASM) ----
    try {
      clearFfmpegLog();
      onProgress?.(whiteName ? "Aplicando copia white (anti-IA)..." : mode === "maximo" ? "Camuflando áudio (anti-IA)..." : "Camuflando áudio...");

      procWav = await renderAudioWav(ffmpeg, inputName, mode, duration, id, whiteName);

      onProgress?.("Finalizando...");
      clearFfmpegLog();
      // encoda o WAV camuflado no formato de saída (ou remuxa no vídeo original)
      const encodeArgs = isVideo
        ? ["-i", inputName, "-i", procWav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", videoAudioCodec, "-b:a", "160k", "-ac", "2", "-map_metadata", "-1", "-movflags", "+faststart", "-shortest", "-y", outputFile]
        : ["-i", procWav, "-c:a", "libmp3lame", "-b:a", "192k", "-map_metadata", "-1", "-y", outputFile];
      const code = await ffmpeg.exec(encodeArgs);
      if (code !== 0) throw new Error(parseFFmpegError(getFfmpegLog()));

      const data = await ffmpeg.readFile(outputFile);
      if (!(data instanceof Uint8Array) || data.length === 0) throw new Error("Saída vazia.");
      const blob = new Blob([new Uint8Array(data.buffer as ArrayBuffer)], {
        type: isVideo ? file.type || "video/mp4" : "audio/mpeg",
      });
      await cleanup();
      return { blob, outputName };
    } catch {
      // ---- fallback robusto: pitch-shift simples (nunca quebra, nunca muta) ----
      onProgress?.("Aplicando camuflagem (modo seguro)...");
      clearFfmpegLog();
      const ratio = 1 + cfg.pitchPercent / 100;
      const simple = `asetrate=${Math.round(SR * ratio)},aresample=${SR},atempo=${(1 / ratio).toFixed(6)}`;
      const args = isVideo
        ? ["-i", inputName, "-af", simple, "-c:v", "copy", "-c:a", videoAudioCodec, "-b:a", "160k", "-map_metadata", "-1", "-movflags", "+faststart", "-shortest", "-y", outputFile]
        : ["-i", inputName, "-af", simple, "-c:a", "libmp3lame", "-b:a", "192k", "-map_metadata", "-1", "-y", outputFile];
      const code = await ffmpeg.exec(args);
      if (code !== 0) {
        await cleanup();
        throw new Error(parseFFmpegError(getFfmpegLog()));
      }
      const data = await ffmpeg.readFile(outputFile);
      const blob = new Blob([new Uint8Array((data as Uint8Array).buffer as ArrayBuffer)], {
        type: isVideo ? file.type || "video/mp4" : "audio/mpeg",
      });
      await cleanup();
      return { blob, outputName };
    }
  });
}

/**
 * Remuxa o áudio do arquivo ORIGINAL (opcionalmente camuflado anti-IA) dentro
 * do vídeo já camuflado visualmente. Usado pela aba Vídeo: o vídeo é gravado
 * sem áudio (a captura via canvas não é confiável) e o áudio vem direto da
 * fonte original aqui — assim nunca some.
 *
 * Estratégia robusta (corrige "vídeo fica mudo" e "trava"):
 *  1) processa o áudio anti-IA pra um WAV STANDALONE (a trava de silêncio via
 *     `volumedetect` é confiável em áudio puro — no container de vídeo às vezes
 *     não media direito e o mudo passava);
 *  2) só então muxa esse WAV (ou o áudio original, se o anti-IA falhar/mudar)
 *     no vídeo. Garante que SEMPRE sai com som.
 * Tudo serializado via `runExclusive` (a fila roda 3 jobs e a instância WASM
 * é única — concorrência sem isso corrompia o FS e travava).
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
  whiteCopy?: File | null,
): Promise<{ blob: Blob; outputName: string }> {
  const ffmpeg = await loadFFmpeg(onProgress);
  const isWebm = /webm/i.test(videoBlob.type);
  const vExt = isWebm ? ".webm" : ".mp4";
  const audioCodec = isWebm ? "libopus" : "aac";
  const id = nextFileId();
  const vName = `cam_${id}${vExt}`;
  const aName = `orig_${id}${getExtension(original.name)}`;
  const whiteName = whiteCopy ? `wc_${id}${getExtension(whiteCopy.name)}` : null;
  const outName = `final_${id}${vExt}`;
  const base = original.name.replace(/\.[^.]+$/, "");
  const outputName = `${base}_camuflado${vExt}`;
  const outType = isWebm ? "video/webm" : "video/mp4";

  const duration = mode === null ? 0 : await getDurationFromFile(original);

  let renderedWav: string | null = null;
  return runExclusive(async () => {
    await ffmpeg.writeFile(vName, await fetchFile(videoBlob));
    await ffmpeg.writeFile(aName, await fetchFile(original));
    if (whiteCopy && whiteName) await ffmpeg.writeFile(whiteName, await fetchFile(whiteCopy));

    const cleanup = () =>
      Promise.allSettled([
        ffmpeg.deleteFile(vName),
        ffmpeg.deleteFile(aName),
        ffmpeg.deleteFile(outName),
        ...(whiteName ? [ffmpeg.deleteFile(whiteName)] : []),
        ...(renderedWav ? [ffmpeg.deleteFile(renderedWav)] : []),
      ]);

    // muxa um arquivo de áudio (audioFile) dentro do vídeo camuflado
    const muxArgs = (audioFile: string) => [
      "-i", vName, "-i", audioFile,
      "-map", "0:v:0", "-map", "1:a:0?",
      "-c:v", "copy", "-c:a", audioCodec, "-b:a", "160k", "-ac", "2",
      "-map_metadata", "-1", "-movflags", "+faststart", "-shortest", "-y", outName,
    ];

    // 1) tenta produzir o WAV anti-IA (em passes, robusto); se falhar, usa o original
    let audioSource = aName;
    if (mode !== null) {
      try {
        onProgress?.(whiteName ? "Aplicando copia white (anti-IA)..." : mode === "maximo" ? "Protegendo áudio (anti-IA)..." : "Protegendo áudio...");
        clearFfmpegLog();
        renderedWav = await renderAudioWav(ffmpeg, aName, mode, duration, id, whiteName);
        audioSource = renderedWav; // anti-IA OK (renderAudioWav nunca devolve mudo)
      } catch {
        audioSource = aName; // qualquer falha → usa o áudio original (nunca fica mudo)
      }
    }

    // 2) muxa o áudio escolhido no vídeo
    try {
      clearFfmpegLog();
      onProgress?.("Finalizando vídeo...");
      const code = await ffmpeg.exec(muxArgs(audioSource));
      if (code !== 0) throw new Error(parseFFmpegError(getFfmpegLog()));
      const data = await ffmpeg.readFile(outName);
      if (!(data instanceof Uint8Array) || data.length === 0) throw new Error("Saída vazia.");
      const blob = new Blob([new Uint8Array(data.buffer as ArrayBuffer)], { type: outType });
      await cleanup();
      return { blob, outputName };
    } catch (err) {
      // último recurso: muxar o áudio original (se ainda não era ele)
      if (audioSource !== aName) {
        try {
          clearFfmpegLog();
          const code = await ffmpeg.exec(muxArgs(aName));
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
      }
      await cleanup();
      throw err instanceof Error ? err : new Error("Falha ao proteger o áudio do vídeo.");
    }
  });
}
