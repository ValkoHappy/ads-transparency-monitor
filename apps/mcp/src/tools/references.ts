import { buildCreativeWhere, prisma } from "@ad-monitor/db";
import * as z from "zod/v4";
import {
  buildPatterns,
  buildReferencePackInsights,
  buildReferenceSummary,
  compareCreatives,
  computeReferenceScore,
  REFERENCE_CREATIVE_SELECT,
  resolveCreativeDescription,
  resolveCreativeTitle,
  toReferenceCreative,
  type ReferenceCreativeRecord,
} from "../intelligence.js";
import { serialize, textToolResult, toLimitedTake } from "../utils.js";
import { creativeFormatEnum, storeEnum } from "../tool-schemas.js";
import {
  buildCreativeFiltersFromArgs,
  fetchCreativeByIdOrThrow,
  findSimilarCandidates,
  mergeWhere,
  uniqueBy,
} from "../tool-support.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerReferencesTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "creatives.find_references",
    {
      description:
        "Find strong reference creatives using filters and heuristic scoring.",
      inputSchema: {
        advertiserId: z.string().optional(),
        country: z.string().optional(),
        countries: z.array(z.string()).optional(),
        store: storeEnum.optional(),
        appId: z.string().optional(),
        appName: z.string().optional(),
        developer: z.string().optional(),
        advertiserName: z.string().optional(),
        category: z.string().optional(),
        format: creativeFormatEnum.optional(),
        q: z.string().optional(),
        activeOnly: z.boolean().optional(),
        minPublicDays: z.number().int().min(0).optional(),
        requireTitle: z.boolean().optional(),
        requireDescription: z.boolean().optional(),
        requireAssets: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => {
      const limit = toLimitedTake(args.limit, 20, 100);
      const filters = buildCreativeFiltersFromArgs({
        ...args,
        status: args.activeOnly ? "ACTIVE" : undefined,
        hasTitle: args.requireTitle,
        hasDescription: args.requireDescription,
        hasAssets: args.requireAssets,
      });
      const where = buildCreativeWhere(filters);
      const items = await prisma.creative.findMany({
        where: mergeWhere(
          where,
          args.category
            ? {
                app: {
                  category: { contains: args.category, mode: "insensitive" },
                },
              }
            : undefined,
        ),
        orderBy: { updatedAt: "desc" },
        take: Math.min(limit * 4, 200),
        select: REFERENCE_CREATIVE_SELECT,
      });
      const ranked = items
        .map(
          (item) => toReferenceCreative(item as ReferenceCreativeRecord) as any,
        )
        .sort(
          (left, right) =>
            right.referenceScore - left.referenceScore ||
            String(right.lastShownAt).localeCompare(String(left.lastShownAt)),
        )
        .slice(0, limit);
      return textToolResult(`Reference creatives: ${ranked.length}`, {
        totalCandidates: items.length,
        items: ranked,
        summary: {
          filters: serialize(filters),
          topAverageScore: ranked.length
            ? Math.round(
                ranked.reduce((sum, item) => sum + item.referenceScore, 0) /
                  ranked.length,
              )
            : 0,
        },
      });
    },
  );

  registerTool(
    server,
    "creatives.find_similar",
    {
      description: "Find creatives similar to one anchor creative.",
      inputSchema: {
        creativeId: z.string(),
        limit: z.number().int().min(1).max(50).optional(),
        country: z.string().optional(),
        store: storeEnum.optional(),
        format: creativeFormatEnum.optional(),
      },
    },
    async (args) => {
      const anchor = await fetchCreativeByIdOrThrow(args.creativeId);
      const candidates = await findSimilarCandidates(anchor, {
        limit: toLimitedTake(args.limit, 12, 50),
        country: args.country,
        store: args.store,
        format: args.format,
      });
      return textToolResult(`Similar creatives for ${anchor.creativeId}`, {
        anchor: toReferenceCreative(anchor),
        items: candidates,
      });
    },
  );

  registerTool(
    server,
    "creatives.reference_pack",
    {
      description:
        "Build a ready-to-use pack of reference creatives, similar items, patterns and key texts.",
      inputSchema: {
        creativeId: z.string().optional(),
        advertiserId: z.string().optional(),
        country: z.string().optional(),
        countries: z.array(z.string()).optional(),
        store: storeEnum.optional(),
        appId: z.string().optional(),
        appName: z.string().optional(),
        developer: z.string().optional(),
        advertiserName: z.string().optional(),
        category: z.string().optional(),
        format: creativeFormatEnum.optional(),
        q: z.string().optional(),
        activeOnly: z.boolean().optional(),
        minPublicDays: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(30).optional(),
      },
    },
    async (args) => {
      const limit = toLimitedTake(args.limit, 6, 30);
      let anchors: ReferenceCreativeRecord[] = [];
      if (args.creativeId) {
        anchors = [await fetchCreativeByIdOrThrow(args.creativeId)];
      } else {
        const filters = buildCreativeFiltersFromArgs({
          ...args,
          status: args.activeOnly ? "ACTIVE" : undefined,
        });
        const where = buildCreativeWhere(filters);
        const items = await prisma.creative.findMany({
          where: mergeWhere(
            where,
            args.category
              ? {
                  app: {
                    category: { contains: args.category, mode: "insensitive" },
                  },
                }
              : undefined,
          ),
          orderBy: { updatedAt: "desc" },
          take: Math.min(limit * 4, 100),
          select: REFERENCE_CREATIVE_SELECT,
        });
        anchors = items
          .sort(
            (left, right) =>
              computeReferenceScore(right as ReferenceCreativeRecord).score -
              computeReferenceScore(left as ReferenceCreativeRecord).score,
          )
          .slice(0, limit) as ReferenceCreativeRecord[];
      }

      const similar = anchors.length
        ? await findSimilarCandidates(anchors[0], { limit })
        : [];
      const allCreatives = [
        ...anchors,
        ...similar.map((item) => item.raw as ReferenceCreativeRecord),
      ];
      const uniqueCreatives = uniqueBy(allCreatives, (item) => item.creativeId);
      return textToolResult(
        `Reference pack: ${uniqueCreatives.length} creatives`,
        {
          anchors: anchors.map((item) => toReferenceCreative(item)),
          similar,
          keyTexts: uniqueCreatives
            .map((item) => ({
              creativeId: item.creativeId,
              title: resolveCreativeTitle(item),
              description: resolveCreativeDescription(item),
            }))
            .filter((item) => item.title || item.description),
          geoSpread: [
            ...new Set(
              uniqueCreatives.flatMap((item) =>
                item.countries
                  .map((country) => country.countryCode)
                  .filter(Boolean),
              ),
            ),
          ],
          assetUrls: uniqueCreatives.map((item) => ({
            creativeId: item.creativeId,
            assets: item.assets.map((asset) => ({
              kind: asset.kind,
              url: asset.url,
            })),
          })),
          patternSummary: buildReferenceSummary(uniqueCreatives),
          patterns: buildPatterns(uniqueCreatives),
          insights: buildReferencePackInsights(uniqueCreatives),
        },
      );
    },
  );

  registerTool(
    server,
    "creatives.compare",
    {
      description:
        "Compare multiple creatives side by side in a normalized table.",
      inputSchema: {
        creativeIds: z.array(z.string()).min(2).max(10),
      },
    },
    async (args) => {
      const creatives = await prisma.creative.findMany({
        where: { creativeId: { in: args.creativeIds } },
        select: REFERENCE_CREATIVE_SELECT,
      });
      return textToolResult(`Creative comparison: ${creatives.length}`, {
        items: compareCreatives(creatives as ReferenceCreativeRecord[]),
      });
    },
  );
}
