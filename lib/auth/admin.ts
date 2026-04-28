const FALLBACK_ADMIN_EMAILS = "hiagobrambatti@gmail.com";

function readAdminEmailsFromEnv(): string[] {
  const raw = process.env.ADMIN_ALLOWED_EMAILS ?? FALLBACK_ADMIN_EMAILS;
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function getAdminEmails(): string[] {
  return readAdminEmailsFromEnv();
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) {
    return false;
  }

  return getAdminEmails().includes(email.trim().toLowerCase());
}
