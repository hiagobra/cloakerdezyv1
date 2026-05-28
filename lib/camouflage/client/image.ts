"use client";

/**
 * Camuflagem de imagem: mistura uma capa (o que o algoritmo "vê") com o
 * criativo real + ruído adversarial anti-IA + shift de contraste/brilho.
 * Tudo via Canvas, processado uma vez por imagem.
 */

interface PRNGState {
  s: number;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

function xorshift(state: PRNGState): number {
  let s = state.s;
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  state.s = s >>> 0;
  return state.s % 256;
}

export const NOISE_MIN = 0;
export const NOISE_MAX = 20;

const COVER_MIX_MIN = 0;
const COVER_MIX_MAX = 0.95;
const COVER_GAMMA = 1.6;

/** Slider 0..20 → fração da capa no blend (0..0.95), curva gamma. */
export function coverLevelToMix(level: number): number {
  const clamped = Math.max(0, Math.min(20, level));
  return COVER_MIX_MIN + (COVER_MIX_MAX - COVER_MIX_MIN) * Math.pow(clamped / 20, COVER_GAMMA);
}

function applyPixelRandomization(data: Uint8ClampedArray, seed: number): void {
  const state: PRNGState = { s: seed + 12345 };
  for (let i = 0; i < data.length; i += 4) {
    const offset = xorshift(state) % 5;
    const sign = xorshift(state) % 2 === 0 ? 1 : -1;
    data[i] = Math.max(0, Math.min(255, data[i] + offset * sign));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + (offset + 1) * -sign));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + offset * sign));
  }
}

function applyAdversarialNoise(data: Uint8ClampedArray, seed: number, intensity: number, width: number): void {
  const state: PRNGState = { s: seed };
  const blockSize = 2;
  for (let i = 0; i < data.length; i += 4) {
    const pixelIndex = i / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const checkerSign = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0 ? 1 : -1;
    const randomOffset = (xorshift(state) % 3) - 1;
    const noise = (intensity + randomOffset) * checkerSign;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }
}

function applyContrastShift(data: Uint8ClampedArray, seed: number): void {
  const state: PRNGState = { s: seed + 99999 };
  const brightnessShift = (xorshift(state) % 7) - 3;
  const contrastFactor = 0.98 + (xorshift(state) % 40) / 1000;
  for (let i = 0; i < data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      const v = Math.round((data[i + ch] - 128) * contrastFactor + 128 + brightnessShift);
      data[i + ch] = Math.max(0, Math.min(255, v));
    }
  }
}

function imageToImageData(img: HTMLImageElement, width: number, height: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error(`Arquivo de imagem inválido: ${file?.name ?? "?"}`));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Erro ao carregar imagem: ${file.name}`));
    };
    img.src = url;
  });
}

export interface ImageCamouflageResult {
  blob: Blob;
  dataUrl: string;
  outputName: string;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Falha ao gerar imagem."));
    }, "image/png");
  });
}

/**
 * Camufla uma imagem criativa. Se houver capa, o canvas usa as dimensões da
 * capa (é o tamanho que o algoritmo espera). Sem capa, usa o próprio criativo
 * e aplica só o ruído adversarial.
 */
export async function camouflageImage(
  creative: HTMLImageElement,
  cover: HTMLImageElement | null,
  index: number,
  coverMix: number,
  noiseLevel: number,
): Promise<ImageCamouflageResult> {
  const base = cover ?? creative;
  const width = base.naturalWidth || base.width;
  const height = base.naturalHeight || base.height;

  const creativeData = imageToImageData(creative, width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const out = ctx.createImageData(width, height);

  const safeMix = cover ? Math.max(0, Math.min(1, coverMix)) : 0;
  const creativeMix = 1 - safeMix;

  if (cover && safeMix > 0) {
    const coverData = imageToImageData(cover, width, height);
    for (let i = 0; i < creativeData.data.length; i += 4) {
      out.data[i] = Math.round(coverData.data[i] * safeMix + creativeData.data[i] * creativeMix);
      out.data[i + 1] = Math.round(coverData.data[i + 1] * safeMix + creativeData.data[i + 1] * creativeMix);
      out.data[i + 2] = Math.round(coverData.data[i + 2] * safeMix + creativeData.data[i + 2] * creativeMix);
      out.data[i + 3] = 255;
    }
  } else {
    out.data.set(creativeData.data);
  }

  const seed = randomSeed();
  applyPixelRandomization(out.data, seed);
  applyAdversarialNoise(out.data, seed, Math.max(0, noiseLevel), width);
  applyContrastShift(out.data, seed);

  ctx.putImageData(out, 0, 0);
  const blob = await canvasToBlob(canvas);
  const dataUrl = canvas.toDataURL("image/png");
  const outputName = `camuflagem_${index + 1}_n${Math.round(noiseLevel)}_${Date.now()}.png`;

  return { blob, dataUrl, outputName };
}
