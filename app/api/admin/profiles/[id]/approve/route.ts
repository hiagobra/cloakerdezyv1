import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/auth/admin";
import { isTrustedOrigin } from "@/lib/security/request-guard";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: "Origem nao autorizada." }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return Response.json({ error: "Acesso restrito ao administrador." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!id) {
    return Response.json({ error: "Perfil invalido." }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Service Role indisponivel.";
    return Response.json({ error: message }, { status: 500 });
  }

  const approvedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("profiles")
    .update({
      status: "approved",
      approved_at: approvedAt,
      approved_by: user.id,
    })
    .eq("id", id)
    .select("id, status, approved_at")
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Perfil nao encontrado." }, { status: 404 });
  }

  return Response.json({
    ok: true,
    profile: {
      id: data.id,
      status: data.status,
      approvedAt: data.approved_at,
    },
  });
}
