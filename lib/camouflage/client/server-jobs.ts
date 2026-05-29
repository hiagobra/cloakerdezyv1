"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobMode, ServerJob } from "@/lib/camouflage/jobs-config";

const POLL_MS = 2500;

interface UploadOptions {
  mode: JobMode;
  targetPreset: string;
}

/**
 * Gerencia a fila de jobs server-side: lista inicial, upload (multipart),
 * polling enquanto houver job ativo e remocao. Substitui o useCamouflageQueue
 * (client-side) nas abas Audio/Video.
 */
export function useServerJobs() {
  const [jobs, setJobs] = useState<ServerJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const hasActive = jobs.some((j) => j.status === "queued" || j.status === "processing");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/camouflage/jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: ServerJob[] };
      if (mountedRef.current) setJobs(data.jobs ?? []);
    } catch {
      /* poll best-effort */
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // refresh e assincrono (setState so apos o await), entao nao causa cascata.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh]);

  // Agenda o proximo poll enquanto houver job ativo.
  useEffect(() => {
    if (!hasActive) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    timerRef.current = setTimeout(() => {
      void refresh();
    }, POLL_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hasActive, jobs, refresh]);

  const uploadFiles = useCallback(async (files: File[], opts: UploadOptions) => {
    setError(null);
    setUploading(true);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        form.append("mode", opts.mode);
        form.append("targetPreset", opts.targetPreset);
        try {
          const res = await fetch("/api/camouflage/jobs", { method: "POST", body: form });
          const data = (await res.json().catch(() => ({}))) as { job?: ServerJob; error?: string };
          if (!res.ok || !data.job) {
            setError(data.error || "Falha ao enviar o arquivo.");
            continue;
          }
          if (mountedRef.current) setJobs((prev) => [data.job!, ...prev]);
        } catch {
          setError("Falha de rede ao enviar o arquivo.");
        }
      }
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  }, []);

  const removeJob = useCallback(async (id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
    try {
      await fetch(`/api/camouflage/jobs/${id}`, { method: "DELETE" });
    } catch {
      /* otimista; o proximo refresh reconcilia */
    }
  }, []);

  const clearFinished = useCallback(async () => {
    const finished = jobs.filter((j) => j.status === "done" || j.status === "error");
    setJobs((prev) => prev.filter((j) => j.status === "queued" || j.status === "processing"));
    await Promise.all(
      finished.map((j) =>
        fetch(`/api/camouflage/jobs/${j.id}`, { method: "DELETE" }).catch(() => undefined),
      ),
    );
  }, [jobs]);

  return { jobs, error, uploading, hasActive, uploadFiles, removeJob, clearFinished };
}
