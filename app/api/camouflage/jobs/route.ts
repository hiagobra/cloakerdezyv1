import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/request-guard";
import { saveInput, removeJobFiles } from "@/lib/camouflage/server/storage";
import {
  MAX_UPLOAD_BYTES,
  DEFAULT_TARGET_PRESET,
  detectKind,
  isValidMode,
  isValidTargetPreset,
  mapJobRow,
  JOB_SELECT_COLUMNS,
  type JobRow,
} from "@/lib/camouflage/jobs-config";

export const runtime = "nodejs";

/** Cria um job de camuflagem: grava o input no disco e enfileira (status=queued). */
export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: "Origem nao autorizada." }, { status: 403 });
  }

  const clientIp = getClientIp(request.headers);
  const rate = checkRateLimit(`camouflage:jobs:${clientIp}`, 30, 60_000);
  if (!rate.allowed) {
    return Response.json(
      { error: "Muitas requisicoes. Aguarde um momento." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Nao autenticado." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Envio invalido." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Arquivo ausente." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: `Arquivo muito grande (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB).` },
      { status: 413 },
    );
  }

  const kind = detectKind(file.name, file.type);
  if (!kind) {
    return Response.json({ error: "Formato nao suportado (use audio ou video)." }, { status: 415 });
  }

  const modeRaw = form.get("mode");
  const mode = isValidMode(modeRaw) ? modeRaw : "fast";

  const presetRaw = form.get("targetPreset");
  const targetPreset = isValidTargetPreset(presetRaw) ? presetRaw : DEFAULT_TARGET_PRESET;

  const jobId = randomUUID();
  let inputPath: string;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    inputPath = await saveInput(jobId, file.name, data);
  } catch {
    return Response.json({ error: "Falha ao salvar o arquivo." }, { status: 500 });
  }

  const { data: row, error } = await supabase
    .from("camouflage_jobs")
    .insert({
      id: jobId,
      user_id: user.id,
      kind,
      mode,
      target_preset: targetPreset,
      status: "queued",
      progress: 0,
      input_path: inputPath,
      input_name: file.name,
    })
    .select(JOB_SELECT_COLUMNS)
    .single();

  if (error || !row) {
    await removeJobFiles(jobId);
    return Response.json({ error: "Falha ao enfileirar o job." }, { status: 500 });
  }

  return Response.json({ job: mapJobRow(row as JobRow) }, { status: 201 });
}

/** Lista os jobs do usuario (mais recentes primeiro). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("camouflage_jobs")
    .select(JOB_SELECT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return Response.json({ error: "Falha ao listar jobs." }, { status: 500 });
  }

  return Response.json({ jobs: (data as JobRow[]).map(mapJobRow) });
}
