import { Prisma, prisma } from "@ad-monitor/db";
import * as z from "zod/v4";
import {
  computeReferenceScore,
  REFERENCE_CREATIVE_SELECT,
  toReferenceCreative,
  type ReferenceCreativeRecord,
} from "../intelligence.js";
import {
  MAX_LIMIT,
  serialize,
  textToolResult,
  toLimitedTake,
  toPage,
} from "../utils.js";
import { storeEnum, sortDirectionEnum } from "../tool-schemas.js";
import { appOrderBy } from "../tool-support.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerAppsTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "apps.list",
    {
      description:
        "List applications with filtering, sorting and creative counts.",
      inputSchema: {
        q: z.string().optional(),
        store: storeEnum.optional(),
        developer: z.string().optional(),
        category: z.string().optional(),
        minCreatives: z.number().int().min(0).optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
        sortBy: z
          .enum(["lastSeenAt", "firstSeenAt", "name", "appId", "store"])
          .optional(),
        sortDir: sortDirectionEnum.optional(),
      },
    },
    async (args) => {
      const paging = toPage(args.page, args.limit);
      const where: Prisma.AppWhereInput = {
        store: args.store,
        developer: args.developer
          ? { contains: args.developer, mode: "insensitive" }
          : undefined,
        category: args.category
          ? { contains: args.category, mode: "insensitive" }
          : undefined,
        OR: args.q
          ? [
              { appId: { contains: args.q, mode: "insensitive" } },
              { name: { contains: args.q, mode: "insensitive" } },
              { developer: { contains: args.q, mode: "insensitive" } },
            ]
          : undefined,
      };

      const [total, items] = await Promise.all([
        prisma.app.count({
          where: {
            ...where,
            creatives: args.minCreatives ? { some: {} } : undefined,
          },
        }),
        prisma.app.findMany({
          where,
          orderBy: appOrderBy(args.sortBy, args.sortDir),
          skip: paging.skip,
          take: paging.limit,
          include: {
            _count: { select: { creatives: true } },
          },
        }),
      ]);

      const filtered = args.minCreatives
        ? items.filter((item) => item._count.creatives >= args.minCreatives!)
        : items;

      return textToolResult(`Apps: ${filtered.length} of ${total}`, {
        total,
        page: paging.page,
        limit: paging.limit,
        hasMore: paging.skip + items.length < total,
        items: filtered,
      });
    },
  );

  registerTool(
    server,
    "apps.get",
    {
      description: "Get one app with recent creatives.",
      inputSchema: {
        appId: z.string(),
        store: storeEnum.optional(),
        creativesLimit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => {
      const app = await prisma.app.findFirst({
        where: {
          appId: args.appId,
          store: args.store,
        },
        include: {
          _count: { select: { creatives: true } },
          creatives: {
            orderBy: { updatedAt: "desc" },
            take: toLimitedTake(args.creativesLimit, 30, 100),
            select: REFERENCE_CREATIVE_SELECT,
          },
        },
      });
      if (!app) throw new Error("App not found.");
      const recentCreatives = app.creatives.map((creative) =>
        toReferenceCreative(creative as ReferenceCreativeRecord),
      );
      const advertisersCount = new Set(
        app.creatives.map((creative) => creative.advertiserId),
      ).size;
      const geoCoverage = [
        ...new Set(
          app.creatives.flatMap((creative) =>
            creative.countries
              .map((country) => country.countryCode)
              .filter(Boolean),
          ),
        ),
      ];
      return textToolResult(`App ${app.appId}`, {
        ...serialize({
          ...app,
          creatives: recentCreatives,
        }),
        summary: {
          totalCreatives: app._count.creatives,
          activeCreatives: app.creatives.filter(
            (creative) => creative.status === "ACTIVE",
          ).length,
          advertisersCount,
          countriesCoverageCount: geoCoverage.length,
          countriesCoverage: geoCoverage,
        },
      });
    },
  );

  registerTool(
    server,
    "apps.find_reference_sets",
    {
      description: "Find apps with many active and reference-worthy creatives.",
      inputSchema: {
        store: storeEnum.optional(),
        developer: z.string().optional(),
        category: z.string().optional(),
        q: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async (args) => {
      const apps = await prisma.app.findMany({
        where: {
          store: args.store,
          developer: args.developer
            ? { contains: args.developer, mode: "insensitive" }
            : undefined,
          category: args.category
            ? { contains: args.category, mode: "insensitive" }
            : undefined,
          OR: args.q
            ? [
                { appId: { contains: args.q, mode: "insensitive" } },
                { name: { contains: args.q, mode: "insensitive" } },
                { developer: { contains: args.q, mode: "insensitive" } },
              ]
            : undefined,
          creatives: { some: {} },
        },
        orderBy: { lastSeenAt: "desc" },
        take: toLimitedTake(args.limit, 15, 50),
        include: {
          _count: { select: { creatives: true } },
          creatives: {
            orderBy: { updatedAt: "desc" },
            take: 20,
            select: REFERENCE_CREATIVE_SELECT,
          },
        },
      });
      const items = apps
        .map((app) => {
          const scores = app.creatives.map(
            (creative) =>
              computeReferenceScore(creative as ReferenceCreativeRecord).score,
          );
          return serialize({
            appId: app.appId,
            store: app.store,
            name: app.name,
            developer: app.developer,
            category: app.category,
            totalCreatives: app._count.creatives,
            activeCreatives: app.creatives.filter(
              (creative) => creative.status === "ACTIVE",
            ).length,
            averageReferenceScore: scores.length
              ? Math.round(
                  scores.reduce((sum, value) => sum + value, 0) / scores.length,
                )
              : 0,
            sampleCreatives: app.creatives
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
      return textToolResult(`Reference app sets: ${items.length}`, { items });
    },
  );
}
