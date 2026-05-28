"use client";

import { loadFFmpeg, fetchFile, getFfmpegLog, clearFfmpegLog, parseFFmpegError } from "./ffmpeg";

export type AudioMode = "leve" | "forte";

/**
 * Filtros de camuflagem de áudio.
 *
 * Pitch-shift sutil compensado: muda a sample rate por 1-2% (altera a
 * impressão digital pro algoritmo) e usa atempo pra compensar a velocidade,
 * mantendo a duração. O resultado é IMPERCEPTÍVEL pro ouvido humano — não
 * troca o conteúdo do áudio, só desloca microscopicamente a assinatura.
 */
const AUDIO_FILTERS: Record<AudioMode, string> = {
  leve: "asetrate=48000*1.01,aresample=48000,atempo=0.990099",
  forte: "asetrate=48000*1.02,aresample=48000,atempo=0.980392",
};

const MAX_BYTES = 120 * 1024 * 1024;

function getExtension(filename: string): string {
  const m = filename.match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : ".mp4";
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name);
}

export interface AudioCamouflageResult {
  blob: Blob;
  outputName: string;
}

/**
 * Camufla a trilha de áudio de um arquivo de áudio ou vídeo.
 * Vídeo: copia o stream de vídeo intacto, re-codifica só o áudio.
 * Áudio puro: re-codifica pra MP3.
 */
export async function camouflageAudio(
  file: File,
  mode: AudioMode = "leve",
  onProgress?: (msg: string) => void,
): Promise<AudioCamouflageResult> {
  if (file.size > MAX_BYTES) {
    throw new Error("Arquivo muito grande para processar no navegador (máx 120MB).");
  }

  const ffmpeg = await loadFFmpeg(onProgress);
  const inputExt = getExtension(file.name);
  const inputName = `input${inputExt}`;
  const isVideo = isVideoFile(file);
  const outputExt = isVideo ? inputExt : ".mp3";
  const outputFile = `output${outputExt}`;
  const outputName = `${file.name.replace(/\.[^.]+$/, "")}_camuflado${outputExt}`;
  const filter = AUDIO_FILTERS[mode];

  try {
    clearFfmpegLog();
    onProgress?.("Lendo arquivo...");
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    onProgress?.("Camuflando áudio...");
    const args = isVideo
      ? ["-i", inputName, "-af", filter, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-map_metadata", "-1", "-y", outputFile]
      : ["-i", inputName, "-af", filter, "-c:a", "libmp3lame", "-b:a", "128k", "-map_metadata", "-1", "-y", outputFile];

    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      throw new Error(parseFFmpegError(getFfmpegLog()));
    }

    onProgress?.("Finalizando...");
    const data = await ffmpeg.readFile(outputFile);
    if (!(data instanceof Uint8Array) || data.length === 0) {
      throw new Error("O arquivo processado não foi gerado corretamente.");
    }

    const mimeType = isVideo ? file.type || "video/mp4" : "audio/mpeg";
    const blob = new Blob([new Uint8Array(data.buffer as ArrayBuffer)], { type: mimeType });
    return { blob, outputName };
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(parseFFmpegError(getFfmpegLog()));
  } finally {
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputFile)]);
  }
}
