import { createClient } from "@/lib/supabase/server";
import { isTrustedOrigin } from "@/lib/security/request-guard";

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: "Origem nao autorizada." }, { status: 403 });
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  return Response.json({ ok: true });
}

