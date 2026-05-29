"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let logBuffer: string[] = [];

function pushLog(message: string) {
  logBuffer.push(message);
  if (logBuffer.length > 200) logBuffer = logBuffer.slice(-200);
}

export function getFfmpegLog(): string {
  return logBuffer.join("\n");
}

export function clearFfmpegLog(): void {
  logBuffer = [];
}

/**
 * Carrega o FFmpeg WASM (single-thread, sem SharedArrayBuffer — não exige
 * headers COOP/COEP). Os binários ficam em /public/ffmpeg.
 */
export async function loadFFmpeg(onProgress?: (msg: string) => void): Promise<FFmpeg> {
  if (instance) return instance;
  if (loading) {
    onProgress?.("Carregando motor de processamento...");
    return loading;
  }

  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => pushLog(message));

  onProgress?.("Carregando motor de processamento...");
  const baseURL = `${window.location.origin}/ffmpeg`;

  loading = ffmpeg
    .load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    })
    .then(() => {
      instance = ffmpeg;
      return ffmpeg;
    })
    .catch((err) => {
      instance = null;
      loading = null;
      throw err;
    });

  return loading;
}

export function preloadFFmpeg(): void {
  loadFFmpeg().catch(() => {});
}

/**
 * Serializa o acesso ao FFmpeg WASM. CRÍTICO: existe UMA só instância
 * (singleton) single-thread; rodar `exec`/`writeFile` de jobs concorrentes (a
 * fila processa 3 simultâneos) na mesma instância corrompe o FS virtual e
 * trava. Todo job que usa FFmpeg deve rodar dentro de `runExclusive`.
 */
let ffmpegLock: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = ffmpegLock.then(task, task);
  // mantém a corrente viva mesmo se um job falhar (não propaga rejeição)
  ffmpegLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** ID curto pra nomear arquivos por job e evitar colisão no FS virtual. */
let idCounter = 0;
export function nextFileId(): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export { fetchFile };

/**
 * Mensagens de erro do FFmpeg traduzidas pra algo amigável.
 */
export function parseFFmpegError(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (!lower) return "O processamento falhou para este arquivo.";
  if (
    lower.includes("output file #0 does not contain any stream") ||
    (lower.includes("stream map") && lower.includes("matches no streams"))
  ) {
    return "Esse arquivo não tem uma trilha compatível para camuflagem.";
  }
  if (
    lower.includes("could not find codec parameters") ||
    lower.includes("invalid data found") ||
    lower.includes("moov atom not found")
  ) {
    return "Esse arquivo não é compatível com processamento no navegador.";
  }
  if (lower.includes("memory access out of bounds") || lower.includes("cannot enlarge memory")) {
    return "Esse arquivo excede a memória disponível no navegador. Use um arquivo menor.";
  }
  if (lower.includes("conversion failed")) {
    return "A conversão falhou para este arquivo.";
  }
  return raw.trim();
}
