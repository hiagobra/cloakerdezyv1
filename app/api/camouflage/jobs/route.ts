import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/request-guard";
import { saveInput, saveCover, removeJobFiles } from "@/lib/camouflage/server/storage";
import {
  MAX_UPLOAD_BYTES,
  DEFAULT_TARGET_PRESET,
  DEFAULT_RESIZE_FORMAT,
  DEFAULT_AUDIO_PROFILE,
  detectKind,
  isValidMode,
  isValidTargetPreset,
  isValidResizeFormat,
  isValidAudioProfile,
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

  const detected = detectKind(file.name, file.type);
  // Aba Filtros envia kind=filter; Redimensionar envia kind=resize. Em ambos o
  // arquivo principal precisa ser video.
  const kindRaw = form.get("kind");
  const isFilter = kindRaw === "filter";
  const isResize = kindRaw === "resize";
  if ((isFilter || isResize) && detected !== "video") {
    const label = isResize ? "Redimensionar aceita" : "Filtros aceitam";
    return Response.json({ error: `${label} apenas video.` }, { status: 415 });
  }
  if (!isFilter && !isResize && !detected) {
    return Response.json({ error: "Formato nao suportado (use audio ou video)." }, { status: 415 });
  }
  const kind = isFilter ? "filter" : isResize ? "resize" : detected!;

  const modeRaw = form.get("mode");
  const mode = isValidMode(modeRaw) ? modeRaw : "fast";

  // Modo Personalizado: guarda o perfil de alteracao do audio em audio_opts.
  let audioOpts: { profile: string } | null = null;
  if (mode === "custom") {
    const profileRaw = form.get("audioProfile");
    audioOpts = { profile: isValidAudioProfile(profileRaw) ? profileRaw : DEFAULT_AUDIO_PROFILE };
  }

  // Para resize, target_preset carrega o formato (square/tiktok). Para os demais,
  // carrega o white-script.
  const presetRaw = form.get("targetPreset");
  const targetPreset = isResize
    ? isValidResizeFormat(presetRaw)
      ? presetRaw
      : DEFAULT_RESIZE_FORMAT
    : isValidTargetPreset(presetRaw)
      ? presetRaw
      : DEFAULT_TARGET_PRESET;

  // Imagem de capa opcional (primeiro frame), so faz sentido pro modo Filtros.
  const cover = form.get("cover");
  let coverFile: File | null = null;
  if (cover instanceof File && cover.size > 0) {
    if (!cover.type.startsWith("image/")) {
      return Response.json({ error: "A capa precisa ser uma imagem." }, { status: 415 });
    }
    if (cover.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: "Imagem de capa muito grande." }, { status: 413 });
    }
    coverFile = cover;
  }

  const jobId = randomUUID();
  let inputPath: string;
  let coverPath: string | null = null;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    inputPath = await saveInput(jobId, file.name, data);
    if (coverFile) {
      const coverData = new Uint8Array(await coverFile.arrayBuffer());
      coverPath = await saveCover(jobId, coverFile.name, coverData);
    }
  } catch {
    await removeJobFiles(jobId);
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
      cover_path: coverPath,
      cover_name: coverFile?.name ?? null,
      audio_opts: audioOpts,
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
