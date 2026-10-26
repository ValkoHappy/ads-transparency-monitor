import { type ParsedSearchCreatives } from "@ad-monitor/core";

export function resolvePreviewWaitConfig() {
  const strictPreview = process.env.GOOGLE_BROWSER_PREVIEW_STRICT === "true";
  return {
    strictPreview,
    maxChecks: readPositiveIntegerEnv(
      "GOOGLE_BROWSER_PREVIEW_MAX_CHECKS",
      strictPreview ? 240 : 80,
    ),
    staleChecks: readPositiveIntegerEnv(
      "GOOGLE_BROWSER_PREVIEW_STALE_CHECKS",
      strictPreview ? 75 : 20,
    ),
  };
}

export function resolveEconomyClearBatch() {
  return Math.max(
    1,
    Math.min(
      50,
      readPositiveIntegerEnv("GOOGLE_BROWSER_ECONOMY_CLEAR_BATCH", 20),
    ),
  );
}

export function registerSearchPageCreativeIds(
  creatives: ParsedSearchCreatives["creatives"],
  seenIds: Set<string>,
) {
  const ids = uniqueStrings(
    creatives.map((item) => item.creativeId).filter(Boolean),
  );
  const newIds = ids.filter((creativeId) => !seenIds.has(creativeId));
  if (newIds.length > 0) {
    for (const creativeId of ids) seenIds.add(creativeId);
  }
  return { ids, newIds };
}

export function shouldCollectBrowserDetail() {
  return process.env.GOOGLE_BROWSER_COLLECT_DETAIL !== "false";
}

export function shouldUseBrowserNativeResumeRpc(pageToken?: string) {
  return (
    Boolean(pageToken) &&
    pageToken !== "browser-native-dom-scroll" &&
    process.env.GOOGLE_BROWSER_RESUME_RPC === "true"
  );
}

export function resolveBrowserNativeDetailDelayMs() {
  const envDetailDelay = Number(process.env.GOOGLE_BROWSER_DETAIL_DELAY_MS);
  if (Number.isFinite(envDetailDelay) && envDetailDelay > 0)
    return Math.round(envDetailDelay);
  return 8_000;
}

export function delay(ms: number) {
  return ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();
}

export function uniqueStrings(values: Array<string | undefined | null>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timer));
  });
}

export function withRejectTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function isTimeoutLikeMessage(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("err_timed_out")
  );
}

export function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

export function readNonNegativeIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

export function isBlockedDetailError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.startsWith("blocked:") ||
    message.includes(":403") ||
    message.includes(":429")
  );
}
