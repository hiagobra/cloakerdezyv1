"use client";

import { useState } from "react";
import { useServerJobs } from "@/lib/camouflage/client/server-jobs";
import { DEFAULT_RESIZE_FORMAT, RESIZE_FORMATS, detectKind } from "@/lib/camouflage/jobs-config";
import { Dropzone, ModeSelector, SectionCard, ServerJobList } from "./shared";

export function ResizeSection() {
  const [format, setFormat] = useState<string>(DEFAULT_RESIZE_FORMAT);
  const { jobs, error, uploading, hasActive, uploadFiles, removeJob, clearFinished } = useServerJobs();
  const resizeJobs = jobs.filter((j) => j.kind === "resize");

  const onFiles = (files: File[]) => {
    const valid = files.filter((f) => detectKind(f.name, f.type) === "video");
    if (valid.length === 0) return;
    void uploadFiles(valid, {
      mode: "fast",
      kind: "resize",
      targetPreset: format,
    });
  };

  return (
    <SectionCard
      title="Redimensionar"
      description="Envie o vídeo e receba ele já no formato recomendado pra subir as campanhas, otimizado em 720p. O vídeo preenche o quadro (sem barras pretas)."
    >
      <div className="flex flex-col gap-5">
        <div>
          <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">Formato</div>
          <ModeSelector
            value={format}
            onChange={setFormat}
            options={RESIZE_FORMATS.map((f) => ({ value: f.id, label: f.label }))}
          />
        </div>

        {error ? (
          <p className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</p>
        ) : null}

        <Dropzone
          accept="video/*"
          onFiles={onFiles}
          label="Solte vídeos aqui ou clique para selecionar"
          hint="MP4, MOV, WebM, MKV. O processamento roda no servidor — acompanhe a fila abaixo."
        />
      </div>

      {uploading ? <p className="mt-3 text-xs text-muted">Enviando arquivo(s)...</p> : null}

      <ServerJobList jobs={resizeJobs} onRemove={removeJob} onClearFinished={clearFinished} />

      {hasActive ? (
        <p className="mt-3 text-xs text-muted">
          Mantenha esta aba aberta: se você fechar, os jobs em andamento saem da fila.
        </p>
      ) : null}
    </SectionCard>
  );
}
