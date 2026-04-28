import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/request-guard";

type LoginBody = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  // #region agent log
  fetch("http://127.0.0.1:7601/ingest/7c957bce-b281-426c-bb97-f528a3634ed5",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ec05a3"},body:JSON.stringify({sessionId:"ec05a3",runId:"precheck-1",hypothesisId:"H2",location:"app/api/auth/login/route.ts:12",message:"Login route entry",data:{hasOrigin:Boolean(request.headers.get("origin")),hasHost:Boolean(request.headers.get("host"))},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
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
  // #region agent log
  fetch("http://127.0.0.1:7601/ingest/7c957bce-b281-426c-bb97-f528a3634ed5",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ec05a3"},body:JSON.stringify({sessionId:"ec05a3",runId:"precheck-1",hypothesisId:"H2",location:"app/api/auth/login/route.ts:31",message:"Login payload parsed",data:{emailLength:email.length,hasPassword:Boolean(password),ip},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (!email || !password) {
    return Response.json({ error: "Informe email e senha." }, { status: 400 });
  }

  const supabase = await createClient();
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
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  }
  // #region agent log
  fetch("http://127.0.0.1:7601/ingest/7c957bce-b281-426c-bb97-f528a3634ed5",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ec05a3"},body:JSON.stringify({sessionId:"ec05a3",runId:"precheck-1",hypothesisId:"H2",location:"app/api/auth/login/route.ts:47",message:"Login success response",data:{sessionEstablished:true},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return Response.json({ ok: true });
}

