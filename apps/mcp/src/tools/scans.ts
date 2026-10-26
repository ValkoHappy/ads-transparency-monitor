import {
  Prisma,
  cancelScanJob,
  prisma,
  queueAdvertiserScan,
} from "@ad-monitor/db";
import * as z from "zod/v4";
import { MAX_LIMIT, textToolResult, toLimitedTake, toPage } from "../utils.js";
import {
  scanModeEnum,
  scanStatusEnum,
  sortDirectionEnum,
} from "../tool-schemas.js";
import {
  scanOrderBy,
  buildDateRange,
  sanitizeScanJob,
} from "../tool-support.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerScansTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "scans.list",
    {
      description:
        "List scan jobs with filtering, sorting, pagination and recent events.",
      inputSchema: {
        advertiserId: z.string().optional(),
        status: scanStatusEnum.optional(),
        scanMode: scanModeEnum.optional(),
        refreshDetails: z.boolean().optional(),
        country: z.string().optional(),
        q: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
        sortBy: z
          .enum([
            "createdAt",
            "updatedAt",
            "scheduledFor",
            "startedAt",
            "finishedAt",
            "status",
            "scanMode",
            "creativesFound",
            "detailsFetched",
            "previewsFetched",
            "pagesFetched",
          ])
          .optional(),
        sortDir: sortDirectionEnum.optional(),
        eventsLimit: z.number().int().min(1).max(20).optional(),
      },
    },
    async (args) => {
      const paging = toPage(args.page, args.limit);
      const dateRange = buildDateRange(args.dateFrom, args.dateTo);
      const where: Prisma.ScanJobWhereInput = {
        advertiserId: args.advertiserId,
        status: args.status,
        scanMode: args.scanMode,
        refreshDetails: args.refreshDetails,
        countries: args.country
          ? { has: args.country.trim().toUpperCase() }
          : undefined,
        createdAt: dateRange,
        OR: args.q
          ? [
              {
                advertiser: { name: { contains: args.q, mode: "insensitive" } },
              },
              {
                advertiser: {
                  googleAdvertiserId: { contains: args.q, mode: "insensitive" },
                },
              },
              { id: { contains: args.q, mode: "insensitive" } },
            ]
          : undefined,
      };
      const eventsLimit = toLimitedTake(args.eventsLimit, 3, 20);
      const [total, items] = await Promise.all([
        prisma.scanJob.count({ where }),
        prisma.scanJob.findMany({
          where,
          orderBy: scanOrderBy(args.sortBy, args.sortDir),
          skip: paging.skip,
          take: paging.limit,
          include: {
            advertiser: true,
            scans: { orderBy: { startedAt: "desc" }, take: 1 },
            events: { orderBy: { createdAt: "desc" }, take: eventsLimit },
          },
        }),
      ]);
      return textToolResult(`Scans: ${items.length} of ${total}`, {
        total,
        page: paging.page,
        limit: paging.limit,
        hasMore: paging.skip + items.length < total,
        items: items.map((item) => sanitizeScanJob(item)),
      });
    },
  );

  registerTool(
    server,
    "scans.get",
    {
      description:
        "Get one scan job with advertiser, scan records and recent events.",
      inputSchema: {
        scanJobId: z.string(),
        eventsLimit: z.number().int().min(1).max(100).optional(),
        scansLimit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => {
      const job = await prisma.scanJob.findUnique({
        where: { id: args.scanJobId },
        include: {
          advertiser: true,
          scans: {
            orderBy: { startedAt: "desc" },
            take: toLimitedTake(args.scansLimit, 20, 100),
          },
          events: {
            orderBy: { createdAt: "desc" },
            take: toLimitedTake(args.eventsLimit, 20, 100),
          },
        },
      });
      if (!job) throw new Error("Scan job not found.");
      return textToolResult(`Scan ${job.id}`, sanitizeScanJob(job));
    },
  );

  registerTool(
    server,
    "scans.events",
    {
      description: "List events for one scan job.",
      inputSchema: {
        scanJobId: z.string(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        level: z.enum(["info", "warn", "error"]).optional(),
      },
    },
    async (args) => {
      const paging = toPage(args.page, args.limit);
      const where: Prisma.ScanEventWhereInput = {
        scanJobId: args.scanJobId,
        level: args.level,
      };
      const [total, items] = await Promise.all([
        prisma.scanEvent.count({ where }),
        prisma.scanEvent.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: paging.skip,
          take: paging.limit,
        }),
      ]);
      return textToolResult(`Scan events: ${items.length} of ${total}`, {
        total,
        page: paging.page,
        limit: paging.limit,
        hasMore: paging.skip + items.length < total,
        items,
      });
    },
  );

  registerTool(
    server,
    "scans.failures",
    {
      description:
        "List recent failed or blocked scan jobs with sanitized errors and events.",
      inputSchema: {
        advertiserId: z.string().optional(),
        status: z.enum(["FAILED", "BLOCKED", "CANCELED"]).optional(),
        level: z.enum(["info", "warn", "error"]).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => {
      const items = await prisma.scanJob.findMany({
        where: {
          advertiserId: args.advertiserId,
          status: args.status ?? { in: ["FAILED", "BLOCKED", "CANCELED"] },
          createdAt: buildDateRange(args.dateFrom, args.dateTo),
        },
        orderBy: { updatedAt: "desc" },
        take: toLimitedTake(args.limit, 20, 100),
        include: {
          advertiser: true,
          events: {
            where: {
              level: args.level,
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      });
      return textToolResult(`Scan failures: ${items.length}`, {
        items: items.map((item) => sanitizeScanJob(item)),
      });
    },
  );

  registerTool(
    server,
    "scans.retry",
    {
      description: "Retry an existing scan job with the same parameters.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        scanJobId: z.string(),
      },
    },
    async (args) => {
      const job = await prisma.scanJob.findUnique({
        where: { id: args.scanJobId },
      });
      if (!job) throw new Error("Scan job not found.");
      const retry = await queueAdvertiserScan(job.advertiserId, job.countries, {
        retryOfJobId: job.id,
        scanMode: job.scanMode,
        requestDelayMs: job.requestDelayMs ?? undefined,
        maxPagesPerRun: job.maxPagesPerRun ?? undefined,
        maxCreativesPerRun: job.maxCreativesPerRun ?? undefined,
        scanStartDate: job.scanStartDate,
        scanEndDate: job.scanEndDate,
        refreshDetails: job.refreshDetails,
      });
      return textToolResult(`Retry queued: ${retry.id}`, retry);
    },
  );

  registerTool(
    server,
    "scans.cancel",
    {
      description: "Cancel queued or running scan job.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        scanJobId: z.string(),
      },
    },
    async (args) => {
      const result = await cancelScanJob(args.scanJobId, prisma);
      if (!result) throw new Error("Scan job not found.");
      return textToolResult(`Scan cancel processed: ${result.id}`, result);
    },
  );
}
