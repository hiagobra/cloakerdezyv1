"use client";

import { useEffect, useState } from "react";
import { cleanMetadata, type CompressionLevel } from "@/lib/camouflage/client/metadata";
import { useCamouflageQueue } from "@/lib/camouflage/client/queue";
import { trackCamouflage, useBeforeUnloadGuard } from "@/lib/camouflage/client/track";
import { CamoResult, Dropzone, JobList, ModeSelector, SectionCard } from "./shared";

const LEVELS: { value: CompressionLevel; label: string; desc: string }[] = [
  { value: "nenhuma", label: "Sem compressão", desc: "Só remove metadados, mantém a qualidade." },
  { value: "leve", label: "Leve", desc: "Compressão suave (CRF 23)." },
  { value: "media", label: "Média", desc: "Bom equilíbrio (CRF 28)." },
  { value: "alta", label: "Alta", desc: "Arquivo bem menor (CRF 32)." },
];

export function MetadataSection() {
  const [level, setLevel] = useState<CompressionLevel>("leve");
  const queue = useCamouflageQueue<CamoResult>(3);

  useBeforeUnloadGuard(queue.activeCount > 0);

  useEffect(() => {
    queue.onComplete(() => trackCamouflage("metadata"));
  }, [queue]);

  const onFiles = (files: File[]) => {
    const valid = files.filter(
      (f) => f.type.startsWith("video/") || f.type.startsWith("image/") || /\.(mp4|mov|m4v|webm|avi|mkv|jpg|jpeg|png|webp)$/i.test(f.name),
    );
    if (valid.length === 0) return;
    queue.enqueue(
      valid.map((file) => ({
        fileName: file.name,
        run: async (onProgress) => {
          const res = await cleanMetadata(file, level, (m) => onProgress(m));
          return { blob: res.blob, outputName: res.outputName };
        },
      })),
    );
  };

  return (
    <SectionCard
      title="Limpeza de metadados + compressão"
      description="Remove EXIF/metadados do container (que entregam origem, device e edição) e opcionalmente comprime o vídeo sem perda perceptível. Útil pra subir o mesmo arquivo várias vezes sem ser pego por hash."
    >
      <ModeSelector value={level} options={LEVELS} onChange={setLevel} />

      <div className="mt-5">
        <Dropzone
          accept="video/*,image/*"
          onFiles={onFiles}
          label="Solte vídeos ou imagens aqui"
          hint="Remove metadados de vídeos (MP4/MOV) e imagens (JPG/PNG). Compressão só se aplica a vídeo."
        />
      </div>

      <JobList jobs={queue.jobs} onRemove={queue.remove} onClearFinished={queue.clearFinished} />
    </SectionCard>
  );
}
