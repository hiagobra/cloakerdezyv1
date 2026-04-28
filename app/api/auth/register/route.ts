import { createClient } from "@/lib/supabase/server";
import { isValidE164, normalizePhone } from "@/lib/auth/phone";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/request-guard";
import { persistProfile } from "@/lib/auth/profile";

type RegisterBody = {
  email?: string;
  password?: string;
  phone?: string;
};

function isAuthRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("rate limit") || lower.includes("too many requests");
}

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
    if (isAuthRateLimitError(signUpResult.error.message)) {
      return Response.json(
        {
          error:
            "Limite temporario de cadastro por email atingido. Aguarde 60 segundos e tente novamente.",
        },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    return Response.json({ error: signUpResult.error.message }, { status: 400 });
  }

  const signedUser = signUpResult.data.user;
  const signedSession = signUpResult.data.session;

  if (signedSession && signedUser) {
    await persistProfile(supabase, signedUser, { fallbackEmail: email, phone });
    return Response.json({ ok: true });
  }

  const signInResult = await supabase.auth.signInWithPassword({ email, password });
  if (signInResult.error) {
    if (isAuthRateLimitError(signInResult.error.message)) {
      return Response.json(
        {
          error:
            "Cadastro criado, mas o login automatico foi temporariamente limitado. Tente entrar em alguns segundos.",
        },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    return Response.json({ error: signInResult.error.message }, { status: 401 });
  }

  await persistProfile(supabase, signInResult.data.user, { fallbackEmail: email, phone });
  return Response.json({ ok: true });
}

