"use client";

import { useState } from "react";
import { useServerJobs } from "@/lib/camouflage/client/server-jobs";
import {
  WHITE_SCRIPT_PRESETS,
  DEFAULT_TARGET_PRESET,
  CUSTOM_AUDIO_PROFILES,
  DEFAULT_AUDIO_PROFILE,
  MODE_HINT,
  detectKind,
  type JobMode,
} from "@/lib/camouflage/jobs-config";
import { Dropzone, ModeSelector, SectionCard, ServerJobList, TargetPresetPicker } from "./shared";

const MODES: { value: JobMode; label: string; desc: string }[] = [
  { value: "fast", label: "Rápido", desc: "Camuflagem rápida e efetiva: encriptamento + prompt injection que confunde a IA." },
  { value: "max", label: "Máximo (anti-IA)", desc: "Tratamento pesado: múltiplos ataques sobre as faixas e legendas do vídeo. O ruído pode ficar um pouco mais perceptível." },
  { value: "custom", label: "Personalizado", desc: "Você escolhe o quanto alterar o áudio." },
];

export function VideoSection() {
  const [mode, setMode] = useState<JobMode>("fast");
  const [preset, setPreset] = useState<string>(DEFAULT_TARGET_PRESET);
  const [audioProfile, setAudioProfile] = useState<string>(DEFAULT_AUDIO_PROFILE);
  const { jobs, error, uploading, hasActive, uploadFiles, removeJob, clearFinished } = useServerJobs();
  const videoJobs = jobs.filter((j) => j.kind === "video");

  const onFiles = (files: File[]) => {
    const valid = files.filter((f) => detectKind(f.name, f.type) === "video");
    if (valid.length === 0) return;
    void uploadFiles(valid, {
      mode,
      targetPreset: preset,
      audioProfile: mode === "custom" ? audioProfile : undefined,
    });
  };

  const profileDesc = CUSTOM_AUDIO_PROFILES.find((p) => p.id === audioProfile)?.desc;

  return (
    <SectionCard
      title="Camuflagem de vídeo"
      description="Envie seu vídeo e escolha o nível de camuflagem. Ele entra na fila, é processado e fica pronto pra download na lista abaixo."
    >
      <div className="flex flex-wrap items-center gap-4">
        <ModeSelector value={mode} options={MODES} onChange={setMode} />
      </div>

      {mode === "custom" ? (
        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">Alteração do áudio</div>
          <ModeSelector
            value={audioProfile}
            onChange={setAudioProfile}
            options={CUSTOM_AUDIO_PROFILES.map((p) => ({ value: p.id, label: p.label, desc: p.desc }))}
          />
          {profileDesc ? <p className="mt-2 text-xs text-muted">{profileDesc}</p> : null}
        </div>
      ) : null}

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
          Mantenha esta aba aberta: se você fechar, os jobs em andamento saem da fila.
        </p>
      ) : null}
    </SectionCard>
  );
}
