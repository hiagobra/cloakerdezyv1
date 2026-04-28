import { createAdminClient } from "@/lib/supabase/admin";
import { isValidE164, normalizePhone } from "@/lib/auth/phone";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/request-guard";

type RegisterBody = {
  email?: string;
  password?: string;
  phone?: string;
};

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: "Origem nao autorizada." }, { status: 403 });
  }

  const ip = getClientIp(request.headers);
  const rate = checkRateLimit(`auth:register:${ip}`, 5, 60_000);
  if (!rate.allowed) {
    return Response.json(
      { error: "Muitas tentativas de cadastro. Aguarde alguns segundos." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const data = (await request.json().catch(() => null)) as RegisterBody | null;
  if (!data) {
    return Response.json({ error: "Payload invalido." }, { status: 400 });
  }

  const email = String(data.email ?? "").trim().toLowerCase();
  const password = String(data.password ?? "");
  const phone = normalizePhone(String(data.phone ?? ""));

  if (!email || !password || !phone) {
    return Response.json({ error: "Informe email, senha e telefone." }, { status: 400 });
  }

  if (password.length < 8) {
    return Response.json({ error: "A senha precisa ter pelo menos 8 caracteres." }, { status: 400 });
  }

  if (!isValidE164(phone)) {
    return Response.json(
      { error: "Telefone invalido. Use formato internacional, ex: +5511999999999." },
      { status: 400 },
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Service Role indisponivel.";
    return Response.json({ error: message }, { status: 500 });
  }

  const createResult = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { phone },
  });

  if (createResult.error || !createResult.data.user) {
    const message = createResult.error?.message ?? "Falha ao criar usuario.";
    const lower = message.toLowerCase();
    if (lower.includes("already registered") || lower.includes("duplicate")) {
      return Response.json(
        { error: "Ja existe um cadastro com este email." },
        { status: 409 },
      );
    }
    return Response.json({ error: message }, { status: 400 });
  }

  const user = createResult.data.user;

  const { error: profileError } = await admin
    .from("profiles")
    .upsert(
      {
        id: user.id,
        email: user.email ?? email,
        phone,
        status: "pending",
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

  if (profileError) {
    return Response.json({ error: profileError.message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    status: "pending",
    message:
      "Cadastro recebido. Voce podera entrar assim que o administrador aprovar o acesso.",
  });
}
