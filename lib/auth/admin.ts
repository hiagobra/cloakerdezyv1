import { normalizePhone } from "@/lib/auth/phone";

const ADMIN_PHONES_ENV = process.env.ADMIN_ALLOWED_PHONES ?? "";

export function getAdminPhones(): string[] {
  return ADMIN_PHONES_ENV.split(",")
    .map((phone) => normalizePhone(phone))
    .filter(Boolean);
}

export function isAdminPhone(phone?: string | null): boolean {
  if (!phone) {
    return false;
  }

  const normalized = normalizePhone(phone);
  return getAdminPhones().includes(normalized);
}
