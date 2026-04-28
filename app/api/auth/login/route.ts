import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/request-guard";
import { persistProfile } from "@/lib/auth/profile";

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

  const data = (await request.json()) as LoginBody;
  const email = String(data.email ?? "").trim();
  const password = String(data.password ?? "");

  if (!email || !password) {
    return Response.json({ error: "Informe email e senha." }, { status: 400 });
  }

  const supabase = await createClient();
  const signInResult = await supabase.auth.signInWithPassword({ email, password });
  if (signInResult.error) {
    return Response.json({ error: signInResult.error.message }, { status: 401 });
  }

  await persistProfile(supabase, signInResult.data.user, { fallbackEmail: email });
  return Response.json({ ok: true });
}

