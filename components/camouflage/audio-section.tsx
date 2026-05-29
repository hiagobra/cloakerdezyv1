"use client";

import { useEffect, useState } from "react";
import { camouflageAudio, type AudioMode } from "@/lib/camouflage/client/audio";
import { useCamouflageQueue } from "@/lib/camouflage/client/queue";
import { trackCamouflage, useBeforeUnloadGuard } from "@/lib/camouflage/client/track";
import { CamoResult, Dropzone, JobList, ModeSelector, SectionCard } from "./shared";

const MODES: { value: AudioMode; label: string; desc: string }[] = [
  { value: "leve", label: "Leve", desc: "Imperceptível: jitter + pitch sutil + poison HF." },
  { value: "maximo", label: "Máximo (anti-IA)", desc: "Nível maskai: camada reversa + eco + notches. IA não transcreve; leve eco audível." },
];

export function AudioSection() {
  const [mode, setMode] = useState<AudioMode>("leve");
  const queue = useCamouflageQueue<CamoResult>(3);

  useBeforeUnloadGuard(queue.activeCount > 0);

  useEffect(() => {
    queue.onComplete(() => trackCamouflage("audio"));
  }, [queue]);

  const onFiles = (files: File[]) => {
    const valid = files.filter(
      (f) => f.type.startsWith("audio/") || f.type.startsWith("video/") || /\.(mp3|wav|m4a|aac|ogg|mp4|mov|webm|avi|mkv)$/i.test(f.name),
    );
    if (valid.length === 0) return;
    queue.enqueue(
      valid.map((file) => ({
        fileName: file.name,
        run: async (onProgress) => {
          const res = await camouflageAudio(file, mode, (m) => onProgress(m));
          return { blob: res.blob, outputName: res.outputName };
        },
      })),
    );
  };

  return (
    <SectionCard
      title="Camuflagem de áudio"
      description="Camuflagem multicamada (timing jitter, pitch sutil, mascaramento pink/brown, poison HF 14-18kHz e, no forte, camada reversa anti-transcrição). Embaralha a assinatura sonora pra máquinas sem o ouvido humano perceber. Funciona em áudios e vídeos (re-codifica só o áudio)."
    >
      <ModeSelector value={mode} options={MODES} onChange={setMode} />

      <div className="mt-5">
        <Dropzone
          accept="audio/*,video/*"
          onFiles={onFiles}
          label="Solte áudios ou vídeos aqui"
          hint="MP3, WAV, M4A ou vídeos (camufla a faixa de áudio). Até 3 ao mesmo tempo."
        />
      </div>

      <JobList jobs={queue.jobs} onRemove={queue.remove} onClearFinished={queue.clearFinished} />
    </SectionCard>
  );
}
