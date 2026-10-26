import { Prisma, buildCreativeWhere, prisma } from "@ad-monitor/db";
import * as z from "zod/v4";
import {
  toReferenceCreative,
  type ReferenceCreativeRecord,
} from "../intelligence.js";
import {
  MAX_LIMIT,
  MAX_SNAPSHOT_LIMIT,
  textToolResult,
  toLimitedTake,
  toPage,
} from "../utils.js";
import {
  creativeStatusEnum,
  creativeFormatEnum,
  storeEnum,
  sortDirectionEnum,
  activityEnum,
  dateFieldEnum,
  rawSnapshotKindEnum,
} from "../tool-schemas.js";
import {
  buildCreativeFiltersFromArgs,
  creativeOrderBy,
} from "../tool-support.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerCreativesTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "creatives.list",
    {
      description:
        "List creatives with full filter set, sorting, pagination and optional nested includes.",
      inputSchema: {
        advertiserId: z.string().optional(),
        creativeIds: z.array(z.string()).optional(),
        country: z.string().optional(),
        countries: z.array(z.string()).optional(),
        status: creativeStatusEnum.optional(),
        format: creativeFormatEnum.optional(),
        store: storeEnum.optional(),
        appId: z.string().optional(),
        appName: z.string().optional(),
        developer: z.string().optional(),
        advertiserName: z.string().optional(),
        q: z.string().optional(),
        activity: activityEnum.optional(),
        dateField: dateFieldEnum.optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        updatedSince: z.string().optional(),
        firstShownSince: z.string().optional(),
        lastShownSince: z.string().optional(),
        hasTitle: z.boolean().optional(),
        hasDescription: z.boolean().optional(),
        hasGeo: z.boolean().optional(),
        hasVideo: z.boolean().optional(),
        hasImage: z.boolean().optional(),
        hasApp: z.boolean().optional(),
        hasDetails: z.boolean().optional(),
        hasPreview: z.boolean().optional(),
        hasAssets: z.boolean().optional(),
        minPublicDays: z.number().int().min(0).optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
        sortBy: z
          .enum([
            "updatedAt",
            "createdAt",
            "creativeId",
            "status",
            "firstShownAt",
            "lastShownAt",
            "firstFoundAt",
            "lastFoundAt",
            "publicDays",
            "impressionsMax",
            "countriesCount",
            "detailFetchedAt",
          ])
          .optional(),
        sortDir: sortDirectionEnum.optional(),
        includeCountries: z.boolean().optional(),
        includeAssets: z.boolean().optional(),
        includeRawSnapshotCount: z.boolean().optional(),
      },
    },
    async (args) => {
      const paging = toPage(args.page, args.limit);
      const filters = buildCreativeFiltersFromArgs(args);
      const where = buildCreativeWhere(filters);
      const orderBy = creativeOrderBy(args.sortBy, args.sortDir);

      const [total, items] = await Promise.all([
        prisma.creative.count({ where }),
        prisma.creative.findMany({
          where,
          orderBy,
          skip: paging.skip,
          take: paging.limit,
          select: {
            id: true,
            creativeId: true,
            advertiserId: true,
            appDbId: true,
            title: true,
            description: true,
            format: true,
            status: true,
            previewUrl: true,
            firstShownAt: true,
            lastShownAt: true,
            publicDays: true,
            impressionsMin: true,
            impressionsMax: true,
            firstFoundAt: true,
            lastFoundAt: true,
            detailFetchedAt: true,
            createdAt: true,
            updatedAt: true,
            advertiser: {
              select: {
                id: true,
                googleAdvertiserId: true,
                name: true,
              },
            },
            app: {
              select: {
                id: true,
                appId: true,
                store: true,
                name: true,
                developer: true,
                category: true,
                storeUrl: true,
                description: true,
                shortDescription: true,
              },
            },
            countries: args.includeCountries
              ? {
                  orderBy: [{ impressionsMax: "desc" }, { updatedAt: "desc" }],
                  take: 50,
                }
              : {
                  select: {
                    id: true,
                    countryCode: true,
                    countryName: true,
                    googleGeoId: true,
                    impressionsMin: true,
                    impressionsMax: true,
                    firstShownDate: true,
                    lastShownDate: true,
                    updatedAt: true,
                  },
                  take: 8,
                  orderBy: [{ impressionsMax: "desc" }, { updatedAt: "desc" }],
                },
            assets: args.includeAssets
              ? {
                  select: {
                    id: true,
                    kind: true,
                    url: true,
                    width: true,
                    height: true,
                  },
                }
              : {
                  select: {
                    id: true,
                    kind: true,
                    url: true,
                    width: true,
                    height: true,
                  },
                  take: 12,
                },
            _count: {
              select: { rawSnapshots: true, countries: true, assets: true },
            },
          },
        }),
      ]);

      return textToolResult(`Creatives: ${items.length} of ${total}`, {
        total,
        page: paging.page,
        limit: paging.limit,
        hasMore: paging.skip + items.length < total,
        items: items.map((item) =>
          toReferenceCreative(item as ReferenceCreativeRecord),
        ),
      });
    },
  );

  registerTool(
    server,
    "creatives.get",
    {
      description:
        "Get one creative with full details, related app/advertiser, countries, assets and raw snapshots.",
      inputSchema: {
        creativeId: z.string(),
        rawSnapshotsLimit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SNAPSHOT_LIMIT)
          .optional(),
      },
    },
    async (args) => {
      const creative = await prisma.creative.findUnique({
        where: { creativeId: args.creativeId },
        select: {
          id: true,
          creativeId: true,
          advertiserId: true,
          appDbId: true,
          title: true,
          description: true,
          format: true,
          status: true,
          previewUrl: true,
          firstShownAt: true,
          lastShownAt: true,
          publicDays: true,
          impressionsMin: true,
          impressionsMax: true,
          firstFoundAt: true,
          lastFoundAt: true,
          detailFetchedAt: true,
          createdAt: true,
          updatedAt: true,
          rawList: true,
          rawDetail: true,
          rawPreview: true,
          advertiser: true,
          app: true,
          countries: {
            orderBy: [{ impressionsMax: "desc" }, { updatedAt: "desc" }],
          },
          assets: true,
          _count: {
            select: {
              countries: true,
              assets: true,
              rawSnapshots: true,
            },
          },
          rawSnapshots: {
            orderBy: { createdAt: "desc" },
            take: toLimitedTake(args.rawSnapshotsLimit, 20, MAX_SNAPSHOT_LIMIT),
          },
        },
      });
      if (!creative) throw new Error("Creative not found.");
      const referenceCard = toReferenceCreative(
        creative as ReferenceCreativeRecord,
      );
      return textToolResult(`Creative ${creative.creativeId}`, {
        ...referenceCard,
        collectionTimeline: {
          firstFoundAt: creative.firstFoundAt,
          detailFetchedAt: creative.detailFetchedAt,
          lastFoundAt: creative.lastFoundAt,
          updatedAt: creative.updatedAt,
        },
      });
    },
  );

  registerTool(
    server,
    "creatives.snapshots",
    {
      description: "List raw snapshots for one creative.",
      inputSchema: {
        creativeId: z.string(),
        kind: rawSnapshotKindEnum.optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_SNAPSHOT_LIMIT).optional(),
      },
    },
    async (args) => {
      const paging = toPage(args.page, args.limit ?? 20);
      const creative = await prisma.creative.findUnique({
        where: { creativeId: args.creativeId },
        select: { id: true, creativeId: true },
      });
      if (!creative) throw new Error("Creative not found.");
      const where: Prisma.RawApiSnapshotWhereInput = {
        creativeId: creative.id,
        kind: args.kind,
      };
      const [total, items] = await Promise.all([
        prisma.rawApiSnapshot.count({ where }),
        prisma.rawApiSnapshot.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: paging.skip,
          take: paging.limit,
        }),
      ]);
      return textToolResult(`Raw snapshots: ${items.length} of ${total}`, {
        creativeId: creative.creativeId,
        total,
        page: paging.page,
        limit: paging.limit,
        hasMore: paging.skip + items.length < total,
        items,
      });
    },
  );
}
