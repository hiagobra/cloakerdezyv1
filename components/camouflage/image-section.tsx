"use client";

import { useEffect, useState } from "react";
import { camouflageImage, coverLevelToMix, loadImageFile } from "@/lib/camouflage/client/image";
import { useCamouflageQueue } from "@/lib/camouflage/client/queue";
import { trackCamouflage } from "@/lib/camouflage/client/track";
import { CamoResult, CoverPicker, Dropzone, JobList, SectionCard } from "./shared";

export function ImageSection() {
  const [cover, setCover] = useState<File | null>(null);
  const [coverLevel, setCoverLevel] = useState(10);
  const [noise, setNoise] = useState(6);
  const queue = useCamouflageQueue<CamoResult>(3);

  useEffect(() => {
    queue.onComplete(() => trackCamouflage("image"));
  }, [queue]);

  const onFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name));
    if (images.length === 0) return;

    const coverImg = cover ? await loadImageFile(cover) : null;
    const coverMix = cover ? coverLevelToMix(coverLevel) : 0;

    queue.enqueue(
      images.map((file, idx) => ({
        fileName: file.name,
        run: async (onProgress) => {
          onProgress("Camuflando imagem...", 50);
          const creative = await loadImageFile(file);
          const res = await camouflageImage(creative, coverImg, idx, coverMix, noise);
          return { blob: res.blob, outputName: res.outputName, previewUrl: res.dataUrl };
        },
      })),
    );
  };

  return (
    <SectionCard
      title="Camuflagem de imagem"
      description="Mistura o criativo com uma capa (o que o algoritmo 'vê') e aplica ruído adversarial anti-IA + shift de contraste. Sem capa, aplica só o ruído. Tudo no navegador."
    >
      <div className="flex flex-col gap-5">
        <CoverPicker cover={cover} onPick={setCover} onClear={() => setCover(null)} />

        {cover ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="uppercase tracking-[0.18em] text-muted">Mistura da capa</span>
              <span className="tabular-nums text-muted-strong">{Math.round(coverLevelToMix(coverLevel) * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={20}
              value={coverLevel}
              onChange={(e) => setCoverLevel(Number(e.target.value))}
              className="w-full accent-[var(--primary)]"
            />
          </div>
        ) : null}

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="uppercase tracking-[0.18em] text-muted">Ruído anti-IA</span>
            <span className="tabular-nums text-muted-strong">{noise}</span>
          </div>
          <input
            type="range"
            min={0}
            max={20}
            value={noise}
            onChange={(e) => setNoise(Number(e.target.value))}
            className="w-full accent-[var(--primary)]"
          />
        </div>

        <Dropzone
          accept="image/*"
          onFiles={onFiles}
          label="Solte imagens aqui ou clique para selecionar"
          hint="JPG, PNG, WebP. Com capa, todos os criativos saem no tamanho da capa."
        />
      </div>

      <JobList jobs={queue.jobs} onRemove={queue.remove} onClearFinished={queue.clearFinished} />
    </SectionCard>
  );
}
