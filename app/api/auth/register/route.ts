import { createClient } from "@/lib/supabase/server";
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

  const data = (await request.json()) as RegisterBody;
  const email = String(data.email ?? "").trim();
  const password = String(data.password ?? "");
  const phone = normalizePhone(String(data.phone ?? ""));

  if (!email || !password || !phone) {
    return Response.json({ error: "Informe email, senha e telefone." }, { status: 400 });
  }

  if (!isValidE164(phone)) {
    return Response.json(
      { error: "Telefone invalido. Use formato internacional, ex: +5511999999999." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const signUpResult = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        phone,
      },
    },
  });

  if (signUpResult.error) {
    return Response.json({ error: signUpResult.error.message }, { status: 400 });
  }

  const signInResult = await supabase.auth.signInWithPassword({ email, password });
  if (signInResult.error) {
    return Response.json({ error: signInResult.error.message }, { status: 401 });
  }

  const user = signInResult.data.user;
  if (user) {
    await supabase.from("profiles").upsert(
      {
        id: user.id,
        email: user.email ?? email,
        phone,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  }

  return Response.json({ ok: true });
}

