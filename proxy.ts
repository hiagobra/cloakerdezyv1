import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const { response, supabase } = await updateSession(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoggedIn = Boolean(user);
  const isProtected =
    pathname.startsWith("/dashboard") ||
    (pathname.startsWith("/api/camouflage") && !pathname.includes("/download"));
  // #region agent log
  fetch("http://127.0.0.1:7601/ingest/7c957bce-b281-426c-bb97-f528a3634ed5",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"ec05a3"},body:JSON.stringify({sessionId:"ec05a3",runId:"precheck-1",hypothesisId:"H1",location:"proxy.ts:27",message:"Proxy auth decision",data:{pathname,isLoggedIn,isProtected,hasUser:Boolean(user)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (isProtected && !isLoggedIn) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(NextResponse.json({ error: "Nao autenticado." }, { status: 401 }));
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return applySecurityHeaders(NextResponse.redirect(loginUrl));
  }

  if (pathname === "/login" && isLoggedIn) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    return applySecurityHeaders(NextResponse.redirect(dashboardUrl));
  }

  return applySecurityHeaders(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

