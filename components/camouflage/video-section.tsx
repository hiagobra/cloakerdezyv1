"use client";

import { useState } from "react";
import { useServerJobs } from "@/lib/camouflage/client/server-jobs";
import { useBeforeUnloadGuard } from "@/lib/camouflage/client/track";
import {
  WHITE_SCRIPT_PRESETS,
  DEFAULT_TARGET_PRESET,
  MODE_HINT,
  detectKind,
  type JobMode,
} from "@/lib/camouflage/jobs-config";
import { Dropzone, ModeSelector, SectionCard, ServerJobList, TargetPresetPicker } from "./shared";

const MODES: { value: JobMode; label: string; desc: string }[] = [
  { value: "fast", label: "Rápido", desc: "CPU rápido: áudio anti-IA + prompt-inject + SRT + metadados." },
  { value: "max", label: "Máximo (anti-IA)", desc: "Adversarial no Whisper sobre o áudio. Mais lento, transcrição vira lixo." },
];

export function VideoSection() {
  const [mode, setMode] = useState<JobMode>("fast");
  const [preset, setPreset] = useState<string>(DEFAULT_TARGET_PRESET);
  const { jobs, error, uploading, hasActive, uploadFiles, removeJob, clearFinished } = useServerJobs();
  const videoJobs = jobs.filter((j) => j.kind === "video");

  useBeforeUnloadGuard(uploading);

  const onFiles = (files: File[]) => {
    const valid = files.filter((f) => detectKind(f.name, f.type) === "video");
    if (valid.length === 0) return;
    void uploadFiles(valid, { mode, targetPreset: preset });
  };

  return (
    <SectionCard
      title="Camuflagem de vídeo"
      description="O vídeo é processado no servidor: a faixa de áudio recebe a camada anti-IA (fala-alvo + injeção de palavras-chave + tratamento), o vídeo ganha prompt-injection sutil, legenda (SRT) e metadados do tópico-alvo. No modo Máximo, soma um ataque adversarial no Whisper. O resultado some na fila abaixo para download."
    >
      <div className="flex flex-wrap items-center gap-4">
        <ModeSelector value={mode} options={MODES} onChange={setMode} />
      </div>

      <div className="mt-4">
        <TargetPresetPicker presets={WHITE_SCRIPT_PRESETS} value={preset} onChange={setPreset} />
      </div>

      <p className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-strong">
        {MODE_HINT[mode]} A IA tende a perceber o vídeo como sendo sobre{" "}
        <strong className="text-foreground">
          {WHITE_SCRIPT_PRESETS.find((p) => p.id === preset)?.label}
        </strong>
        .
      </p>

      {error ? (
        <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</p>
      ) : null}

      <div className="mt-5">
        <Dropzone
          accept="video/*"
          onFiles={onFiles}
          label="Solte vídeos aqui ou clique para selecionar"
          hint="MP4, MOV, WebM, MKV. O processamento roda no servidor — acompanhe a fila abaixo."
        />
      </div>

      {uploading ? <p className="mt-3 text-xs text-muted">Enviando arquivo(s)...</p> : null}

      <ServerJobList jobs={videoJobs} onRemove={removeJob} onClearFinished={clearFinished} />

      {hasActive ? (
        <p className="mt-3 text-xs text-muted">
          Os jobs continuam processando no servidor mesmo se você fechar a aba.
        </p>
      ) : null}
    </SectionCard>
  );
}
