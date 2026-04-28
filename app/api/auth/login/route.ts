import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/auth/admin";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/request-guard";

type LoginBody = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: "Origem nao autorizada." }, { status: 403 });
  }

  const ip = getClientIp(request.headers);
  const rate = checkRateLimit(`auth:login:${ip}`, 8, 60_000);
  if (!rate.allowed) {
    return Response.json(
      { error: "Muitas tentativas de login. Aguarde alguns segundos." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const data = (await request.json().catch(() => null)) as LoginBody | null;
  if (!data) {
    return Response.json({ error: "Payload invalido." }, { status: 400 });
  }

  const email = String(data.email ?? "").trim().toLowerCase();
  const password = String(data.password ?? "");

  if (!email || !password) {
    return Response.json({ error: "Informe email e senha." }, { status: 400 });
  }

  const supabase = await createClient();
  const signInResult = await supabase.auth.signInWithPassword({ email, password });
  if (signInResult.error) {
    return Response.json({ error: signInResult.error.message }, { status: 401 });
  }

  const user = signInResult.data.user;
  if (!user) {
    return Response.json({ error: "Sessao invalida." }, { status: 401 });
  }

  const userEmail = user.email ?? email;

  if (isAdminEmail(userEmail)) {
    let admin;
    try {
      admin = createAdminClient();
    } catch {
      admin = null;
    }
    if (admin) {
      await admin
        .from("profiles")
        .update({
          status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: user.id,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", user.id);
    }
    return Response.json({ ok: true, role: "admin" });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    await supabase.auth.signOut();
    return Response.json({ error: profileError.message }, { status: 500 });
  }

  const status = profile?.status ?? "pending";

  if (status === "rejected") {
    await supabase.auth.signOut();
    return Response.json(
      { error: "Acesso negado para esta conta. Fale com o administrador." },
      { status: 403 },
    );
  }

  if (status !== "approved") {
    await supabase.auth.signOut();
    return Response.json(
      {
        error:
          "Cadastro pendente de aprovacao. Voce recebera acesso assim que o administrador liberar.",
      },
      { status: 403 },
    );
  }

  await supabase
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", user.id);

  return Response.json({ ok: true, role: "user" });
}
