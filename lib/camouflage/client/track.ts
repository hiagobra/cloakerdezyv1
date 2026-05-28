"use client";

import { useEffect } from "react";

export type CamouflageType = "video" | "audio" | "image" | "metadata";

/** Reporta uma camuflagem concluída pro backend (alimenta o total do admin). */
export async function trackCamouflage(type: CamouflageType): Promise<void> {
  try {
    await fetch("/api/camouflage/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
  } catch {
    // métrica é best-effort; não bloqueia o usuário
  }
}

/** Dispara o download de um Blob com o nome dado. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Avisa antes de sair/recarregar quando há processamento em andamento. */
export function useBeforeUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
