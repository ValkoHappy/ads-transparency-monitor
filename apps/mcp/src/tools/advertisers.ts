import {
  Prisma,
  getSystemSettings,
  prisma,
  queueAdvertiserScan,
  upsertAdvertiser,
  withAdvertiserQueueLock,
} from "@ad-monitor/db";
import * as z from "zod/v4";
import {
  MAX_LIMIT,
  normalizeCountryCodes,
  normalizeDateInput,
  textToolResult,
  toLimitedTake,
  toPage,
} from "../utils.js";
import {
  scanModeEnum,
  scanStatusEnum,
  sortDirectionEnum,
} from "../tool-schemas.js";
import {
  advertiserOrderBy,
  findAdvertiser,
  requireAdvertiser,
} from "../tool-support.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerAdvertisersTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "advertisers.list",
    {
      description: "List advertisers with filtering, sorting and pagination.",
      inputSchema: {
        q: z.string().optional(),
        googleAdvertiserId: z.string().optional(),
        dailyScanEnabled: z.boolean().optional(),
        scanMode: scanModeEnum.optional(),
        lastScanStatus: scanStatusEnum.optional(),
        hasNotes: z.boolean().optional(),
        country: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
        sortBy: z
          .enum([
            "updatedAt",
            "createdAt",
            "name",
            "googleAdvertiserId",
            "totalCreatives",
            "activeCreatives",
            "lastScanAt",
            "lastSuccessfulScanAt",
          ])
          .optional(),
        sortDir: sortDirectionEnum.optional(),
      },
    },
    async (args) => {
      const paging = toPage(args.page, args.limit);
      const orderBy = advertiserOrderBy(args.sortBy, args.sortDir);
      const where: Prisma.AdvertiserWhereInput = {
        googleAdvertiserId: args.googleAdvertiserId
          ? { contains: args.googleAdvertiserId, mode: "insensitive" }
          : undefined,
        dailyScanEnabled: args.dailyScanEnabled,
        scanMode: args.scanMode,
        lastScanStatus: args.lastScanStatus,
        notes:
          args.hasNotes === undefined
            ? undefined
            : args.hasNotes
              ? { not: null }
              : null,
        selectedCountries: args.country
          ? { has: args.country.trim().toUpperCase() }
          : undefined,
        OR: args.q
          ? [
              { name: { contains: args.q, mode: "insensitive" } },
              { googleAdvertiserId: { contains: args.q, mode: "insensitive" } },
              { notes: { contains: args.q, mode: "insensitive" } },
            ]
          : undefined,
      };

      const [total, items] = await Promise.all([
        prisma.advertiser.count({ where }),
        prisma.advertiser.findMany({
          where,
          orderBy,
          skip: paging.skip,
          take: paging.limit,
          include: {
            scanJobs: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                creativesFound: true,
                detailsFetched: true,
                previewsFetched: true,
                refreshDetails: true,
              },
            },
          },
        }),
      ]);

      return textToolResult(`Advertisers: ${items.length} of ${total}`, {
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
    "advertisers.get",
    {
      description:
        "Get one advertiser by internal id or Google advertiser id, with recent creatives, scans and jobs.",
      inputSchema: {
        id: z.string(),
        creativesLimit: z.number().int().min(1).max(100).optional(),
        scanJobsLimit: z.number().int().min(1).max(100).optional(),
        scansLimit: z.number().int().min(1).max(100).optional(),
        scanEventsLimit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => {
      const advertiser = await findAdvertiser(args.id, {
        creativesLimit: toLimitedTake(args.creativesLimit, 50, 100),
        scanJobsLimit: toLimitedTake(args.scanJobsLimit, 20, 100),
        scansLimit: toLimitedTake(args.scansLimit, 10, 100),
        scanEventsLimit: toLimitedTake(args.scanEventsLimit, 5, 100),
      });
      if (!advertiser) throw new Error("Advertiser not found.");
      return textToolResult(
        `Advertiser ${advertiser.googleAdvertiserId}`,
        advertiser,
      );
    },
  );

  registerTool(
    server,
    "advertisers.create_or_update",
    {
      description:
        "Create advertiser or update by Google advertiser id / transparency URL input.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        input: z.string(),
        name: z.string().optional(),
        selectedCountries: z.array(z.string()).optional(),
        notes: z.string().optional(),
        dailyScanEnabled: z.boolean().optional(),
        scanMode: scanModeEnum.optional(),
        requestDelayMs: z.number().int().min(0).max(3_600_000).optional(),
        maxPagesPerRun: z.number().int().min(1).max(1000).optional(),
        maxCreativesPerRun: z.number().int().min(1).max(100000).optional(),
        scanStartDate: z.string().optional(),
        scanEndDate: z.string().optional(),
      },
    },
    async (args) => {
      const advertiser = await upsertAdvertiser({
        input: args.input,
        name: args.name?.trim() || undefined,
        selectedCountries: normalizeCountryCodes(args.selectedCountries),
        notes: args.notes?.trim() || undefined,
        dailyScanEnabled: args.dailyScanEnabled,
        scanMode: args.scanMode,
        requestDelayMs: args.requestDelayMs,
        maxPagesPerRun: args.maxPagesPerRun,
        maxCreativesPerRun: args.maxCreativesPerRun,
        scanStartDate: normalizeDateInput(args.scanStartDate) ?? null,
        scanEndDate: normalizeDateInput(args.scanEndDate) ?? null,
      });
      return textToolResult(
        `Advertiser saved: ${advertiser.googleAdvertiserId}`,
        advertiser,
      );
    },
  );

  registerTool(
    server,
    "advertisers.update",
    {
      description:
        "Update advertiser settings and metadata by internal id or Google advertiser id.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        selectedCountries: z.array(z.string()).optional(),
        notes: z.string().optional(),
        dailyScanEnabled: z.boolean().optional(),
        scanMode: scanModeEnum.optional(),
        requestDelayMs: z.number().int().min(0).max(3_600_000).optional(),
        maxPagesPerRun: z.number().int().min(1).max(1000).nullable().optional(),
        maxCreativesPerRun: z
          .number()
          .int()
          .min(1)
          .max(100000)
          .nullable()
          .optional(),
        scanStartDate: z.string().nullable().optional(),
        scanEndDate: z.string().nullable().optional(),
      },
    },
    async (args) => {
      const advertiser = await requireAdvertiser(args.id);
      const updated = await prisma.advertiser.update({
        where: { id: advertiser.id },
        data: {
          name: args.name === undefined ? undefined : args.name.trim() || null,
          selectedCountries: args.selectedCountries
            ? normalizeCountryCodes(args.selectedCountries)
            : undefined,
          notes:
            args.notes === undefined ? undefined : args.notes.trim() || null,
          dailyScanEnabled: args.dailyScanEnabled,
          scanMode: args.scanMode,
          requestDelayMs: args.requestDelayMs,
          maxPagesPerRun: args.maxPagesPerRun,
          maxCreativesPerRun: args.maxCreativesPerRun,
          scanStartDate:
            args.scanStartDate === undefined
              ? undefined
              : (normalizeDateInput(args.scanStartDate ?? undefined) ?? null),
          scanEndDate:
            args.scanEndDate === undefined
              ? undefined
              : (normalizeDateInput(args.scanEndDate ?? undefined) ?? null),
        },
      });
      return textToolResult(
        `Advertiser updated: ${updated.googleAdvertiserId}`,
        updated,
      );
    },
  );

  registerTool(
    server,
    "advertisers.delete",
    {
      description:
        "Delete advertiser if there are no active queued/running scans.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        id: z.string(),
      },
    },
    async (args) => {
      const advertiser = await requireAdvertiser(args.id, {
        includeActiveJob: true,
      });
      if (advertiser.scanJobs?.length) {
        throw new Error(
          "Cancel or finish the active scan before deleting the advertiser.",
        );
      }

      await withAdvertiserQueueLock(advertiser.id, async (tx) => {
        const activeJob = await tx.scanJob.findFirst({
          where: {
            advertiserId: advertiser.id,
            status: { in: ["QUEUED", "RUNNING"] },
          },
          select: { id: true },
        });
        if (activeJob)
          throw new Error(
            "Cancel or finish the active scan before deleting the advertiser.",
          );
        await tx.advertiser.delete({ where: { id: advertiser.id } });
      });

      return textToolResult(
        `Advertiser deleted: ${advertiser.googleAdvertiserId}`,
        {
          ok: true,
          advertiserId: advertiser.id,
          googleAdvertiserId: advertiser.googleAdvertiserId,
        },
      );
    },
  );

  registerTool(
    server,
    "advertisers.scan.queue",
    {
      description:
        "Queue advertiser scan with optional overrides, countries and refreshDetails.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        advertiserId: z.string(),
        countries: z.array(z.string()).optional(),
        scanMode: scanModeEnum.optional(),
        requestDelayMs: z.number().int().min(0).max(3_600_000).optional(),
        maxPagesPerRun: z.number().int().min(1).max(1000).optional(),
        maxCreativesPerRun: z.number().int().min(1).max(100000).optional(),
        scanStartDate: z.string().optional(),
        scanEndDate: z.string().optional(),
        refreshDetails: z.boolean().optional(),
      },
    },
    async (args) => {
      const advertiser = await requireAdvertiser(args.advertiserId);
      const settings = await getSystemSettings(prisma);
      const scanMode =
        args.scanMode ?? advertiser.scanMode ?? settings.scanMode;
      const refreshDetails = args.refreshDetails ?? scanMode === "FULL";
      const job = await queueAdvertiserScan(
        advertiser.id,
        normalizeCountryCodes(args.countries),
        {
          scanMode,
          requestDelayMs:
            args.requestDelayMs ??
            advertiser.requestDelayMs ??
            settings.requestDelayMs,
          maxPagesPerRun:
            args.maxPagesPerRun ??
            advertiser.maxPagesPerRun ??
            settings.maxPagesPerRun ??
            undefined,
          maxCreativesPerRun:
            args.maxCreativesPerRun ??
            advertiser.maxCreativesPerRun ??
            settings.maxCreativesPerRun ??
            undefined,
          scanStartDate:
            normalizeDateInput(args.scanStartDate) ?? advertiser.scanStartDate,
          scanEndDate:
            normalizeDateInput(args.scanEndDate) ?? advertiser.scanEndDate,
          refreshDetails,
        },
      );
      return textToolResult(`Scan queued: ${job.id}`, job);
    },
  );
}
