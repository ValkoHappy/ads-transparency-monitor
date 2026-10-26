import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export type BrowserNativePageState = "normal" | "captcha" | "blocked" | "timeout" | "empty";
export type BrowserNativeErrorKind = "CHALLENGE_REQUIRED" | "TIMEOUT" | "BLOCKED" | "FAILED" | "PROFILE_LOCKED";

const PROFILE_LEASE_FILE = ".lease.json";
const PROFILE_SINGLETON_ARTIFACTS = [
  "SingletonLock",
  "SingletonSocket",
  "SingletonCookie",
  "lockfile",
  ".org.chromium.Chromium.*"
];

type BrowserProfileLease = {
  pid: number;
  acquiredAt: string;
  profileDir: string;
};

let lastProfileSweepAt = 0;

export function browserNativeProfileBaseDir() {
  const base = process.env.GOOGLE_BROWSER_PROFILE_DIR ?? ".google-browser-profiles";
  return path.resolve(process.cwd(), base);
}

export function browserNativeProfileDir(proxyUrl?: string, profileKey?: string) {
  const base = browserNativeProfileBaseDir();
  const proxyKey = proxyUrl ? createHash("sha256").update(proxyUrl).digest("hex").slice(0, 16) : "direct";
  const safeProfileKey = profileKey?.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
  const key = safeProfileKey ? `${safeProfileKey}-${proxyKey}` : proxyKey;
  return path.resolve(base, key);
}

export function classifyBrowserNativeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  if (isBrowserProfileLockError(error)) return "PROFILE_LOCKED" as const;
  if (message.startsWith("browser-native:challenge:")) return "CHALLENGE_REQUIRED" as const;
  if (message.startsWith("browser-native:timeout:")) return "TIMEOUT" as const;
  if (message === "browser-native:no-search-results") return "FAILED" as const;
  if (message === "browser-native:empty-search-page") return "FAILED" as const;
  if (
    message.includes("net::ERR_TIMED_OUT") ||
    message.includes("net::ERR_TUNNEL_CONNECTION_FAILED") ||
    message.includes("net::ERR_PROXY_CONNECTION_FAILED") ||
    message.includes("net::ERR_SOCKS_CONNECTION_FAILED")
  ) {
    return "TIMEOUT" as const;
  }
  if (lowerMessage.includes("target crashed")) {
    return "TIMEOUT" as const;
  }
  if (
    lowerMessage.includes("target closed") ||
    lowerMessage.includes("target page, context or browser has been closed")
  ) {
    return "TIMEOUT" as const;
  }
  if (message.startsWith("browser-native:preview-incomplete:")) return "FAILED" as const;
  if (message.startsWith("blocked:")) return "BLOCKED" as const;
  return "FAILED" as const;
}

export function isBrowserProfileLockError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  return lowerMessage.includes("processsingleton")
    || lowerMessage.includes("singletonlock")
    || lowerMessage.includes("profile directory")
    || message.startsWith("browser-native:profile-locked:");
}

export function shouldContinueBackgroundDetailAfterError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "browser-native:no-search-results") return false;
  if (message === "browser-native:empty-search-page") return false;
  return classifyBrowserNativeError(error) === "FAILED";
}

export function classifyChallengeText(input: string) {
  const text = input.toLowerCase();
  if (
    text.includes("unusual traffic") ||
    text.includes("our systems have detected") ||
    text.includes("recaptcha") ||
    text.includes("captcha") ||
    text.includes("ik ben geen robot") ||
    text.includes("ongebruikelijk verkeer") ||
    text.includes("uw computernetwerk vastgesteld") ||
    text.includes("verify you are human") ||
    text.includes("подтвердите, что вы не робот") ||
    text.includes("необычный трафик")
  ) {
    return "captcha" as const;
  }
  if (
    text.includes("access denied") ||
    text.includes("request blocked") ||
    text.includes("temporarily unavailable") ||
    text.includes("too many requests")
  ) {
    return "blocked" as const;
  }
  return "normal" as const;
}

export function dedupeBrowserItems<T>(
  items: T[],
  getKey: (item: T) => { creativeId?: string | null; creativeUrl?: string | null; appId?: string | null; store?: string | null }
) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const keyData = getKey(item);
    const key = keyData.creativeId
      ? `creative:${keyData.creativeId}`
      : `fallback:${keyData.creativeUrl ?? ""}:${keyData.appId ?? ""}:${keyData.store ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export async function cleanupStaleBrowserProfiles(options?: { now?: number; ttlMs?: number }) {
  const now = options?.now ?? Date.now();
  const ttlMs = options?.ttlMs ?? readPositiveIntegerEnv("GOOGLE_BROWSER_PROFILE_TTL_MS", 12 * 60 * 60 * 1000);
  if (now - lastProfileSweepAt < 60_000) return;
  lastProfileSweepAt = now;

  const baseDir = browserNativeProfileBaseDir();
  await mkdir(baseDir, { recursive: true });

  const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const profileDir = path.join(baseDir, entry.name);
    const leasePath = browserNativeLeasePath(profileDir);
    const lease = await readBrowserProfileLease(profileDir);
    if (lease && isLeasePidAlive(lease.pid)) continue;
    const info = await stat(profileDir).catch(() => null);
    if (!info) continue;
    if (now - info.mtimeMs < ttlMs) continue;
    await rm(leasePath, { force: true }).catch(() => undefined);
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function prepareBrowserProfileDir(profileDir: string) {
  await mkdir(profileDir, { recursive: true });
  const lease = await readBrowserProfileLease(profileDir);
  if (lease && isLeasePidAlive(lease.pid)) {
    throw new Error(`browser-native:profile-locked:${profileDir}`);
  }
  await rm(browserNativeLeasePath(profileDir), { force: true }).catch(() => undefined);
  await removeBrowserSingletonArtifacts(profileDir);
  await acquireBrowserProfileLease(profileDir);
}

export async function releaseBrowserProfileDir(profileDir: string, options?: { removeDir?: boolean }) {
  await rm(browserNativeLeasePath(profileDir), { force: true }).catch(() => undefined);
  await removeBrowserSingletonArtifacts(profileDir);
  if (options?.removeDir !== false) {
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function removeBrowserSingletonArtifacts(profileDir: string) {
  for (const name of PROFILE_SINGLETON_ARTIFACTS) {
    await rm(path.join(profileDir, name), { recursive: true, force: true }).catch(() => undefined);
  }
}

async function acquireBrowserProfileLease(profileDir: string) {
  const leasePath = browserNativeLeasePath(profileDir);
  const payload: BrowserProfileLease = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    profileDir
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(leasePath, "wx");
      try {
        await handle.writeFile(JSON.stringify(payload), "utf8");
      } finally {
        await handle.close();
      }
      return;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
      if (code !== "EEXIST") throw error;
      const existing = await readBrowserProfileLease(profileDir);
      if (existing && isLeasePidAlive(existing.pid)) {
        throw new Error(`browser-native:profile-locked:${profileDir}`);
      }
      await rm(leasePath, { force: true }).catch(() => undefined);
    }
  }
  throw new Error(`browser-native:profile-locked:${profileDir}`);
}

function browserNativeLeasePath(profileDir: string) {
  return path.join(profileDir, PROFILE_LEASE_FILE);
}

async function readBrowserProfileLease(profileDir: string) {
  try {
    const raw = await readFile(browserNativeLeasePath(profileDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<BrowserProfileLease>;
    return typeof parsed.pid === "number" && Number.isInteger(parsed.pid) ? parsed as BrowserProfileLease : null;
  } catch {
    return null;
  }
}

function isLeasePidAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? "");
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
