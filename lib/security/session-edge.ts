type SessionPayload = {
  email: string;
  exp: number;
};

const SESSION_COOKIE_NAME = "cdz_session";

function getSessionSecret(): string {
  return process.env.AUTH_SESSION_SECRET ?? "dev-only-secret-change-in-production";
}

async function sign(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(content));
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function getSessionCookieNameEdge(): string {
  return SESSION_COOKIE_NAME;
}

export async function verifySessionTokenEdge(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) {
    return null;
  }

  const [encodedPayload, givenSignature] = token.split(".");
  if (!encodedPayload || !givenSignature) {
    return null;
  }

  const expectedSignature = await sign(encodedPayload);
  if (!timingSafeCompare(givenSignature, expectedSignature)) {
    return null;
  }

  try {
    const normalized = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = atob(padded);
    const payload = JSON.parse(decoded) as SessionPayload;
    if (!payload.email || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

