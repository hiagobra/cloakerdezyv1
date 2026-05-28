import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/request-guard";

const VALID_TYPES = ["video", "audio", "image", "metadata"] as const;
type CamouflageType = (typeof VALID_TYPES)[number];

function isValidType(value: unknown): value is CamouflageType {
  return typeof value === "string" && (VALID_TYPES as readonly string[]).includes(value);
}

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: "Origem nao autorizada." }, { status: 403 });
  }

  const clientIp = getClientIp(request.headers);
  const rate = checkRateLimit(`camouflage:track:${clientIp}`, 120, 60_000);
  if (!rate.allowed) {
    return Response.json(
      { error: "Muitas requisicoes." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Nao autenticado." }, { status: 401 });
  }

  let type: unknown;
  try {
    const body = (await request.json()) as { type?: unknown };
    type = body.type;
  } catch {
    return Response.json({ error: "Corpo invalido." }, { status: 400 });
  }

  if (!isValidType(type)) {
    return Response.json({ error: "Tipo invalido." }, { status: 400 });
  }

  const { error } = await supabase.from("camouflage_logs").insert({ user_id: user.id, type });
  if (error) {
    return Response.json({ error: "Falha ao registrar." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
