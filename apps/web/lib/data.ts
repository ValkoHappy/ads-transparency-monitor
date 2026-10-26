import { countCreatives, findCreatives, getSystemSettings, listMcpAccessTokens, parseCreativeFilters, Prisma, prisma, sanitizeOperationalMessage } from "@ad-monitor/db";
import { filterMeta, timeAsync } from "./perf";
import { sanitizePublicValue, sanitizeScanEvent } from "./sanitize";

type StatRow = {
  label: string | null;
  value: number | bigint;
};

const creativeDetailSelect = {
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
  rawDetail: true,
  advertiser: true,
  app: true,
  countries: { orderBy: { impressionsMax: "desc" } },
  assets: true,
  rawSnapshots: { orderBy: { createdAt: "desc" }, take: 20 }
} satisfies Prisma.CreativeSelect;

type CreativeDetailRecord = Prisma.CreativeGetPayload<{ select: typeof creativeDetailSelect }>;

export async function getDashboardData() {
  try {
    const [
      advertisers,
      creatives,
      activeCreatives,
      apps,
      scans,
      recentAdvertisers,
      recentCreatives,
      recentScanJobs,
      formatStats,
      storeStats,
      countryStats,
      scanStatusStats,
      scanJobsForStats
    ] = await timeAsync("page.dashboard.data", () => Promise.all([
      prisma.advertiser.count(),
      prisma.creative.count(),
      prisma.creative.count({ where: { status: "ACTIVE" } }),
      prisma.app.count(),
      prisma.scan.count(),
      prisma.advertiser.findMany({ orderBy: { updatedAt: "desc" }, take: 5 }),
      prisma.creative.findMany({
        orderBy: { updatedAt: "desc" },
        take: 6,
        include: { advertiser: true, app: true, countries: { take: 8 } }
      }),
      prisma.scanJob.findMany({ orderBy: { createdAt: "desc" }, take: 12, include: { advertiser: true, events: { orderBy: { createdAt: "desc" }, take: 1 } } }),
      dashboardFormatStats(),
      dashboardStoreStats(),
      dashboardCountryStats(),
      dashboardScanStatusStats(),
      prisma.scanJob.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { advertiser: true } })
    ]), { route: "/" });

    return {
      advertisers,
      creatives,
      activeCreatives,
      apps,
      scans,
      recentAdvertisers,
      recentCreatives,
      recentScanJobs,
      formatStats,
      storeStats,
      countryStats,
      scanStatusStats,
      scanVolumeStats: scanJobsForStats
        .slice(0, 10)
        .reverse()
        .map((scan) => ({
          label: new Date(scan.createdAt).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" }),
          timeLabel: new Date(scan.createdAt).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }),
          dateTimeLabel: new Date(scan.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
          finishedTimeLabel: scan.finishedAt ? new Date(scan.finishedAt).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }) : null,
          value: scan.creativesFound,
          details: scan.detailsFetched,
          previews: scan.previewsFetched,
          status: scan.status,
          advertiserName: scan.advertiser.name ?? scan.advertiser.googleAdvertiserId,
          googleAdvertiserId: scan.advertiser.googleAdvertiserId
        }))
    };
  } catch {
    if (process.env.NODE_ENV === "production") throw new Error("Dashboard data is unavailable.");
    return demoDashboardData();
  }
}

export async function getAdvertisers() {
  try {
    const advertisers = await timeAsync(
      "db.getAdvertisers",
      () => prisma.advertiser.findMany({
        orderBy: { updatedAt: "desc" },
        take: 500,
        include: {
          scanJobs: {
            take: 1,
            orderBy: { createdAt: "desc" },
            include: { events: { orderBy: { createdAt: "desc" }, take: 1 } }
          }
        }
      }),
      { take: 500 }
    );
    return advertisers.map((advertiser) => ({
      ...advertiser,
      scanJobs: advertiser.scanJobs.map((job) => ({
        ...job,
        errorMessage: job.errorMessage ? sanitizeOperationalMessage(job.errorMessage) : job.errorMessage,
        blockedReason: job.blockedReason ? sanitizeOperationalMessage(job.blockedReason) : job.blockedReason,
        events: job.events.map(sanitizeScanEvent)
      }))
    }));
  } catch {
    if (process.env.NODE_ENV === "production") throw new Error("Advertisers data is unavailable.");
    return demoDashboardData().recentAdvertisers;
  }
}

export async function getAdvertiser(id: string, options?: { scanEventsLimit?: number }) {
  try {
    const scanEventsLimit = Math.max(1, Math.min(options?.scanEventsLimit ?? 1, 200));
    const advertiser = await timeAsync("db.getAdvertiser", () => prisma.advertiser.findFirst({
      where: {
        OR: [
          { id },
          { googleAdvertiserId: id }
        ]
      },
      include: {
        creatives: {
          orderBy: { updatedAt: "desc" },
          include: {
            app: true,
            countries: { take: 8 },
            assets: { take: 1 }
          },
          take: 100
        },
        scanJobs: {
          orderBy: { createdAt: "desc" },
          include: { events: { orderBy: { createdAt: "desc" }, take: scanEventsLimit } },
          take: 20
        },
        scans: { orderBy: { startedAt: "desc" }, take: 10 }
      }
    }), { idKind: id.startsWith("AR") ? "googleAdvertiserId" : "id", scanEventsLimit });
    return advertiser ? {
      ...advertiser,
      scanJobs: advertiser.scanJobs.map((job) => ({
        ...job,
        errorMessage: job.errorMessage ? sanitizeOperationalMessage(job.errorMessage) : job.errorMessage,
        blockedReason: job.blockedReason ? sanitizeOperationalMessage(job.blockedReason) : job.blockedReason,
        events: job.events.map(sanitizeScanEvent)
      }))
    } : null;
  } catch {
    return null;
  }
}

export async function getCreatives(params?: {
  advertiserId?: string;
  country?: string;
  status?: string;
  format?: string;
  store?: string;
  appId?: string;
  q?: string;
  activity?: string;
  dateField?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  take?: number;
}) {
  try {
    const take = params?.take ?? 100;
    const page = Math.max(1, Number(params?.page ?? 1) || 1);
    const query = {
      advertiserId: params?.advertiserId,
      country: params?.country?.toUpperCase(),
      status: params?.status && params.status !== "ALL" ? params.status as never : undefined,
      format: params?.format && params.format !== "ALL" ? params.format as never : undefined,
      store: params?.store && params.store !== "ALL" ? params.store as never : undefined,
      appId: params?.appId,
      q: params?.q,
      activity: params?.activity && params.activity !== "ALL" ? params.activity as never : undefined,
      dateField: params?.dateField as never,
      dateFrom: params?.dateFrom,
      dateTo: params?.dateTo
    };
    return await timeAsync(
      "db.getCreatives",
      () => findCreatives(query, prisma, take, (page - 1) * take),
      { ...filterMeta({ ...params, page, take }), skip: (page - 1) * take },
      { always: true }
    );
  } catch {
    if (process.env.NODE_ENV === "production") throw new Error("Creatives data is unavailable.");
    return demoDashboardData().recentCreatives;
  }
}

export async function getCreativesCount(params?: {
  advertiserId?: string;
  country?: string;
  status?: string;
  format?: string;
  store?: string;
  appId?: string;
  q?: string;
  activity?: string;
  dateField?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const query = {
      advertiserId: params?.advertiserId,
      country: params?.country?.toUpperCase(),
      status: params?.status && params.status !== "ALL" ? params.status as never : undefined,
      format: params?.format && params.format !== "ALL" ? params.format as never : undefined,
      store: params?.store && params.store !== "ALL" ? params.store as never : undefined,
      appId: params?.appId,
      q: params?.q,
      activity: params?.activity && params.activity !== "ALL" ? params.activity as never : undefined,
      dateField: params?.dateField as never,
      dateFrom: params?.dateFrom,
      dateTo: params?.dateTo
    };
    return await timeAsync(
      "db.getCreativesCount",
      () => countCreatives(query, prisma),
      filterMeta(params),
      { always: true }
    );
  } catch {
    if (process.env.NODE_ENV === "production") throw new Error("Creatives count is unavailable.");
    return demoDashboardData().recentCreatives.length;
  }
}

export async function getCreative(creativeId: string): Promise<CreativeDetailRecord | null> {
  try {
    const creative = await timeAsync("db.getCreative", () => prisma.creative.findUnique({
      where: { creativeId },
      select: creativeDetailSelect
    }), { creativeId });
    return creative ? {
      ...creative,
      rawSnapshots: creative.rawSnapshots.map((snapshot) => ({
        ...snapshot,
        url: snapshot.url ? sanitizePublicValue(snapshot.url) : snapshot.url,
        payload: sanitizePublicValue(snapshot.payload)
      }))
    } : null;
  } catch {
    if (process.env.NODE_ENV === "production") throw new Error("Creative data is unavailable.");
    return demoDashboardData().recentCreatives.find((creative) => creative.creativeId === creativeId) ?? demoDashboardData().recentCreatives[0] ?? null;
  }
}

export async function getScans() {
  try {
    const jobs = await timeAsync("db.getScans", () => prisma.scanJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        advertiser: true,
        scans: { orderBy: { startedAt: "desc" }, take: 1 },
        events: { orderBy: { createdAt: "desc" }, take: 3 }
      }
    }), { take: 50 });
    return jobs.map((job) => ({
      ...job,
      errorMessage: job.errorMessage ? sanitizeOperationalMessage(job.errorMessage) : job.errorMessage,
      blockedReason: job.blockedReason ? sanitizeOperationalMessage(job.blockedReason) : job.blockedReason,
      scans: job.scans.map((scan) => ({
        ...scan,
        errorMessage: scan.errorMessage ? sanitizeOperationalMessage(scan.errorMessage) : scan.errorMessage,
        blockedReason: scan.blockedReason ? sanitizeOperationalMessage(scan.blockedReason) : scan.blockedReason
      })),
      events: job.events.map(sanitizeScanEvent)
    }));
  } catch {
    return [];
  }
}

export async function getExportStats() {
  try {
    const [creatives, rawSnapshots, advertisers, apps] = await Promise.all([
      prisma.creative.count(),
      prisma.rawApiSnapshot.count(),
      prisma.advertiser.count(),
      prisma.app.count()
    ]);
    return { creatives, rawSnapshots, advertisers, apps };
  } catch {
    return { creatives: 0, rawSnapshots: 0, advertisers: 0, apps: 0 };
  }
}

export async function getExportData(searchParams?: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => params.append(key, item));
    } else if (value) {
      params.set(key, value);
    }
  }

  const filters = parseCreativeFilters(params);
  const [stats, advertisers, apps, previewCount, settings, previewRows] = await timeAsync("page.export.data", () => Promise.all([
    getExportStats(),
    prisma.advertiser.findMany({ orderBy: { name: "asc" }, take: 1000 }),
    prisma.app.findMany({ orderBy: { name: "asc" }, take: 100 }),
    countCreatives(filters, prisma),
    getSystemSettings(prisma),
    findCreatives(filters, prisma, 100)
  ]), { hasFilters: params.size > 0 });

  return { stats, advertisers, apps, previewCount, settings, filters, previewRows };
}

export async function getSettingsData() {
  const [counts, settings, systemStatus, proxies, mcpTokens] = await timeAsync("page.settings.data", () => Promise.all([
    getSettingsCounts(),
    getSystemSettings(prisma),
    getSystemStatusData(),
    prisma.proxyEndpoint.findMany({ orderBy: { createdAt: "asc" }, take: 1000 }).catch(() => []),
    listMcpAccessTokens(prisma).catch(() => [])
  ]), { route: "/settings" });
  return {
    ...counts,
    settings: {
      ...settings,
      proxyUrl: settings.proxyUrl ? maskProxyUrl(settings.proxyUrl) : settings.proxyUrl
    },
    systemStatus,
    proxies: proxies.map((proxy) => ({
      ...proxy,
      lastError: proxy.lastError ? sanitizeOperationalMessage(proxy.lastError) : proxy.lastError
    })),
    mcpTokens: mcpTokens.map((token) => ({
      ...token,
      createdAt: token.createdAt.toISOString(),
      updatedAt: token.updatedAt.toISOString(),
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      revokedAt: token.revokedAt?.toISOString() ?? null
    })),
    adminEmail: process.env.ADMIN_EMAIL ?? "admin@ads-monitor.local",
    databaseUrl: maskDatabaseUrl(process.env.DATABASE_URL),
    appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Ads Transparency Monitor"
  };
}

export async function getAppSettings() {
  return getSystemSettings(prisma);
}

export async function getSystemStatusData() {
  const startedAt = Date.now();
  try {
    await timeAsync("db.systemStatus.ping", () => prisma.advertiser.count(), {}, { thresholdMs: 100 });
    const [queued, running, failed, heartbeat, googleHealth, lastScan, lastSuccessfulScan, creativesWithoutApp, creativesWithoutPreviewUrl, rawSnapshots] = await timeAsync("db.systemStatus.summary", () => Promise.all([
      prisma.scanJob.count({ where: { status: "QUEUED" } }),
      prisma.scanJob.count({ where: { status: "RUNNING" } }),
      prisma.scanJob.count({ where: { status: "FAILED" } }),
      prisma.workerHeartbeat.findUnique({ where: { id: "default" } }),
      prisma.googleHealth.findUnique({ where: { id: "default" } }),
      prisma.scanJob.findFirst({ orderBy: { updatedAt: "desc" }, include: { advertiser: true, events: { orderBy: { createdAt: "desc" }, take: 1 } } }),
      prisma.scanJob.findFirst({ where: { status: "SUCCESS" }, orderBy: { finishedAt: "desc" } }),
      prisma.creative.count({ where: { appDbId: null } }),
      prisma.creative.count({ where: { previewUrl: null } }),
      prisma.rawApiSnapshot.count()
    ]), {}, { thresholdMs: 100 });
    const heartbeatAgeMs = heartbeat ? Date.now() - heartbeat.lastSeenAt.getTime() : null;
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      workerOnline: heartbeatAgeMs !== null && heartbeatAgeMs <= 10 * 60_000,
      workerStatus: heartbeat?.status ?? "unknown",
      workerMessage: heartbeat?.message ?? null,
      workerLastSeenAt: heartbeat?.lastSeenAt ?? null,
      google: {
        status: googleHealth?.status ?? "OK",
        blockedUntil: googleHealth?.blockedUntil ?? null,
        lastProbeAt: googleHealth?.lastProbeAt ?? null,
        lastSuccessAt: googleHealth?.lastSuccessAt ?? null,
        consecutiveBlocks: googleHealth?.consecutiveBlocks ?? 0,
        lastError: googleHealth?.lastError ? sanitizeOperationalMessage(googleHealth.lastError) : googleHealth?.lastError ?? null
      },
      queued,
      running,
      failed,
      lastScan: lastScan ? {
        ...lastScan,
        errorMessage: lastScan.errorMessage ? sanitizeOperationalMessage(lastScan.errorMessage) : lastScan.errorMessage,
        blockedReason: lastScan.blockedReason ? sanitizeOperationalMessage(lastScan.blockedReason) : lastScan.blockedReason,
        events: lastScan.events.map(sanitizeScanEvent)
      } : null,
      lastSuccessAt: lastSuccessfulScan?.finishedAt ?? null,
      creativesWithoutApp,
      creativesWithoutPreviewUrl,
      rawSnapshots
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? sanitizeOperationalMessage(error.message) : "Unknown DB error",
      workerOnline: false,
      workerStatus: "unknown",
      workerMessage: null,
      workerLastSeenAt: null,
      google: null,
      queued: 0,
      running: 0,
      failed: 0,
      lastScan: null,
      lastSuccessAt: null,
      creativesWithoutApp: 0,
      creativesWithoutPreviewUrl: 0,
      rawSnapshots: 0
    };
  }
}

function maskDatabaseUrl(value?: string) {
  if (!value) return "локальная база не указана";
  return value.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

function maskProxyUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = url.username ? "***" : "";
      url.password = url.password ? "***" : "";
    }
    return url.toString();
  } catch {
    return sanitizeOperationalMessage(value);
  }
}

export function demoDashboardData() {
  const advertiser = {
    id: "demo-adv",
    googleAdvertiserId: "AR14577439029227159553",
    name: "Karen Manukyan",
    transparencyUrl: "https://adstransparency.google.com/advertiser/AR14577439029227159553",
    selectedCountries: ["GB", "BE", "FR", "DE", "IT"],
    lastScanAt: new Date("2026-05-23T04:58:36.000Z"),
    lastSuccessfulScanAt: new Date("2026-05-23T04:58:36.000Z"),
    lastScanStatus: "SUCCESS" as const,
    dailyScanEnabled: true,
    scanMode: "FULL" as const,
    requestDelayMs: null,
    maxPagesPerRun: null,
    maxCreativesPerRun: null,
    scanStartDate: null,
    scanEndDate: null,
    nextScanAt: null,
    totalCreatives: 200,
    activeCreatives: 186,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    scanJobs: []
  };

  const app = {
    id: "demo-app",
    appId: "com.flightsbooking.tickets.app",
    store: "GOOGLE_PLAY" as const,
    storeUrl: "https://play.google.com/store/apps/details?id=com.flightsbooking.tickets.app",
    name: "Cheap Flights",
    developer: "Cheap Flights Tickets App",
    category: "TRAVEL_AND_LOCAL",
    description: "Meilleurs prix pour les vols",
    shortDescription: "Recherchez des vols pas chers",
    firstSeenAt: new Date(),
    lastSeenAt: new Date()
  };

  const countries = [
    { id: "c1", creativeId: "demo", googleGeoId: 2380, countryCode: "IT", countryName: "Italy", impressionsMin: 25000, impressionsMax: 30000, firstShownDate: "2025-03-07", lastShownDate: "2026-05-22", raw: {}, updatedAt: new Date() },
    { id: "c2", creativeId: "demo", googleGeoId: 2276, countryCode: "DE", countryName: "Germany", impressionsMin: 15000, impressionsMax: 20000, firstShownDate: "2025-03-07", lastShownDate: "2026-05-22", raw: {}, updatedAt: new Date() },
    { id: "c3", creativeId: "demo", googleGeoId: 2826, countryCode: "GB", countryName: "United Kingdom", impressionsMin: null, impressionsMax: null, firstShownDate: null, lastShownDate: "2026-05-22", raw: {}, updatedAt: new Date() }
  ];

  const creative: CreativeDetailRecord = {
    id: "demo-creative",
    creativeId: "CR06346342443637538817",
    advertiserId: advertiser.id,
    appDbId: app.id,
    title: "Cheap Flights",
    description: "Meilleurs prix pour les vols",
    format: "VIDEO",
    status: "ACTIVE",
    previewUrl: "https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=737259876424",
    firstShownAt: new Date("2025-03-07T00:00:00.000Z"),
    lastShownAt: new Date("2026-05-22T00:00:00.000Z"),
    publicDays: 441,
    impressionsMin: 60000,
    impressionsMax: 70000,
    firstFoundAt: new Date(),
    lastFoundAt: new Date(),
    detailFetchedAt: null,
    rawDetail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    advertiser,
    app,
    countries,
    assets: [
      { id: "a1", creativeId: "demo", kind: "LANDSCAPE_IMAGE", url: "https://tpc.googlesyndication.com/simgad/7117847437982836729", width: null, height: null, createdAt: new Date() }
    ],
    rawSnapshots: [
      { id: "r1", creativeId: "demo", kind: "CREATIVE_DETAIL", url: null, payload: { demo: true }, createdAt: new Date() }
    ]
  };

  return {
    advertisers: 1,
    creatives: 200,
    activeCreatives: 186,
    apps: 1,
    scans: 4,
    recentAdvertisers: [advertiser],
    recentCreatives: [creative],
    recentScanJobs: [],
    formatStats: [
      { label: "VIDEO", value: 160 },
      { label: "IMAGE", value: 30 },
      { label: "TEXT", value: 10 }
    ],
    storeStats: [
      { label: "GOOGLE_PLAY", value: 140 },
      { label: "APP_STORE", value: 60 }
    ],
    countryStats: [
      { label: "GB", value: 120 },
      { label: "DE", value: 96 },
      { label: "FR", value: 88 }
    ],
    scanStatusStats: [
      { label: "SUCCESS", value: 3 },
      { label: "FAILED", value: 1 }
    ],
    scanVolumeStats: [
      { label: "21.05", value: 80, status: "SUCCESS" },
      { label: "22.05", value: 120, status: "SUCCESS" },
      { label: "23.05", value: 153, status: "SUCCESS" }
    ]
  };
}

async function getSettingsCounts() {
  const [advertisers, creatives, activeCreatives, apps, scans] = await Promise.all([
    prisma.advertiser.count(),
    prisma.creative.count(),
    prisma.creative.count({ where: { status: "ACTIVE" } }),
    prisma.app.count(),
    prisma.scan.count()
  ]);
  return { advertisers, creatives, activeCreatives, apps, scans };
}

async function dashboardFormatStats() {
  const rows = await prisma.$queryRaw<StatRow[]>(Prisma.sql`
    SELECT format::text AS label, COUNT(*)::int AS value
    FROM "Creative"
    GROUP BY format
    ORDER BY value DESC
  `);
  return normalizeStats(rows);
}

async function dashboardStoreStats() {
  const rows = await prisma.$queryRaw<StatRow[]>(Prisma.sql`
    SELECT COALESCE(app.store::text, 'UNKNOWN') AS label, COUNT(*)::int AS value
    FROM "Creative" creative
    LEFT JOIN "App" app ON app.id = creative."appDbId"
    GROUP BY COALESCE(app.store::text, 'UNKNOWN')
    ORDER BY value DESC
  `);
  return normalizeStats(rows);
}

async function dashboardCountryStats() {
  const rows = await prisma.$queryRaw<StatRow[]>(Prisma.sql`
    SELECT "countryCode" AS label, COUNT(*)::int AS value
    FROM "CreativeCountry"
    WHERE "countryCode" IS NOT NULL AND "countryCode" <> ''
    GROUP BY "countryCode"
    ORDER BY value DESC
    LIMIT 8
  `);
  return normalizeStats(rows);
}

async function dashboardScanStatusStats() {
  const rows = await prisma.$queryRaw<StatRow[]>(Prisma.sql`
    SELECT status::text AS label, COUNT(*)::int AS value
    FROM "ScanJob"
    GROUP BY status
    ORDER BY value DESC
  `);
  return normalizeStats(rows);
}

function normalizeStats(rows: StatRow[]) {
  return rows.map((row) => ({
    label: row.label ?? "UNKNOWN",
    value: Number(row.value)
  }));
}
