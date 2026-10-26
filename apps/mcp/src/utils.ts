import type { Prisma } from "@ad-monitor/db";
import { sanitizeOperationalMessage } from "@ad-monitor/db";

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const MAX_SNAPSHOT_LIMIT = 100;
export const ACTIVE_STATUS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const ACTIVE_FOUND_WINDOW_MS = 24 * 60 * 60 * 1000;

export function toPage(inputPage?: number, inputLimit?: number) {
  const page = Number.isFinite(inputPage) && inputPage && inputPage > 0 ? Math.floor(inputPage) : DEFAULT_PAGE;
  const limit = Number.isFinite(inputLimit) && inputLimit && inputLimit > 0
    ? Math.min(MAX_LIMIT, Math.floor(inputLimit))
    : DEFAULT_LIMIT;
  return {
    page,
    limit,
    skip: (page - 1) * limit
  };
}

export function toLimitedTake(inputLimit?: number, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  if (!Number.isFinite(inputLimit) || !inputLimit || inputLimit <= 0) return fallback;
  return Math.min(max, Math.floor(inputLimit));
}

export function textToolResult(summary: string, structuredContent: unknown) {
  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent: serialize(structuredContent)
  };
}

export function serialize<T>(value: T): T {
  return serializeValue(value) as T;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(serializeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, serializeValue(entry)])
  );
}

export function toolError(error: unknown) {
  const message = sanitizeOperationalMessage(error instanceof Error ? error.message : String(error));
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true
  };
}

export function maskProxyUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = url.username ? "***" : "";
      url.password = url.password ? "***" : "";
    }
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:@]+):([^@]+)@/, "://***:***@");
  }
}

export function normalizeProxyUrl(value: string) {
  const text = value.trim();
  if (!text) return "";
  const compactWithScheme = normalizeSchemeCompactProxyUrl(text);
  if (compactWithScheme) return compactWithScheme;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return normalizeExplicitProxyUrl(text);

  const parts = text.split(":");
  if (parts.length >= 4) {
    const [host, port, username, ...passwordParts] = parts;
    return normalizeExplicitProxyUrl(`socks5://${encodeURIComponent(username)}:${encodeURIComponent(passwordParts.join(":"))}@${host}:${port}`);
  }

  return normalizeExplicitProxyUrl(`http://${text}`);
}

export function normalizeProxyList(values: string[]) {
  return [...new Set(values.map(normalizeProxyUrl).filter(Boolean))];
}

function normalizeSchemeCompactProxyUrl(value: string) {
  const match = value.match(/^(socks5h?|https?):\/\/([^/:@]+):(\d+):([^:]+):(.+)$/i);
  if (!match) return "";
  const [, protocol, host, port, username, password] = match;
  return normalizeExplicitProxyUrl(`${protocol.toLowerCase()}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`);
}

function normalizeExplicitProxyUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:", "socks5:", "socks5h:"].includes(url.protocol)) return "";
    if (!url.hostname) return "";
    if (url.port) {
      const port = Number(url.port);
      if (!Number.isInteger(port) || port <= 0 || port > 65_535) return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function normalizeCountryCodes(input: unknown) {
  const values = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,\s]+/)
      : [];

  const seen = new Set<string>();
  const countries: string[] = [];
  for (const value of values) {
    const code = String(value).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    countries.push(code);
    if (countries.length >= 300) break;
  }
  return countries;
}

export function normalizeDateInput(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : undefined;
}

export function boundedInt(value: unknown, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function nullableBoundedInt(value: unknown, min: number, max: number) {
  if (value === null || value === "") return null;
  return boundedInt(value, min, max);
}

export function parseScanMode(value: unknown): "FAST" | "FULL" | "CAUTIOUS" | undefined {
  return value === "FAST" || value === "FULL" || value === "CAUTIOUS" ? value : undefined;
}

export function parseScheduleType(value: unknown) {
  return value === "DAILY" || value === "MULTIPLE" || value === "INTERVAL" ? value : undefined;
}

export function normalizeHours(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const hours = value.map(Number).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  return [...new Set(hours)].sort((a, b) => a - b);
}

export function computeCreativeStatus(lastShownAt: Date | null | undefined, lastFoundAt?: Date | null) {
  if (lastFoundAt && Date.now() - lastFoundAt.getTime() <= ACTIVE_FOUND_WINDOW_MS) return "ACTIVE" as const;
  if (!lastShownAt) return "UNKNOWN" as const;
  return Date.now() - lastShownAt.getTime() <= ACTIVE_STATUS_WINDOW_MS ? "ACTIVE" as const : "STOPPED" as const;
}

export function mapSortDirection(direction?: "asc" | "desc") {
  return direction === "asc" ? "asc" : "desc";
}

export function rawSnapshotCountSelect() {
  return {
    _count: {
      select: {
        rawSnapshots: true,
        countries: true,
        assets: true
      }
    }
  } satisfies Prisma.CreativeSelect;
}
