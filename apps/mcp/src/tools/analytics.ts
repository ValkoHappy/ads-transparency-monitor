import * as z from "zod/v4";
import {
  buildPatterns,
  buildReferenceSummary,
  toReferenceCreative,
} from "../intelligence.js";
import { textToolResult, toLimitedTake } from "../utils.js";
import {
  creativeStatusEnum,
  creativeFormatEnum,
  storeEnum,
} from "../tool-schemas.js";
import { loadCreativeSelection } from "../tool-support.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerAnalyticsTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "analytics.patterns",
    {
      description:
        "Extract repeated title/description, format, geo and asset patterns from a creative selection.",
      inputSchema: {
        creativeIds: z.array(z.string()).optional(),
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
        status: creativeStatusEnum.optional(),
        limit: z.number().int().min(1).max(300).optional(),
      },
    },
    async (args) => {
      const creatives = await loadCreativeSelection(
        args,
        toLimitedTake(args.limit, 100, 300),
      );
      return textToolResult(
        `Patterns for ${creatives.length} creatives`,
        buildPatterns(creatives),
      );
    },
  );

  registerTool(
    server,
    "analytics.reference_summary",
    {
      description:
        "Build a compact reference-oriented summary for a creative selection.",
      inputSchema: {
        creativeIds: z.array(z.string()).optional(),
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
        status: creativeStatusEnum.optional(),
        limit: z.number().int().min(1).max(300).optional(),
      },
    },
    async (args) => {
      const creatives = await loadCreativeSelection(
        args,
        toLimitedTake(args.limit, 100, 300),
      );
      return textToolResult(
        `Reference summary for ${creatives.length} creatives`,
        buildReferenceSummary(creatives),
      );
    },
  );

  registerTool(
    server,
    "analytics.top_creatives",
    {
      description: "Rank creatives by heuristic reference score.",
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
        status: creativeStatusEnum.optional(),
        minPublicDays: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => {
      const creatives = await loadCreativeSelection(
        args,
        Math.min(toLimitedTake(args.limit, 20, 100) * 4, 250),
      );
      const items = creatives
        .map((creative) => toReferenceCreative(creative) as any)
        .sort(
          (left, right) =>
            right.referenceScore - left.referenceScore ||
            String(right.lastShownAt).localeCompare(String(left.lastShownAt)),
        )
        .slice(0, toLimitedTake(args.limit, 20, 100));
      return textToolResult(`Top creatives: ${items.length}`, { items });
    },
  );
}
