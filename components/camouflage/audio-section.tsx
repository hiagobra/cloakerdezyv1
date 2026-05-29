"use client";

import { useState } from "react";
import { useServerJobs } from "@/lib/camouflage/client/server-jobs";
import {
  WHITE_SCRIPT_PRESETS,
  DEFAULT_TARGET_PRESET,
  MODE_HINT,
  detectKind,
  type JobMode,
} from "@/lib/camouflage/jobs-config";
import { Dropzone, ModeSelector, SectionCard, ServerJobList, TargetPresetPicker } from "./shared";

const MODES: { value: JobMode; label: string; desc: string }[] = [
  { value: "fast", label: "Rápido", desc: "Funciona em qualquer device; desloca o tópico (não garante)." },
  { value: "max", label: "Máximo (anti-IA)", desc: "Cancelamento de fase: a IA só transcreve o decoy. Estéreo/fone p/ ouvir o original." },
];

export function AudioSection() {
  const [mode, setMode] = useState<JobMode>("fast");
  const [preset, setPreset] = useState<string>(DEFAULT_TARGET_PRESET);
  const { jobs, error, uploading, hasActive, uploadFiles, removeJob, clearFinished } = useServerJobs();
  const audioJobs = jobs.filter((j) => j.kind === "audio");

  const onFiles = (files: File[]) => {
    const valid = files.filter((f) => detectKind(f.name, f.type) === "audio");
    if (valid.length === 0) return;
    void uploadFiles(valid, { mode, targetPreset: preset });
  };

  return (
    <SectionCard
      title="Camuflagem de áudio"
      description="O áudio é processado no servidor: uma fala-alvo (TTS) entra por baixo, palavras-chave do tópico são injetadas e a faixa é tratada para confundir transcritores. No modo Máximo, um ataque adversarial no Whisper deixa a transcrição como lixo — mantendo o áudio quase imperceptível pro ouvido."
    >
      <div className="flex flex-wrap items-center gap-4">
        <ModeSelector value={mode} options={MODES} onChange={setMode} />
      </div>

      <div className="mt-4">
        <TargetPresetPicker presets={WHITE_SCRIPT_PRESETS} value={preset} onChange={setPreset} />
      </div>

      <p className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-strong">
        {MODE_HINT[mode]} A IA tende a transcrever/perceber o tópico{" "}
        <strong className="text-foreground">
          {WHITE_SCRIPT_PRESETS.find((p) => p.id === preset)?.label}
        </strong>{" "}
        no lugar da fala real.
      </p>

      {error ? (
        <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</p>
      ) : null}

      <div className="mt-5">
        <Dropzone
          accept="audio/*"
          onFiles={onFiles}
          label="Solte áudios aqui ou clique para selecionar"
          hint="MP3, WAV, M4A, AAC ou OGG. O processamento roda no servidor — você pode acompanhar a fila abaixo."
        />
      </div>

      {uploading ? <p className="mt-3 text-xs text-muted">Enviando arquivo(s)...</p> : null}

      <ServerJobList jobs={audioJobs} onRemove={removeJob} onClearFinished={clearFinished} />

      {hasActive ? (
        <p className="mt-3 text-xs text-muted">
          Mantenha esta aba aberta: se você fechar, os jobs em andamento saem da fila.
        </p>
      ) : null}
    </SectionCard>
  );
}
