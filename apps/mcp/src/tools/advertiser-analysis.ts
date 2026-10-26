import { prisma } from "@ad-monitor/db";
import * as z from "zod/v4";
import {
  computeReferenceScore,
  getCreativeIssues,
  REFERENCE_CREATIVE_SELECT,
  toReferenceCreative,
  type ReferenceCreativeRecord,
} from "../intelligence.js";
import { serialize, textToolResult, toLimitedTake } from "../utils.js";
import { repairModeEnum } from "../tool-schemas.js";
import {
  queueRepairForCreatives,
  summarizeAdvertiserDiagnostics,
  requireAdvertiser,
} from "../tool-support.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerAdvertiserAnalysisTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "advertisers.find_reference_sets",
    {
      description:
        "Find advertisers with many active and reference-worthy creatives.",
      inputSchema: {
        country: z.string().optional(),
        q: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async (args) => {
      const advertisers = await prisma.advertiser.findMany({
        where: {
          creatives: args.country
            ? {
                some: {
                  countries: {
                    some: { countryCode: args.country.trim().toUpperCase() },
                  },
                },
              }
            : undefined,
          OR: args.q
            ? [
                { name: { contains: args.q, mode: "insensitive" } },
                {
                  googleAdvertiserId: { contains: args.q, mode: "insensitive" },
                },
              ]
            : undefined,
        },
        orderBy: [{ activeCreatives: "desc" }, { updatedAt: "desc" }],
        take: toLimitedTake(args.limit, 15, 50),
        include: {
          creatives: {
            orderBy: { updatedAt: "desc" },
            take: 20,
            select: REFERENCE_CREATIVE_SELECT,
          },
        },
      });
      const items = advertisers
        .map((advertiser) => {
          const scores = advertiser.creatives.map(
            (creative) =>
              computeReferenceScore(creative as ReferenceCreativeRecord).score,
          );
          return serialize({
            advertiserId: advertiser.id,
            googleAdvertiserId: advertiser.googleAdvertiserId,
            name: advertiser.name,
            totalCreatives: advertiser.totalCreatives,
            activeCreatives: advertiser.activeCreatives,
            averageReferenceScore: scores.length
              ? Math.round(
                  scores.reduce((sum, value) => sum + value, 0) / scores.length,
                )
              : 0,
            geoSpread: [
              ...new Set(
                advertiser.creatives.flatMap((creative) =>
                  creative.countries
                    .map((country) => country.countryCode)
                    .filter(Boolean),
                ),
              ),
            ],
            sampleCreatives: advertiser.creatives
              .slice(0, 5)
              .map((creative) =>
                toReferenceCreative(creative as ReferenceCreativeRecord),
              ),
          });
        })
        .sort(
          (left: any, right: any) =>
            right.averageReferenceScore - left.averageReferenceScore ||
            right.activeCreatives - left.activeCreatives,
        );
      return textToolResult(`Reference advertiser sets: ${items.length}`, {
        items,
      });
    },
  );

  registerTool(
    server,
    "advertisers.diagnostics",
    {
      description: "Summarize data collection gaps for one advertiser.",
      inputSchema: {
        advertiserId: z.string(),
      },
    },
    async (args) => {
      const advertiser = await requireAdvertiser(args.advertiserId, {
        scanJobsLimit: 5,
        scanEventsLimit: 3,
      });
      const creatives = await prisma.creative.findMany({
        where: { advertiserId: advertiser.id },
        select: REFERENCE_CREATIVE_SELECT,
        take: 200,
        orderBy: { updatedAt: "desc" },
      });
      const diagnostics = summarizeAdvertiserDiagnostics(
        advertiser.id,
        creatives as ReferenceCreativeRecord[],
      );
      return textToolResult(
        `Advertiser diagnostics: ${advertiser.googleAdvertiserId}`,
        {
          advertiser: serialize(advertiser),
          diagnostics,
        },
      );
    },
  );

  registerTool(
    server,
    "advertisers.repair",
    {
      description:
        "Queue repair actions for one advertiser based on missing coverage.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        advertiserId: z.string(),
        mode: repairModeEnum.optional(),
        limit: z.number().int().min(1).max(200).optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => {
      const advertiser = await requireAdvertiser(args.advertiserId);
      const creatives = await prisma.creative.findMany({
        where: { advertiserId: advertiser.id },
        orderBy: { updatedAt: "desc" },
        take: toLimitedTake(args.limit, 50, 200),
        select: REFERENCE_CREATIVE_SELECT,
      });
      const mode = args.mode ?? "FULL";
      if (args.dryRun !== false) {
        return textToolResult(
          `Advertiser repair dry-run: ${creatives.length} creatives`,
          {
            advertiserId: advertiser.id,
            mode,
            dryRun: true,
            creatives: creatives.map((creative) => ({
              creativeId: creative.creativeId,
              issues: getCreativeIssues(creative as ReferenceCreativeRecord),
            })),
          },
        );
      }
      const jobs = await queueRepairForCreatives(
        creatives as ReferenceCreativeRecord[],
        mode,
      );
      return textToolResult(`Advertiser repair queued: ${jobs.length} jobs`, {
        advertiserId: advertiser.id,
        mode,
        dryRun: false,
        jobs,
      });
    },
  );
}
