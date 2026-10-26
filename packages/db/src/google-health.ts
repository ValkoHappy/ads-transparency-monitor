import { prisma as defaultPrisma } from "./prisma.js";
import { errorMessage } from "./sanitize.js";

type DbClient = typeof defaultPrisma;

export const BACKOFF_STEPS_MS = [
  15 * 60 * 1000,
  45 * 60 * 1000,
  2 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000
] as const;

export function isGoogleBlockedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("blocked:") || message.includes(":429") || message.includes(":403") || message.includes(" 429") || message.includes(" 403");
}

export function backoffDelayMs(consecutiveBlocks: number, random = Math.random()) {
  const base = BACKOFF_STEPS_MS[Math.min(Math.max(consecutiveBlocks - 1, 0), BACKOFF_STEPS_MS.length - 1)];
  const jitter = 1 + 0.1 + Math.max(0, Math.min(1, random)) * 0.2;
  return Math.round(base * jitter);
}

export async function getGoogleHealth(db: DbClient = defaultPrisma) {
  return db.googleHealth.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {}
  });
}

export async function markGoogleBlocked(error: unknown, db: DbClient = defaultPrisma, now = new Date()) {
  const current = await getGoogleHealth(db);
  const consecutiveBlocks = current.consecutiveBlocks + 1;
  const blockedUntil = new Date(now.getTime() + backoffDelayMs(consecutiveBlocks));
  return db.googleHealth.update({
    where: { id: "default" },
    data: {
      status: "BLOCKED",
      consecutiveBlocks,
      blockedUntil,
      lastError: errorMessage(error),
      lastProbeAt: now
    }
  });
}

export async function markGoogleProbeStarted(db: DbClient = defaultPrisma, now = new Date()) {
  return db.googleHealth.upsert({
    where: { id: "default" },
    create: { id: "default", status: "PROBING", lastProbeAt: now },
    update: { status: "PROBING", lastProbeAt: now }
  });
}

export async function markGoogleOk(db: DbClient = defaultPrisma, now = new Date()) {
  return db.googleHealth.upsert({
    where: { id: "default" },
    create: { id: "default", status: "OK", lastSuccessAt: now, consecutiveBlocks: 0, lastError: null, blockedUntil: null },
    update: { status: "OK", lastSuccessAt: now, consecutiveBlocks: 0, lastError: null, blockedUntil: null }
  });
}

export function shouldProbeGoogle(health: { status: string; blockedUntil: Date | null; lastProbeAt: Date | null }, probeIntervalMs: number, now = new Date()) {
  if (health.status !== "BLOCKED") return false;
  if (health.blockedUntil && health.blockedUntil > now) return false;
  if (health.blockedUntil && health.blockedUntil <= now) return true;
  if (!health.lastProbeAt) return true;
  return now.getTime() - health.lastProbeAt.getTime() >= probeIntervalMs;
}
