"use client";

import { useEffect, useState } from "react";
import { camouflageVideo, type VideoMode } from "@/lib/camouflage/client/video";
import { camouflageAudio, type AudioMode } from "@/lib/camouflage/client/audio";
import { useCamouflageQueue } from "@/lib/camouflage/client/queue";
import { trackCamouflage, useBeforeUnloadGuard } from "@/lib/camouflage/client/track";
import { CamoResult, CoverPicker, Dropzone, JobList, ModeSelector, SectionCard } from "./shared";

const MODES: { value: VideoMode; label: string; desc: string }[] = [
  { value: "leve", label: "Leve", desc: "Perturbação mínima, mais rápido." },
  { value: "medio", label: "Médio", desc: "Equilíbrio entre disfarce e qualidade." },
  { value: "forte", label: "Forte", desc: "Disfarce máximo, ainda imperceptível." },
];

const AUDIO_MODES: { value: AudioMode; label: string; desc: string }[] = [
  { value: "leve", label: "Leve", desc: "Imperceptível." },
  { value: "maximo", label: "Máximo", desc: "IA não transcreve; leve eco audível." },
];

export function VideoSection() {
  const [mode, setMode] = useState<VideoMode>("medio");
  const [cover, setCover] = useState<File | null>(null);
  const [protectAudio, setProtectAudio] = useState(true);
  const [audioMode, setAudioMode] = useState<AudioMode>("maximo");
  const queue = useCamouflageQueue<CamoResult>(3);

  useBeforeUnloadGuard(queue.activeCount > 0);

  useEffect(() => {
    queue.onComplete(() => trackCamouflage("video"));
  }, [queue]);

  const onFiles = (files: File[]) => {
    const videos = files.filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(f.name));
    if (videos.length === 0) return;
    queue.enqueue(
      videos.map((file) => ({
        fileName: file.name,
        run: async (onProgress) => {
          const visual = await camouflageVideo(file, { mode, cover, onProgress });
          if (!protectAudio) {
            return { blob: visual.blob, outputName: visual.outputName };
          }
          // 2º passo: protege a faixa de áudio contra IA (copia o vídeo, re-encoda só o áudio)
          const ext = visual.outputName.match(/\.[^.]+$/)?.[0] ?? ".mp4";
          const base = file.name.replace(/\.[^.]+$/, "");
          const wrapped = new File([visual.blob], `${base}${ext}`, { type: visual.blob.type });
          const out = await camouflageAudio(wrapped, audioMode, (m) => onProgress(`Áudio: ${m}`));
          return { blob: out.blob, outputName: out.outputName };
        },
      })),
    );
  };

  return (
    <SectionCard
      title="Camuflagem de vídeo"
      description="Re-encoda o vídeo com perturbação imperceptível, zera metadados e muda a impressão digital. Com a proteção de áudio ligada, a faixa de áudio também fica anti-transcrição. Processa no seu navegador."
    >
      <div className="flex flex-wrap items-center gap-4">
        <ModeSelector value={mode} options={MODES} onChange={setMode} />
        <CoverPicker cover={cover} onPick={setCover} onClear={() => setCover(null)} />
      </div>

      <div className="mt-4 rounded-2xl border border-border-soft bg-card-soft/40 p-4">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-medium text-foreground">Proteger áudio contra IA</span>
            <span className="block text-xs text-muted">Adiciona camadas que confundem a transcrição automática.</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={protectAudio}
            onClick={() => setProtectAudio((v) => !v)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${protectAudio ? "bg-primary" : "bg-border-strong"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background transition-all ${protectAudio ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </label>
        {protectAudio ? (
          <div className="mt-3">
            <ModeSelector value={audioMode} options={AUDIO_MODES} onChange={setAudioMode} />
          </div>
        ) : null}
      </div>

      <div className="mt-5">
        <Dropzone
          accept="video/*"
          onFiles={onFiles}
          label="Solte vídeos aqui ou clique para selecionar"
          hint="MP4, MOV, WebM. Até 3 ao mesmo tempo. O vídeo processa em tempo real e a proteção de áudio roda logo depois (não feche a aba)."
        />
      </div>

      <JobList jobs={queue.jobs} onRemove={queue.remove} onClearFinished={queue.clearFinished} />
    </SectionCard>
  );
}
