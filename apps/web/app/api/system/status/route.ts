import { NextResponse } from "next/server";
import { prisma, sanitizeOperationalMessage } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { requestMeta, timeAsync } from "@/lib/perf";

const STALE_HEARTBEAT_MS = 10 * 60_000;

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const startedAt = Date.now();
  const meta = requestMeta(request);
  const url = new URL(request.url);
  const lite = url.searchParams.get("lite") === "1";
  try {
    if (lite) {
      const [queued, running, heartbeat] = await timeAsync("api.system.status.lite", () => Promise.all([
        prisma.scanJob.count({ where: { status: "QUEUED" } }),
        prisma.scanJob.count({ where: { status: "RUNNING" } }),
        prisma.workerHeartbeat.findUnique({ where: { id: "default" } })
      ]), { ...meta, lite: true }, { thresholdMs: 100, always: true });

      const heartbeatAgeMs = heartbeat ? Date.now() - heartbeat.lastSeenAt.getTime() : null;
      const workerOnline = heartbeatAgeMs !== null && heartbeatAgeMs <= STALE_HEARTBEAT_MS;

      return NextResponse.json({
        ok: true,
        db: { ok: true, latencyMs: Date.now() - startedAt },
        worker: {
          online: workerOnline,
          status: heartbeat?.status ?? "unknown",
          message: heartbeat?.message ?? null,
          pid: heartbeat?.pid ?? null,
          lastSeenAt: heartbeat?.lastSeenAt ?? null,
          heartbeatAgeMs
        },
        queue: { queued, running }
      });
    }

    await timeAsync("api.system.status.ping", () => prisma.advertiser.count(), meta, { thresholdMs: 100 });
    const [
      queued,
      running,
      failed,
      lastScan,
      lastSuccessfulScan,
      heartbeat,
      googleHealth,
      activeChunk,
      creativesWithoutApp,
      creativesWithoutPreviewUrl,
      rawSnapshots
    ] = await timeAsync("api.system.status.summary", () => Promise.all([
      timeAsync("api.system.status.queued", () => prisma.scanJob.count({ where: { status: "QUEUED" } }), meta, { thresholdMs: 100 }),
      timeAsync("api.system.status.running", () => prisma.scanJob.count({ where: { status: "RUNNING" } }), meta, { thresholdMs: 100 }),
      timeAsync("api.system.status.failed", () => prisma.scanJob.count({ where: { status: "FAILED" } }), meta, { thresholdMs: 100 }),
      timeAsync("api.system.status.lastScan", () => prisma.scanJob.findFirst({ orderBy: { updatedAt: "desc" }, include: { advertiser: true, events: { orderBy: { createdAt: "desc" }, take: 1 } } }), meta, { thresholdMs: 100 }),
      timeAsync("api.system.status.lastSuccess", () => prisma.scanJob.findFirst({ where: { status: "SUCCESS" }, orderBy: { finishedAt: "desc" } }), meta, { thresholdMs: 100 }),
      timeAsync("api.system.status.heartbeat", () => prisma.workerHeartbeat.findUnique({ where: { id: "default" } }), meta, { thresholdMs: 100 }),
      timeAsync("api.system.status.googleHealth", () => prisma.googleHealth.findUnique({ where: { id: "default" } }), meta, { thresholdMs: 100 }),
      timeAsync("api.system.status.activeChunk", () => prisma.scanJob.findFirst({ where: { status: "RUNNING", chunkStartedAt: { not: null } }, orderBy: { updatedAt: "desc" }, select: { id: true, currentCountryCode: true, nextPageToken: true, pagesFetched: true, creativesFound: true, chunkStartedAt: true } }), meta, { thresholdMs: 100 }),
      timeAsync("api.system.status.creativesWithoutApp", () => prisma.creative.count({ where: { appDbId: null } }), meta, { thresholdMs: 100 }),
      timeAsync("api.system.status.creativesWithoutPreviewUrl", () => prisma.creative.count({ where: { previewUrl: null } }), meta, { thresholdMs: 100 }),
      timeAsync("api.system.status.rawSnapshots", () => prisma.rawApiSnapshot.count(), meta, { thresholdMs: 100 })
    ]), meta, { always: true });

    const heartbeatAgeMs = heartbeat ? Date.now() - heartbeat.lastSeenAt.getTime() : null;
    const workerOnline = heartbeatAgeMs !== null && heartbeatAgeMs <= STALE_HEARTBEAT_MS;

    return NextResponse.json({
      ok: true,
      db: { ok: true, latencyMs: Date.now() - startedAt },
      worker: {
        online: workerOnline,
        status: heartbeat?.status ?? "unknown",
        message: heartbeat?.message ?? null,
        pid: heartbeat?.pid ?? null,
        lastSeenAt: heartbeat?.lastSeenAt ?? null,
        heartbeatAgeMs
      },
      queue: { queued, running, failed, activeChunk },
      google: {
        status: googleHealth?.status ?? "OK",
        blockedUntil: googleHealth?.blockedUntil ?? null,
        nextProbeAt: googleHealth?.blockedUntil ?? null,
        lastProbeResult: googleHealth?.lastError ? "blocked" : "ok",
        lastProbeAt: googleHealth?.lastProbeAt ?? null,
        lastSuccessAt: googleHealth?.lastSuccessAt ?? null,
        consecutiveBlocks: googleHealth?.consecutiveBlocks ?? 0
      },
      scans: {
        last: lastScan ? {
          id: lastScan.id,
          status: lastScan.status,
          advertiser: lastScan.advertiser.name ?? lastScan.advertiser.googleAdvertiserId,
          updatedAt: lastScan.updatedAt,
          event: lastScan.events[0]?.message ? sanitizeOperationalMessage(lastScan.events[0].message) : null,
          reasonCode: scanEventReasonCode(lastScan.events[0]?.data)
        } : null,
        lastSuccessAt: lastSuccessfulScan?.finishedAt ?? null
      },
      data: {
        creativesWithoutApp,
        creativesWithoutPreviewUrl,
        rawSnapshots
      }
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      db: { ok: false, latencyMs: Date.now() - startedAt },
      error: error instanceof Error ? sanitizeOperationalMessage(error.message) : "Unknown system status error"
    }, { status: 500 });
  }
}

function scanEventReasonCode(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const value = (data as { reasonCode?: unknown }).reasonCode;
  return typeof value === "string" ? value : null;
}
