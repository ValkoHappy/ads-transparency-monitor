import type { NormalizedCreative } from "@ad-monitor/core";
import type { Prisma } from "./generated/prisma/client.js";
import { resolveCreativeStatus } from "@ad-monitor/core";
import type { CreativeFilters } from "./filters.js";
import { buildCreativeWhere } from "./filters.js";
import { buildCreativePersistenceModel, parseAdvertiserInput } from "./mappers.js";
import { prisma as defaultPrisma } from "./prisma.js";

type DbClient = typeof defaultPrisma | Prisma.TransactionClient;
const DEFAULT_RAW_SNAPSHOT_MAX_BYTES = 250_000;
const RAW_SNAPSHOT_PREVIEW_CHARS = 4_096;
const DEFAULT_SCAN_LIMITS: Record<NonNullable<QueueScanOptions["scanMode"]>, { maxPagesPerRun: number | null; maxCreativesPerRun: number | null }> = {
  FAST: { maxPagesPerRun: 1, maxCreativesPerRun: 20 },
  FULL: { maxPagesPerRun: 100, maxCreativesPerRun: null },
  CAUTIOUS: { maxPagesPerRun: 1, maxCreativesPerRun: 10 }
};

export interface CreateAdvertiserInput {
  input: string;
  name?: string;
  selectedCountries?: string[];
  notes?: string;
  dailyScanEnabled?: boolean;
  scanMode?: "FAST" | "FULL" | "CAUTIOUS";
  requestDelayMs?: number;
  maxPagesPerRun?: number;
  maxCreativesPerRun?: number;
  scanStartDate?: string | null;
  scanEndDate?: string | null;
}

export interface QueueScanOptions {
  scanMode?: "FAST" | "FULL" | "CAUTIOUS";
  requestDelayMs?: number;
  maxPagesPerRun?: number;
  maxCreativesPerRun?: number;
  scanStartDate?: string | null;
  scanEndDate?: string | null;
  retryOfJobId?: string;
  refreshDetails?: boolean;
}

export interface SystemSettingsInput {
  scanMode?: "FAST" | "FULL" | "CAUTIOUS";
  dailyScanHour?: number;
  scheduleType?: string;
  dailyScanHours?: number[];
  scanIntervalHours?: number | null;
  requestDelayMs?: number;
  maxPagesPerRun?: number | null;
  maxCreativesPerRun?: number | null;
  workerConcurrency?: number;
  advertiserDelayMs?: number;
  probeIntervalMs?: number;
  rawSnapshotRetentionDays?: number;
  scanEventRetentionDays?: number;
  exportDefaultFields?: string[];
  proxyEnabled?: boolean;
  proxyUrl?: string | null;
}

export type McpAccessLevel = "READ" | "READ_WRITE";

export interface CreateMcpAccessTokenInput {
  name: string;
  accessLevel?: McpAccessLevel;
  isAdmin?: boolean;
}

export interface McpAccessTokenAuth {
  source: "db";
  tokenId: string;
  tokenPrefix: string;
  accessLevel: McpAccessLevel;
  isAdmin: boolean;
}

export async function upsertAdvertiser(input: CreateAdvertiserInput, db: DbClient = defaultPrisma) {
  const parsed = parseAdvertiserInput(input.input);

  return db.advertiser.upsert({
    where: { googleAdvertiserId: parsed.googleAdvertiserId },
    create: {
      googleAdvertiserId: parsed.googleAdvertiserId,
      transparencyUrl: parsed.transparencyUrl,
      name: input.name,
      selectedCountries: input.selectedCountries ?? [],
      dailyScanEnabled: input.dailyScanEnabled ?? true,
      scanMode: input.scanMode,
      requestDelayMs: input.requestDelayMs,
      maxPagesPerRun: input.maxPagesPerRun,
      maxCreativesPerRun: input.maxCreativesPerRun,
      scanStartDate: input.scanStartDate,
      scanEndDate: input.scanEndDate,
      notes: input.notes
    },
    update: {
      transparencyUrl: parsed.transparencyUrl,
      name: input.name,
      selectedCountries: input.selectedCountries,
      dailyScanEnabled: input.dailyScanEnabled,
      scanMode: input.scanMode,
      requestDelayMs: input.requestDelayMs,
      maxPagesPerRun: input.maxPagesPerRun,
      maxCreativesPerRun: input.maxCreativesPerRun,
      scanStartDate: input.scanStartDate,
      scanEndDate: input.scanEndDate,
      notes: input.notes
    }
  });
}

export async function queueAdvertiserScan(
  advertiserId: string,
  countries: string[],
  optionsOrDb: QueueScanOptions | DbClient = {},
  maybeDb?: DbClient
) {
  const db = isDbClient(optionsOrDb) ? optionsOrDb : maybeDb ?? defaultPrisma;
  const options = isDbClient(optionsOrDb) ? {} : optionsOrDb;
  if (!options.retryOfJobId && canOpenTransaction(db)) {
    return db.$transaction(async (tx) => {
      await lockAdvertiserQueue(tx, advertiserId);
      return queueAdvertiserScanLocked(advertiserId, countries, options, tx);
    });
  }

  return queueAdvertiserScanLocked(advertiserId, countries, options, db);
}

async function queueAdvertiserScanLocked(
  advertiserId: string,
  countries: string[],
  options: QueueScanOptions,
  db: DbClient
) {
  if (!options.retryOfJobId) {
    const activeJob = await db.scanJob.findFirst({
      where: {
        advertiserId,
        status: { in: ["QUEUED", "RUNNING"] }
      },
      orderBy: { createdAt: "desc" }
    });

    if (activeJob) {
      if (activeJob.status !== "QUEUED") return activeJob;
      const nextScanMode = options.scanMode ?? activeJob.scanMode;
      const nextLimits = resolveQueuedScanLimits(nextScanMode, options, activeJob);
      const updated = await db.scanJob.update({
        where: { id: activeJob.id },
        data: {
          countries,
          scanMode: nextScanMode,
          requestDelayMs: options.requestDelayMs ?? (options.scanMode ? null : activeJob.requestDelayMs),
          maxPagesPerRun: nextLimits.maxPagesPerRun,
          maxCreativesPerRun: nextLimits.maxCreativesPerRun,
          scanStartDate: options.scanStartDate ?? activeJob.scanStartDate,
          scanEndDate: options.scanEndDate ?? activeJob.scanEndDate,
          refreshDetails: options.refreshDetails ?? activeJob.refreshDetails,
          cancelRequested: false,
          errorMessage: null,
          blockedReason: null
        }
      });
      await recordScanEvent({
        scanJobId: updated.id,
        level: "info",
        message: "Задача в очереди обновлена",
        data: { reasonCode: "SCAN_QUEUE_UPDATED" }
      }, db);
      return updated;
    }
  }

  const nextScanMode = options.scanMode ?? "FULL";
  const nextLimits = resolveQueuedScanLimits(nextScanMode, options);
  const job = await db.scanJob.create({
    data: {
      advertiserId,
      countries,
      status: "QUEUED",
      scanMode: nextScanMode,
      requestDelayMs: options.requestDelayMs,
      maxPagesPerRun: nextLimits.maxPagesPerRun,
      maxCreativesPerRun: nextLimits.maxCreativesPerRun,
        scanStartDate: options.scanStartDate,
        scanEndDate: options.scanEndDate,
        retryOfJobId: options.retryOfJobId,
        refreshDetails: options.refreshDetails ?? false
      }
    });
  await recordScanEvent({
    scanJobId: job.id,
    level: "info",
    message: "Задача добавлена в очередь",
    data: { reasonCode: "SCAN_QUEUED" }
  }, db);
  return job;
}

function resolveQueuedScanLimits(
  scanMode: NonNullable<QueueScanOptions["scanMode"]>,
  options: QueueScanOptions,
  activeJob?: { maxPagesPerRun: number | null; maxCreativesPerRun: number | null } | null
) {
  const defaults = DEFAULT_SCAN_LIMITS[scanMode];
  const modeChanged = Boolean(options.scanMode);
  return {
    maxPagesPerRun: options.maxPagesPerRun ?? (modeChanged ? defaults.maxPagesPerRun : activeJob?.maxPagesPerRun ?? defaults.maxPagesPerRun),
    maxCreativesPerRun: options.maxCreativesPerRun ?? (modeChanged ? defaults.maxCreativesPerRun : activeJob?.maxCreativesPerRun ?? defaults.maxCreativesPerRun)
  };
}

async function lockAdvertiserQueue(db: DbClient, advertiserId: string) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`scan_queue:${advertiserId}`}))`;
}

export async function withAdvertiserQueueLock<T>(
  advertiserId: string,
  callback: (db: Prisma.TransactionClient) => Promise<T>,
  db: typeof defaultPrisma = defaultPrisma
) {
  return db.$transaction(async (tx) => {
    await lockAdvertiserQueue(tx, advertiserId);
    return callback(tx);
  });
}

export async function cancelScanJob(scanJobId: string, db: DbClient = defaultPrisma) {
  const now = new Date();
  const job = await db.scanJob.findUnique({ where: { id: scanJobId }, select: { advertiserId: true } });
  const queued = await db.scanJob.updateMany({
    where: { id: scanJobId, status: "QUEUED" },
    data: { status: "CANCELED", finishedAt: now, cancelRequested: true, errorMessage: "scan-canceled" }
  });
  if (queued.count === 1) {
    if (job) await refreshAdvertiserCounters(job.advertiserId, db);
    await recordScanEvent({
      scanJobId,
      level: "info",
      message: "Сканирование остановлено пользователем",
      data: { reasonCode: "SCAN_CANCELED" }
    }, db);
    return db.scanJob.findUnique({ where: { id: scanJobId } });
  }

  const running = await db.scanJob.updateMany({
    where: { id: scanJobId, status: "RUNNING" },
    data: { cancelRequested: true }
  });
  if (running.count === 1) {
    await recordScanEvent({
      scanJobId,
      level: "info",
      message: "Запрошена остановка сканирования",
      data: { reasonCode: "SCAN_CANCEL_REQUESTED" }
    }, db);
    return db.scanJob.findUnique({ where: { id: scanJobId } });
  }

  return db.scanJob.findUnique({ where: { id: scanJobId } });
}

export async function getSystemSettings(db: DbClient = defaultPrisma) {
  return db.systemSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {}
  });
}

export async function updateSystemSettings(input: SystemSettingsInput, db: DbClient = defaultPrisma) {
  return db.systemSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      ...settingsData(input)
    },
    update: settingsData(input)
  });
}

export async function listMcpAccessTokens(db: DbClient = defaultPrisma) {
  return db.mcpAccessToken.findMany({
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }]
  });
}

export async function createMcpAccessToken(input: CreateMcpAccessTokenInput, db: DbClient = defaultPrisma) {
  const name = input.name.trim().slice(0, 120);
  if (!name) {
    throw new Error("Token name is required.");
  }
  const accessLevel = input.accessLevel === "READ_WRITE" ? "READ_WRITE" : "READ";
  const token = `atm_${accessLevel === "READ" ? "ro" : "rw"}_${randomBytes(24).toString("base64url")}`;
  const record = await db.mcpAccessToken.create({
    data: {
      name,
      tokenPrefix: token.slice(0, 18),
      tokenHash: hashMcpAccessToken(token),
      accessLevel,
      isAdmin: Boolean(input.isAdmin)
    }
  });
  return { token, record };
}

export async function revokeMcpAccessToken(id: string, db: DbClient = defaultPrisma) {
  return db.mcpAccessToken.update({
    where: { id },
    data: { revokedAt: new Date() }
  });
}

export async function deleteMcpAccessToken(id: string, db: DbClient = defaultPrisma) {
  return db.mcpAccessToken.delete({
    where: { id }
  });
}

export async function authenticateMcpAccessToken(token: string, db: DbClient = defaultPrisma): Promise<McpAccessTokenAuth | null> {
  const record = await db.mcpAccessToken.findUnique({
    where: { tokenHash: hashMcpAccessToken(token) }
  });
  if (!record || record.revokedAt) return null;
  await db.mcpAccessToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() }
  }).catch(() => undefined);
  return {
    source: "db",
    tokenId: record.id,
    tokenPrefix: record.tokenPrefix,
    accessLevel: record.accessLevel,
    isAdmin: record.isAdmin
  };
}

export async function findCreatives(filters: CreativeFilters, db: DbClient = defaultPrisma, take = 200, skip = 0) {
  return db.creative.findMany({
    where: buildCreativeWhere(filters),
    include: {
      advertiser: true,
      app: true,
      countries: { take: 8 },
      assets: { take: 1 }
    },
    orderBy: { updatedAt: "desc" },
    skip,
    take
  });
}

export async function countCreatives(filters: CreativeFilters, db: DbClient = defaultPrisma) {
  return db.creative.count({ where: buildCreativeWhere(filters) });
}

export async function saveNormalizedCreative(
  advertiserDbId: string,
  normalized: NormalizedCreative,
  db: DbClient = defaultPrisma
) {
  const model = buildCreativePersistenceModel(normalized);
  const advertiserName = normalized.advertiserName?.trim();
  const detailFetchedAt = model.creative.detailFetchedAt;

  if (advertiserName) {
    await db.advertiser.updateMany({
      where: {
        id: advertiserDbId,
        OR: [
          { name: null },
          { name: "" }
        ]
      },
      data: { name: advertiserName }
    });
  }

  const app = model.app
    ? await db.app.upsert({
      where: model.app.where,
      create: model.app.create,
      update: omitUndefined({
        ...model.app.update,
        name: undefined
      })
    })
    : undefined;
  if (app && model.app?.create.name) {
    await fillMissingOrBrokenAppName(app.id, model.app.create.name, db);
  }

  const creativeUpdate = omitUndefined({
    ...model.creative,
    status: "ACTIVE" as const,
    rawList: jsonOrUndefined(model.creative.rawList),
    rawDetail: jsonOrUndefined(model.creative.rawDetail),
    detailFetchedAt,
    rawPreview: jsonOrUndefined(model.creative.rawPreview),
    advertiserId: advertiserDbId,
    appDbId: app?.id,
    lastFoundAt: new Date()
  });

  const creative = await db.creative.upsert({
    where: { creativeId: model.creative.creativeId },
    create: {
      ...model.creative,
      status: "ACTIVE" as const,
      rawList: jsonOrUndefined(model.creative.rawList),
      rawDetail: jsonOrUndefined(model.creative.rawDetail),
      detailFetchedAt,
      rawPreview: jsonOrUndefined(model.creative.rawPreview),
      advertiserId: advertiserDbId,
      appDbId: app?.id
    },
    update: creativeUpdate
  });

  const assets = uniqueBy(model.assets, (asset) => `${asset.kind}:${asset.url}`);
  const countries = uniqueBy(model.countries, (country) => String(country.googleGeoId));
  const shouldReplaceCountries = model.creative.rawDetail !== undefined;

  await Promise.all([
    shouldReplaceCountries
      ? db.creativeCountry.deleteMany({
        where: {
          creativeId: creative.id,
          googleGeoId: { notIn: countries.map((country) => country.googleGeoId) }
        }
      })
      : undefined,
    ...assets.map((asset) => db.creativeAsset.upsert({
      where: {
        creativeId_kind_url: {
          creativeId: creative.id,
          kind: asset.kind,
          url: asset.url
        }
      },
      create: {
        creativeId: creative.id,
        kind: asset.kind,
        url: asset.url,
        width: asset.width,
        height: asset.height
      },
      update: {
        width: asset.width,
        height: asset.height
      }
    })),
    ...countries.map((country) => db.creativeCountry.upsert({
      where: {
        creativeId_googleGeoId: {
          creativeId: creative.id,
          googleGeoId: country.googleGeoId
        }
      },
      create: {
        creativeId: creative.id,
        ...country,
        raw: jsonOrUndefined(country.raw)
      },
      update: {
        ...country,
        raw: jsonOrUndefined(country.raw)
      }
    })),
    ...model.rawSnapshots.map((snapshot) => db.rawApiSnapshot.create({
      data: {
        creativeId: creative.id,
        kind: snapshot.kind,
        payload: jsonValue(boundedRawSnapshotPayload(snapshot.payload))
      }
    }))
  ]);

  return creative;
}

export async function refreshAdvertiserCounters(advertiserId: string, db: DbClient = defaultPrisma) {
  const [totalCreatives, activeCreatives] = await Promise.all([
    db.creative.count({ where: { advertiserId } }),
    db.creative.count({ where: { advertiserId, status: "ACTIVE" } })
  ]);

  return db.advertiser.update({
    where: { id: advertiserId },
    data: {
      totalCreatives,
      activeCreatives
    }
  });
}

export async function recomputeCreativeStatuses(
  options: { advertiserId?: string; now?: Date; refreshCounters?: boolean } = {},
  db: DbClient = defaultPrisma
) {
  const now = options.now ?? new Date();
  const baseWhere = options.advertiserId ? { advertiserId: options.advertiserId } : {};
  const creatives = await db.creative.findMany({
    where: baseWhere,
    select: {
      id: true,
      advertiserId: true,
      status: true,
      lastShownAt: true,
      lastFoundAt: true
    }
  });

  let active = 0;
  let stopped = 0;
  let unknown = 0;

  await Promise.all(creatives.map(async (creative) => {
    const nextStatus = resolveCreativeStatus(creative.lastShownAt ?? undefined, creative.lastFoundAt ?? undefined, now);
    if (nextStatus === "ACTIVE") active += 1;
    else if (nextStatus === "STOPPED") stopped += 1;
    else unknown += 1;
    if (creative.status === nextStatus) return;
    await db.creative.update({
      where: { id: creative.id },
      data: { status: nextStatus }
    });
  }));

  if (options.refreshCounters !== false) {
    if (options.advertiserId) {
      await refreshAdvertiserCounters(options.advertiserId, db);
    } else {
      const advertiserIds = [...new Set(creatives.map((creative) => creative.advertiserId))];
      await Promise.all(advertiserIds.map((advertiserId) => refreshAdvertiserCounters(advertiserId, db)));
    }
  }

  return {
    advertiserId: options.advertiserId ?? null,
    total: creatives.length,
    active,
    stopped,
    unknown
  };
}

export async function recordScanEvent(
  input: {
    scanJobId?: string;
    scanId?: string;
    level: "info" | "warn" | "error";
    message: string;
    data?: unknown;
  },
  db: DbClient = defaultPrisma
) {
  logScanEvent(input);
  return db.scanEvent.create({
    data: {
      scanJobId: input.scanJobId,
      scanId: input.scanId,
      level: input.level,
      message: input.message,
      data: jsonOrUndefined(input.data)
    } as Prisma.ScanEventUncheckedCreateInput
  });
}

function logScanEvent(input: {
  scanJobId?: string;
  scanId?: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: unknown;
}) {
  if (!shouldLogScanEvents()) return;

  const compactData = compactScanEventData(input.data);
  const reason = typeof compactData.reasonCode === "string" ? ` reason=${compactData.reasonCode}` : "";
  const job = input.scanJobId ? ` job=${input.scanJobId}` : "";
  const scan = input.scanId ? ` scan=${input.scanId}` : "";
  const dataText = Object.keys(compactData).length > 0 ? ` ${safeStringify(compactData)}` : "";
  const line = `[scan-event] ${input.level.toUpperCase()}${job}${scan}${reason} ${input.message}${dataText}`;

  if (input.level === "error") {
    console.error(line);
  } else if (input.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function shouldLogScanEvents() {
  if (process.env.SCAN_EVENT_STDOUT === "false") return false;
  if (process.env.NODE_ENV === "test" && process.env.SCAN_EVENT_STDOUT !== "true") return false;
  return true;
}

function compactScanEventData(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {};

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of [
    "reasonCode",
    "page",
    "slot",
    "creative",
    "creativeId",
    "creatives",
    "creativesFound",
    "previewsFetched",
    "detailsFetched",
    "found",
    "total",
    "cleared",
    "readyBatch",
    "pending",
    "remaining",
    "emptyAdvanceStreak",
    "status",
    "attempt",
    "proxyId",
    "error"
  ]) {
    if (source[key] !== undefined) result[key] = compactValue(source[key]);
  }

  if (isPlainObject(source.diagnostics)) {
    const diagnostics = source.diagnostics as Record<string, unknown>;
    result.diagnostics = compactObject(diagnostics, [
      "scrollY",
      "scrollHeight",
      "clientHeight",
      "cardCount",
      "visibleCount",
      "readyVisible",
      "pendingVisible",
      "cleared",
      "removed",
      "moved",
      "reason"
    ]);
  }

  if (Array.isArray(source.missing)) result.missing = source.missing.slice(0, 10);
  if (Array.isArray(source.ids)) result.ids = source.ids.slice(0, 10);

  return result;
}

function compactObject(source: Record<string, unknown>, keys: string[]) {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = compactValue(source[key]);
  }
  return result;
}

function compactValue(value: unknown): unknown {
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  if (Array.isArray(value)) return value.slice(0, 10).map(compactValue);
  if (isPlainObject(value)) return compactObject(value as Record<string, unknown>, Object.keys(value).slice(0, 12));
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function jsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : jsonValue(value);
}

async function fillMissingOrBrokenAppName(appId: string, name: string, db: DbClient) {
  const trimmedName = name.trim();
  if (!trimmedName) return;
  await db.app.updateMany({
    where: {
      id: appId,
      OR: [
        { name: null },
        { name: "" },
        { name: "a.performance" },
        { name: "window.WIZ_global_data" },
        { name: "this.parentNode" },
        { name: { startsWith: "window." } },
        { name: { startsWith: "this." } },
        { name: { contains: ".performance" } }
      ]
    },
    data: { name: trimmedName }
  });
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function boundedRawSnapshotPayload(value: unknown) {
  const serialized = JSON.stringify(value);
  if (!serialized) return null;
  const maxBytes = readPositiveIntegerEnv("RAW_SNAPSHOT_MAX_BYTES", DEFAULT_RAW_SNAPSHOT_MAX_BYTES);
  const originalBytes = Buffer.byteLength(serialized, "utf8");
  if (originalBytes <= maxBytes) return JSON.parse(serialized);
  return {
    truncated: true,
    originalBytes,
    preview: serialized.slice(0, RAW_SNAPSHOT_PREVIEW_CHARS)
  };
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function omitUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

function isDbClient(value: QueueScanOptions | DbClient): value is DbClient {
  return Boolean((value as DbClient).scanJob);
}

function canOpenTransaction(db: DbClient): db is typeof defaultPrisma {
  return typeof (db as typeof defaultPrisma).$transaction === "function";
}

function settingsData(input: SystemSettingsInput) {
  return {
    scanMode: input.scanMode,
    dailyScanHour: input.dailyScanHour,
    scheduleType: input.scheduleType,
    dailyScanHours: input.dailyScanHours,
    scanIntervalHours: input.scanIntervalHours,
    requestDelayMs: input.requestDelayMs,
    maxPagesPerRun: input.maxPagesPerRun,
    maxCreativesPerRun: input.maxCreativesPerRun,
    workerConcurrency: input.workerConcurrency,
    advertiserDelayMs: input.advertiserDelayMs,
    probeIntervalMs: input.probeIntervalMs,
    rawSnapshotRetentionDays: input.rawSnapshotRetentionDays,
    scanEventRetentionDays: input.scanEventRetentionDays,
    exportDefaultFields: input.exportDefaultFields,
    proxyEnabled: input.proxyEnabled,
    proxyUrl: input.proxyUrl
  };
}

function hashMcpAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

import { createHash, randomBytes } from "node:crypto";
