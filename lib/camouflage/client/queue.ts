"use client";

import { useCallback, useRef, useState } from "react";

export type JobStatus = "queued" | "processing" | "done" | "error";

export interface QueueJob<R> {
  id: string;
  fileName: string;
  status: JobStatus;
  progress: number;
  message: string;
  result?: R;
  error?: string;
}

export interface QueueItem<R> {
  fileName: string;
  run: (onProgress: (msg: string, pct?: number) => void) => Promise<R>;
}

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Fila de processamento com no máximo `concurrency` jobs simultâneos.
 * Os demais ficam em "queued" e iniciam conforme as vagas liberam.
 */
export function useCamouflageQueue<R>(concurrency = 3) {
  const [jobs, setJobs] = useState<QueueJob<R>[]>([]);
  const activeRef = useRef(0);
  const queueRef = useRef<{ id: string; item: QueueItem<R> }[]>([]);
  const onCompleteRef = useRef<((job: QueueJob<R>) => void) | null>(null);

  const update = useCallback((id: string, patch: Partial<QueueJob<R>>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const pump = useCallback(() => {
    while (activeRef.current < concurrency && queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      activeRef.current++;
      update(next.id, { status: "processing", message: "Iniciando..." });

      next.item
        .run((msg, pct) => update(next.id, { message: msg, progress: pct ?? 0 }))
        .then((result) => {
          update(next.id, { status: "done", progress: 100, message: "Concluído", result });
          onCompleteRef.current?.({
            id: next.id,
            fileName: next.item.fileName,
            status: "done",
            progress: 100,
            message: "Concluído",
            result,
          });
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : "Falha no processamento.";
          update(next.id, { status: "error", message: error, error });
        })
        .finally(() => {
          activeRef.current--;
          pump();
        });
    }
  }, [concurrency, update]);

  const enqueue = useCallback(
    (items: QueueItem<R>[]) => {
      const newJobs: QueueJob<R>[] = items.map((item) => ({
        id: randomId(),
        fileName: item.fileName,
        status: "queued",
        progress: 0,
        message: "Na fila",
      }));
      setJobs((prev) => [...newJobs, ...prev]);
      newJobs.forEach((job, i) => queueRef.current.push({ id: job.id, item: items[i] }));
      pump();
    },
    [pump],
  );

  const remove = useCallback((id: string) => {
    queueRef.current = queueRef.current.filter((q) => q.id !== id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status === "queued" || j.status === "processing"));
  }, []);

  const onComplete = useCallback((cb: (job: QueueJob<R>) => void) => {
    onCompleteRef.current = cb;
  }, []);

  const activeCount = jobs.filter((j) => j.status === "processing" || j.status === "queued").length;

  return { jobs, enqueue, remove, clearFinished, onComplete, activeCount };
}
