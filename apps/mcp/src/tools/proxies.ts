import { Prisma, prisma } from "@ad-monitor/db";
import * as z from "zod/v4";
import {
  maskProxyUrl,
  MAX_LIMIT,
  normalizeProxyUrl,
  textToolResult,
  toPage,
} from "../utils.js";
import { sortDirectionEnum, proxyStatusEnum } from "../tool-schemas.js";
import { proxyOrderBy, syncProxyPool } from "../tool-support.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRequestAccess } from "../tool-schemas.js";
import type { ToolRegistrar } from "../tool-registrar.js";

export function registerProxiesTools(
  server: McpServer,
  registerTool: ToolRegistrar,
  access: McpRequestAccess,
) {
  registerTool(
    server,
    "proxies.list",
    {
      description:
        "List proxy endpoints with filtering, sorting and pagination.",
      inputSchema: {
        q: z.string().optional(),
        status: proxyStatusEnum.optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
        sortBy: z
          .enum(["updatedAt", "createdAt", "lastUsedAt", "status", "failCount"])
          .optional(),
        sortDir: sortDirectionEnum.optional(),
        includeCredentials: z.boolean().optional(),
      },
    },
    async (args) => {
      const paging = toPage(args.page, args.limit);
      const where: Prisma.ProxyEndpointWhereInput = {
        status: args.status,
        OR: args.q
          ? [
              { url: { contains: args.q, mode: "insensitive" } },
              { lastError: { contains: args.q, mode: "insensitive" } },
            ]
          : undefined,
      };
      const [total, items] = await Promise.all([
        prisma.proxyEndpoint.count({ where }),
        prisma.proxyEndpoint.findMany({
          where,
          orderBy: proxyOrderBy(args.sortBy, args.sortDir),
          skip: paging.skip,
          take: paging.limit,
        }),
      ]);
      return textToolResult(`Proxies: ${items.length} of ${total}`, {
        total,
        page: paging.page,
        limit: paging.limit,
        hasMore: paging.skip + items.length < total,
        items: items.map((item) => ({
          ...item,
          url: args.includeCredentials ? item.url : maskProxyUrl(item.url),
        })),
      });
    },
  );

  registerTool(
    server,
    "proxies.upsert",
    {
      description: "Create or update one proxy endpoint.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        url: z.string(),
        status: proxyStatusEnum.optional(),
        blockedUntil: z.string().nullable().optional(),
        lastError: z.string().nullable().optional(),
        failCount: z.number().int().min(0).optional(),
      },
    },
    async (args) => {
      const normalized = normalizeProxyUrl(args.url);
      if (!normalized) throw new Error("Invalid proxy URL.");
      const proxy = await prisma.proxyEndpoint.upsert({
        where: { url: normalized },
        create: {
          url: normalized,
          status: args.status ?? "OK",
          blockedUntil: args.blockedUntil ? new Date(args.blockedUntil) : null,
          lastError: args.lastError ?? null,
          failCount: args.failCount ?? 0,
        },
        update: {
          status: args.status,
          blockedUntil:
            args.blockedUntil === undefined
              ? undefined
              : args.blockedUntil
                ? new Date(args.blockedUntil)
                : null,
          lastError: args.lastError === undefined ? undefined : args.lastError,
          failCount: args.failCount,
        },
      });
      return textToolResult(`Proxy saved: ${proxy.id}`, {
        ...proxy,
        url: maskProxyUrl(proxy.url),
      });
    },
  );

  registerTool(
    server,
    "proxies.delete",
    {
      description: "Delete proxy by id or exact URL.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        id: z.string().optional(),
        url: z.string().optional(),
      },
    },
    async (args) => {
      if (!args.id && !args.url) throw new Error("Provide id or url.");
      const proxy = await prisma.proxyEndpoint.findFirst({
        where: {
          OR: [
            args.id ? { id: args.id } : undefined,
            args.url
              ? { url: normalizeProxyUrl(args.url) || args.url }
              : undefined,
          ].filter(Boolean) as Prisma.ProxyEndpointWhereInput[],
        },
      });
      if (!proxy) throw new Error("Proxy not found.");
      await prisma.proxyEndpoint.delete({ where: { id: proxy.id } });
      return textToolResult(`Proxy deleted: ${proxy.id}`, {
        ok: true,
        proxyId: proxy.id,
        url: maskProxyUrl(proxy.url),
      });
    },
  );

  registerTool(
    server,
    "proxies.sync_pool",
    {
      description: "Synchronize proxy pool from a full list of URLs.",
      accessLevel: "READ_WRITE",
      inputSchema: {
        urls: z.array(z.string()),
      },
    },
    async (args) => {
      const result = await syncProxyPool(args.urls);
      return textToolResult("Proxy pool synchronized", result);
    },
  );
}
