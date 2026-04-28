import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isAdminEmail } from "@/lib/auth/admin";

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
  const pathname = request.nextUrl.pathname;
  const isAdminPath = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  const isProtected =
    isAdminPath ||
    pathname.startsWith("/dashboard") ||
    (pathname.startsWith("/api/camouflage") && !pathname.includes("/download"));

  try {
    const { response, supabase } = await updateSession(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const isLoggedIn = Boolean(user);

    if (isProtected && !isLoggedIn) {
      if (pathname.startsWith("/api/")) {
        return applySecurityHeaders(NextResponse.json({ error: "Nao autenticado." }, { status: 401 }));
      }

      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      return applySecurityHeaders(NextResponse.redirect(loginUrl));
    }

    if (isAdminPath && isLoggedIn && !isAdminEmail(user?.email)) {
      if (pathname.startsWith("/api/")) {
        return applySecurityHeaders(
          NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 }),
        );
      }
      const deniedUrl = request.nextUrl.clone();
      deniedUrl.pathname = "/access-denied";
      return applySecurityHeaders(NextResponse.redirect(deniedUrl));
    }

    if ((pathname === "/login" || pathname === "/register") && isLoggedIn) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = isAdminEmail(user?.email) ? "/admin" : "/dashboard";
      return applySecurityHeaders(NextResponse.redirect(redirectUrl));
    }

    return applySecurityHeaders(response);
  } catch {
    if (isProtected && pathname.startsWith("/api/")) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Servico de autenticacao indisponivel." }, { status: 503 }),
      );
    }

    return applySecurityHeaders(
      NextResponse.next({
        request: {
          headers: request.headers,
        },
      }),
    );
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
