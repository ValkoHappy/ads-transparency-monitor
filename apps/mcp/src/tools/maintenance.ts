import {
  prisma,
  recomputeCreativeStatuses,
  refreshAdvertiserCounters,
} from "@ad-monitor/db";
import * as z from "zod/v4";
import { textToolResult } from "../utils.js";
import { requireAdvertiser } from "../tool-support.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerMaintenanceTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "maintenance.recompute_creative_statuses",
    {
      description:
        "Recompute creative statuses using the current 14-day activity window.",
      accessLevel: "READ_WRITE",
      adminOnly: true,
      inputSchema: {
        advertiserId: z.string().optional(),
      },
    },
    async (args) => {
      const advertiser = args.advertiserId
        ? await requireAdvertiser(args.advertiserId)
        : null;
      const result = await recomputeCreativeStatuses(
        { advertiserId: advertiser?.id },
        prisma,
      );

      return textToolResult("Creative statuses recomputed", {
        advertiserId: result.advertiserId,
        total: result.total,
        active: result.active,
        stopped: result.stopped,
        unknown: result.unknown,
      });
    },
  );

  registerTool(
    server,
    "maintenance.refresh_advertiser_counters",
    {
      description:
        "Refresh stored advertiser creative counters for one advertiser or all advertisers.",
      accessLevel: "READ_WRITE",
      adminOnly: true,
      inputSchema: {
        advertiserId: z.string().optional(),
      },
    },
    async (args) => {
      if (args.advertiserId) {
        const advertiser = await requireAdvertiser(args.advertiserId);
        const updated = await refreshAdvertiserCounters(advertiser.id, prisma);
        return textToolResult(
          `Advertiser counters refreshed: ${advertiser.googleAdvertiserId}`,
          updated,
        );
      }

      const advertisers = await prisma.advertiser.findMany({
        select: { id: true, googleAdvertiserId: true },
      });
      await Promise.all(
        advertisers.map((item) => refreshAdvertiserCounters(item.id, prisma)),
      );
      return textToolResult(
        `Advertiser counters refreshed for ${advertisers.length} advertisers`,
        {
          total: advertisers.length,
        },
      );
    },
  );
}
