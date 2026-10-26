import { prisma, sanitizeOperationalMessage } from "@ad-monitor/db";
import * as z from "zod/v4";
import { textToolResult } from "../utils.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerSystemTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "system.status",
    {
      description: "Get database, worker, Google health and queue status.",
      inputSchema: {
        lite: z.boolean().optional(),
      },
    },
    async (args) => {
      const startedAt = Date.now();
      const STALE_HEARTBEAT_MS = 10 * 60_000;
      if (args.lite) {
        const [queued, running, heartbeat] = await Promise.all([
          prisma.scanJob.count({ where: { status: "QUEUED" } }),
          prisma.scanJob.count({ where: { status: "RUNNING" } }),
          prisma.workerHeartbeat.findUnique({ where: { id: "default" } }),
        ]);
        const heartbeatAgeMs = heartbeat
          ? Date.now() - heartbeat.lastSeenAt.getTime()
          : null;
        return textToolResult("System status (lite)", {
          ok: true,
          db: { ok: true, latencyMs: Date.now() - startedAt },
          worker: {
            online:
              heartbeatAgeMs !== null && heartbeatAgeMs <= STALE_HEARTBEAT_MS,
            status: heartbeat?.status ?? "unknown",
            message: heartbeat?.message ?? null,
            pid: heartbeat?.pid ?? null,
            lastSeenAt: heartbeat?.lastSeenAt ?? null,
            heartbeatAgeMs,
          },
          queue: { queued, running },
        });
      }

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
        rawSnapshots,
      ] = await Promise.all([
        prisma.scanJob.count({ where: { status: "QUEUED" } }),
        prisma.scanJob.count({ where: { status: "RUNNING" } }),
        prisma.scanJob.count({ where: { status: "FAILED" } }),
        prisma.scanJob.findFirst({
          orderBy: { updatedAt: "desc" },
          include: {
            advertiser: true,
            events: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        }),
        prisma.scanJob.findFirst({
          where: { status: "SUCCESS" },
          orderBy: { finishedAt: "desc" },
        }),
        prisma.workerHeartbeat.findUnique({ where: { id: "default" } }),
        prisma.googleHealth.findUnique({ where: { id: "default" } }),
        prisma.scanJob.findFirst({
          where: { status: "RUNNING", chunkStartedAt: { not: null } },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            currentCountryCode: true,
            nextPageToken: true,
            pagesFetched: true,
            creativesFound: true,
            chunkStartedAt: true,
          },
        }),
        prisma.creative.count({ where: { appDbId: null } }),
        prisma.creative.count({ where: { previewUrl: null } }),
        prisma.rawApiSnapshot.count(),
      ]);
      const heartbeatAgeMs = heartbeat
        ? Date.now() - heartbeat.lastSeenAt.getTime()
        : null;
      return textToolResult("System status", {
        ok: true,
        db: { ok: true, latencyMs: Date.now() - startedAt },
        worker: {
          online:
            heartbeatAgeMs !== null && heartbeatAgeMs <= STALE_HEARTBEAT_MS,
          status: heartbeat?.status ?? "unknown",
          message: heartbeat?.message ?? null,
          pid: heartbeat?.pid ?? null,
          lastSeenAt: heartbeat?.lastSeenAt ?? null,
          heartbeatAgeMs,
        },
        queue: { queued, running, failed, activeChunk },
        google: {
          status: googleHealth?.status ?? "OK",
          blockedUntil: googleHealth?.blockedUntil ?? null,
          lastProbeAt: googleHealth?.lastProbeAt ?? null,
          lastSuccessAt: googleHealth?.lastSuccessAt ?? null,
          consecutiveBlocks: googleHealth?.consecutiveBlocks ?? 0,
          lastError: googleHealth?.lastError ?? null,
        },
        scans: {
          last: lastScan
            ? {
                id: lastScan.id,
                status: lastScan.status,
                advertiser:
                  lastScan.advertiser.name ??
                  lastScan.advertiser.googleAdvertiserId,
                updatedAt: lastScan.updatedAt,
                event: lastScan.events[0]?.message
                  ? sanitizeOperationalMessage(lastScan.events[0].message)
                  : null,
              }
            : null,
          lastSuccessAt: lastSuccessfulScan?.finishedAt ?? null,
        },
        data: {
          creativesWithoutApp,
          creativesWithoutPreviewUrl,
          rawSnapshots,
        },
      });
    },
  );
}
