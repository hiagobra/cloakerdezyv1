import { promises as fs } from "node:fs";
import path from "node:path";
import { getJob } from "@/lib/camouflage/job-store";
import { verifyDownloadToken } from "@/lib/security/download-token";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".avi") return "video/x-msvideo";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".ogg") return "audio/ogg";
  return "application/octet-stream";
}

export async function GET(request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const token = new URL(request.url).searchParams.get("token") ?? undefined;
  // #region agent log
  fetch("http://127.0.0.1:7601/ingest/7c957bce-b281-426c-bb97-f528a3634ed5",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ec05a3"},body:JSON.stringify({sessionId:"ec05a3",runId:"precheck-1",hypothesisId:"H5",location:"app/api/camouflage/[jobId]/download/route.ts:30",message:"Download request received",data:{jobId,hasToken:Boolean(token)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (!verifyDownloadToken(token, jobId)) {
    return Response.json({ error: "Token de download invalido ou expirado." }, { status: 403 });
  }

  const job = await getJob(jobId);
  if (!job || job.status !== "done" || !job.outputPath) {
    return Response.json({ error: "Arquivo indisponivel." }, { status: 404 });
  }

  const outputBuffer = await fs.readFile(job.outputPath);
  const outputName = path.basename(job.outputPath);
  const contentType = getContentType(job.outputPath);
  // #region agent log
  fetch("http://127.0.0.1:7601/ingest/7c957bce-b281-426c-bb97-f528a3634ed5",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ec05a3"},body:JSON.stringify({sessionId:"ec05a3",runId:"precheck-1",hypothesisId:"H5",location:"app/api/camouflage/[jobId]/download/route.ts:44",message:"Download response sent",data:{jobId,outputName,contentType,sizeBytes:outputBuffer.byteLength},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  return new Response(outputBuffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${outputName}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}

