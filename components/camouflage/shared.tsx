"use client";

import { useRef, useState, type ReactNode } from "react";
import type { QueueJob } from "@/lib/camouflage/client/queue";
import { downloadBlob } from "@/lib/camouflage/client/track";

export interface CamoResult {
  blob: Blob;
  outputName: string;
  previewUrl?: string;
}

// ============================================================
// Dropzone
// ============================================================

export function Dropzone({
  accept,
  multiple = true,
  onFiles,
  label,
  hint,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  label: string;
  hint: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center transition ${
        dragging ? "border-primary bg-primary/5" : "border-border-strong hover:border-primary/50 hover:bg-card-soft/40"
      }`}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v12M7 8l5-5 5 5M5 21h14" />
        </svg>
      </div>
      <p className="text-display-tight text-base text-foreground">{label}</p>
      <p className="max-w-sm text-xs text-muted">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ============================================================
// Mode selector (segmented control)
// ============================================================

export function ModeSelector<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; desc?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1.5 rounded-full border border-border-soft bg-card-soft p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          title={opt.desc}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// Section shell
// ============================================================

export function SectionCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="surface-panel p-6 md:p-7">
      <div className="mb-5">
        <h2 className="text-display text-xl text-foreground md:text-2xl">{title}</h2>
        <p className="mt-1 text-sm text-muted-strong">{description}</p>
      </div>
      {children}
    </div>
  );
}

// ============================================================
// Job list (queue display)
// ============================================================

const STATUS_STYLES: Record<QueueJob<CamoResult>["status"], string> = {
  queued: "bg-card-soft text-muted",
  processing: "bg-amber-500/15 text-amber-300",
  done: "bg-primary/15 text-primary",
  error: "bg-red-500/15 text-red-300",
};

const STATUS_LABEL: Record<QueueJob<CamoResult>["status"], string> = {
  queued: "Na fila",
  processing: "Processando",
  done: "Pronto",
  error: "Erro",
};

export function JobList({
  jobs,
  onRemove,
  onClearFinished,
}: {
  jobs: QueueJob<CamoResult>[];
  onRemove: (id: string) => void;
  onClearFinished: () => void;
}) {
  if (jobs.length === 0) return null;

  const hasFinished = jobs.some((j) => j.status === "done" || j.status === "error");

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-[0.18em] text-muted">Fila ({jobs.length})</h3>
        {hasFinished ? (
          <button type="button" onClick={onClearFinished} className="text-xs text-muted hover:text-foreground">
            Limpar concluídos
          </button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2.5">
        {jobs.map((job) => (
          <div key={job.id} className="surface-panel-soft flex items-center gap-4 p-3.5">
            {job.result?.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={job.result.previewUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-card text-muted">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 4h16v16H4zM4 9h16M9 4v16" />
                </svg>
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground">{job.fileName}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[job.status]}`}>
                  {STATUS_LABEL[job.status]}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">{job.message}</p>
              {job.status === "processing" ? (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-border-soft">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(4, job.progress)}%` }} />
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {job.status === "done" && job.result ? (
                <button
                  type="button"
                  onClick={() => downloadBlob(job.result!.blob, job.result!.outputName)}
                  className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary-strong"
                >
                  Baixar
                </button>
              ) : null}
              {job.status !== "processing" ? (
                <button
                  type="button"
                  onClick={() => onRemove(job.id)}
                  className="text-muted transition hover:text-foreground"
                  aria-label="Remover"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Optional cover picker
// ============================================================

export function WhiteCopyPicker({ file, onPick, onClear }: { file: File | null; onPick: (f: File) => void; onClear: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 rounded-full border border-border-strong px-4 py-2 text-sm text-foreground transition hover:border-primary/50"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 1v22M8 5v14M4 9v6M16 5v14M20 9v6" />
        </svg>
        {file ? "Trocar copia white" : "Copia white (opcional)"}
      </button>
      {file ? (
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className="max-w-[160px] truncate">{file.name}</span>
          <button type="button" onClick={onClear} className="hover:text-foreground">
            remover
          </button>
        </span>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function CoverPicker({ cover, onPick, onClear }: { cover: File | null; onPick: (f: File) => void; onClear: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 rounded-full border border-border-strong px-4 py-2 text-sm text-foreground transition hover:border-primary/50"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-5 w-5 rounded object-cover" />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.5-3.5L9 20" />
          </svg>
        )}
        {cover ? "Trocar capa" : "Capa (opcional)"}
      </button>
      {cover ? (
        <button type="button" onClick={() => { onClear(); setPreview(null); }} className="text-xs text-muted hover:text-foreground">
          remover
        </button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            onPick(f);
            setPreview(URL.createObjectURL(f));
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}
