import {
  freemem,
  totalmem
} from "node:os";
import {
  getGoogleHealth,
  errorMessage,
  getSystemSettings,
  isGoogleBlockedError,
  markGoogleBlocked,
  markGoogleOk,
  markGoogleProbeStarted,
  prisma,
  queueAdvertiserScan,
  Prisma,
  recomputeCreativeStatuses,
  recordScanEvent,
  refreshAdvertiserCounters,
  saveNormalizedCreative,
  shouldProbeGoogle,
  validateWorkerEnv
} from "@ad-monitor/db";
import {
  normalizeCreative,
  parseCreativeDetails,
  parsePreviewContentJs,
  type CreativeFormat,
  type ParsedSearchCreative
} from "@ad-monitor/core";
import { enrichAppMetadata } from "./app-metadata.js";
import { createGoogleClient } from "./browser-google-client.js";
import { classifyBrowserNativeError, shouldContinueBackgroundDetailAfterError } from "./browser-native-diagnostics.js";
import { collectBestPreview, normalizeGooglePreviewUrl, defaultUserAgent } from "./google-client.js";
import { resolveDueAdvertiserScanPlan, resumeCountryCodes } from "./schedule.js";
import { runAdvertiserScan, shouldSkipCreativeDetail } from "./scanner.js";

type ScanMode = "FAST" | "FULL" | "CAUTIOUS";

function dateRangeForMode(mode: ScanMode = "FULL") {
  if (mode === "FULL") return undefined;

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - { FAST: 3, CAUTIOUS: 7 }[mode]);
  return {
    start: toGoogleDate(start),
    end: toGoogleDate(end)
  };
}

function dateRangeForJob(job: { scanMode: ScanMode; scanStartDate?: string | null; scanEndDate?: string | null }) {
  if (job.scanStartDate && job.scanEndDate) {
    return {
      start: job.scanStartDate.replaceAll("-", ""),
      end: job.scanEndDate.replaceAll("-", "")
    };
  }
  return dateRangeForMode(job.scanMode);
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_WORKER_CONCURRENCY = 1;
const MAX_WORKER_CONCURRENCY = 6;
const DEFAULT_DETAIL_CONCURRENCY = 1;
const MAX_DETAIL_CONCURRENCY = 6;
const ACTIVE_WORKER_HEARTBEAT_MS = 90_000;
const STALE_RUNNING_JOB_MS = 60 * 60 * 1000;
const CREATIVE_STATUS_RECOMPUTE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STALE_CREATIVE_RECHECK_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const STALE_CREATIVE_RECHECK_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;
const DEFAULT_BACKGROUND_DETAIL_RETRY_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const DEFAULT_CHUNK_BUDGET_MS = 8 * 60 * 1000;
const RETENTION_DELETE_BATCH_SIZE = 1000;
const RETENTION_MAX_BATCHES_PER_CYCLE = 20;
const PROBE_ADVERTISER_ID = process.env.GOOGLE_PROBE_ADVERTISER_ID ?? "AR14577439029227159553";
const APP_TIME_ZONE = "Europe/Moscow";
const MOSCOW_UTC_OFFSET_HOURS = 3;
let stopping = false;
let lastIdleLogAt = 0;
let lastBackgroundDetailIdleLogAt = 0;
let lastCreativeStatusRecomputeAt = 0;
const backgroundDetailCreativeCooldowns = new Map<string, number>();

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

async function main() {
  validateWorkerEnv();
  if (await hasActivePeerWorker()) {
    console.log("Another scan worker is already active. Exiting to avoid duplicate queue processing.");
    return;
  }
  await recoverInterruptedRunningJobs();
  await recoverStaleRunningJobs();
  await updateHeartbeat("starting");

  if (process.env.WORKER_RUN_ONCE === "true") {
    await processQueueCycle();
    await updateHeartbeat("idle", "run-once complete");
    return;
  }

  void backgroundDetailLoop();

  const pollIntervalMs = readPollInterval();
  console.log(`Scan worker started. Polling queue every ${pollIntervalMs}ms.`);

  while (!stopping) {
    let processed = 0;
    try {
      processed = await processQueueCycle();
    } catch (error) {
      console.error("Queue cycle failed", error);
      await updateHeartbeat("error", `queue cycle failed: ${errorMessage(error)}`).catch(() => undefined);
    }
    if (!processed) await sleep(pollIntervalMs);
  }
  await updateHeartbeat("stopping");
}

async function processQueueCycle() {
  await updateHeartbeat("polling");
  await recoverStaleRunningJobs();
  await cleanupRetainedData();
  await recomputeCreativeStatusesIfDue();

  const settings = await getSystemSettings(prisma);
  const health = await getGoogleHealth(prisma);
  if (health.status === "BLOCKED") {
    if (shouldProbeGoogle(health, settings.probeIntervalMs)) {
      const probeOk = await probeGoogleAccess({
        proxyUrl: settings.proxyEnabled ? settings.proxyUrl ?? undefined : undefined,
        useEnvProxy: settings.proxyEnabled
      });
      if (!probeOk) return 0;
    } else {
      await updateHeartbeat("cooldown", `Google blocked until ${health.blockedUntil?.toISOString() ?? "probe window"}`);
      return 0;
    }
  }

  await enqueueDueDailyJobs();

  const concurrency = readWorkerConcurrency(settings.workerConcurrency);
  const results = await Promise.all(Array.from({ length: concurrency }, (_, index) => processQueueSlot(index + 1)));
  const processed = results.reduce((sum, value) => sum + value, 0);

  if (!processed) {
    const queued = await prisma.scanJob.count({ where: { status: "QUEUED" } });
    if (queued > 0) {
      await updateHeartbeat("cooldown", `queued ${queued} job(s), no healthy proxy available`);
      return processed;
    }
    logIdleOncePerMinute();
  }
  await updateHeartbeat(processed ? "processed" : "idle", processed ? `processed ${processed} job(s)` : "queue is empty");
  return processed;
}

async function recomputeCreativeStatusesIfDue(now = new Date()) {
  if (now.getTime() - lastCreativeStatusRecomputeAt < CREATIVE_STATUS_RECOMPUTE_INTERVAL_MS) return;
  lastCreativeStatusRecomputeAt = now.getTime();
  try {
    const result = await recomputeCreativeStatuses({ now }, prisma);
    if (result.total > 0) {
      console.info(
        `[creative-status-sync] total=${result.total} active=${result.active} stopped=${result.stopped} unknown=${result.unknown}`
      );
    }
  } catch (error) {
    lastCreativeStatusRecomputeAt = 0;
    console.warn("Creative status recompute failed:", errorMessage(error));
  }
}

async function backgroundDetailLoop() {
  if (process.env.GOOGLE_BACKGROUND_DETAIL_ENABLED === "false") return;
  await sleep(readBackgroundDetailPollMs());
  while (!stopping) {
    try {
      if (!await hasEnoughFreeMemoryForBackground()) {
        logBackgroundDetailOncePerMinute("skip: low free memory");
        await updateHeartbeat("cooldown", "background detail paused: low free memory");
        await sleep(readBackgroundDetailPollMs());
        continue;
      }
      await processStaleCreativeRecheckBatch();
      await processBackgroundPreviewBackfillBatch();
      await processBackgroundDetailBatch();
    } catch (error) {
      console.error("Background detail failed", error);
    }
    await sleep(readBackgroundDetailPollMs());
  }
}

async function processBackgroundDetailBatch() {
  const health = await getGoogleHealth(prisma);
  if (health.blockedUntil && health.blockedUntil > new Date()) {
    logBackgroundDetailOncePerMinute(`skip: Google cooldown until ${health.blockedUntil.toISOString()}`);
    await updateHeartbeat("cooldown", `background detail paused: Google cooldown until ${health.blockedUntil.toISOString()}`);
    return 0;
  }

  const activeJobs = await countActiveScanQueue();
  if (activeJobs > 0) {
    console.info(`[background-detail] continuing while ${activeJobs} scan job(s) are active`);
  }

  const settings = await getSystemSettings(prisma);
  const slots = await createBackgroundDetailSlots(settings.proxyEnabled, settings.proxyUrl ?? undefined);
  if (!slots.length) {
    const proxyCount = await prisma.proxyEndpoint.count();
    logBackgroundDetailOncePerMinute(`skip: no healthy proxy slots, proxyEnabled=${settings.proxyEnabled}, proxyCount=${proxyCount}`);
    await updateHeartbeat("cooldown", `background detail paused: no healthy proxy slots (${proxyCount} proxies)`);
    return 0;
  }

  const batchSize = Math.max(slots.length, readBackgroundDetailBatchSize());
  const candidatePoolSize = Math.min(250, Math.max(batchSize * 8, 100));
  const candidates = await prisma.creative.findMany({
    where: {
      advertiser: { googleAdvertiserId: { not: "" } }
    },
    orderBy: [{ updatedAt: "desc" }],
    take: candidatePoolSize,
    select: {
      id: true,
      advertiserId: true,
      creativeId: true,
      appDbId: true,
      previewUrl: true,
      format: true,
      firstShownAt: true,
      lastShownAt: true,
      publicDays: true,
      rawList: true,
      rawDetail: true,
      rawPreview: true,
      detailFetchedAt: true,
      lastFoundAt: true,
      updatedAt: true,
      _count: { select: { countries: true } }
    }
  });
  const nowDate = new Date();
  const now = nowDate.getTime();
  clearExpiredBackgroundDetailCooldowns(now);
  const rows = candidates
    .filter((row) => shouldCollectBackgroundDetail(row, nowDate))
    .filter((row) => !isBackgroundDetailCreativeCoolingDown(row.creativeId, now))
    .slice(0, batchSize);
  if (!rows.length) {
    await closeBackgroundDetailSlots(slots);
    logBackgroundDetailOncePerMinute(candidates.length
      ? `idle: ${candidates.length} pending rawDetail creatives are cooling down`
      : "idle: no pending rawDetail creatives");
    return 0;
  }

  let processed = 0;
  let cursor = 0;
  const advertisers = new Map((await prisma.advertiser.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.advertiserId))] } },
    select: { id: true, name: true, googleAdvertiserId: true }
  })).map((advertiser) => [advertiser.id, advertiser]));
  const nextRow = () => rows[cursor++];
  const delayMs = readBackgroundDetailDelayMs();
  console.info(`[background-detail] start rows=${rows.length} slots=${slots.length} delayMs=${delayMs}`);
  await updateHeartbeat("running", `background detail: ${rows.length} креативов`);
  try {
    await Promise.all(slots.map(async (slot, index) => {
      for (;;) {
        const row = nextRow();
        if (!row || stopping) return;
        const advertiser = advertisers.get(row.advertiserId);
        if (!advertiser) continue;
        if (delayMs > 0) await sleep(delayMs + Math.floor(Math.random() * Math.min(delayMs, 3_000)));
        try {
          const normalized = await slot.client.collectCreative({
            advertiserId: advertiser.googleAdvertiserId,
            creativeId: row.creativeId,
            listCreative: listCreativeFromRow(row, advertiser),
            collectDetail: true
          });
          await saveNormalizedCreative(row.advertiserId, normalized, prisma);
          await markGoogleOk(prisma);
          if (slot.proxy) await markProxyOk(slot.proxy.id);
          processed += 1;
          await updateHeartbeat("running", `background detail slot ${index + 1}: ${processed}/${rows.length}`);
          console.info(`[background-detail] collected ${row.creativeId} slot=${index + 1} progress=${processed}/${rows.length}`);
        } catch (error) {
          const proxyIssue = classifyBrowserNativeError(error);
          if (slot.proxy && proxyIssue !== "FAILED" && proxyIssue !== "PROFILE_LOCKED") {
            await markProxyIssue(slot.proxy.id, error, proxyIssue);
          }
          if (isGoogleBlockedError(error)) await markGoogleBlocked(error, prisma);
          markBackgroundDetailCreativeCooldown(row.creativeId, error);
          console.warn(`[background-detail] slot=${index + 1} failed creative=${row.creativeId} issue=${proxyIssue}: ${errorMessage(error)}`);
          await updateHeartbeat("cooldown", `background detail slot ${index + 1} failed: ${proxyIssue}`);
          if (!shouldContinueBackgroundDetailAfterError(error)) return;
        }
      }
    }));
  } finally {
    await closeBackgroundDetailSlots(slots);
  }
  if (processed > 0) await updateHeartbeat("processed", `background detail collected ${processed}`);
  if (processed === 0) {
    console.warn(`[background-detail] finished without collected details, attempted rows=${rows.length}, slots=${slots.length}`);
    await updateHeartbeat("cooldown", `background detail attempted ${rows.length}, collected 0`);
  }
  return processed;
}

async function processStaleCreativeRecheckBatch() {
  if (process.env.GOOGLE_STALE_CREATIVE_RECHECK_ENABLED === "false") return 0;
  if (await hasActiveScanQueue()) return 0;

  const now = new Date();
  const settings = await getSystemSettings(prisma);
  const slots = await createBackgroundDetailSlots(settings.proxyEnabled, settings.proxyUrl ?? undefined);
  if (!slots.length) return 0;

  const rows = await prisma.creative.findMany({
    where: {
      advertiser: { googleAdvertiserId: { not: "" } },
      status: { in: ["ACTIVE", "STOPPED"] },
      lastShownAt: { not: null }
    },
    orderBy: [{ lastFoundAt: "asc" }],
    take: Math.max(slots.length, Math.min(24, readBackgroundDetailBatchSize())),
    select: {
      advertiserId: true,
      creativeId: true,
      previewUrl: true,
      format: true,
      firstShownAt: true,
      lastShownAt: true,
      publicDays: true,
      rawList: true,
      lastFoundAt: true,
      status: true
    }
  });

  const candidates = rows.filter((row) => shouldRecheckCreativeExistence(row, now));
  if (!candidates.length) {
    await closeBackgroundDetailSlots(slots);
    return 0;
  }

  const advertisers = new Map((await prisma.advertiser.findMany({
    where: { id: { in: [...new Set(candidates.map((row) => row.advertiserId))] } },
    select: { id: true, name: true, googleAdvertiserId: true }
  })).map((advertiser) => [advertiser.id, advertiser]));

  let processed = 0;
  let cursor = 0;
  const nextRow = () => candidates[cursor++];
  try {
    await Promise.all(slots.map(async (slot) => {
      for (;;) {
        const row = nextRow();
        if (!row || stopping) return;
        const advertiser = advertisers.get(row.advertiserId);
        if (!advertiser) continue;

        try {
          const normalized = await slot.client.collectCreative({
            advertiserId: advertiser.googleAdvertiserId,
            creativeId: row.creativeId,
            listCreative: listCreativeFromRow(row, advertiser),
            collectDetail: true
          });
          await saveNormalizedCreative(row.advertiserId, normalized, prisma);
          await markGoogleOk(prisma);
          if (slot.proxy) await markProxyOk(slot.proxy.id);
          processed += 1;
          console.info(`[stale-creative-recheck] refreshed ${row.creativeId} previousStatus=${row.status}`);
        } catch (error) {
          const proxyIssue = classifyBrowserNativeError(error);
          if (slot.proxy && proxyIssue !== "FAILED" && proxyIssue !== "PROFILE_LOCKED") {
            await markProxyIssue(slot.proxy.id, error, proxyIssue);
          }
          markBackgroundDetailCreativeCooldown(row.creativeId, error);
          console.warn(`[stale-creative-recheck] failed ${row.creativeId}: ${errorMessage(error)}`);
        }
      }
    }));
  } finally {
    await closeBackgroundDetailSlots(slots);
  }

  if (processed > 0) {
    await updateHeartbeat("processed", `stale creative recheck refreshed ${processed}`);
  }
  return processed;
}

function shouldCollectBackgroundDetail(row: {
  rawDetail: unknown;
  rawPreview: unknown;
  appDbId: string | null;
  previewUrl: string | null;
  detailFetchedAt: Date | null;
  lastFoundAt: Date;
  updatedAt: Date;
  _count: { countries: number };
}, now = new Date()) {
  const shouldRefresh = !shouldSkipCreativeDetail({
    rawDetail: row.rawDetail,
    rawPreview: row.rawPreview,
    appDbId: row.appDbId,
    previewUrl: row.previewUrl,
    countryCount: row._count.countries,
    detailFetchedAt: row.detailFetchedAt
  }, {
    now,
    ttlMs: readPositiveIntegerEnv("GOOGLE_BACKGROUND_DETAIL_REFRESH_TTL_MS", 7 * 24 * 60 * 60 * 1000)
  });
  if (!shouldRefresh) return false;
  if (!row.rawDetail) return true;
  const retryCooldownMs = readPositiveIntegerEnv(
    "GOOGLE_BACKGROUND_DETAIL_RETRY_COOLDOWN_MS",
    DEFAULT_BACKGROUND_DETAIL_RETRY_COOLDOWN_MS
  );
  if (now.getTime() - row.updatedAt.getTime() < retryCooldownMs) return false;
  const recentWindowMs = readPositiveIntegerEnv("GOOGLE_BACKGROUND_DETAIL_RECENT_WINDOW_MS", 36 * 60 * 60 * 1000);
  return row.lastFoundAt.getTime() >= now.getTime() - recentWindowMs;
}

function shouldRecheckCreativeExistence(row: {
  creativeId: string;
  lastShownAt: Date | null;
  lastFoundAt: Date;
  status: string;
}, now = new Date()) {
  if (!row.lastShownAt || row.status === "UNKNOWN") return false;
  const ageSinceFoundMs = now.getTime() - row.lastFoundAt.getTime();
  if (ageSinceFoundMs < STALE_CREATIVE_RECHECK_MIN_AGE_MS) return false;
  const ageSinceShownMs = now.getTime() - row.lastShownAt.getTime();
  return ageSinceShownMs >= STALE_CREATIVE_RECHECK_MIN_AGE_MS
    && ageSinceShownMs <= STALE_CREATIVE_RECHECK_WINDOW_MS
    && !isBackgroundDetailCreativeCoolingDown(row.creativeId, now.getTime());
}

async function processBackgroundPreviewBackfillBatch() {
  if (process.env.GOOGLE_BACKGROUND_PREVIEW_BACKFILL_ENABLED === "false") return 0;
  if (await hasActiveScanQueue()) return 0;

  const rows = await prisma.creative.findMany({
    where: {
      rawDetail: { not: Prisma.DbNull },
      advertiser: { googleAdvertiserId: { not: "" } },
      OR: [
        { appDbId: null },
        { rawPreview: { equals: Prisma.DbNull } }
      ]
    },
    orderBy: [{ updatedAt: "desc" }],
    take: readBackgroundPreviewBackfillBatchSize(),
    select: {
      id: true,
      advertiserId: true,
      creativeId: true,
      previewUrl: true,
      format: true,
      firstShownAt: true,
      lastShownAt: true,
      publicDays: true,
      rawList: true,
      rawDetail: true
    }
  });
  if (!rows.length) return 0;

  const advertisers = new Map((await prisma.advertiser.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.advertiserId))] } },
    select: { id: true, name: true, googleAdvertiserId: true }
  })).map((advertiser) => [advertiser.id, advertiser]));

  let processed = 0;
  await updateHeartbeat("running", `preview backfill: ${rows.length} creatives`);
  await mapWithConcurrency(rows, readBackgroundPreviewBackfillConcurrency(), async (row) => {
    if (stopping) return;
    const advertiser = advertisers.get(row.advertiserId);
    if (!advertiser || !row.rawDetail) return;

    try {
      const detail = parseCreativeDetails(row.rawDetail);
      const preview = await collectBestPreview(
        [row.previewUrl ?? undefined, ...detail.previewUrls],
        fetchPreviewContentForBackfill
      );
      if (!preview?.appId || preview.store === "UNKNOWN") return;

      const normalized = await enrichAppMetadata(normalizeCreative({
        list: listCreativeFromRow(row, advertiser),
        detail,
        preview
      }));
      await saveNormalizedCreative(row.advertiserId, normalized, prisma);
      processed += 1;
    } catch (error) {
      console.warn(`Preview backfill skipped ${row.creativeId}: ${errorMessage(error)}`);
    }
  });

  if (processed > 0) await updateHeartbeat("processed", `preview backfill repaired ${processed}`);
  return processed;
}

async function hasActiveScanQueue() {
  return await countActiveScanQueue() > 0;
}

async function countActiveScanQueue() {
  const count = await prisma.scanJob.count({
    where: { status: { in: ["QUEUED", "RUNNING"] } }
  });
  return count;
}

async function processQueueSlot(slot: number) {
  let processed = 0;
  while (!stopping && await processNextQueuedJob(slot)) processed += 1;
  return processed;
}

async function processNextQueuedJob(slot: number) {
  const job = await claimNextQueuedJob();
  if (!job) return false;

  const settings = await getSystemSettings(prisma);
  const proxy = await selectProxy(settings.proxyEnabled ? settings.proxyUrl ?? undefined : undefined);
  if (settings.proxyEnabled && !proxy && await prisma.proxyEndpoint.count() > 0) {
    await prisma.scanJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: { status: "QUEUED", startedAt: null }
    });
    await updateHeartbeat("cooldown", "no healthy proxy available");
    return false;
  }
  const profileAttemptKey = job.startedAt?.getTime() ?? Date.now();
  const client = createGoogleClient({
      proxyUrl: proxy?.url,
      useEnvProxy: settings.proxyEnabled,
      profileKey: proxy ? `worker-slot-${slot}-${proxy.id}-${profileAttemptKey}` : `worker-slot-${slot}-direct-${profileAttemptKey}`,
      onProgress: (message) => updateHeartbeat("running", `job ${job.id}: ${message}`)
    });
  const detailProxies = await selectDetailProxies({
    enabled: settings.proxyEnabled,
    fallbackProxyUrl: settings.proxyUrl ?? undefined,
    excludeIds: proxy ? [proxy.id] : [],
    count: Math.max(0, readDetailConcurrency() - 1)
  });
  const detailClients = [
    client,
    ...detailProxies.map((detailProxy, index) => createGoogleClient({
      proxyUrl: detailProxy.url,
      useEnvProxy: settings.proxyEnabled,
      profileKey: `detail-slot-${slot}-${index + 1}-${detailProxy.id}-${profileAttemptKey}`,
      onProgress: (message) => updateHeartbeat("running", `job ${job.id}: detail ${index + 2}: ${message}`)
    }))
  ];
  try {
    await updateHeartbeat("running", `slot ${slot}, job ${job.id}`);
    const result = await withJobTimeout(runAdvertiserScan({
      scanJobId: job.id,
      advertiserDbId: job.advertiser.id,
      googleAdvertiserId: job.advertiser.googleAdvertiserId,
      countryCodes: resumeCountryCodes(job.countries, job.currentCountryCode),
      dateRange: dateRangeForJob(job),
      scanMode: job.scanMode,
      requestDelayMs: job.requestDelayMs ?? undefined,
      maxPagesPerRun: job.maxPagesPerRun ?? undefined,
      maxCreativesPerRun: job.maxCreativesPerRun ?? undefined,
      chunkBudgetMs: readChunkBudget(),
      initialPageToken: job.nextPageToken,
      refreshDetails: job.refreshDetails,
      detailClients
    }, client), readPositiveIntegerEnv("GOOGLE_BROWSER_JOB_TIMEOUT_MS", 90 * 60 * 1000), `browser-native:timeout:ScanJob:${job.id}`);
    await markGoogleOk(prisma);
    if (proxy) await markProxyOk(proxy.id);
    await Promise.all(detailProxies.map((detailProxy) => markProxyOk(detailProxy.id)));
    if (result.chunked) {
      await prisma.scanJob.update({
        where: { id: job.id },
        data: { status: "QUEUED", startedAt: null, finishedAt: null }
      });
      await recordScanEvent({
        scanJobId: job.id,
        level: "info",
        message: "Кусок полного сбора сохранен, задача вернулась в очередь",
        data: {
          reasonCode: "SCAN_CHUNK_REQUEUED",
          proxyId: proxy?.id ?? null
        }
      }, prisma);
      await updateHeartbeat("processed", `chunk saved for job ${job.id}`);
      return true;
    }
    if (job.scanMode === "FULL") await sleep(settings.advertiserDelayMs);
  } catch (error) {
    const runtimeReasonCode = workerRuntimeReasonCode(error);
    const proxyIssue = classifyBrowserNativeError(error);
    if (proxyIssue === "PROFILE_LOCKED") {
      const profileRetryLimit = readPositiveIntegerEnv("GOOGLE_BROWSER_PROFILE_LOCK_RETRY_LIMIT", 2);
      const profileLockRetries = await recentEventReasonCount(job.id, ["SCAN_REQUEUED_AFTER_PROFILE_LOCK"]);
      const shouldRetry = profileLockRetries < profileRetryLimit;
      if (shouldRetry) {
        await prisma.scanJob.updateMany({
          where: { id: job.id, status: { in: ["RUNNING", "BLOCKED", "FAILED"] } },
          data: { status: "QUEUED", startedAt: null, finishedAt: null, errorMessage: null, blockedReason: null }
        });
        await recordScanEvent({
          scanJobId: job.id,
          level: "warn",
          message: "Browser-профиль был занят, задача возвращена в очередь для повторного запуска",
          data: {
            reasonCode: "SCAN_REQUEUED_AFTER_PROFILE_LOCK",
            retryAttempt: profileLockRetries + 1,
            retryLimit: profileRetryLimit,
            proxyId: proxy?.id ?? null,
            error: errorMessage(error)
          }
        }, prisma);
        await updateHeartbeat("cooldown", `profile locked, job ${job.id} requeued`);
        return true;
      }
    }
    if (proxy && proxyIssue !== "FAILED" && proxyIssue !== "PROFILE_LOCKED") {
      await markProxyIssue(proxy.id, error, proxyIssue);
      const nextProxy = await selectProxy(settings.proxyEnabled ? settings.proxyUrl ?? undefined : undefined);
      const proxyRetryReasonCode = proxyIssue === "BLOCKED"
        ? "SCAN_REQUEUED_AFTER_GOOGLE_BLOCK"
        : "SCAN_REQUEUED_AFTER_PROXY_ISSUE";
      const proxyRetryLimit = readPositiveIntegerEnv("GOOGLE_BROWSER_PROXY_RETRY_LIMIT", 3);
      const proxyRetryCount = await recentEventReasonCount(job.id, [proxyRetryReasonCode]);
      const shouldRetryProxy = Boolean(nextProxy) && proxyRetryCount < proxyRetryLimit;
      if (shouldRetryProxy) {
        await prisma.scanJob.updateMany({
          where: { id: job.id, status: { in: ["RUNNING", "BLOCKED", "FAILED"] } },
          data: { status: "QUEUED", startedAt: null, finishedAt: null, errorMessage: null, blockedReason: null }
        });
      }
      await recordScanEvent({
        scanJobId: job.id,
        level: "warn",
        message: shouldRetryProxy
          ? `Proxy ${proxy.id} дал ${proxyIssue}, задача возвращена в очередь на другой proxy`
          : `Proxy ${proxy.id} дал ${proxyIssue}, запасного proxy сейчас нет`,
        data: {
          reasonCode: shouldRetryProxy ? proxyRetryReasonCode : runtimeReasonCode,
          proxyId: proxy.id,
          proxyIssue,
          nextProxyId: nextProxy?.id ?? null,
          retryAttempt: shouldRetryProxy ? proxyRetryCount + 1 : proxyRetryCount,
          retryLimit: proxyRetryLimit,
          error: errorMessage(error)
        }
      }, prisma);
      await updateHeartbeat("cooldown", shouldRetryProxy
        ? `proxy ${proxy.id} ${proxyIssue.toLowerCase()}, job requeued`
        : nextProxy
          ? `proxy ${proxy.id} ${proxyIssue.toLowerCase()}, retry limit reached`
          : `proxy ${proxy.id} ${proxyIssue.toLowerCase()}, no spare proxy`);
      if (shouldRetryProxy) return true;
    }
    if (isGoogleBlockedError(error)) {
      if (proxy) {
        await markProxyIssue(proxy.id, error, "BLOCKED");
        const nextProxy = await selectProxy(settings.proxyEnabled ? settings.proxyUrl ?? undefined : undefined);
        if (nextProxy) {
          await prisma.scanJob.updateMany({
            where: { id: job.id, status: { in: ["RUNNING", "BLOCKED"] } },
            data: { status: "QUEUED", startedAt: null, finishedAt: null, errorMessage: null, blockedReason: null }
          });
          await recordScanEvent({
            scanJobId: job.id,
            level: "warn",
            message: `Google ограничил proxy ${proxy.id}, задача возвращена в очередь на другой proxy`,
            data: {
              reasonCode: "SCAN_REQUEUED_AFTER_GOOGLE_BLOCK",
              proxyId: proxy.id,
              nextProxyId: nextProxy.id,
              error: errorMessage(error)
            }
          }, prisma);
          await updateHeartbeat("cooldown", `proxy ${proxy.id} blocked, job requeued for next proxy`);
          return true;
        }
      }
      await markGoogleBlocked(error, prisma);
    }
    await prisma.scanJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: errorMessage(error)
      }
    });
    await recordScanEvent({
      scanJobId: job.id,
      level: "error",
      message: "Worker завершил задачу с ошибкой",
      data: {
        reasonCode: runtimeReasonCode,
        proxyId: proxy?.id ?? null,
        proxyIssue,
        error: errorMessage(error)
      }
    }, prisma);
    console.error(error);
  } finally {
    await Promise.all(detailClients.map((detailClient) => detailClient.close?.()));
    await updateHeartbeat("polling");
  }
  return true;
}

async function recentEventReasonCount(scanJobId: string, reasonCodes: string[]) {
  const events = await prisma.scanEvent.findMany({
    where: { scanJobId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { data: true }
  });
  return events.filter((event) => {
    const reasonCode = scanEventReasonCode(event.data);
    return reasonCode ? reasonCodes.includes(reasonCode) : false;
  }).length;
}

async function claimNextQueuedJob() {
  return prisma.$transaction(async (tx) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const queued = await tx.scanJob.findFirst({
        where: { status: "QUEUED" },
        select: { id: true },
        orderBy: { createdAt: "asc" }
      });

      if (!queued) return null;

      const claimed = await tx.scanJob.updateMany({
        where: { id: queued.id, status: "QUEUED" },
        data: { status: "RUNNING", startedAt: new Date(), finishedAt: null }
      });

      if (claimed.count !== 1) continue;

      return tx.scanJob.findUnique({
        where: { id: queued.id },
        include: { advertiser: true }
      });
    }

    return null;
  });
}

/*
async function finalizeDuplicatePageJobBeforeProxy(job: Awaited<ReturnType<typeof claimNextQueuedJob>>) {
  if (!job?.nextPageToken || job.creativesFound <= 0) return false;

  const stopAfter = readPositiveIntegerEnv("GOOGLE_BROWSER_DUPLICATE_PAGE_STOP_AFTER", 3);
  const streak = await recentDuplicatePageStreak(job.id);
  if (streak < stopAfter) return false;

  const now = new Date();
  await recordScanEvent({
    scanJobId: job.id,
    level: "info",
    message: "Повторяющиеся страницы без новых креативов, сбор выдачи завершен до выбора прокси",
    data: {
      reasonCode: "DUPLICATE_SEARCH_PAGES_STOPPED",
      streak,
      finalizedBeforeProxy: true
    }
  }, prisma);

  await prisma.scanJob.update({
    where: { id: job.id },
    data: {
      status: "SUCCESS",
      startedAt: job.startedAt,
      finishedAt: now,
      errorMessage: null,
      blockedReason: null,
      nextPageToken: null,
      currentCountryCode: null,
      chunkStartedAt: null
    }
  });
  await prisma.scan.updateMany({
    where: { scanJobId: job.id, status: { in: ["QUEUED", "RUNNING", "FAILED", "BLOCKED"] } },
    data: {
      status: "SUCCESS",
      finishedAt: now,
      errorMessage: null,
      blockedReason: null
    }
  });
  await prisma.advertiser.update({
    where: { id: job.advertiserId },
    data: {
      lastScanAt: now,
      lastSuccessfulScanAt: now,
      lastScanStatus: "SUCCESS"
    }
  });
  await refreshAdvertiserCounters(job.advertiserId, prisma);
  await updateHeartbeat("processed", `duplicate pages stopped for job ${job.id}`);
  return true;
}

async function recentDuplicatePageStreak(scanJobId: string) {
  const events = await prisma.scanEvent.findMany({
    where: { scanJobId },
    orderBy: { createdAt: "desc" },
    take: 120,
    select: { data: true }
  });
  let streak = 0;
  for (const event of events) {
    const reasonCode = scanEventReasonCode(event.data);
    if (reasonCode === "DUPLICATE_SEARCH_PAGE") {
      streak += 1;
      continue;
    }
    if (
      reasonCode === "SEARCH_PAGE_FOUND" ||
      reasonCode === "ADVERTISER_PAGE_OPENED" ||
      reasonCode === "SCAN_FAILED" ||
      reasonCode === "PROXY_TIMEOUT" ||
      reasonCode === "WORKER_RESTART_REQUEUED"
    ) {
      continue;
    }
    if (!reasonCode) continue;
    break;
  }
  return streak;
}

function scanEventReasonCode(data: unknown) {
  return data && typeof data === "object" && "reasonCode" in data
    ? String((data as { reasonCode?: unknown }).reasonCode ?? "")
    : "";
}

function workerRuntimeReasonCode(error: unknown) {
  const message = errorMessage(error);
  if (message.startsWith("browser-native:profile-locked:")) return "PROFILE_LOCKED";
  if (message === "browser-native:empty-search-page" || message === "browser-native:no-search-results") return "EMPTY_SEARCH_PAGE";
  if (message.startsWith("browser-native:timeout:")) return "PROXY_TIMEOUT";
  if (message.startsWith("blocked:")) return "GOOGLE_BLOCKED";
  return "WORKER_JOB_FAILED";
}

*/

function scanEventReasonCode(data: unknown) {
  return data && typeof data === "object" && "reasonCode" in data
    ? String((data as { reasonCode?: unknown }).reasonCode ?? "")
    : "";
}

function workerRuntimeReasonCode(error: unknown) {
  const message = errorMessage(error);
  if (message.startsWith("browser-native:profile-locked:")) return "PROFILE_LOCKED";
  if (message === "browser-native:empty-search-page" || message === "browser-native:no-search-results") return "EMPTY_SEARCH_PAGE";
  if (message.startsWith("browser-native:timeout:")) return "PROXY_TIMEOUT";
  if (message.startsWith("blocked:")) return "GOOGLE_BLOCKED";
  return "WORKER_JOB_FAILED";
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function withJobTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function probeGoogleAccess(options: { proxyUrl?: string; useEnvProxy?: boolean } = {}) {
  await markGoogleProbeStarted(prisma);
  await updateHeartbeat("probing", "Checking Google access");
  const client = createGoogleClient({
    proxyUrl: options.proxyUrl,
    useEnvProxy: options.useEnvProxy
  });
  try {
    await client.searchCreatives({
      advertiserId: PROBE_ADVERTISER_ID,
      geoId: 2826,
      dateRange: { start: "20260516", end: "20260523" }
    });
    await markGoogleOk(prisma);
    await updateHeartbeat("idle", "Google probe succeeded");
    return true;
  } catch (error) {
    if (isGoogleBlockedError(error)) {
      const health = await markGoogleBlocked(error, prisma);
      await updateHeartbeat("cooldown", `Google blocked until ${health.blockedUntil?.toISOString()}`);
      return false;
    }
    await prisma.googleHealth.update({
      where: { id: "default" },
      data: { status: "DEGRADED", lastError: errorMessage(error), lastProbeAt: new Date() }
    });
    return false;
  } finally {
    await client.close?.();
  }
}

function toGoogleDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("");
}

async function enqueueDueDailyJobs(now = new Date()) {
  const settings = await getSystemSettings(prisma);
  const dueAdvertisers = await prisma.advertiser.findMany({
    where: {
      dailyScanEnabled: true,
      OR: [
        { nextScanAt: null },
        { nextScanAt: { lte: now } }
      ]
    },
    include: {
      scanJobs: {
        where: { status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true },
        take: 1
      }
    }
  });

  for (const advertiser of dueAdvertisers) {
    if (advertiser.scanJobs.length) continue;
    const plan = resolveDueAdvertiserScanPlan(advertiser, settings);
    await queueAdvertiserScan(advertiser.id, plan.countries, plan.options, prisma);
    await prisma.advertiser.update({
      where: { id: advertiser.id },
      data: { nextScanAt: nextScheduledScanTime(now, settings) }
    });
  }
}

function nextScheduledScanTime(
  from: Date,
  settings: {
    dailyScanHour?: number | null;
    scheduleType?: string | null;
    dailyScanHours?: number[] | null;
    scanIntervalHours?: number | null;
  }
) {
  if ((settings.scheduleType ?? "DAILY") === "INTERVAL") {
    const interval = clampInterval(settings.scanIntervalHours);
    const parts = getMoscowParts(from);
    const nextHour = Math.floor(parts.hour / interval) * interval + interval;
    const targetDay = nextHour >= 24 ? addMoscowDays(parts, 1) : parts;
    return moscowWallTimeToUtcDate(targetDay.year, targetDay.month, targetDay.day, nextHour % 24);
  }

  const hours = normalizeScheduleHours(settings);
  const today = getMoscowParts(from);
  for (const hour of hours) {
    const next = moscowWallTimeToUtcDate(today.year, today.month, today.day, hour);
    if (next > from) return next;
  }
  const tomorrow = addMoscowDays(today, 1);
  return moscowWallTimeToUtcDate(tomorrow.year, tomorrow.month, tomorrow.day, hours[0] ?? 3);
}

function normalizeScheduleHours(settings: { dailyScanHour?: number | null; dailyScanHours?: number[] | null }) {
  const source = settings.dailyScanHours?.length ? settings.dailyScanHours : [settings.dailyScanHour ?? 3];
  const hours = [...new Set(source.map(Number).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23))];
  return hours.length ? hours.sort((a, b) => a - b) : [3];
}

function clampInterval(value?: number | null) {
  const interval = Number(value);
  if (!Number.isFinite(interval)) return 24;
  return Math.min(24, Math.max(1, Math.round(interval)));
}

function getMoscowParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

function addMoscowDays(parts: { year: number; month: number; day: number }, days: number) {
  const utcNoon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12 - MOSCOW_UTC_OFFSET_HOURS));
  return getMoscowParts(utcNoon);
}

function moscowWallTimeToUtcDate(year: number, month: number, day: number, hour: number) {
  return new Date(Date.UTC(year, month - 1, day, hour - MOSCOW_UTC_OFFSET_HOURS, 0, 0, 0));
}

function readPollInterval() {
  const value = Number(process.env.WORKER_POLL_INTERVAL_MS);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_POLL_INTERVAL_MS;
  return Math.max(2_000, Math.round(value));
}

function readWorkerConcurrency(settingsValue?: number | null) {
  const value = Number(settingsValue ?? process.env.WORKER_CONCURRENCY ?? DEFAULT_WORKER_CONCURRENCY);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WORKER_CONCURRENCY;
  return Math.min(MAX_WORKER_CONCURRENCY, Math.max(1, Math.round(value)));
}

function readDetailConcurrency() {
  const value = Number(process.env.GOOGLE_DETAIL_CONCURRENCY ?? DEFAULT_DETAIL_CONCURRENCY);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DETAIL_CONCURRENCY;
  return Math.min(MAX_DETAIL_CONCURRENCY, Math.max(1, Math.round(value)));
}

function readBackgroundDetailConcurrency() {
  const value = Number(process.env.GOOGLE_BACKGROUND_DETAIL_CONCURRENCY ?? readDetailConcurrency());
  if (!Number.isFinite(value) || value <= 0) return readDetailConcurrency();
  return Math.min(MAX_DETAIL_CONCURRENCY, Math.max(1, Math.round(value)));
}

function readBackgroundDetailBatchSize() {
  const value = Number(process.env.GOOGLE_BACKGROUND_DETAIL_BATCH_SIZE);
  if (!Number.isFinite(value) || value <= 0) return Math.max(6, readBackgroundDetailConcurrency() * 4);
  return Math.max(1, Math.round(value));
}

function readBackgroundDetailPollMs() {
  const value = Number(process.env.GOOGLE_BACKGROUND_DETAIL_POLL_MS);
  if (!Number.isFinite(value) || value <= 0) return 20_000;
  return Math.max(5_000, Math.round(value));
}

function readBackgroundDetailDelayMs() {
  const value = Number(process.env.GOOGLE_BACKGROUND_DETAIL_DELAY_MS ?? process.env.GOOGLE_BROWSER_DETAIL_DELAY_MS);
  if (!Number.isFinite(value) || value < 0) return 10_000;
  return Math.round(value);
}

function readBackgroundPreviewBackfillBatchSize() {
  const value = Number(process.env.GOOGLE_BACKGROUND_PREVIEW_BACKFILL_BATCH_SIZE);
  if (!Number.isFinite(value) || value <= 0) return 50;
  return Math.max(1, Math.round(value));
}

function readBackgroundPreviewBackfillConcurrency() {
  const value = Number(process.env.GOOGLE_BACKGROUND_PREVIEW_BACKFILL_CONCURRENCY);
  if (!Number.isFinite(value) || value <= 0) return 4;
  return Math.min(8, Math.max(1, Math.round(value)));
}

async function hasEnoughFreeMemoryForBackground() {
  const minMb = Number(process.env.GOOGLE_BACKGROUND_MIN_FREE_MEMORY_MB);
  if (!Number.isFinite(minMb) || minMb <= 0) return true;

  const freeMb = Math.round(freemem() / 1024 / 1024);
  if (freeMb >= minMb) return true;

  const totalMb = Math.round(totalmem() / 1024 / 1024);
  await updateHeartbeat("cooldown", `background skipped: low memory ${freeMb}/${totalMb} MB free`);
  return false;
}

async function fetchPreviewContentForBackfill(previewUrl: string) {
  const response = await fetch(normalizeGooglePreviewUrl(previewUrl), {
    headers: { "user-agent": defaultUserAgent() },
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) {
    throw new Error(`preview backfill failed with ${response.status}`);
  }
  return parsePreviewContentJs(await response.text());
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, mapper: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await mapper(items[index]);
    }
  }));
}

async function cleanupRetainedData(now = new Date()) {
  const settings = await getSystemSettings(prisma);
  const rawBefore = retentionCutoff(now, settings.rawSnapshotRetentionDays);
  const eventsBefore = retentionCutoff(now, settings.scanEventRetentionDays);

  await Promise.all([
    rawBefore ? cleanupRawSnapshots(rawBefore) : Promise.resolve(0),
    eventsBefore ? cleanupScanEvents(eventsBefore) : Promise.resolve(0)
  ]).catch((error) => {
    console.warn("Retention cleanup failed:", errorMessage(error));
  });
}

async function cleanupRawSnapshots(before: Date) {
  let deleted = 0;
  for (let batch = 0; batch < RETENTION_MAX_BATCHES_PER_CYCLE; batch += 1) {
    const rows = await prisma.rawApiSnapshot.findMany({
      where: { createdAt: { lt: before } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: RETENTION_DELETE_BATCH_SIZE
    });
    if (!rows.length) break;
    const result = await prisma.rawApiSnapshot.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    deleted += result.count;
    if (rows.length < RETENTION_DELETE_BATCH_SIZE) break;
  }
  return deleted;
}

async function cleanupScanEvents(before: Date) {
  let deleted = 0;
  for (let batch = 0; batch < RETENTION_MAX_BATCHES_PER_CYCLE; batch += 1) {
    const rows = await prisma.scanEvent.findMany({
      where: { createdAt: { lt: before } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: RETENTION_DELETE_BATCH_SIZE
    });
    if (!rows.length) break;
    const result = await prisma.scanEvent.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    deleted += result.count;
    if (rows.length < RETENTION_DELETE_BATCH_SIZE) break;
  }
  return deleted;
}

function readChunkBudget() {
  const value = Number(process.env.WORKER_CHUNK_BUDGET_MS);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_CHUNK_BUDGET_MS;
}

async function selectProxy(fallbackProxyUrl?: string, excludeIds: string[] = []) {
  const now = new Date();
  const proxy = await claimHealthyProxy(now, excludeIds);
  const proxyCount = proxy ? 1 : await prisma.proxyEndpoint.count();
  if (proxy) return proxy;
  if (proxyCount > 0) return null;
  return fallbackProxyUrl && !excludeIds.includes("settings") ? { id: "settings", url: fallbackProxyUrl } : null;
}

async function selectDetailProxies(input: { enabled: boolean; fallbackProxyUrl?: string; excludeIds: string[]; count: number }) {
  if (!input.enabled || input.count <= 0) return [];
  const selected: Array<{ id: string; url: string }> = [];
  const excludeIds = [...input.excludeIds];
  for (let index = 0; index < input.count; index += 1) {
    const proxy = await selectProxy(input.fallbackProxyUrl, excludeIds);
    if (!proxy) break;
    selected.push(proxy);
    excludeIds.push(proxy.id);
  }
  return selected;
}

type BackgroundDetailSlot = {
  proxy?: { id: string; url: string };
  client: ReturnType<typeof createGoogleClient>;
};

async function createBackgroundDetailSlots(proxyEnabled: boolean, fallbackProxyUrl?: string | null): Promise<BackgroundDetailSlot[]> {
  const count = readBackgroundDetailConcurrency();
  const proxies = await selectDetailProxies({
    enabled: proxyEnabled,
    fallbackProxyUrl: fallbackProxyUrl ?? undefined,
    excludeIds: [],
    count
  });

  if (proxyEnabled && !proxies.length && await prisma.proxyEndpoint.count() > 0) return [];
  const source = proxies.length ? proxies : Array.from({ length: proxyEnabled ? 0 : 1 }, () => undefined);
  return source.map((proxy, index) => ({
    proxy,
    client: createGoogleClient({
      proxyUrl: proxy?.url,
      useEnvProxy: proxyEnabled,
      profileKey: proxy ? `background-detail-${index + 1}-${proxy.id}` : `background-detail-${index + 1}-direct`,
      onProgress: (message) => updateHeartbeat("running", `background detail ${index + 1}: ${message}`)
    })
  }));
}

async function closeBackgroundDetailSlots(slots: BackgroundDetailSlot[]) {
  await Promise.all(slots.map((slot) => slot.client.close?.()));
}

function listCreativeFromRow(row: {
  creativeId: string;
  previewUrl: string | null;
  format: string;
  firstShownAt: Date | null;
  lastShownAt: Date | null;
  publicDays: number | null;
  rawList: unknown;
}, advertiser: { name: string | null; googleAdvertiserId: string }): ParsedSearchCreative {
  return {
    advertiserId: advertiser.googleAdvertiserId,
    advertiserName: advertiser.name ?? undefined,
    creativeId: row.creativeId,
    previewUrl: row.previewUrl ?? undefined,
    format: row.format as CreativeFormat,
    firstShownAt: row.firstShownAt ?? undefined,
    lastShownAt: row.lastShownAt ?? undefined,
    publicDays: row.publicDays ?? undefined,
    raw: row.rawList ?? { source: "background-detail" }
  };
}

async function claimHealthyProxy(now: Date, excludeIds: string[] = []) {
  return prisma.$transaction(async (tx) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const proxy = await tx.proxyEndpoint.findFirst({
        where: {
          id: { notIn: excludeIds.filter((id) => id !== "settings") },
          OR: [
            {
              status: "OK",
              OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }]
            },
            {
              status: { in: ["BLOCKED", "CHALLENGE_REQUIRED", "TIMEOUT"] },
              blockedUntil: { lte: now }
            }
          ]
        },
        orderBy: [{ lastUsedAt: "asc" }, { createdAt: "asc" }]
      });
      if (!proxy) return null;

      const claimed = await tx.proxyEndpoint.updateMany({
        where: {
          id: proxy.id,
          OR: [
            { lastUsedAt: proxy.lastUsedAt },
            { lastUsedAt: null }
          ]
        },
        data: { lastUsedAt: now }
      });
      if (claimed.count === 1) {
        return { ...proxy, lastUsedAt: now };
      }
    }
    return null;
  });
}

async function markProxyOk(id: string) {
  if (id === "settings") return;
  await prisma.proxyEndpoint.update({
    where: { id },
    data: {
      status: "OK",
      blockedUntil: null,
      lastError: null,
      failCount: 0
    }
  });
}

async function markProxyIssue(id: string, error: unknown, status: "BLOCKED" | "CHALLENGE_REQUIRED" | "TIMEOUT" | "FAILED") {
  if (id === "settings") return;
  const cooldownMs = status === "TIMEOUT"
    ? readPositiveIntegerEnv("PROXY_TIMEOUT_COOLDOWN_MS", 2 * 60 * 1000)
    : readPositiveIntegerEnv("PROXY_BLOCKED_COOLDOWN_MS", 60 * 60 * 1000);
  await prisma.proxyEndpoint.update({
    where: { id },
    data: {
      status,
      blockedUntil: new Date(Date.now() + cooldownMs),
      failCount: { increment: 1 },
      lastError: errorMessage(error)
    }
  });
}

function retentionCutoff(now: Date, days?: number | null) {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(now.getTime() - Math.round(value) * 24 * 60 * 60 * 1000);
}

function logIdleOncePerMinute(now = Date.now()) {
  if (now - lastIdleLogAt < 60_000) return;
  lastIdleLogAt = now;
  console.log("Queue is empty.");
}

function logBackgroundDetailOncePerMinute(message: string, now = Date.now()) {
  if (now - lastBackgroundDetailIdleLogAt < 60_000) return;
  lastBackgroundDetailIdleLogAt = now;
  console.info(`[background-detail] ${message}`);
}

function clearExpiredBackgroundDetailCooldowns(now = Date.now()) {
  for (const [creativeId, retryAt] of backgroundDetailCreativeCooldowns) {
    if (retryAt <= now) backgroundDetailCreativeCooldowns.delete(creativeId);
  }
}

function isBackgroundDetailCreativeCoolingDown(creativeId: string, now = Date.now()) {
  const retryAt = backgroundDetailCreativeCooldowns.get(creativeId);
  return Boolean(retryAt && retryAt > now);
}

function markBackgroundDetailCreativeCooldown(creativeId: string, error: unknown) {
  const message = errorMessage(error);
  const cooldownMs = message.startsWith("creative-detail-empty:")
    ? readPositiveIntegerEnv("GOOGLE_BACKGROUND_DETAIL_EMPTY_COOLDOWN_MS", 24 * 60 * 60 * 1000)
    : readPositiveIntegerEnv("GOOGLE_BACKGROUND_DETAIL_CREATIVE_COOLDOWN_MS", 10 * 60 * 1000);
  backgroundDetailCreativeCooldowns.set(creativeId, Date.now() + cooldownMs);
}

async function recoverStaleRunningJobs(now = new Date()) {
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_JOB_MS);
  const staleJobs = await prisma.scanJob.findMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: staleBefore },
      finishedAt: null
    },
    select: { id: true, advertiserId: true }
  });

  for (const job of staleJobs) {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: now,
        errorMessage: "stale-running-job",
        blockedReason: null
      }
    });
    await prisma.scan.updateMany({
      where: { scanJobId: job.id, status: "RUNNING" },
      data: {
        status: "FAILED",
        finishedAt: now,
        errorMessage: "stale-running-job"
      }
    });
    await prisma.scanEvent.create({
      data: {
        scanJobId: job.id,
        level: "error",
        message: "Зависшая задача помечена как ошибка после рестарта worker",
        data: { reasonCode: "STALE_RUNNING_JOB" }
      }
    });
    await prisma.advertiser.updateMany({
      where: { id: job.advertiserId, lastScanStatus: "RUNNING" },
      data: { lastScanStatus: "FAILED", lastScanAt: now }
    });
  }
}

async function recoverInterruptedRunningJobs(now = new Date()) {
  if (await hasActivePeerWorker(now)) return;

  const runningJobs = await prisma.scanJob.findMany({
    where: {
      status: "RUNNING",
      finishedAt: null
    },
    select: { id: true, advertiserId: true }
  });

  for (const job of runningJobs) {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: {
        status: "QUEUED",
        startedAt: null,
        finishedAt: null,
        chunkStartedAt: null,
        errorMessage: null
      }
    });
    await prisma.scan.updateMany({
      where: { scanJobId: job.id, status: "RUNNING" },
      data: { status: "QUEUED", finishedAt: null, errorMessage: null }
    });
    await prisma.scanEvent.create({
      data: {
        scanJobId: job.id,
        level: "warn",
        message: "Задача возвращена в очередь после рестарта worker",
        data: { reasonCode: "WORKER_RESTART_REQUEUED" }
      }
    });
    await prisma.advertiser.updateMany({
      where: { id: job.advertiserId, lastScanStatus: "RUNNING" },
      data: { lastScanStatus: "QUEUED", lastScanAt: now }
    });
  }
}

async function hasActivePeerWorker(now = new Date()) {
  if (process.env.WORKER_PEER_PID_CHECK !== "true") return false;

  const heartbeat = await prisma.workerHeartbeat.findUnique({
    where: { id: "default" },
    select: { pid: true, lastSeenAt: true }
  }).catch(() => null);
  if (!heartbeat?.pid || heartbeat.pid === process.pid) return false;
  if (now.getTime() - heartbeat.lastSeenAt.getTime() > ACTIVE_WORKER_HEARTBEAT_MS) return false;
  return isProcessAlive(heartbeat.pid);
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === "EPERM";
  }
}

async function updateHeartbeat(status: string, message?: string) {
  await prisma.workerHeartbeat.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      status,
      message,
      pid: process.pid,
      lastSeenAt: new Date()
    },
    update: {
      status,
      message,
      pid: process.pid,
      lastSeenAt: new Date()
    }
  }).catch(() => undefined);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
