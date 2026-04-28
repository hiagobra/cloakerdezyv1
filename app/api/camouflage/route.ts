import { createDownloadToken } from "@/lib/security/download-token";
import { createJob, listJobs, type CamouflagePreset } from "@/lib/camouflage/job-store";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/request-guard";

export async function GET(request: Request) {
  const clientIp = getClientIp(request.headers);
  const rate = checkRateLimit(`camouflage:list:${clientIp}`, 30, 60_000);
  if (!rate.allowed) {
    return Response.json(
      { error: "Muitas requisicoes de listagem." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const jobs = await listJobs();
  return Response.json(
    jobs.map((job) => ({
      id: job.id,
      fileName: job.fileName,
      preset: job.preset,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      outputName: job.outputPath ? job.outputPath.split(/[\\/]/).pop() : undefined,
      downloadUrl:
        job.status === "done"
          ? `/api/camouflage/${job.id}/download?token=${encodeURIComponent(createDownloadToken(job.id, 60 * 10))}`
          : undefined,
      error: job.error,
    })),
  );
}

export async function POST(request: Request) {
  // #region agent log
  fetch("http://127.0.0.1:7601/ingest/7c957bce-b281-426c-bb97-f528a3634ed5",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ec05a3"},body:JSON.stringify({sessionId:"ec05a3",runId:"precheck-1",hypothesisId:"H3",location:"app/api/camouflage/route.ts:36",message:"Camouflage create entry",data:{contentType:request.headers.get("content-type")??"",hasOrigin:Boolean(request.headers.get("origin"))},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
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

  const formData = await request.formData();
  const file = formData.get("file");
  const preset = String(formData.get("preset") ?? "medio") as CamouflagePreset;

  if (!(file instanceof File)) {
    return Response.json({ error: "Arquivo nao enviado." }, { status: 400 });
  }

  if (!["leve", "medio", "forte"].includes(preset)) {
    return Response.json({ error: "Preset invalido." }, { status: 400 });
  }

  try {
    const bytes = await file.arrayBuffer();
    const job = await createJob(file.name, preset, Buffer.from(bytes));
    // #region agent log
    fetch("http://127.0.0.1:7601/ingest/7c957bce-b281-426c-bb97-f528a3634ed5",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ec05a3"},body:JSON.stringify({sessionId:"ec05a3",runId:"precheck-1",hypothesisId:"H3",location:"app/api/camouflage/route.ts:70",message:"Camouflage job created",data:{jobId:job.id,preset,fileSizeBytes:bytes.byteLength},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return Response.json({ jobId: job.id, status: job.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao camuflar arquivo.";
    return Response.json({ error: message }, { status: 500 });
  }
}
