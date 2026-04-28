import { createHmac, timingSafeEqual } from "node:crypto";

type SessionPayload = {
  email: string;
  exp: number;
};

const SESSION_COOKIE_NAME = "cdz_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function getSessionSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET ?? "dev-only-secret-change-in-production";
  if (process.env.NODE_ENV === "production" && secret === "dev-only-secret-change-in-production") {
    throw new Error("AUTH_SESSION_SECRET obrigatorio em producao.");
  }
  return secret;
}

function toBase64Url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(content: string): string {
  return createHmac("sha256", getSessionSecret()).update(content).digest("base64url");
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export function createSessionToken(email: string): string {
  const payload: SessionPayload = {
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [encodedPayload, givenSignature] = token.split(".");
  if (!encodedPayload || !givenSignature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);
  if (Buffer.byteLength(givenSignature) !== Buffer.byteLength(expectedSignature)) {
    return null;
  }
  const safe = timingSafeEqual(Buffer.from(givenSignature), Buffer.from(expectedSignature));

  if (!safe) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as SessionPayload;
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

