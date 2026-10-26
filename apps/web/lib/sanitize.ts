import { sanitizeOperationalMessage } from "@ad-monitor/db";

const SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "setcookie",
  "token",
  "secret",
  "password",
  "passwd",
  "proxyauthorization",
  "xgoogauthuser",
  "xclientdata",
  "apikey"
];

export function sanitizePublicValue<T>(value: T): T {
  return sanitizePublicEntry(undefined, value);
}

function sanitizePublicEntry<T>(key: string | undefined, value: T): T {
  if (key && isSensitiveKey(key)) return "[redacted]" as T;
  if (typeof value === "string") return sanitizeOperationalMessage(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizePublicEntry(undefined, item)) as T;
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entry]) => [entryKey, sanitizePublicEntry(entryKey, entry)])
  ) as T;
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive));
}

export function sanitizeScanEvent<T extends { message?: string | null; data?: unknown }>(event: T): T {
  return {
    ...event,
    message: event.message ? sanitizeOperationalMessage(event.message) : event.message,
    data: sanitizePublicValue(event.data)
  };
}
