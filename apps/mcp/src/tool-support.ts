import {
  type McpAccessLevel,
  Prisma,
  buildCreativeWhere,
  prisma,
  queueAdvertiserScan,
  sanitizeOperationalMessage,
} from "@ad-monitor/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import {
  computeSimilarity,
  getCreativeIssues,
  REFERENCE_CREATIVE_SELECT,
  toReferenceCreative,
  type ReferenceCreativeRecord,
} from "./intelligence.js";
import {
  computeCreativeStatus,
  mapSortDirection,
  maskProxyUrl,
  normalizeCountryCodes,
  normalizeDateInput,
  normalizeProxyList,
  serialize,
  toolError,
} from "./utils.js";
import { repairModeEnum, McpRequestAccess } from "./tool-schemas.js";

export function buildCreativeFiltersFromArgs(args: Record<string, unknown>) {
  return {
    advertiserId:
      typeof args.advertiserId === "string" ? args.advertiserId : undefined,
    creativeIds: Array.isArray(args.creativeIds)
      ? args.creativeIds.filter(
          (item): item is string => typeof item === "string",
        )
      : undefined,
    country:
      typeof args.country === "string"
        ? args.country.trim().toUpperCase()
        : undefined,
    countries: Array.isArray(args.countries)
      ? normalizeCountryCodes(args.countries)
      : undefined,
    status: args.status as "ACTIVE" | "STOPPED" | "UNKNOWN" | undefined,
    format: args.format as "TEXT" | "IMAGE" | "VIDEO" | "UNKNOWN" | undefined,
    store: args.store as "GOOGLE_PLAY" | "APP_STORE" | "UNKNOWN" | undefined,
    appId: typeof args.appId === "string" ? args.appId : undefined,
    appName: typeof args.appName === "string" ? args.appName : undefined,
    developer: typeof args.developer === "string" ? args.developer : undefined,
    advertiserName:
      typeof args.advertiserName === "string" ? args.advertiserName : undefined,
    q: typeof args.q === "string" ? args.q : undefined,
    activity: args.activity as "NEW_TODAY" | "DISAPPEARED" | undefined,
    dateField: args.dateField as
      | "firstShownAt"
      | "lastShownAt"
      | "firstFoundAt"
      | "lastFoundAt"
      | "updatedAt"
      | "createdAt"
      | undefined,
    dateFrom: normalizeDateInput(args.dateFrom),
    dateTo: normalizeDateInput(args.dateTo),
    updatedSince: normalizeDateInput(args.updatedSince),
    firstShownSince: normalizeDateInput(args.firstShownSince),
    lastShownSince: normalizeDateInput(args.lastShownSince),
    hasTitle: typeof args.hasTitle === "boolean" ? args.hasTitle : undefined,
    hasDescription:
      typeof args.hasDescription === "boolean"
        ? args.hasDescription
        : undefined,
    hasGeo: typeof args.hasGeo === "boolean" ? args.hasGeo : undefined,
    hasVideo: typeof args.hasVideo === "boolean" ? args.hasVideo : undefined,
    hasImage: typeof args.hasImage === "boolean" ? args.hasImage : undefined,
    hasApp: typeof args.hasApp === "boolean" ? args.hasApp : undefined,
    hasDetails:
      typeof args.hasDetails === "boolean" ? args.hasDetails : undefined,
    hasPreview:
      typeof args.hasPreview === "boolean" ? args.hasPreview : undefined,
    hasAssets: typeof args.hasAssets === "boolean" ? args.hasAssets : undefined,
    minPublicDays:
      typeof args.minPublicDays === "number" ? args.minPublicDays : undefined,
  };
}

export async function fetchCreativeByIdOrThrow(creativeId: string) {
  const creative = await prisma.creative.findUnique({
    where: { creativeId },
    select: REFERENCE_CREATIVE_SELECT,
  });
  if (!creative) throw new Error("Creative not found.");
  return creative as ReferenceCreativeRecord;
}

export async function loadCreativeSelection(
  args: Record<string, unknown>,
  take: number,
) {
  const filters = buildCreativeFiltersFromArgs(args);
  const where = buildCreativeWhere(filters);
  return prisma.creative.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take,
    select: REFERENCE_CREATIVE_SELECT,
  }) as Promise<ReferenceCreativeRecord[]>;
}

export async function findSimilarCandidates(
  anchor: ReferenceCreativeRecord,
  options: { limit: number; country?: string; store?: string; format?: string },
) {
  const baseOr = [
    anchor.app?.appId ? { app: { appId: anchor.app.appId } } : undefined,
    anchor.app?.developer
      ? { app: { developer: anchor.app.developer } }
      : undefined,
    anchor.app?.category
      ? { app: { category: anchor.app.category } }
      : undefined,
    anchor.format ? { format: anchor.format } : undefined,
  ].filter(Boolean) as Prisma.CreativeWhereInput[];
  const where = mergeWhere(
    {
      id: { not: anchor.id },
      OR: baseOr.length ? baseOr : undefined,
    },
    options.country
      ? {
          countries: {
            some: { countryCode: options.country.trim().toUpperCase() },
          },
        }
      : undefined,
    options.store ? { app: { store: options.store as any } } : undefined,
    options.format ? { format: options.format as any } : undefined,
  );
  const candidates = await prisma.creative.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(options.limit * 6, 150),
    select: REFERENCE_CREATIVE_SELECT,
  });
  return candidates
    .map((candidate) => {
      const similarity = computeSimilarity(
        anchor,
        candidate as ReferenceCreativeRecord,
      );
      return {
        ...toReferenceCreative(candidate as ReferenceCreativeRecord),
        similarityScore: similarity.score,
        similarityReasons: similarity.reasons,
        raw: candidate as ReferenceCreativeRecord,
      };
    })
    .sort(
      (left, right) =>
        right.similarityScore - left.similarityScore ||
        right.referenceScore - left.referenceScore,
    )
    .slice(0, options.limit);
}

export async function tryBackfillCreativeApp(
  creative: ReferenceCreativeRecord,
) {
  const appId = creative.app?.appId?.trim();
  if (!appId) return false;
  const app = await prisma.app.findFirst({
    where: {
      appId,
      store: creative.app?.store ?? undefined,
    },
    select: { id: true },
  });
  if (!app || creative.appDbId === app.id) return false;
  await prisma.creative.update({
    where: { id: creative.id },
    data: { appDbId: app.id },
  });
  return true;
}

export async function queueRepairForCreatives(
  creatives: ReferenceCreativeRecord[],
  mode: z.infer<typeof repairModeEnum>,
) {
  if (mode === "STATUS_ONLY") {
    const updated = await Promise.all(
      creatives.map((creative) =>
        prisma.creative.update({
          where: { id: creative.id },
          data: {
            status: computeCreativeStatus(
              creative.lastShownAt,
              creative.lastFoundAt,
            ),
          },
        }),
      ),
    );
    return updated.map((item) => ({
      creativeId: item.creativeId,
      mode,
      status: item.status,
    }));
  }
  if (mode === "APP_LINK_ONLY") {
    const results = await Promise.all(
      creatives.map(async (creative) => ({
        creativeId: creative.creativeId,
        mode,
        linked: await tryBackfillCreativeApp(creative),
      })),
    );
    return results;
  }

  const grouped = new Map<
    string,
    { advertiserId: string; countries: Set<string> }
  >();
  for (const creative of creatives) {
    const entry = grouped.get(creative.advertiserId) ?? {
      advertiserId: creative.advertiserId,
      countries: new Set<string>(),
    };
    for (const country of creative.countries) {
      if (country.countryCode) entry.countries.add(country.countryCode);
    }
    grouped.set(creative.advertiserId, entry);
  }
  const jobs = [];
  for (const entry of grouped.values()) {
    const advertiser = await requireAdvertiser(entry.advertiserId);
    const job = await queueAdvertiserScan(advertiser.id, [...entry.countries], {
      scanMode: "FULL",
      refreshDetails: true,
    });
    jobs.push({
      advertiserId: advertiser.id,
      googleAdvertiserId: advertiser.googleAdvertiserId,
      scanJobId: job.id,
      mode,
    });
  }
  return jobs;
}

export function summarizeAdvertiserDiagnostics(
  advertiserId: string,
  creatives: ReferenceCreativeRecord[],
) {
  const counts = {
    totalCreatives: creatives.length,
    missingApp: 0,
    missingDetails: 0,
    missingPreview: 0,
    missingGeo: 0,
    missingTitle: 0,
    missingDescription: 0,
    missingAssets: 0,
    statusOutOfSync: 0,
  };
  for (const creative of creatives) {
    const issues = getCreativeIssues(creative);
    if (issues.includes("missing_app_link")) counts.missingApp += 1;
    if (issues.includes("missing_details")) counts.missingDetails += 1;
    if (issues.includes("missing_preview")) counts.missingPreview += 1;
    if (issues.includes("missing_geo")) counts.missingGeo += 1;
    if (issues.includes("missing_title")) counts.missingTitle += 1;
    if (issues.includes("missing_description")) counts.missingDescription += 1;
    if (issues.includes("missing_assets")) counts.missingAssets += 1;
    if (issues.includes("status_out_of_sync")) counts.statusOutOfSync += 1;
  }
  return serialize({
    advertiserId,
    counts,
    sampleIssues: creatives
      .slice(0, 20)
      .map((creative) => ({
        creativeId: creative.creativeId,
        issues: getCreativeIssues(creative),
      }))
      .filter((item) => item.issues.length > 0),
  });
}

export function mergeWhere(
  ...parts: Array<Prisma.CreativeWhereInput | undefined>
) {
  const filtered = parts.filter(Boolean) as Prisma.CreativeWhereInput[];
  if (!filtered.length) return undefined;
  if (filtered.length === 1) return filtered[0];
  return { AND: filtered };
}

export function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function registerScopedTool(
  server: McpServer,
  access: McpRequestAccess,
  name: string,
  config: any,
  handler: (args: any, extra: any) => Promise<any>,
) {
  const policy = {
    accessLevel: config.accessLevel as McpAccessLevel | undefined,
    adminOnly: Boolean(config.adminOnly),
  };
  const requiredAccess = policy.accessLevel ?? "READ";
  if (!toolAllowed(requiredAccess, policy.adminOnly)) return;
  const {
    accessLevel: _accessLevel,
    adminOnly: _adminOnly,
    ...toolConfig
  } = config;
  server.registerTool(
    name,
    toolConfig as any,
    (async (args: any, extra: any) => {
      try {
        return await handler(args, extra);
      } catch (error) {
        return toolError(error);
      }
    }) as any,
  );

  function toolAllowed(required: McpAccessLevel, adminOnly: boolean) {
    if (adminOnly && !access.isAdmin) return false;
    if (required === "READ_WRITE" && access.accessLevel !== "READ_WRITE")
      return false;
    return true;
  }
}

export function advertiserOrderBy(
  field?: string,
  direction?: "asc" | "desc",
): Prisma.AdvertiserOrderByWithRelationInput {
  const dir = mapSortDirection(direction);
  switch (field) {
    case "createdAt":
    case "name":
    case "googleAdvertiserId":
    case "totalCreatives":
    case "activeCreatives":
    case "lastScanAt":
    case "lastSuccessfulScanAt":
      return { [field]: dir };
    default:
      return { updatedAt: dir };
  }
}

export function creativeOrderBy(
  field?: string,
  direction?: "asc" | "desc",
): Prisma.CreativeOrderByWithRelationInput {
  const dir = mapSortDirection(direction);
  switch (field) {
    case "createdAt":
    case "creativeId":
    case "status":
    case "firstShownAt":
    case "lastShownAt":
    case "firstFoundAt":
    case "lastFoundAt":
    case "publicDays":
    case "detailFetchedAt":
    case "impressionsMax":
      return { [field]: dir };
    case "countriesCount":
      return { countries: { _count: dir } };
    default:
      return { updatedAt: dir };
  }
}

export function appOrderBy(
  field?: string,
  direction?: "asc" | "desc",
): Prisma.AppOrderByWithRelationInput {
  const dir = mapSortDirection(direction);
  switch (field) {
    case "firstSeenAt":
    case "name":
    case "appId":
    case "store":
      return { [field]: dir };
    default:
      return { lastSeenAt: dir };
  }
}

export function scanOrderBy(
  field?: string,
  direction?: "asc" | "desc",
): Prisma.ScanJobOrderByWithRelationInput {
  const dir = mapSortDirection(direction);
  switch (field) {
    case "updatedAt":
    case "scheduledFor":
    case "startedAt":
    case "finishedAt":
    case "status":
    case "scanMode":
    case "creativesFound":
    case "detailsFetched":
    case "previewsFetched":
    case "pagesFetched":
      return { [field]: dir };
    default:
      return { createdAt: dir };
  }
}

export function proxyOrderBy(
  field?: string,
  direction?: "asc" | "desc",
): Prisma.ProxyEndpointOrderByWithRelationInput {
  const dir = mapSortDirection(direction);
  switch (field) {
    case "createdAt":
    case "lastUsedAt":
    case "status":
    case "failCount":
      return { [field]: dir };
    default:
      return { updatedAt: dir };
  }
}

export function buildDateRange(dateFrom?: string, dateTo?: string) {
  const from = normalizeDateInput(dateFrom);
  const to = normalizeDateInput(dateTo);
  if (!from && !to) return undefined;
  return {
    gte: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
    lte: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
  };
}

export async function findAdvertiser(
  id: string,
  options: {
    creativesLimit?: number;
    scanJobsLimit?: number;
    scansLimit?: number;
    scanEventsLimit?: number;
    includeActiveJob?: boolean;
  } = {},
) {
  return prisma.advertiser.findFirst({
    where: {
      OR: [{ id }, { googleAdvertiserId: id }],
    },
    include: {
      creatives: options.creativesLimit
        ? {
            orderBy: { updatedAt: "desc" },
            include: {
              app: true,
              countries: { take: 8 },
              assets: { take: 1 },
            },
            take: options.creativesLimit,
          }
        : false,
      scanJobs: options.includeActiveJob
        ? {
            where: { status: { in: ["QUEUED", "RUNNING"] } },
            select: { id: true, status: true },
            take: 1,
          }
        : options.scanJobsLimit
          ? {
              orderBy: { createdAt: "desc" },
              include: {
                events: {
                  orderBy: { createdAt: "desc" },
                  take: options.scanEventsLimit ?? 5,
                },
              },
              take: options.scanJobsLimit,
            }
          : false,
      scans: options.scansLimit
        ? { orderBy: { startedAt: "desc" }, take: options.scansLimit }
        : false,
    },
  });
}

export async function requireAdvertiser(
  id: string,
  options?: Parameters<typeof findAdvertiser>[1],
) {
  const advertiser = await findAdvertiser(id, options);
  if (!advertiser) throw new Error("Advertiser not found.");
  return advertiser;
}

export function sanitizeScanJob<
  T extends {
    errorMessage?: string | null;
    blockedReason?: string | null;
    events?: Array<{ message: string; data?: unknown }>;
    scans?: Array<{
      errorMessage?: string | null;
      blockedReason?: string | null;
    }>;
  },
>(job: T) {
  return serialize({
    ...job,
    errorMessage: job.errorMessage
      ? sanitizeOperationalMessage(job.errorMessage)
      : job.errorMessage,
    blockedReason: job.blockedReason
      ? sanitizeOperationalMessage(job.blockedReason)
      : job.blockedReason,
    scans: job.scans?.map((scan) => ({
      ...scan,
      errorMessage: scan.errorMessage
        ? sanitizeOperationalMessage(scan.errorMessage)
        : scan.errorMessage,
      blockedReason: scan.blockedReason
        ? sanitizeOperationalMessage(scan.blockedReason)
        : scan.blockedReason,
    })),
    events: job.events?.map((event) => ({
      ...event,
      message: sanitizeOperationalMessage(event.message),
    })),
  });
}

export async function syncProxyPool(urlsInput: string[]) {
  const urls = normalizeProxyList(urlsInput);
  const existing = await prisma.proxyEndpoint.findMany({
    select: { id: true, url: true },
  });
  await Promise.all([
    ...urls.map((url) =>
      prisma.proxyEndpoint.upsert({
        where: { url },
        create: { url, status: "OK" },
        update: {},
      }),
    ),
    ...existing
      .filter((proxy) => !urls.includes(proxy.url))
      .map((proxy) => prisma.proxyEndpoint.delete({ where: { id: proxy.id } })),
  ]);
  return {
    total: urls.length,
    urls: urls.map(maskProxyUrl),
  };
}
