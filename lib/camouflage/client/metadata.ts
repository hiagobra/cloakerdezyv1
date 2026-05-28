"use client";

import { loadFFmpeg, fetchFile, getFfmpegLog, clearFfmpegLog, parseFFmpegError } from "./ffmpeg";

export type CompressionLevel = "nenhuma" | "leve" | "media" | "alta";

/** CRF por nível de compressão (maior CRF = mais compressão, menor arquivo). */
const CRF_BY_LEVEL: Record<Exclude<CompressionLevel, "nenhuma">, number> = {
  leve: 23,
  media: 28,
  alta: 32,
};

const MAX_BYTES = 200 * 1024 * 1024;

function getExtension(filename: string): string {
  const m = filename.match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : ".mp4";
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name);
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name);
}

export interface MetadataResult {
  blob: Blob;
  outputName: string;
}

/**
 * Limpa metadados (EXIF/container) e opcionalmente comprime o arquivo.
 * Vídeo: strip de metadata + re-encode H.264 com CRF; áudio copiado.
 * Imagem: strip de EXIF re-salvando.
 */
export async function cleanMetadata(
  file: File,
  compression: CompressionLevel = "leve",
  onProgress?: (msg: string) => void,
): Promise<MetadataResult> {
  if (file.size > MAX_BYTES) {
    throw new Error("Arquivo muito grande para processar no navegador (máx 200MB).");
  }

  const ffmpeg = await loadFFmpeg(onProgress);
  const inputExt = getExtension(file.name);
  const inputName = `input${inputExt}`;
  const isVideo = isVideoFile(file);
  const isImage = isImageFile(file);

  if (!isVideo && !isImage) {
    throw new Error("Formato não suportado para limpeza de metadados.");
  }

  const outputExt = isImage ? (inputExt === ".png" ? ".png" : ".jpg") : ".mp4";
  const outputFile = `output${outputExt}`;
  const outputName = `${file.name.replace(/\.[^.]+$/, "")}_limpo${outputExt}`;

  try {
    clearFfmpegLog();
    onProgress?.("Lendo arquivo...");
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    let args: string[];
    if (isImage) {
      onProgress?.("Removendo metadados da imagem...");
      args = ["-i", inputName, "-map_metadata", "-1", "-y", outputFile];
    } else if (compression === "nenhuma") {
      onProgress?.("Removendo metadados (sem recompressão)...");
      args = ["-i", inputName, "-map_metadata", "-1", "-c", "copy", "-movflags", "+faststart", "-y", outputFile];
    } else {
      onProgress?.("Limpando metadados e comprimindo...");
      const crf = CRF_BY_LEVEL[compression];
      args = [
        "-i", inputName,
        "-map_metadata", "-1",
        "-c:v", "libx264",
        "-crf", String(crf),
        "-preset", "veryfast",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", outputFile,
      ];
    }

    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      throw new Error(parseFFmpegError(getFfmpegLog()));
    }

    onProgress?.("Finalizando...");
    const data = await ffmpeg.readFile(outputFile);
    if (!(data instanceof Uint8Array) || data.length === 0) {
      throw new Error("O arquivo processado não foi gerado corretamente.");
    }

    const mimeType = isImage ? (outputExt === ".png" ? "image/png" : "image/jpeg") : "video/mp4";
    const blob = new Blob([new Uint8Array(data.buffer as ArrayBuffer)], { type: mimeType });
    return { blob, outputName };
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(parseFFmpegError(getFfmpegLog()));
  } finally {
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputFile)]);
  }
}
