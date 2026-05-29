import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { createClient } from "@/lib/supabase/server";
import { fileExists } from "@/lib/camouflage/server/storage";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

function contentTypeFor(name: string): string {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Stream do output de um job concluido (somente o dono). */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Nao autenticado." }, { status: 401 });
  }

  // RLS restringe ao dono; selecionamos os campos sensiveis de path aqui.
  const { data, error } = await supabase
    .from("camouflage_jobs")
    .select("status, output_path, output_name")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return Response.json({ error: "Falha ao consultar o job." }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Job nao encontrado." }, { status: 404 });
  }
  if (data.status !== "done" || !data.output_path) {
    return Response.json({ error: "Resultado ainda nao disponivel." }, { status: 409 });
  }
  if (!(await fileExists(data.output_path))) {
    return Response.json({ error: "Arquivo de saida nao encontrado." }, { status: 410 });
  }

  const outputName = data.output_name ?? "camuflado";
  const info = await stat(data.output_path);
  const nodeStream = createReadStream(data.output_path);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(outputName),
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${outputName.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
