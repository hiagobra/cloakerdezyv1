"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type CamouflagePreset = "leve" | "medio" | "forte";
type VideoStatus = "local" | "queued" | "processing" | "done" | "error";

type CamouflageTarget =
  | "financas_pt"
  | "tecnologia_pt"
  | "culinaria_pt"
  | "saude_pt"
  | "nutricao_pt"
  | "motivacional_pt"
  | "marketing_pt"
  | "educacao_infantil_pt"
  | "finance_en"
  | "fitness_en";

const TARGET_OPTIONS: ReadonlyArray<{ value: CamouflageTarget; label: string }> = [
  { value: "financas_pt", label: "Finanças (PT)" },
  { value: "tecnologia_pt", label: "Tecnologia (PT)" },
  { value: "culinaria_pt", label: "Culinária (PT)" },
  { value: "saude_pt", label: "Saúde (PT)" },
  { value: "nutricao_pt", label: "Nutrição (PT)" },
  { value: "motivacional_pt", label: "Motivacional (PT)" },
  { value: "marketing_pt", label: "Marketing Digital (PT)" },
  { value: "educacao_infantil_pt", label: "Educação Infantil (PT)" },
  { value: "finance_en", label: "Finance (EN)" },
  { value: "fitness_en", label: "Fitness (EN)" },
];

const VALID_TARGETS: ReadonlyArray<CamouflageTarget> = TARGET_OPTIONS.map((o) => o.value);

function isCamouflageTarget(value: unknown): value is CamouflageTarget {
  return typeof value === "string" && (VALID_TARGETS as ReadonlyArray<string>).includes(value);
}

type VideoJob = {
  id: string;
  remoteJobId?: string;
  file?: File;
  fileName: string;
  fileSizeMb: string;
  uploadedAt: string;
  preset: CamouflagePreset;
  targetPreset: CamouflageTarget;
  status: VideoStatus;
  outputName?: string;
  downloadPath?: string;
  layersApplied?: string[];
  errorMessage?: string;
};

function formatSizeInMb(size: number): string {
  return (size / (1024 * 1024)).toFixed(2);
}

function safeRandomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    const loadJobs = async () => {
      const response = await fetch("/api/camouflage");
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as Array<{
        id: string;
        fileName: string;
        preset: CamouflagePreset;
        targetPreset?: string;
        status: "queued" | "processing" | "done" | "failed";
        createdAt: string;
        outputName?: string;
        downloadUrl?: string;
        layersApplied?: string[];
        error?: string;
      }>;

      setJobs(
        data.map((item) => ({
          id: safeRandomId(),
          remoteJobId: item.id,
          fileName: item.fileName,
          fileSizeMb: "-",
          uploadedAt: new Date(item.createdAt).toLocaleString("pt-BR"),
          preset: item.preset,
          targetPreset: isCamouflageTarget(item.targetPreset) ? item.targetPreset : "financas_pt",
          status:
            item.status === "failed" ? "error" : item.status === "done" ? "done" : item.status,
          outputName: item.outputName,
          downloadPath: item.downloadUrl,
          layersApplied: item.layersApplied,
          errorMessage: item.error,
        })),
      );
    };

    void loadJobs();
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
          navigator.sendBeacon("/api/camouflage/cleanup");
        }
      } catch {
        // Ignorar falhas de cleanup ao fechar a aba.
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
    };
  }, []);

  const totals = useMemo(() => {
    const total = jobs.length;
    const processing = jobs.filter((job) => job.status === "processing").length;
    const done = jobs.filter((job) => job.status === "done").length;

    return { total, processing, done };
  }, [jobs]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const tracking = jobs.filter(
        (job) => job.remoteJobId && (job.status === "queued" || job.status === "processing"),
      );

      if (tracking.length === 0) {
        return;
      }

      for (const job of tracking) {
        const response = await fetch(`/api/camouflage/${job.remoteJobId}`);
        if (!response.ok) {
          continue;
        }

        const data = (await response.json()) as {
          status: "queued" | "processing" | "done" | "failed";
          outputName?: string;
          downloadUrl?: string;
          layersApplied?: string[];
          error?: string;
        };

        setJobs((prev) =>
          prev.map((current) =>
            current.id === job.id
              ? {
                  ...current,
                  status:
                    data.status === "failed"
                      ? "error"
                      : data.status === "done"
                        ? "done"
                        : data.status,
                  outputName: data.outputName ?? current.outputName,
                  downloadPath: data.downloadUrl ?? current.downloadPath,
                  layersApplied: data.layersApplied ?? current.layersApplied,
                  errorMessage: data.error ?? undefined,
                }
              : current,
          ),
        );
      }
    }, 2000);

    return () => {
      clearInterval(interval);
    };
  }, [jobs]);

  function onUpload(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    const now = new Date().toLocaleString("pt-BR");
    const newJobs: VideoJob[] = [];

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("video/")) {
        continue;
      }

      newJobs.push({
        id: safeRandomId(),
        file,
        fileName: file.name,
        fileSizeMb: formatSizeInMb(file.size),
        uploadedAt: now,
        preset: "medio",
        targetPreset: "financas_pt",
        status: "local",
      });
    }

    if (newJobs.length === 0) {
      setFeedback("Nenhum video valido foi selecionado.");
      return;
    }

    setJobs((prev) => [...newJobs, ...prev]);
    setFeedback(`${newJobs.length} video(s) enviado(s) para a fila.`);
  }

  function updatePreset(jobId: string, preset: CamouflagePreset) {
    setJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, preset } : job)));
  }

  function updateTarget(jobId: string, targetPreset: CamouflageTarget) {
    setJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, targetPreset } : job)));
  }

  async function startCamouflage(jobId: string) {
    const currentJob = jobs.find((job) => job.id === jobId);
    if (!currentJob) {
      return;
    }
    if (!currentJob.file) {
      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? {
                ...job,
                status: "error",
                errorMessage: "Reenvie o arquivo para processar novamente.",
              }
            : job,
        ),
      );
      return;
    }

    setJobs((prev) =>
      prev.map((job) => (job.id === jobId ? { ...job, status: "queued", errorMessage: undefined } : job)),
    );

    try {
      const body = new FormData();
      body.append("file", currentJob.file);
      body.append("preset", currentJob.preset);
      body.append("targetPreset", currentJob.targetPreset);

      const response = await fetch("/api/camouflage", {
        method: "POST",
        body,
      });

      if (!response.ok) {
        let reason = "Falha ao processar o arquivo.";
        try {
          const data = (await response.json()) as { error?: string };
          reason = data.error || reason;
        } catch {
          // Keep default message when response is not JSON.
        }

        throw new Error(reason);
      }

      const data = (await response.json()) as { jobId: string; status: string };

      setJobs((prev) =>
        prev.map((job) => {
          if (job.id !== jobId) {
            return job;
          }

          return {
            ...job,
            remoteJobId: data.jobId,
            status: data.status === "processing" ? "processing" : "queued",
            errorMessage: undefined,
          };
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado no processamento.";

      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId
            ? {
                ...job,
                status: "error",
                errorMessage: message,
              }
            : job,
        ),
      );
    }
  }

  async function signOut() {
    try {
      await fetch("/api/camouflage", { method: "DELETE" });
    } catch {
      // Mesmo se falhar a limpeza, prosseguir com logout.
    }
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <main className="dezy-bg min-h-screen p-4 md:p-8">
      <section className="mx-auto max-w-7xl">
        <header className="glass-panel mb-8 flex flex-col gap-5 rounded-3xl p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Image
              src="/brand/logo.png"
              alt="CloakerDezy"
              width={56}
              height={56}
              className="rounded-full border border-[rgba(157,107,255,0.45)]"
            />
            <div>
              <h1 className="text-2xl font-semibold">Dashboard de Videos</h1>
              <p className="text-sm text-muted">
                Upload rapido, fila de processamento e camuflagem em um lugar.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={signOut}
            className="rounded-xl border border-primary/70 px-4 py-2 text-sm font-semibold transition hover:bg-primary/15"
          >
            Sair
          </button>
        </header>

        <section className="mb-6 grid gap-4 md:grid-cols-3">
          <article className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-muted">Videos na fila</p>
            <p className="mt-2 text-4xl font-semibold text-primary">{totals.total}</p>
          </article>
          <article className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-muted">Processando</p>
            <p className="mt-2 text-4xl font-semibold text-primary">{totals.processing}</p>
          </article>
          <article className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-muted">Camuflados</p>
            <p className="mt-2 text-4xl font-semibold text-primary">{totals.done}</p>
          </article>
        </section>

        <section className="glass-panel mb-6 rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="font-semibold">Upload de videos</h2>
            <label className="cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-[#100b23] transition hover:bg-primary-strong">
              Selecionar videos
              <input
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                onChange={(event) => onUpload(event.target.files)}
              />
            </label>
          </div>
          <p className="text-sm text-muted">
            Formatos aceitos: qualquer formato de video reconhecido pelo navegador.
          </p>
          {feedback ? (
            <p className="mt-4 rounded-xl border border-emerald-400/40 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-200">
              {feedback}
            </p>
          ) : null}
        </section>

        <section className="glass-panel overflow-hidden rounded-2xl">
          <div className="border-b border-border-soft/80 px-5 py-4">
            <h2 className="font-semibold">Fila de camuflagem</h2>
          </div>

          {jobs.length === 0 ? (
            <p className="p-5 text-sm text-muted">Nenhum video enviado ainda.</p>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-card-soft/80">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-muted">Arquivo</th>
                      <th className="px-3 py-3 text-left font-medium text-muted whitespace-nowrap">Tamanho</th>
                      <th className="px-3 py-3 text-left font-medium text-muted">Intensidade</th>
                      <th className="px-3 py-3 text-left font-medium text-muted">Tópico-alvo</th>
                      <th className="px-3 py-3 text-left font-medium text-muted">Status</th>
                      <th className="px-3 py-3 text-left font-medium text-muted">Saida</th>
                      <th className="px-3 py-3 text-right font-medium text-muted">Acao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id} className="border-t border-border-soft/70 align-top">
                        <td className="px-4 py-3">
                          <p className="font-medium break-words">{job.fileName}</p>
                          <p className="text-xs text-muted">Enviado em {job.uploadedAt}</p>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">{job.fileSizeMb} MB</td>
                        <td className="px-3 py-3">
                          <select
                            value={job.preset}
                            onChange={(event) =>
                              updatePreset(job.id, event.target.value as CamouflagePreset)
                            }
                            className="rounded-lg border border-border-soft bg-card-soft px-2 py-1.5 outline-none transition focus:border-primary"
                            disabled={job.status === "processing"}
                          >
                            <option value="leve">Leve</option>
                            <option value="medio">Medio</option>
                            <option value="forte">Forte</option>
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <select
                            value={job.targetPreset}
                            onChange={(event) =>
                              updateTarget(job.id, event.target.value as CamouflageTarget)
                            }
                            className="rounded-lg border border-border-soft bg-card-soft px-2 py-1.5 outline-none transition focus:border-primary"
                            disabled={job.status === "processing"}
                          >
                            {TARGET_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
                              job.status === "done"
                                ? "bg-emerald-500/20 text-emerald-200"
                                : job.status === "error"
                                  ? "bg-red-500/20 text-red-200"
                                : job.status === "processing"
                                  ? "bg-amber-500/20 text-amber-200"
                                  : "bg-zinc-500/20 text-zinc-200"
                            }`}
                          >
                            {job.status === "processing"
                              ? "Camuflando..."
                              : job.status === "done"
                                ? "Camuflado"
                                : job.status === "error"
                                  ? "Erro"
                                : job.status === "queued"
                                  ? "Na fila"
                                  : "Pronto para iniciar"}
                          </span>
                          {job.errorMessage ? (
                            <p className="mt-1 max-w-[220px] text-xs text-red-200 break-words">{job.errorMessage}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-muted">
                          {job.outputName && job.downloadPath ? (
                            <a
                              href={job.downloadPath}
                              download={job.outputName}
                              className="text-primary underline decoration-primary/50 underline-offset-4 hover:text-primary-strong break-words"
                            >
                              Baixar {job.outputName}
                            </a>
                          ) : (
                            "Aguardando..."
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => startCamouflage(job.id)}
                            disabled={job.status === "processing"}
                            className="rounded-lg border border-primary/80 px-3 py-2 text-xs font-semibold whitespace-nowrap transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {job.status === "processing"
                              ? "Processando..."
                              : job.status === "done"
                                ? "Reprocessar"
                                : "Camuflar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 p-4 md:hidden">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-2xl border border-border-soft/70 bg-card-soft/40 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium break-words">{job.fileName}</p>
                        <p className="text-xs text-muted">{job.uploadedAt}</p>
                        <p className="text-xs text-muted mt-1">{job.fileSizeMb} MB</p>
                      </div>
                      <span
                        className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
                          job.status === "done"
                            ? "bg-emerald-500/20 text-emerald-200"
                            : job.status === "error"
                              ? "bg-red-500/20 text-red-200"
                            : job.status === "processing"
                              ? "bg-amber-500/20 text-amber-200"
                              : "bg-zinc-500/20 text-zinc-200"
                        }`}
                      >
                        {job.status === "processing"
                          ? "Camuflando..."
                          : job.status === "done"
                            ? "Camuflado"
                            : job.status === "error"
                              ? "Erro"
                            : job.status === "queued"
                              ? "Na fila"
                              : "Pronto"}
                      </span>
                    </div>

                    {job.errorMessage ? (
                      <p className="mt-2 text-xs text-red-200 break-words">{job.errorMessage}</p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select
                        value={job.preset}
                        onChange={(event) =>
                          updatePreset(job.id, event.target.value as CamouflagePreset)
                        }
                        className="rounded-lg border border-border-soft bg-card-soft px-2 py-1.5 text-sm outline-none transition focus:border-primary"
                        disabled={job.status === "processing"}
                        aria-label="Intensidade"
                      >
                        <option value="leve">Leve</option>
                        <option value="medio">Medio</option>
                        <option value="forte">Forte</option>
                      </select>

                      <select
                        value={job.targetPreset}
                        onChange={(event) =>
                          updateTarget(job.id, event.target.value as CamouflageTarget)
                        }
                        className="rounded-lg border border-border-soft bg-card-soft px-2 py-1.5 text-sm outline-none transition focus:border-primary"
                        disabled={job.status === "processing"}
                        aria-label="Tópico-alvo"
                      >
                        {TARGET_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => startCamouflage(job.id)}
                        disabled={job.status === "processing"}
                        className="ml-auto rounded-lg border border-primary/80 px-3 py-2 text-xs font-semibold transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {job.status === "processing"
                          ? "Processando..."
                          : job.status === "done"
                            ? "Reprocessar"
                            : "Camuflar"}
                      </button>
                    </div>

                    {job.outputName && job.downloadPath ? (
                      <a
                        href={job.downloadPath}
                        download={job.outputName}
                        className="mt-3 inline-block text-sm text-primary underline decoration-primary/50 underline-offset-4 hover:text-primary-strong break-words"
                      >
                        Baixar {job.outputName}
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
