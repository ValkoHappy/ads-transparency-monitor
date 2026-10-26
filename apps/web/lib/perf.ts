type PerfMeta = Record<string, unknown>;

const DEFAULT_SLOW_MS = 250;
const MAX_STRING_LENGTH = 220;

const SECRET_KEY_PATTERN = /(authorization|cookie|token|secret|password|proxy|database|dsn|url)$/i;

export async function timeAsync<T>(
  label: string,
  callback: () => Promise<T>,
  meta: PerfMeta = {},
  options: { thresholdMs?: number; always?: boolean } = {}
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await callback();
    const durationMs = Math.round(performance.now() - startedAt);
    if (options.always || durationMs >= (options.thresholdMs ?? DEFAULT_SLOW_MS)) {
      logPerf("server", { label, status: "ok", durationMs, ...meta });
    }
    return result;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    logPerf("server", {
      label,
      status: "error",
      durationMs,
      error: error instanceof Error ? safeString(error.message) : "unknown",
      ...meta
    });
    throw error;
  }
}

export function logPerf(source: "server" | "client", payload: PerfMeta) {
  const safePayload = sanitizePayload({
    ts: new Date().toISOString(),
    source,
    ...payload
  });
  const line = JSON.stringify(safePayload);
  if (source === "client") {
    console.log(`[client-perf] ${line}`);
  } else {
    console.log(`[web-perf] ${line}`);
  }
}

export function requestMeta(request: Request): PerfMeta {
  const url = new URL(request.url);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const userAgent = request.headers.get("user-agent") ?? "";
  const referer = request.headers.get("referer") ?? "";
  return {
    method: request.method,
    path: url.pathname,
    hasQuery: url.searchParams.size > 0,
    rsc: url.searchParams.has("_rsc"),
    ip: forwarded || realIp || "unknown",
    userAgent: safeString(userAgent, 160),
    referer: safePath(referer)
  };
}

export function filterMeta(params?: Record<string, unknown>): PerfMeta {
  const q = typeof params?.q === "string" ? params.q : "";
  return {
    advertiserId: safeString(params?.advertiserId),
    country: safeString(params?.country),
    status: safeString(params?.status),
    format: safeString(params?.format),
    store: safeString(params?.store),
    appId: safeString(params?.appId),
    activity: safeString(params?.activity),
    dateField: safeString(params?.dateField),
    hasQ: q.length > 0,
    qLength: q.length,
    hasDateFrom: Boolean(params?.dateFrom),
    hasDateTo: Boolean(params?.dateTo),
    page: safeNumber(params?.page),
    take: safeNumber(params?.take)
  };
}

export function sanitizeClientPerf(input: unknown): PerfMeta {
  if (!input || typeof input !== "object") return {};
  const data = input as Record<string, unknown>;
  return {
    event: safeString(data.event),
    from: safePath(data.from),
    to: safePath(data.to),
    reason: safeString(data.reason),
    durationMs: safeNumber(data.durationMs),
    pendingMs: safeNumber(data.pendingMs),
    visibilityState: safeString(data.visibilityState),
    viewport: sanitizePayload(data.viewport),
    connection: sanitizePayload(data.connection)
  };
}

function sanitizePayload(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return safeString(value);
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizePayload);
  if (typeof value !== "object") return String(value);

  const result: PerfMeta = {};
  for (const [key, item] of Object.entries(value as PerfMeta).slice(0, 40)) {
    result[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : sanitizePayload(item);
  }
  return result;
}

function safeString(value: unknown, maxLength = MAX_STRING_LENGTH) {
  if (value === null || value === undefined) return undefined;
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function safeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : undefined;
}

function safePath(value: unknown) {
  const text = safeString(value, 500);
  if (!text) return undefined;
  try {
    const url = new URL(text, "http://local");
    return `${url.pathname}${url.search ? sanitizeSearch(url.search) : ""}`;
  } catch {
    return text.startsWith("/") ? text.slice(0, 500) : undefined;
  }
}

function sanitizeSearch(search: string) {
  const params = new URLSearchParams(search);
  for (const key of Array.from(params.keys())) {
    if (SECRET_KEY_PATTERN.test(key)) {
      params.set(key, "[redacted]");
    } else {
      const value = params.get(key);
      if (value && value.length > 80) params.set(key, `${value.slice(0, 80)}...`);
    }
  }
  const output = params.toString();
  return output ? `?${output}` : "";
}
