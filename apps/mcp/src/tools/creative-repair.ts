import {
  buildCreativeWhere,
  prisma,
  queueAdvertiserScan,
} from "@ad-monitor/db";
import * as z from "zod/v4";
import {
  getCreativeCoverage,
  getCreativeIssues,
  REFERENCE_CREATIVE_SELECT,
  resolveCreativeDescription,
  resolveCreativeTitle,
  type ReferenceCreativeRecord,
} from "../intelligence.js";
import {
  computeCreativeStatus,
  textToolResult,
  toLimitedTake,
} from "../utils.js";
import {
  creativeFormatEnum,
  storeEnum,
  repairModeEnum,
} from "../tool-schemas.js";
import {
  buildCreativeFiltersFromArgs,
  fetchCreativeByIdOrThrow,
  tryBackfillCreativeApp,
  queueRepairForCreatives,
  requireAdvertiser,
} from "../tool-support.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerCreativeRepairTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "creatives.diagnostics",
    {
      description:
        "Explain why one creative is incomplete or weakly collected.",
      inputSchema: {
        creativeId: z.string(),
      },
    },
    async (args) => {
      const creative = await fetchCreativeByIdOrThrow(args.creativeId);
      const coverage = getCreativeCoverage(creative);
      return textToolResult(`Diagnostics for ${creative.creativeId}`, {
        creativeId: creative.creativeId,
        title: resolveCreativeTitle(creative),
        description: resolveCreativeDescription(creative),
        coverage,
        issues: getCreativeIssues(creative),
        collectionTimeline: {
          firstFoundAt: creative.firstFoundAt,
          detailFetchedAt: creative.detailFetchedAt,
          lastFoundAt: creative.lastFoundAt,
          updatedAt: creative.updatedAt,
        },
        snapshotSummary: {
          hasRawList: Boolean(creative.rawList),
          hasRawDetail: Boolean(creative.rawDetail),
          hasRawPreview: Boolean(creative.rawPreview),
          rawSnapshotsCount: creative._count.rawSnapshots,
        },
      });
    },
  );

  registerTool(
    server,
    "creatives.rescan",
    {
      description: "Queue a repair-oriented rescan for one creative.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        creativeId: z.string(),
        mode: repairModeEnum.optional(),
      },
    },
    async (args) => {
      const creative = await fetchCreativeByIdOrThrow(args.creativeId);
      const advertiser = await requireAdvertiser(creative.advertiserId);
      const mode = args.mode ?? "FULL";
      if (mode === "STATUS_ONLY") {
        const nextStatus = computeCreativeStatus(
          creative.lastShownAt,
          creative.lastFoundAt,
        );
        const updated = await prisma.creative.update({
          where: { id: creative.id },
          data: { status: nextStatus },
        });
        return textToolResult(`Status refreshed for ${creative.creativeId}`, {
          creativeId: creative.creativeId,
          mode,
          status: updated.status,
        });
      }
      if (mode === "APP_LINK_ONLY") {
        const linked = await tryBackfillCreativeApp(creative);
        return textToolResult(
          `App link repair processed for ${creative.creativeId}`,
          {
            creativeId: creative.creativeId,
            mode,
            linked,
          },
        );
      }

      const job = await queueAdvertiserScan(
        advertiser.id,
        creative.countries
          .map((country) => country.countryCode)
          .filter(Boolean) as string[],
        {
          scanMode: "FULL",
          refreshDetails: true,
        },
      );
      return textToolResult(`Rescan queued for ${creative.creativeId}`, {
        creativeId: creative.creativeId,
        mode,
        advertiserId: advertiser.id,
        scanJobId: job.id,
      });
    },
  );

  registerTool(
    server,
    "creatives.bulk_repair",
    {
      description: "Queue repair actions for creatives selected by filters.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        advertiserId: z.string().optional(),
        country: z.string().optional(),
        countries: z.array(z.string()).optional(),
        store: storeEnum.optional(),
        appId: z.string().optional(),
        appName: z.string().optional(),
        developer: z.string().optional(),
        advertiserName: z.string().optional(),
        format: creativeFormatEnum.optional(),
        q: z.string().optional(),
        hasTitle: z.boolean().optional(),
        hasDescription: z.boolean().optional(),
        hasGeo: z.boolean().optional(),
        hasApp: z.boolean().optional(),
        hasDetails: z.boolean().optional(),
        hasPreview: z.boolean().optional(),
        hasAssets: z.boolean().optional(),
        minPublicDays: z.number().int().min(0).optional(),
        mode: repairModeEnum.optional(),
        limit: z.number().int().min(1).max(200).optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => {
      const mode = args.mode ?? "FULL";
      const limit = toLimitedTake(args.limit, 25, 200);
      const filters = buildCreativeFiltersFromArgs(args);
      const where = buildCreativeWhere(filters);
      const creatives = await prisma.creative.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: REFERENCE_CREATIVE_SELECT,
      });
      if (args.dryRun !== false) {
        return textToolResult(
          `Bulk repair dry-run: ${creatives.length} creatives`,
          {
            mode,
            dryRun: true,
            creatives: creatives.map((creative) => ({
              creativeId: creative.creativeId,
              advertiserId: creative.advertiserId,
              issues: getCreativeIssues(creative as ReferenceCreativeRecord),
            })),
          },
        );
      }
      const queued = await queueRepairForCreatives(
        creatives as ReferenceCreativeRecord[],
        mode,
      );
      return textToolResult(
        `Bulk repair queued for ${queued.length} advertisers`,
        {
          mode,
          dryRun: false,
          jobs: queued,
        },
      );
    },
  );
}
