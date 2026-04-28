import { createHmac, timingSafeEqual } from "node:crypto";

type DownloadTokenPayload = {
  jobId: string;
  exp: number;
};

function getDownloadSecret(): string {
  const secret = process.env.DOWNLOAD_TOKEN_SECRET ?? "dev-download-secret-change-in-production";
  if (process.env.NODE_ENV === "production" && secret === "dev-download-secret-change-in-production") {
    throw new Error("DOWNLOAD_TOKEN_SECRET obrigatorio em producao.");
  }
  return secret;
}

function sign(content: string): string {
  return createHmac("sha256", getDownloadSecret()).update(content).digest("base64url");
}

export function createDownloadToken(jobId: string, ttlSeconds = 60 * 15): string {
  const payload: DownloadTokenPayload = {
    jobId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(body);
  return `${body}.${signature}`;
}

export function verifyDownloadToken(token: string | undefined, expectedJobId: string): boolean {
  if (!token) {
    return false;
  }

  const [body, givenSignature] = token.split(".");
  if (!body || !givenSignature) {
    return false;
  }

  const expectedSignature = sign(body);
  if (Buffer.byteLength(givenSignature) !== Buffer.byteLength(expectedSignature)) {
    return false;
  }

  const isValidSignature = timingSafeEqual(Buffer.from(givenSignature), Buffer.from(expectedSignature));
  if (!isValidSignature) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as DownloadTokenPayload;
    if (payload.jobId !== expectedJobId) {
      return false;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

