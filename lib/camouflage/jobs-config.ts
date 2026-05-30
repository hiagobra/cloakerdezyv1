/**
 * Config isomorfica dos jobs de camuflagem server-side. Sem imports de Node ou
 * Next: usada tanto pela API/worker quanto pelo frontend.
 */

export type JobKind = "audio" | "video" | "filter";
export type JobMode = "fast" | "max";
export type JobStatus = "queued" | "processing" | "done" | "error";

export interface ServerJob {
  id: string;
  kind: JobKind;
  mode: JobMode;
  targetPreset: string | null;
  status: JobStatus;
  progress: number;
  message: string | null;
  inputName: string;
  outputName: string | null;
  coverName: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Tamanho maximo de upload (bytes). */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB

export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg"] as const;
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "avi", "mkv"] as const;

/**
 * "White scripts" / topicos-alvo disponiveis. O `id` casa 1:1 com as chaves de
 * TOPIC_TARGETS no pipeline Python (audio_poc.cloak.targets). A IA passa a
 * transcrever/perceber este topico no lugar do conteudo real.
 */
export const WHITE_SCRIPT_PRESETS: { id: string; label: string }[] = [
  { id: "financas_pt", label: "Financas / renda fixa" },
  { id: "marketing_pt", label: "Marketing digital" },
  { id: "saude_pt", label: "Saude / bem-estar" },
  { id: "nutricao_pt", label: "Nutricao / alimentacao" },
  { id: "motivacional_pt", label: "Motivacional / mindset" },
  { id: "tecnologia_pt", label: "Tecnologia / tutorial" },
  { id: "culinaria_pt", label: "Culinaria / receita" },
  { id: "educacao_infantil_pt", label: "Educacao infantil" },
];

export const DEFAULT_TARGET_PRESET = "financas_pt";

export function isValidTargetPreset(value: unknown): value is string {
  return typeof value === "string" && WHITE_SCRIPT_PRESETS.some((p) => p.id === value);
}

export function isValidKind(value: unknown): value is JobKind {
  return value === "audio" || value === "video" || value === "filter";
}

export function isValidMode(value: unknown): value is JobMode {
  return value === "fast" || value === "max";
}

function getExt(fileName: string): string {
  const m = fileName.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : "";
}

/** Detecta o kind a partir do nome/tipo do arquivo; null se nao suportado. */
export function detectKind(fileName: string, mimeType?: string): JobKind | null {
  const ext = getExt(fileName);
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return "audio";
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("audio/")) return "audio";
  return null;
}

/** Estimativa de tempo (texto) por modo, pra UI setar expectativa. */
export const MODE_HINT: Record<JobMode, string> = {
  fast: "Camuflagem rápida e efetiva: encriptamento + prompt injection que confunde a IA.",
  max: "Tratamento pesado: múltiplos ataques sobre as faixas e legendas do vídeo. O ruído pode ficar um pouco mais perceptível.",
};

/** Shape da linha do banco (snake_case) que as rotas selecionam. */
export interface JobRow {
  id: string;
  kind: JobKind;
  mode: JobMode;
  target_preset: string | null;
  status: JobStatus;
  progress: number | null;
  message: string | null;
  input_name: string;
  output_name: string | null;
  cover_name: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

/** Converte a linha do banco no objeto camelCase exposto ao cliente. */
export function mapJobRow(row: JobRow): ServerJob {
  return {
    id: row.id,
    kind: row.kind,
    mode: row.mode,
    targetPreset: row.target_preset,
    status: row.status,
    progress: row.progress ?? 0,
    message: row.message,
    inputName: row.input_name,
    outputName: row.output_name,
    coverName: row.cover_name,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export const JOB_SELECT_COLUMNS =
  "id, kind, mode, target_preset, status, progress, message, input_name, output_name, cover_name, error, created_at, finished_at";
