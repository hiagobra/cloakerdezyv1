import { createClient } from "@/lib/supabase/server";
import { createDownloadToken } from "@/lib/security/download-token";
import {
  createJob,
  deleteJobsByUser,
  DEFAULT_TARGET,
  isValidTarget,
  listJobsByUser,
  type CamouflagePreset,
  type CamouflageTarget,
} from "@/lib/camouflage/job-store";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/request-guard";

async function getAuthenticatedUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const clientIp = getClientIp(request.headers);
  const rate = checkRateLimit(`camouflage:list:${clientIp}`, 30, 60_000);
  if (!rate.allowed) {
    return Response.json(
      { error: "Muitas requisicoes de listagem." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return Response.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const jobs = await listJobsByUser(userId);
  return Response.json(
    jobs.map((job) => ({
      id: job.id,
      fileName: job.fileName,
      preset: job.preset,
      targetPreset: job.targetPreset,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      outputName: job.outputPath ? job.outputPath.split(/[\\/]/).pop() : undefined,
      downloadUrl:
        job.status === "done"
          ? `/api/camouflage/${job.id}/download?token=${encodeURIComponent(createDownloadToken(job.id, 60 * 10))}`
          : undefined,
      layersApplied: job.layersApplied,
      error: job.error,
    })),
  );
}

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: "Origem nao autorizada." }, { status: 403 });
  }

  const clientIp = getClientIp(request.headers);
  const rate = checkRateLimit(`camouflage:create:${clientIp}`, 10, 60_000);
  if (!rate.allowed) {
    return Response.json(
      { error: "Muitas requisicoes. Tente novamente em instantes." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return Response.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const preset = String(formData.get("preset") ?? "medio") as CamouflagePreset;
  const rawTarget = formData.get("targetPreset");
  const targetPreset: CamouflageTarget = isValidTarget(rawTarget)
    ? (rawTarget as CamouflageTarget)
    : DEFAULT_TARGET;

  if (!(file instanceof File)) {
    return Response.json({ error: "Arquivo nao enviado." }, { status: 400 });
  }

  if (!["leve", "medio", "forte"].includes(preset)) {
    return Response.json({ error: "Preset invalido." }, { status: 400 });
  }

  try {
    const bytes = await file.arrayBuffer();
    const job = await createJob(userId, file.name, preset, targetPreset, Buffer.from(bytes));
    return Response.json({ jobId: job.id, status: job.status, targetPreset: job.targetPreset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao camuflar arquivo.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: "Origem nao autorizada." }, { status: 403 });
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return Response.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const removed = await deleteJobsByUser(userId);
  return Response.json({ ok: true, removed });
}
