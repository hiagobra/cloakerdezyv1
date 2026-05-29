import { createClient } from "@/lib/supabase/server";
import { isTrustedOrigin } from "@/lib/security/request-guard";
import { removeJobFiles } from "@/lib/camouflage/server/storage";
import { mapJobRow, JOB_SELECT_COLUMNS, type JobRow } from "@/lib/camouflage/jobs-config";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Status de um job (poll). RLS garante que so o dono enxerga. */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
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
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return Response.json({ error: "Falha ao consultar o job." }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Job nao encontrado." }, { status: 404 });
  }

  return Response.json({ job: mapJobRow(data as JobRow) });
}

/** Remove um job (linha + arquivos no disco). */
export async function DELETE(request: Request, context: RouteContext) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: "Origem nao autorizada." }, { status: 403 });
  }
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Nao autenticado." }, { status: 401 });
  }

  // RLS so deixa deletar os proprios; .select confirma se algo foi removido.
  const { data, error } = await supabase
    .from("camouflage_jobs")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    return Response.json({ error: "Falha ao remover o job." }, { status: 500 });
  }
  if (data) {
    await removeJobFiles(id);
  }
  return Response.json({ ok: true });
}
