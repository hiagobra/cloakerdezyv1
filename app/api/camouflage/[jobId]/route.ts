import { createDownloadToken } from "@/lib/security/download-token";
import { claimJobById, getJob, saveJob } from "@/lib/camouflage/job-store";
import { processJob } from "@/lib/camouflage/processor";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/request-guard";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

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

  const { jobId } = await context.params;
  let job = await getJob(jobId);

  if (!job) {
    return Response.json({ error: "Job nao encontrado." }, { status: 404 });
  }

  if (job.status === "queued") {
    const claimed = await claimJobById(jobId);
    if (claimed) {
      job = await processJob(claimed);
    } else {
      job = (await getJob(jobId)) ?? job;
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
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    outputName: job.outputPath ? job.outputPath.split(/[\\/]/).pop() : undefined,
    downloadUrl,
    error: job.error,
  });
}

