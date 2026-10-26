import { prisma } from "@ad-monitor/db";
import { textToolResult } from "../utils.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerDashboardTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "dashboard.stats",
    {
      description:
        "Get dashboard counters and compact top statistics for formats, stores and statuses.",
      inputSchema: {},
    },
    async () => {
      const [
        advertisers,
        creatives,
        activeCreatives,
        apps,
        scans,
        formatStats,
        storeStats,
        statusStats,
        countryStats,
        latestJobs,
      ] = await Promise.all([
        prisma.advertiser.count(),
        prisma.creative.count(),
        prisma.creative.count({ where: { status: "ACTIVE" } }),
        prisma.app.count(),
        prisma.scan.count(),
        prisma.creative.groupBy({
          by: ["format"],
          _count: { _all: true },
          orderBy: { _count: { format: "desc" } },
        }),
        prisma.app.groupBy({
          by: ["store"],
          _count: { _all: true },
          orderBy: { _count: { store: "desc" } },
        }),
        prisma.scanJob.groupBy({
          by: ["status"],
          _count: { _all: true },
          orderBy: { _count: { status: "desc" } },
        }),
        prisma.creativeCountry.groupBy({
          by: ["countryCode"],
          _count: { _all: true },
          where: { countryCode: { not: null } },
          orderBy: { _count: { countryCode: "desc" } },
          take: 15,
        }),
        prisma.scanJob.findMany({
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { advertiser: true },
        }),
      ]);

      return textToolResult("Dashboard stats", {
        totals: { advertisers, creatives, activeCreatives, apps, scans },
        formatStats,
        storeStats,
        statusStats,
        countryStats,
        recentScanVolume: latestJobs
          .slice()
          .reverse()
          .map((job) => ({
            id: job.id,
            createdAt: job.createdAt,
            status: job.status,
            creativesFound: job.creativesFound,
            detailsFetched: job.detailsFetched,
            previewsFetched: job.previewsFetched,
            advertiserName:
              job.advertiser.name ?? job.advertiser.googleAdvertiserId,
            googleAdvertiserId: job.advertiser.googleAdvertiserId,
          })),
      });
    },
  );
}
