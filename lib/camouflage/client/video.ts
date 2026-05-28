"use client";

/**
 * Camuflagem de vídeo no browser via Canvas + MediaRecorder.
 *
 * Filosofia: IMPERCEPTÍVEL pro humano, mas muda a impressão digital pro
 * algoritmo. Em vez de blend pesado de capa (que distorce visualmente), usa:
 *   - micro shift de contraste/brilho (GPU, via ctx.filter)
 *   - ruído esparso em baixíssima opacidade, deslocado a cada frame
 *   - re-encode completo (zera metadados e o hash do arquivo)
 *   - capa opcional em blend leve (controlado pelo usuário)
 *
 * Mantém o áudio original (captura o audio track do <video>).
 */

export type VideoMode = "leve" | "medio" | "forte";

interface ModeParams {
  contrast: number;
  brightness: number;
  noiseAlpha: number;
  defaultCoverMix: number;
}

const MODE_PARAMS: Record<VideoMode, ModeParams> = {
  leve: { contrast: 1.01, brightness: 1.005, noiseAlpha: 0.015, defaultCoverMix: 0 },
  medio: { contrast: 1.02, brightness: 1.01, noiseAlpha: 0.03, defaultCoverMix: 0.04 },
  forte: { contrast: 1.03, brightness: 1.015, noiseAlpha: 0.05, defaultCoverMix: 0.08 },
};

export interface VideoCamouflageResult {
  blob: Blob;
  outputName: string;
  mimeType: string;
}

type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback: (id: number) => void;
};

function hasRVFC(v: HTMLVideoElement): v is RVFCVideo {
  return typeof (v as RVFCVideo).requestVideoFrameCallback === "function";
}

/** Prefere MP4 (aceito por TikTok/Meta/Google); cai pra WebM se indisponível. */
function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "video/webm";
  const candidates = [
    "video/mp4;codecs=avc1.640028",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

function loadCover(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(u);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(u);
      reject(new Error("Erro ao carregar a imagem de capa."));
    };
    img.src = u;
  });
}

/** Textura de ruído pré-gerada, reutilizada e deslocada a cada frame. */
function makeNoiseTexture(size = 160): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const cx = c.getContext("2d")!;
  const img = cx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 256);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return c;
}

export interface VideoCamouflageOptions {
  mode?: VideoMode;
  cover?: File | null;
  /** 0..1; sobrescreve o blend de capa padrão do modo. */
  coverMix?: number;
  onProgress?: (msg: string, pct?: number) => void;
}

export async function camouflageVideo(
  file: File,
  options: VideoCamouflageOptions = {},
): Promise<VideoCamouflageResult> {
  const { mode = "medio", cover = null, onProgress } = options;
  const params = MODE_PARAMS[mode];
  const coverMix = options.coverMix ?? params.defaultCoverMix;
  const coverImg = cover ? await loadCover(cover) : null;
  const noiseTex = makeNoiseTexture();
  const mime = pickRecorderMime();

  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.playsInline = true;
    video.preload = "auto";
    video.muted = false;
    video.volume = 0; // não toca alto pro usuário, mas mantém o track de áudio

    const objUrl = URL.createObjectURL(file);
    video.src = objUrl;

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      URL.revokeObjectURL(objUrl);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Erro ao carregar o vídeo. Formato pode não ser suportado."));
    };

    video.onloadedmetadata = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      const duration = video.duration;
      if (!w || !h) {
        cleanup();
        reject(new Error("Dimensões de vídeo inválidas."));
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx || typeof canvas.captureStream !== "function") {
        cleanup();
        reject(new Error("Este navegador não suporta processamento de vídeo no canvas. Use o Chrome atualizado."));
        return;
      }

      const out = new MediaStream();
      canvas.captureStream().getVideoTracks().forEach((t) => out.addTrack(t));
      try {
        const vWithCap = video as HTMLVideoElement & { captureStream?: () => MediaStream };
        if (typeof vWithCap.captureStream === "function") {
          vWithCap.captureStream().getAudioTracks().forEach((t) => out.addTrack(t));
        }
      } catch {
        /* vídeo sem áudio */
      }

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      } catch {
        try {
          recorder = new MediaRecorder(out, { mimeType: "video/webm", videoBitsPerSecond: 8_000_000 });
        } catch {
          cleanup();
          reject(new Error("Não foi possível iniciar a gravação (MediaRecorder)."));
          return;
        }
      }

      const chunks: Blob[] = [];
      let finished = false;
      let rejected = false;
      let rvfcId: number | null = null;
      let fallbackTimer: ReturnType<typeof setInterval> | null = null;
      let watchdog: ReturnType<typeof setInterval> | null = null;
      let frameCount = 0;
      const noisePattern = ctx.createPattern(noiseTex, "repeat");

      // Watchdog anti-travamento: se a reprodução parar de avançar (buffer,
      // hiccup de decode, aba em background), tenta retomar; se ficar preso
      // demais, finaliza com o que já foi gravado em vez de congelar pra sempre.
      let lastTime = 0;
      let lastAdvanceAt = Date.now();
      let nudges = 0;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onerror = () => {
        rejected = true;
        cleanup();
        reject(new Error("Erro durante a gravação do vídeo."));
      };
      recorder.onstop = () => {
        cleanup();
        if (rejected) return;
        const totalBytes = chunks.reduce((s, c) => s + c.size, 0);
        if (totalBytes === 0) {
          reject(new Error("Gravação vazia — tente outro vídeo ou formato."));
          return;
        }
        const outMime = recorder.mimeType || mime;
        const ext = outMime.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunks, { type: outMime });
        const base = file.name.replace(/\.[^.]+$/, "") || "video";
        resolve({ blob, outputName: `${base}_camuflado.${ext}`, mimeType: blob.type || outMime });
      };

      const drawFrame = () => {
        ctx.filter = `contrast(${params.contrast}) brightness(${params.brightness})`;
        ctx.globalAlpha = 1;
        ctx.drawImage(video, 0, 0, w, h);
        ctx.filter = "none";

        if (coverImg && coverMix > 0) {
          ctx.globalAlpha = coverMix;
          ctx.drawImage(coverImg, 0, 0, w, h);
          ctx.globalAlpha = 1;
        }

        // ruído esparso, deslocado a cada frame pra variação temporal
        if (noisePattern) {
          ctx.globalAlpha = params.noiseAlpha;
          const ox = (frameCount * 37) % noiseTex.width;
          const oy = (frameCount * 53) % noiseTex.height;
          ctx.translate(-ox, -oy);
          ctx.fillStyle = noisePattern;
          ctx.fillRect(ox, oy, w, h);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
        }
        frameCount++;
      };

      const stopAll = () => {
        if (rvfcId !== null && hasRVFC(video)) {
          try {
            video.cancelVideoFrameCallback(rvfcId);
          } catch {
            /* ignore */
          }
          rvfcId = null;
        }
        if (fallbackTimer !== null) {
          clearInterval(fallbackTimer);
          fallbackTimer = null;
        }
        if (watchdog !== null) {
          clearInterval(watchdog);
          watchdog = null;
        }
      };

      const resumePlayback = () => {
        if (finished || video.ended) return;
        const p = video.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      };

      // Retoma a reprodução automaticamente se o vídeo pausar/bufferizar.
      for (const ev of ["stalled", "waiting", "suspend", "pause"] as const) {
        video.addEventListener(ev, () => {
          if (!finished && !video.ended) resumePlayback();
        });
      }

      const startWatchdog = () => {
        lastTime = video.currentTime;
        lastAdvanceAt = Date.now();
        watchdog = setInterval(() => {
          if (finished) return;
          if (video.ended) return; // o handler "ended" finaliza

          if (video.currentTime > lastTime + 0.01) {
            lastTime = video.currentTime;
            lastAdvanceAt = Date.now();
            nudges = 0;
            return;
          }

          const stuckMs = Date.now() - lastAdvanceAt;

          // 1) primeiro tenta só retomar a reprodução
          if (video.paused) resumePlayback();

          // 2) travado >3s: empurra alguns frames pra frente pra pular o ponto ruim
          if (stuckMs > 3000 && nudges < 40 && duration > 0 && video.currentTime < duration - 0.2) {
            nudges++;
            try {
              video.currentTime = Math.min(duration - 0.05, video.currentTime + 0.1);
            } catch {
              /* ignore */
            }
            resumePlayback();
          }

          // 3) travado perto do fim: finaliza com o que tem (praticamente completo)
          if (stuckMs > 5000 && duration > 0 && video.currentTime >= duration - 0.5) {
            finalize();
            return;
          }

          // 4) travado de vez no meio: aborta com erro claro em vez de entregar
          //    um vídeo cortado pela metade (mantém a camuflagem íntegra).
          if (stuckMs > 20000) {
            finished = true;
            rejected = true;
            stopAll();
            try {
              video.pause();
              if (recorder.state === "recording") recorder.stop();
            } catch {
              /* ignore */
            }
            cleanup();
            reject(
              new Error(
                "O vídeo travou no processamento (possível problema de codec/decode). Tente de novo, use um vídeo menor ou converta pra MP4 antes.",
              ),
            );
          }
        }, 1000);
      };

      const finalize = () => {
        if (finished) return;
        finished = true;
        stopAll();
        try {
          video.pause();
        } catch {
          /* ignore */
        }
        try {
          recorder.stop();
        } catch {
          rejected = true;
          cleanup();
          reject(new Error("Erro ao finalizar a gravação."));
        }
      };

      video.addEventListener(
        "ended",
        () => {
          drawFrame();
          finalize();
        },
        { once: true },
      );

      video.addEventListener("timeupdate", () => {
        if (duration > 0) {
          onProgress?.(`Camuflando vídeo: ${Math.round((video.currentTime / duration) * 100)}%`, (video.currentTime / duration) * 100);
        }
      });

      const runRvfc = () => {
        const v = video as RVFCVideo;
        const tick = () => {
          if (finished) return;
          if (v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            rvfcId = v.requestVideoFrameCallback(tick);
            return;
          }
          drawFrame();
          if (v.ended) return;
          rvfcId = v.requestVideoFrameCallback(tick);
        };
        rvfcId = v.requestVideoFrameCallback(tick);
      };

      const runFallback = () => {
        const ms = Math.max(16, Math.round(1000 / 30));
        fallbackTimer = setInterval(() => {
          if (finished) return;
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) drawFrame();
          if (video.ended && fallbackTimer !== null) {
            clearInterval(fallbackTimer);
            fallbackTimer = null;
          }
        }, ms);
      };

      onProgress?.("Iniciando camuflagem...", 0);
      recorder.start(1000);
      if (hasRVFC(video)) runRvfc();
      else runFallback();
      startWatchdog();

      video.play().catch(() => {
        rejected = true;
        stopAll();
        try {
          if (recorder.state === "recording") recorder.stop();
        } catch {
          /* ignore */
        }
        cleanup();
        reject(new Error("Não foi possível reproduzir o vídeo (codec ou autoplay bloqueado)."));
      });
    };
  });
}
