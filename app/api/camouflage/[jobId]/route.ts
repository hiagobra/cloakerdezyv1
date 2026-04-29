import { createClient } from "@/lib/supabase/server";
import { createDownloadToken } from "@/lib/security/download-token";
import { claimJobById, getJobForUser, saveJob } from "@/lib/camouflage/job-store";
import { processJob } from "@/lib/camouflage/processor";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/request-guard";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

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

export async function GET(request: Request, context: RouteContext) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: "Origem nao autorizada." }, { status: 403 });
  }

  const clientIp = getClientIp(request.headers);
  const rate = checkRateLimit(`camouflage:status:${clientIp}`, 120, 60_000);
  if (!rate.allowed) {
    return Response.json(
      { error: "Muitas requisicoes de status." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return Response.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const { jobId } = await context.params;
  let job = await getJobForUser(jobId, userId);

  if (!job) {
    return Response.json({ error: "Job nao encontrado." }, { status: 404 });
  }

  if (job.status === "queued") {
    const claimed = await claimJobById(jobId);
    if (claimed) {
      job = await processJob(claimed);
    } else {
      job = (await getJobForUser(jobId, userId)) ?? job;
    }
  } else if (job.status === "processing") {
    const ageMs = Date.now() - new Date(job.updatedAt).getTime();
    const maxProcessingMs = 5 * 60 * 1000;

    if (ageMs > maxProcessingMs) {
      job.status = "failed";
      job.error = "Processamento expirou (timeout). Reenvie o video para tentar novamente.";
      await saveJob(job);
    }
  }

  let downloadUrl: string | undefined;
  if (job.status === "done") {
    const token = createDownloadToken(job.id, 60 * 10);
    downloadUrl = `/api/camouflage/${job.id}/download?token=${encodeURIComponent(token)}`;
  }

  return Response.json({
    id: job.id,
    fileName: job.fileName,
    preset: job.preset,
    targetPreset: job.targetPreset,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    outputName: job.outputPath ? job.outputPath.split(/[\\/]/).pop() : undefined,
    downloadUrl,
    layersApplied: job.layersApplied,
    error: job.error,
  });
}
