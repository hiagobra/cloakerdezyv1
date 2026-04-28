export function normalizePhone(rawPhone: string): string {
  const sanitized = rawPhone.replace(/[^\d+]/g, "").trim();
  if (!sanitized) {
    return "";
  }

  if (sanitized.startsWith("+")) {
    return `+${sanitized.slice(1).replace(/\D/g, "")}`;
  }

  if (sanitized.startsWith("00")) {
    return `+${sanitized.slice(2).replace(/\D/g, "")}`;
  }

  return `+${sanitized.replace(/\D/g, "")}`;
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{9,14}$/.test(phone);
}

export function maskPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  if (normalized.length < 8) {
    return normalized;
  }

  return `${normalized.slice(0, 4)}****${normalized.slice(-3)}`;
}
