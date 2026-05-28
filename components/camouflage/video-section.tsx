"use client";

import { useEffect, useState } from "react";
import { camouflageVideo, type VideoMode } from "@/lib/camouflage/client/video";
import { useCamouflageQueue } from "@/lib/camouflage/client/queue";
import { trackCamouflage, useBeforeUnloadGuard } from "@/lib/camouflage/client/track";
import { CamoResult, CoverPicker, Dropzone, JobList, ModeSelector, SectionCard } from "./shared";

const MODES: { value: VideoMode; label: string; desc: string }[] = [
  { value: "leve", label: "Leve", desc: "Perturbação mínima, mais rápido." },
  { value: "medio", label: "Médio", desc: "Equilíbrio entre disfarce e qualidade." },
  { value: "forte", label: "Forte", desc: "Disfarce máximo, ainda imperceptível." },
];

export function VideoSection() {
  const [mode, setMode] = useState<VideoMode>("medio");
  const [cover, setCover] = useState<File | null>(null);
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
          const res = await camouflageVideo(file, { mode, cover, onProgress });
          return { blob: res.blob, outputName: res.outputName };
        },
      })),
    );
  };

  return (
    <SectionCard
      title="Camuflagem de vídeo"
      description="Re-encoda o vídeo com perturbação imperceptível, zera metadados e muda a impressão digital. O áudio original é mantido. Processa no seu navegador."
    >
      <div className="flex flex-wrap items-center gap-4">
        <ModeSelector value={mode} options={MODES} onChange={setMode} />
        <CoverPicker cover={cover} onPick={setCover} onClear={() => setCover(null)} />
      </div>

      <div className="mt-5">
        <Dropzone
          accept="video/*"
          onFiles={onFiles}
          label="Solte vídeos aqui ou clique para selecionar"
          hint="MP4, MOV, WebM. Até 3 processam ao mesmo tempo; o resto entra na fila. O processamento roda em tempo real (não feche a aba)."
        />
      </div>

      <JobList jobs={queue.jobs} onRemove={queue.remove} onClearFinished={queue.clearFinished} />
    </SectionCard>
  );
}
