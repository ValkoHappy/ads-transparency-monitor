import {
  getSystemSettings,
  prisma,
  updateSystemSettings,
} from "@ad-monitor/db";
import * as z from "zod/v4";
import {
  boundedInt,
  maskProxyUrl,
  normalizeHours,
  normalizeProxyUrl,
  nullableBoundedInt,
  parseScanMode,
  parseScheduleType,
  textToolResult,
} from "../utils.js";
import { scanModeEnum, scheduleTypeEnum } from "../tool-schemas.js";
import { syncProxyPool } from "../tool-support.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerSettingsTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "settings.get",
    {
      description: "Get system settings and current proxy pool.",
      inputSchema: {},
    },
    async () => {
      const [settings, proxyPool] = await Promise.all([
        getSystemSettings(prisma),
        prisma.proxyEndpoint.findMany({
          orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        }),
      ]);
      return textToolResult("System settings loaded", {
        settings: {
          ...settings,
          proxyUrl: settings.proxyUrl
            ? maskProxyUrl(settings.proxyUrl)
            : settings.proxyUrl,
        },
        proxyPool: proxyPool.map((item) => ({
          ...item,
          url: maskProxyUrl(item.url),
        })),
      });
    },
  );

  registerTool(
    server,
    "settings.update",
    {
      description:
        "Update system settings and optionally synchronize the proxy pool.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        scanMode: scanModeEnum.optional(),
        dailyScanHour: z.number().int().min(0).max(23).optional(),
        scheduleType: scheduleTypeEnum.optional(),
        dailyScanHours: z.array(z.number().int().min(0).max(23)).optional(),
        scanIntervalHours: z
          .number()
          .int()
          .min(1)
          .max(24)
          .nullable()
          .optional(),
        requestDelayMs: z.number().int().min(0).max(3_600_000).optional(),
        maxPagesPerRun: z.number().int().min(1).max(1000).nullable().optional(),
        maxCreativesPerRun: z
          .number()
          .int()
          .min(1)
          .max(100000)
          .nullable()
          .optional(),
        workerConcurrency: z.number().int().min(1).max(6).optional(),
        advertiserDelayMs: z.number().int().min(0).max(3_600_000).optional(),
        probeIntervalMs: z
          .number()
          .int()
          .min(60_000)
          .max(86_400_000)
          .optional(),
        rawSnapshotRetentionDays: z.number().int().min(1).max(365).optional(),
        scanEventRetentionDays: z.number().int().min(1).max(365).optional(),
        exportDefaultFields: z.array(z.string()).optional(),
        proxyEnabled: z.boolean().optional(),
        proxyUrl: z.string().nullable().optional(),
        proxyPool: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const settings = await updateSystemSettings(
        {
          scanMode: parseScanMode(args.scanMode),
          dailyScanHour: boundedInt(args.dailyScanHour, 0, 23),
          scheduleType: parseScheduleType(args.scheduleType),
          dailyScanHours: normalizeHours(args.dailyScanHours),
          scanIntervalHours: nullableBoundedInt(args.scanIntervalHours, 1, 24),
          requestDelayMs: boundedInt(args.requestDelayMs, 0, 3_600_000),
          maxPagesPerRun: nullableBoundedInt(args.maxPagesPerRun, 1, 1000),
          maxCreativesPerRun: nullableBoundedInt(
            args.maxCreativesPerRun,
            1,
            100000,
          ),
          workerConcurrency: boundedInt(args.workerConcurrency, 1, 6),
          advertiserDelayMs: boundedInt(args.advertiserDelayMs, 0, 3_600_000),
          probeIntervalMs: boundedInt(args.probeIntervalMs, 60_000, 86_400_000),
          rawSnapshotRetentionDays: boundedInt(
            args.rawSnapshotRetentionDays,
            1,
            365,
          ),
          scanEventRetentionDays: boundedInt(
            args.scanEventRetentionDays,
            1,
            365,
          ),
          exportDefaultFields: args.exportDefaultFields,
          proxyEnabled: args.proxyEnabled,
          proxyUrl:
            args.proxyUrl === undefined
              ? undefined
              : args.proxyUrl === null
                ? null
                : normalizeProxyUrl(args.proxyUrl) || null,
        },
        prisma,
      );
      if (args.proxyPool) {
        await syncProxyPool(args.proxyPool);
      }
      return textToolResult("System settings updated", {
        settings: {
          ...settings,
          proxyUrl: settings.proxyUrl
            ? maskProxyUrl(settings.proxyUrl)
            : settings.proxyUrl,
        },
      });
    },
  );
}
