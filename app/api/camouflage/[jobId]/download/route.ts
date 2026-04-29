import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { getJobForUser } from "@/lib/camouflage/job-store";
import { verifyDownloadToken } from "@/lib/security/download-token";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";

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
  const clientIp = getClientIp(request.headers);
  const rate = checkRateLimit(`camouflage:download:${clientIp}`, 30, 60_000);
  if (!rate.allowed) {
    return Response.json(
      { error: "Muitas requisicoes de download." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const { jobId } = await context.params;
  const token = new URL(request.url).searchParams.get("token") ?? undefined;

  if (!verifyDownloadToken(token, jobId)) {
    return Response.json({ error: "Token de download invalido ou expirado." }, { status: 403 });
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return Response.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const job = await getJobForUser(jobId, userId);
  if (!job || job.status !== "done" || !job.outputPath) {
    return Response.json({ error: "Arquivo indisponivel." }, { status: 404 });
  }

  const outputBuffer = await fs.readFile(job.outputPath);
  const outputName = path.basename(job.outputPath);
  const contentType = getContentType(job.outputPath);

  return new Response(outputBuffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${outputName}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
