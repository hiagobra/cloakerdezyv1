"use client";

import { useState } from "react";
import { useServerJobs } from "@/lib/camouflage/client/server-jobs";
import { DEFAULT_TARGET_PRESET, detectKind } from "@/lib/camouflage/jobs-config";
import { CoverPicker, Dropzone, SectionCard, ServerJobList } from "./shared";

export function FilterSection() {
  const [cover, setCover] = useState<File | null>(null);
  const { jobs, error, uploading, hasActive, uploadFiles, removeJob, clearFinished } = useServerJobs();
  const filterJobs = jobs.filter((j) => j.kind === "filter");

  const onFiles = (files: File[]) => {
    const valid = files.filter((f) => detectKind(f.name, f.type) === "video");
    if (valid.length === 0) return;
    void uploadFiles(valid, {
      mode: "fast",
      kind: "filter",
      cover,
      targetPreset: DEFAULT_TARGET_PRESET,
    });
  };

  return (
    <SectionCard
      title="Filtros"
      description="Aplique filtros para desmarcar seu criativo. Opcionalmente envie uma imagem para aparecer no primeiro frame. Ao processar, aplicamos um filtro imperceptível (variação leve de cor, enquadramento e ruído) que muda a assinatura do vídeo para o algoritmo achar que é outro criativo."
    >
      <div className="flex flex-col gap-5">
        <div>
          <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">
            Imagem do primeiro frame (opcional)
          </div>
          <CoverPicker cover={cover} onPick={setCover} onClear={() => setCover(null)} />
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

      <ServerJobList jobs={filterJobs} onRemove={removeJob} onClearFinished={clearFinished} />

      {hasActive ? (
        <p className="mt-3 text-xs text-muted">
          Mantenha esta aba aberta: se você fechar, os jobs em andamento saem da fila.
        </p>
      ) : null}
    </SectionCard>
  );
}
