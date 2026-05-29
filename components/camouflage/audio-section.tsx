"use client";

import { useEffect, useState } from "react";
import { camouflageAudio, type AudioMode } from "@/lib/camouflage/client/audio";
import { useCamouflageQueue } from "@/lib/camouflage/client/queue";
import { trackCamouflage, useBeforeUnloadGuard } from "@/lib/camouflage/client/track";
import { CamoResult, Dropzone, JobList, ModeSelector, SectionCard, WhiteCopyPicker } from "./shared";

const MODES: { value: AudioMode; label: string; desc: string }[] = [
  { value: "leve", label: "Leve", desc: "Imperceptível: jitter + pitch sutil + poison HF." },
  { value: "maximo", label: "Máximo (anti-IA)", desc: "Nível maskai: camada reversa + eco + notches. IA não transcreve; leve eco audível." },
];

export function AudioSection() {
  const [mode, setMode] = useState<AudioMode>("maximo");
  const [whiteCopy, setWhiteCopy] = useState<File | null>(null);
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
    const white = whiteCopy;
    queue.enqueue(
      valid.map((file) => ({
        fileName: file.name,
        run: async (onProgress) => {
          const res = await camouflageAudio(file, mode, (m) => onProgress(m), white);
          return { blob: res.blob, outputName: res.outputName };
        },
      })),
    );
  };

  return (
    <SectionCard
      title="Camuflagem de áudio"
      description="Camuflagem multicamada (timing jitter, pitch sutil, mascaramento pink/brown, poison HF 14-18kHz e, no máximo, camada reversa anti-transcrição). Com uma copia white, sobrepõe uma fala limpa que a IA transcreve no lugar da real (nível maskai). Funciona em áudios e vídeos (re-codifica só o áudio)."
    >
      <div className="flex flex-wrap items-center gap-4">
        <ModeSelector value={mode} options={MODES} onChange={setMode} />
        <WhiteCopyPicker file={whiteCopy} onPick={setWhiteCopy} onClear={() => setWhiteCopy(null)} />
      </div>

      {whiteCopy ? (
        <p className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-strong">
          Copia white ativa: a IA de transcrição vai ler <strong className="text-foreground">{whiteCopy.name}</strong> no lugar do que é realmente falado. Use o modo <strong className="text-foreground">Máximo</strong> pra degradar a voz real e a copia white dominar a transcrição.
        </p>
      ) : null}

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
