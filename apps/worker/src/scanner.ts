import { getGeoTarget, type NormalizedCreative, type ParsedSearchCreative } from "@ad-monitor/core";
import {
  recordScanEvent,
  refreshAdvertiserCounters,
  saveNormalizedCreative,
  errorMessage,
  prisma as defaultPrisma
} from "@ad-monitor/db";
import { GoogleTransparencyClient, type GoogleCreativeClient, type ScanDateRange } from "./google-client.js";

type DbClient = typeof defaultPrisma;
type ScanCounters = { pagesFetched: number; detailsFetched: number; previewsFetched: number };
type PersistedScanCounters = ScanCounters & { creativesFound: number };
type PendingCreativeDetail = {
  countryCode?: string;
  listCreative: NonNullable<Parameters<GoogleCreativeClient["collectCreative"]>[0]["listCreative"]>;
};
const DEFAULT_DETAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PROGRESS_FLUSH_INTERVAL_MS = 60_000;
const DEFAULT_PROGRESS_FLUSH_CREATIVE_BATCH = 25;
const DEFAULT_RESUME_FAST_FORWARD_EXTRA_PAGES = 10;
let lastWorkerHeartbeatTouchAt = 0;

export interface RunScanInput {
  scanJobId: string;
  advertiserDbId: string;
  googleAdvertiserId: string;
  countryCodes: string[];
  dateRange?: ScanDateRange;
  scanMode?: "FAST" | "FULL" | "CAUTIOUS";
  requestDelayMs?: number;
  maxPagesPerRun?: number;
  maxCreativesPerRun?: number;
  chunkBudgetMs?: number;
  initialPageToken?: string | null;
  refreshDetails?: boolean;
  detailClients?: GoogleCreativeClient[];
}

export async function runAdvertiserScan(
  input: RunScanInput,
  client: GoogleCreativeClient = new GoogleTransparencyClient(),
  db: DbClient = defaultPrisma
) {
  const scanStartedAt = new Date();
  await db.scanJob.update({
    where: { id: input.scanJobId },
    data: {
      status: "RUNNING",
      scanMode: input.scanMode ?? "FULL",
      startedAt: scanStartedAt
    }
  });

  const scan = await db.scan.create({
    data: {
      advertiserId: input.advertiserDbId,
      scanJobId: input.scanJobId,
      status: "RUNNING",
      scanMode: input.scanMode ?? "FULL",
      startedAt: scanStartedAt
    }
  });

  const resumeProgress = input.initialPageToken
    ? await db.scanJob.findUnique({
      where: { id: input.scanJobId },
      select: {
        pagesFetched: true,
        creativesFound: true,
        detailsFetched: true,
        previewsFetched: true
      }
    })
    : null;
  const resumeSeenCreativeIds = input.initialPageToken
    ? await loadScanJobSeenCreativeIds(input.scanJobId, db)
    : [];
  const seen = new Map<string, NormalizedCreative>(
    resumeSeenCreativeIds.map((creativeId) => [creativeId, seenCreativePlaceholder(input.googleAdvertiserId, creativeId)])
  );
  const counters = {
    pagesFetched: resumeProgress?.pagesFetched ?? 0,
    detailsFetched: resumeProgress?.detailsFetched ?? 0,
    previewsFetched: resumeProgress?.previewsFetched ?? 0
  };
  const totalCreativesFound = () => seen.size;
  const limits = resolveLimits(input);
  const browserNative = isBrowserNativeClient(client);
  const browserNativeDelays = resolveBrowserNativeDelays(limits);
  const pageDelayMs = browserNative ? browserNativeDelays.pageDelayMs : limits.requestDelayMs;
  const creativeDelayMs = browserNative ? 0 : limits.requestDelayMs;
  const detailBatchPerPage = browserNative ? resolveBrowserNativeInlineDetailBatch() : 0;
  const progressPersister = createProgressPersister();
  const chunkDeadline = input.chunkBudgetMs && !browserNative ? Date.now() + input.chunkBudgetMs : Number.POSITIVE_INFINITY;
  const resumedBrowserNativeJob = browserNative && resumeSeenCreativeIds.length > 0;
  const resumeFastForwardLimit = resumedBrowserNativeJob
    ? resolveBrowserNativeResumeFastForwardLimit(resumeSeenCreativeIds.length)
    : 0;
  const pendingDetails: PendingCreativeDetail[] = [];
  let creativeErrors = 0;
  const unknownCountryCodes: string[] = [];
  let validCountryTargetCount = 0;
  let hitScanLimit = false;
  let stoppedAfterDuplicatePages = false;
  let resumeFastForwardStreak = 0;
  try {
    const countryTargets = input.countryCodes.length ? input.countryCodes : [undefined];
    for (const countryCode of countryTargets) {
      if (totalCreativesFound() >= limits.maxCreativesPerRun) break;
      const geo = countryCode ? findGeoByCountryCode(countryCode) : undefined;
      if (countryCode && !geo) {
        unknownCountryCodes.push(countryCode);
        await recordScanEvent({
          scanJobId: input.scanJobId,
          scanId: scan.id,
          level: "warn",
          message: `Неизвестный код страны ${countryCode}`,
          data: { reasonCode: "UNKNOWN_COUNTRY_CODE", countryCode }
        }, db);
        continue;
      }
      validCountryTargetCount += 1;

      let pageToken: string | undefined = input.initialPageToken ?? undefined;
      let duplicatePageStreak = 0;
      do {
        if (counters.pagesFetched >= limits.maxPagesPerRun || totalCreativesFound() >= limits.maxCreativesPerRun) {
          hitScanLimit = true;
          break;
        }
        if (Date.now() >= chunkDeadline) {
          await saveChunkProgress(input.scanJobId, scan.id, countryCode, pageToken, counters, totalCreativesFound(), db, { chunkComplete: true });
          await recordScanEvent({
            scanJobId: input.scanJobId,
            scanId: scan.id,
            level: "info",
            message: "Кусок полного сбора сохранен, задача вернется в очередь",
            data: { reasonCode: "FULL_SCAN_CHUNK_SAVED", nextPageToken: pageToken ?? null, creativesFound: totalCreativesFound() }
          }, db);
          return { creativesFound: totalCreativesFound(), chunked: true };
        }
        await assertNotCanceled(input.scanJobId, db);
        await delay(pageDelayMs);
        await recordScanEvent({
          scanJobId: input.scanJobId,
          scanId: scan.id,
          level: "info",
          message: countryCode
            ? `Открыта страница рекламодателя: ${countryCode}, страница ${counters.pagesFetched + 1}`
            : `Открыта страница рекламодателя: все страны, страница ${counters.pagesFetched + 1}`,
          data: { reasonCode: "ADVERTISER_PAGE_OPENED", countryCode: countryCode ?? null, page: counters.pagesFetched + 1 }
        }, db);

        const page = await withOperationTimeout(client.searchCreatives({
          advertiserId: input.googleAdvertiserId,
          geoId: geo?.googleGeoId,
          dateRange: input.dateRange,
          pageToken
        }).catch(async (error) => {
          const message = errorMessage(error);
          if (browserNative && message === "browser-native:no-search-results" && totalCreativesFound() > 0) {
            await recordScanEvent({
              scanJobId: input.scanJobId,
              scanId: scan.id,
              level: "info",
              message: "Новых страниц больше нет, сбор завершен",
              data: { reasonCode: "BROWSER_NATIVE_NO_MORE_PAGES", creativesFound: totalCreativesFound(), pagesFetched: counters.pagesFetched }
            }, db);
            return null;
          }
          throw error;
        }), browserNative ? readPositiveIntegerEnv("GOOGLE_BROWSER_SEARCH_TIMEOUT_MS", 600_000) : 0, "browser-native:timeout:SearchCreatives");
        if (!page) break;
        const pageCreativeIds = uniqueStrings(page.creatives.map((creative) => creative.creativeId).filter(Boolean));
        const seenBeforePage = new Set(pageCreativeIds.filter((creativeId) => seen.has(creativeId)));
        if (resumedBrowserNativeJob && pageCreativeIds.length > 0 && seenBeforePage.size === pageCreativeIds.length && !isBrowserNativeResumeRpcPage(page.raw)) {
          resumeFastForwardStreak += 1;
          pageToken = page.nextPageToken;
          counters.pagesFetched += 1;
          await recordScanEvent({
            scanJobId: input.scanJobId,
            scanId: scan.id,
            level: "info",
            message: `Resume: старая страница уже была собрана, проматываю дальше без пересчёта: ${pageCreativeIds.length}`,
            data: {
              reasonCode: "BROWSER_NATIVE_RESUME_FAST_FORWARD_PAGE",
              creatives: pageCreativeIds.length,
              pagesFetched: counters.pagesFetched,
              nextPageToken: pageToken ?? null
            }
          }, db);
          await saveChunkProgress(input.scanJobId, scan.id, countryCode, pageToken, counters, totalCreativesFound(), db);
          if (resumeFastForwardStreak > resumeFastForwardLimit) {
            stoppedAfterDuplicatePages = true;
            pageToken = undefined;
            await recordScanEvent({
              scanJobId: input.scanJobId,
              scanId: scan.id,
              level: "warn",
              message: "Resume слишком долго видит только уже собранные страницы, сбор остановлен как зацикленный",
              data: {
                reasonCode: "BROWSER_NATIVE_RESUME_FAST_FORWARD_STOPPED",
                streak: resumeFastForwardStreak,
                limit: resumeFastForwardLimit,
                page: counters.pagesFetched,
                creatives: totalCreativesFound()
              }
            }, db);
            break;
          }
          continue;
        }
        resumeFastForwardStreak = 0;
        counters.pagesFetched += 1;
        await persistCounters(input.scanJobId, scan.id, counters, totalCreativesFound(), db);
        await recordScanEvent({
          scanJobId: input.scanJobId,
          scanId: scan.id,
          level: "info",
          message: `Найдена страница выдачи, креативов: ${page.creatives.length}`,
          data: { reasonCode: "SEARCH_PAGE_FOUND", creatives: page.creatives.length, nextPageToken: page.nextPageToken ?? null }
        }, db);
        await recordBrowserNativeDomDiagnostics({
          input,
          scanId: scan.id,
          db,
          client,
          stage: "page-found",
          extra: { page: counters.pagesFetched, creatives: page.creatives.length }
        });
        const pageProcessDeadline = browserNative
          ? Date.now() + readPositiveIntegerEnv("GOOGLE_BROWSER_PAGE_PROCESS_TIMEOUT_MS", 120_000)
          : Number.POSITIVE_INFINITY;
        const previewIncomplete = browserNativePreviewIncomplete(page.raw);
        if (previewIncomplete) {
          await recordScanEvent({
            scanJobId: input.scanJobId,
            scanId: scan.id,
            level: "warn",
            message: `Preview карточки догрузились не полностью: ${previewIncomplete.found}/${previewIncomplete.total}`,
            data: {
              reasonCode: "PREVIEW_INCOMPLETE_CONTINUED",
              found: previewIncomplete.found,
              total: previewIncomplete.total,
              missing: previewIncomplete.missing
            }
          }, db);
          if (shouldStopOnIncompletePreview(input, previewIncomplete)) {
            throw new Error(`browser-native:preview-incomplete:${previewIncomplete.found}/${previewIncomplete.total}:${previewIncomplete.missing.join(",")}`);
          }
        }

        const existingDetails = await existingCreativeDetailStates(page.creatives.map((creative) => creative.creativeId), input.advertiserDbId, db);

        let remainingCreatives = [...page.creatives];
        let emptyAdvanceStreak = 0;
        while (remainingCreatives.length > 0) {
          assertBeforePageProcessDeadline(pageProcessDeadline);
          if (totalCreativesFound() >= limits.maxCreativesPerRun) break;
          remainingCreatives = remainingCreatives.filter((creative) => !seen.has(creative.creativeId));
          if (!remainingCreatives.length) break;
          if (client.orderCreativesForCollection) {
            try {
              remainingCreatives = await withOperationTimeout(
                client.orderCreativesForCollection(remainingCreatives, [...seen.keys()]),
                browserNative ? readPositiveIntegerEnv("GOOGLE_BROWSER_ORDER_TIMEOUT_MS", 60_000) : 0,
                "browser-native:timeout:OrderCreatives"
              );
            } catch (error) {
              if (!browserNative || errorMessage(error) !== "browser-native:timeout:OrderCreatives") throw error;
              await recordScanEvent({
                scanJobId: input.scanJobId,
                scanId: scan.id,
                level: "warn",
                message: "Сортировка видимых карточек заняла слишком много времени, продолжаю без неё",
                data: {
                  reasonCode: "ORDER_CREATIVES_TIMEOUT_CONTINUED",
                  page: counters.pagesFetched,
                  remaining: remainingCreatives.length
                }
              }, db);
            }
            assertBeforePageProcessDeadline(pageProcessDeadline);
            await recordBrowserNativeDomDiagnostics({
              input,
              scanId: scan.id,
              db,
              client,
              stage: "ordered",
              extra: { page: counters.pagesFetched, remaining: remainingCreatives.length }
            });
          }
          const readyBatch = browserNative
            ? takeReadyBrowserNativeCreatives(remainingCreatives, seen, limits.maxCreativesPerRun - totalCreativesFound())
            : [];
          if (readyBatch.length > 0) {
            emptyAdvanceStreak = 0;
            for (const listCreative of readyBatch) {
              if (totalCreativesFound() >= limits.maxCreativesPerRun) break;
              const collected = await withOperationTimeout(collectSearchListCreative({
                input,
                scanId: scan.id,
                countryCode,
                listCreative,
                existingDetails,
                counters,
                seen,
                pendingDetails,
                progressPersister,
                db,
                client,
                deferEconomyPrune: true
              }), browserNative ? readPositiveIntegerEnv("GOOGLE_BROWSER_COLLECT_TIMEOUT_MS", 20_000) : 0, `browser-native:timeout:CollectCreative:${listCreative.creativeId}`);
              if (collected === "failed") creativeErrors += 1;
            }
            const flushed = await withOperationTimeout(
              client.flushCollectedCreatives?.() ?? Promise.resolve(0),
              browserNative ? readPositiveIntegerEnv("GOOGLE_BROWSER_FLUSH_TIMEOUT_MS", 12_000) : 0,
              "browser-native:timeout:FlushCollectedCreatives"
            );
            assertBeforePageProcessDeadline(pageProcessDeadline);
            await recordBrowserNativeDomDiagnostics({
              input,
              scanId: scan.id,
              db,
              client,
              stage: "after-flush",
              extra: { page: counters.pagesFetched, readyBatch: readyBatch.length, flushed: flushed ?? 0 }
            });
            const collectedIds = new Set(readyBatch.map((creative) => creative.creativeId));
            remainingCreatives = remainingCreatives.filter((creative) => !collectedIds.has(creative.creativeId) && !seen.has(creative.creativeId));
            continue;
          }
          if (browserNative && client.advanceCollectionViewport) {
            let moved = false;
            try {
              moved = await withOperationTimeout(
                client.advanceCollectionViewport(),
                readPositiveIntegerEnv("GOOGLE_BROWSER_ADVANCE_TIMEOUT_MS", 15_000),
                "browser-native:timeout:AdvanceCollectionViewport"
              );
            } catch (error) {
              const message = errorMessage(error);
              if (!message.startsWith("browser-native:timeout:AdvanceCollectionViewport")) throw error;
              await recordScanEvent({
                scanJobId: input.scanJobId,
                scanId: scan.id,
                level: "warn",
                message: `Скролл/очистка страницы зависли, сохраняю уже собранное и пропускаю остаток страницы: ${remainingCreatives.length}`,
                data: {
                  reasonCode: "BROWSER_NATIVE_ADVANCE_TIMEOUT_SKIPPED",
                  page: counters.pagesFetched,
                  remaining: remainingCreatives.length,
                  creativeIds: remainingCreatives.slice(0, 12).map((creative) => creative.creativeId),
                  rawMessage: message
                }
              }, db);
              break;
            }
            assertBeforePageProcessDeadline(pageProcessDeadline);
            emptyAdvanceStreak += 1;
            await recordBrowserNativeDomDiagnostics({
              input,
              scanId: scan.id,
              db,
              client,
              stage: "after-scroll",
              extra: { page: counters.pagesFetched, moved, remaining: remainingCreatives.length, emptyAdvanceStreak }
            });
            remainingCreatives = remainingCreatives.filter((creative) => !seen.has(creative.creativeId));
            if (emptyAdvanceStreak >= readPositiveIntegerEnv("GOOGLE_BROWSER_MAX_EMPTY_ADVANCES_PER_PAGE", 18)) {
              await recordScanEvent({
                scanJobId: input.scanJobId,
                scanId: scan.id,
                level: "warn",
                message: `Страница выдачи застряла на неготовых карточках, пропускаю остаток: ${remainingCreatives.length}`,
                data: {
                  reasonCode: "BROWSER_NATIVE_PAGE_STUCK_SKIPPED",
                  page: counters.pagesFetched,
                  remaining: remainingCreatives.length,
                  creativeIds: remainingCreatives.slice(0, 12).map((creative) => creative.creativeId),
                  emptyAdvanceStreak
                }
              }, db);
              break;
            }
            continue;
          }
          const listCreative = remainingCreatives.shift();
          if (!listCreative) break;
          if (seen.has(listCreative.creativeId)) continue;
          await assertNotCanceled(input.scanJobId, db);
          try {
            const skipDetail = shouldSkipCreativeDetail(existingDetails.get(listCreative.creativeId), {
              refreshDetails: input.refreshDetails
            });
            const listOnly = await withOperationTimeout(client.collectCreative({
              advertiserId: input.googleAdvertiserId,
              creativeId: listCreative.creativeId,
              listCreative,
              collectDetail: false
            }), browserNative ? readPositiveIntegerEnv("GOOGLE_BROWSER_COLLECT_TIMEOUT_MS", 20_000) : 0, `browser-native:timeout:CollectCreative:${listCreative.creativeId}`);
            if (hasUsefulRawPreview(listOnly.raw.preview)) counters.previewsFetched += 1;
            seen.set(listOnly.creativeId, listOnly);
            await saveNormalizedCreative(input.advertiserDbId, listOnly, db);
            if (!skipDetail) {
              pendingDetails.push({ countryCode, listCreative });
            } else {
              counters.detailsFetched += 1;
              if (!hasUsefulRawPreview(listOnly.raw.preview) && hasUsefulRawPreview(existingDetails.get(listCreative.creativeId)?.rawPreview)) counters.previewsFetched += 1;
            }
            await maybePersistCounters(progressPersister, input.scanJobId, scan.id, counters, totalCreativesFound(), db);
            await recordScanEvent({
              scanJobId: input.scanJobId,
              scanId: scan.id,
              level: "info",
              message: `Креатив сохранен из выдачи: ${listOnly.creativeId}`,
              data: {
                reasonCode: skipDetail ? "CREATIVE_DETAIL_SKIPPED_EXISTING" : "CREATIVE_DETAIL_QUEUED",
                creativeId: listOnly.creativeId
              }
            }, db);
          } catch (error) {
            if (isBlockedError(error)) throw error;
            creativeErrors += 1;
            await recordScanEvent({
              scanJobId: input.scanJobId,
              scanId: scan.id,
              level: "warn",
              message: `Не удалось собрать креатив ${listCreative.creativeId}`,
              data: {
                reasonCode: "CREATIVE_COLLECT_FAILED",
                creativeId: listCreative.creativeId,
                error: errorMessage(error)
              }
            }, db);
          }
        }

        const nextPageToken = page.nextPageToken;
        const newOnPage = pageCreativeIds.filter((creativeId) => seen.has(creativeId) && !seenBeforePage.has(creativeId)).length;
        if (browserNative && pageCreativeIds.length > 0 && newOnPage === 0) {
          duplicatePageStreak += 1;
          await recordScanEvent({
            scanJobId: input.scanJobId,
            scanId: scan.id,
            level: "warn",
            message: `Страница выдачи повторилась без новых креативов: ${duplicatePageStreak}`,
            data: {
              reasonCode: "DUPLICATE_SEARCH_PAGE",
              streak: duplicatePageStreak,
              page: counters.pagesFetched,
              creatives: pageCreativeIds.length
            }
          }, db);
          if (duplicatePageStreak >= readPositiveIntegerEnv("GOOGLE_BROWSER_DUPLICATE_PAGE_STOP_AFTER", 3)) {
            stoppedAfterDuplicatePages = true;
            pageToken = undefined;
            await recordScanEvent({
              scanJobId: input.scanJobId,
              scanId: scan.id,
              level: "info",
              message: "Повторяющиеся страницы без новых креативов, сбор выдачи завершен",
              data: {
                reasonCode: "DUPLICATE_SEARCH_PAGES_STOPPED",
                streak: duplicatePageStreak,
                page: counters.pagesFetched,
                creatives: totalCreativesFound()
              }
            }, db);
            break;
          }
          if (isBrowserNativeResumeRpcPage(page.raw)) {
            pageToken = undefined;
            await recordScanEvent({
              scanJobId: input.scanJobId,
              scanId: scan.id,
              level: "warn",
              message: "Resume RPC вернул дубль, переключаюсь обратно на DOM-скролл",
              data: {
                reasonCode: "BROWSER_NATIVE_RESUME_RPC_DUPLICATE",
                page: counters.pagesFetched,
                creatives: pageCreativeIds.length
              }
            }, db);
          } else {
            pageToken = nextPageToken;
          }
        } else {
          duplicatePageStreak = 0;
          pageToken = nextPageToken;
        }
        if (pageToken && (counters.pagesFetched >= limits.maxPagesPerRun || totalCreativesFound() >= limits.maxCreativesPerRun)) {
          hitScanLimit = true;
        }
        await saveChunkProgress(input.scanJobId, scan.id, countryCode, pageToken, counters, totalCreativesFound(), db);
        if (detailBatchPerPage > 0 && pendingDetails.length > 0) {
          creativeErrors += await collectPendingCreativeDetails({
            input,
            scanId: scan.id,
            pendingDetails,
            counters,
            seen,
            creativeDelayMs,
            progressPersister,
            db,
            client,
            detailClients: input.detailClients,
            maxItems: detailBatchPerPage
          });
        }
      } while (pageToken && counters.pagesFetched < limits.maxPagesPerRun && totalCreativesFound() < limits.maxCreativesPerRun);
    }

    if (input.countryCodes.length > 0 && validCountryTargetCount === 0) {
      throw new Error(`unknown-country-codes:${unknownCountryCodes.join(",")}`);
    }

    if (creativeErrors > 0 && totalCreativesFound() === 0) {
      throw new Error(`creative-details-failed:${creativeErrors}`);
    }

    if (!browserNative) {
      creativeErrors += await collectPendingCreativeDetails({
        input,
        scanId: scan.id,
        pendingDetails,
        counters,
        seen,
        creativeDelayMs,
        progressPersister,
        db,
        client,
        detailClients: input.detailClients,
        maxItems: Number.POSITIVE_INFINITY
      });
      if (pendingDetails.length > 0) {
        throw new Error(`blocked:detail-incomplete:${pendingDetails.length}`);
      }
    } else if (pendingDetails.length > 0) {
      await recordScanEvent({
        scanJobId: input.scanJobId,
        scanId: scan.id,
        level: "info",
        message: `Основной сбор завершен, detail RPC оставлен фоновому добору: ${pendingDetails.length}`,
        data: { reasonCode: "DETAIL_BACKGROUND_DEFERRED", remaining: pendingDetails.length }
      }, db);
    }

    const disappeared = hitScanLimit || stoppedAfterDuplicatePages || resumedBrowserNativeJob ? 0 : await markDisappearedCreatives(input, scanStartedAt, db);
    const newCreatives = await countNewCreatives(input.advertiserDbId, scanStartedAt, db);
    await refreshAdvertiserCounters(input.advertiserDbId, db);
    await db.scan.update({
      where: { id: scan.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        pagesFetched: counters.pagesFetched,
        creativesFound: totalCreativesFound(),
        newCreatives,
        detailsFetched: counters.detailsFetched,
        previewsFetched: counters.previewsFetched
      }
    });
    if (hitScanLimit) {
      await recordScanEvent({
        scanJobId: input.scanJobId,
        scanId: scan.id,
        level: "info",
        message: "Частичный сбор завершен по лимиту, пропавшие креативы не помечались",
        data: { reasonCode: "DISAPPEARED_MARK_SKIPPED_LIMIT", pagesFetched: counters.pagesFetched, creativesFound: totalCreativesFound() }
      }, db);
    } else if (disappeared > 0) {
      await recordScanEvent({
        scanJobId: input.scanJobId,
        scanId: scan.id,
        level: "info",
        message: `Помечены пропавшие креативы: ${disappeared}`,
        data: { reasonCode: "CREATIVES_MARKED_STOPPED", creatives: disappeared }
      }, db);
    }
    const finalJobCounters = await monotonicJobCounters(input.scanJobId, counters, totalCreativesFound(), db);
    await db.scanJob.update({
      where: { id: input.scanJobId },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        errorMessage: null,
        blockedReason: null,
        ...finalJobCounters,
        nextPageToken: null,
        currentCountryCode: null,
        chunkStartedAt: null
      }
    });
    await db.advertiser.update({
      where: { id: input.advertiserDbId },
      data: {
        lastScanAt: new Date(),
        lastSuccessfulScanAt: new Date(),
        lastScanStatus: "SUCCESS"
      }
    });

    return { creativesFound: finalJobCounters.creativesFound, chunked: false };
  } catch (error) {
    const message = errorMessage(error);
    const blocked = message.startsWith("blocked:") || message.startsWith("browser-native:challenge:") || message.startsWith("browser-native:timeout:");
    const canceled = message === "scan-canceled";
    const status = canceled ? "CANCELED" : blocked ? "BLOCKED" : "FAILED";

    await recordScanEvent({
      scanJobId: input.scanJobId,
      scanId: scan.id,
      level: "error",
      message: humanScanError(message),
      data: { blocked, reasonCode: scanFailureReasonCode(message), rawMessage: message }
    }, db);
    await db.scan.update({
      where: { id: scan.id },
      data: {
        status,
        finishedAt: new Date(),
        errorMessage: message,
        blockedReason: blocked ? message : undefined,
        pagesFetched: counters.pagesFetched,
        creativesFound: totalCreativesFound(),
        detailsFetched: counters.detailsFetched,
        previewsFetched: counters.previewsFetched
      }
    });
    const finalJobCounters = await monotonicJobCounters(input.scanJobId, counters, totalCreativesFound(), db);
    await db.scanJob.update({
      where: { id: input.scanJobId },
      data: {
        status,
        finishedAt: new Date(),
        errorMessage: message,
        blockedReason: blocked ? message : undefined,
        ...finalJobCounters
      }
    });
    await refreshAdvertiserCounters(input.advertiserDbId, db);
    await db.advertiser.update({
      where: { id: input.advertiserDbId },
      data: { lastScanAt: new Date(), lastScanStatus: status }
    });

    throw error;
  }
}

type CollectSearchListCreativeInput = {
  input: RunScanInput;
  scanId: string;
  countryCode?: string;
  listCreative: ParsedSearchCreative;
  existingDetails: Map<string, ExistingCreativeDetailState>;
  counters: ScanCounters;
  seen: Map<string, NormalizedCreative>;
  pendingDetails: PendingCreativeDetail[];
  progressPersister: ProgressPersister;
  db: DbClient;
  client: GoogleCreativeClient;
  deferEconomyPrune?: boolean;
};

function takeReadyBrowserNativeCreatives(
  creatives: ParsedSearchCreative[],
  seen: Map<string, NormalizedCreative>,
  maxRemaining: number
) {
  const maxBatch = Math.max(1, Math.min(
    readPositiveIntegerEnv("GOOGLE_BROWSER_READY_BATCH_SIZE", 8),
    Number.isFinite(maxRemaining) ? maxRemaining : Number.MAX_SAFE_INTEGER
  ));
  const batch: ParsedSearchCreative[] = [];
  for (const creative of creatives) {
    if (seen.has(creative.creativeId)) continue;
    if (!isReadyBrowserNativeListCreative(creative)) continue;
    batch.push(creative);
    if (batch.length >= maxBatch) break;
  }
  return batch;
}

function isReadyBrowserNativeListCreative(creative: ParsedSearchCreative) {
  const rawRoot = creative.raw as {
    browserNativeDom?: unknown;
    dom?: unknown;
  } | undefined;
  const raw = (rawRoot?.browserNativeDom ? rawRoot : rawRoot?.dom) as {
    browserNativeDom?: unknown;
    assets?: unknown;
    storeUrl?: unknown;
    appId?: unknown;
    appName?: unknown;
    title?: unknown;
    description?: unknown;
  } | undefined;
  if (!raw?.browserNativeDom) return false;
  const assets = Array.isArray(raw.assets) ? raw.assets.filter(Boolean).length : 0;
  return Boolean(
    creative.previewUrl
      || raw.storeUrl
      || raw.appId
      || raw.appName
      || raw.title
      || raw.description
      || assets > 0
  );
}

async function collectSearchListCreative({
  input,
  scanId,
  countryCode,
  listCreative,
  existingDetails,
  counters,
  seen,
  pendingDetails,
  progressPersister,
  db,
  client,
  deferEconomyPrune
}: CollectSearchListCreativeInput) {
  if (seen.has(listCreative.creativeId)) return "skipped" as const;
  await assertNotCanceled(input.scanJobId, db);
  try {
    const skipDetail = shouldSkipCreativeDetail(existingDetails.get(listCreative.creativeId), {
      refreshDetails: input.refreshDetails
    });
    const listOnly = await client.collectCreative({
      advertiserId: input.googleAdvertiserId,
      creativeId: listCreative.creativeId,
      listCreative,
      collectDetail: false,
      deferEconomyPrune
    });
    if (hasUsefulRawPreview(listOnly.raw.preview)) counters.previewsFetched += 1;
    seen.set(listOnly.creativeId, listOnly);
    await saveNormalizedCreative(input.advertiserDbId, listOnly, db);
    if (!skipDetail) {
      pendingDetails.push({ countryCode, listCreative });
    } else {
      counters.detailsFetched += 1;
      if (!hasUsefulRawPreview(listOnly.raw.preview) && hasUsefulRawPreview(existingDetails.get(listCreative.creativeId)?.rawPreview)) counters.previewsFetched += 1;
    }
    await maybePersistCounters(progressPersister, input.scanJobId, scanId, counters, seen.size, db);
    await recordScanEvent({
      scanJobId: input.scanJobId,
      scanId,
      level: "info",
      message: `Креатив сохранен из выдачи: ${listOnly.creativeId}`,
      data: {
        reasonCode: skipDetail ? "CREATIVE_DETAIL_SKIPPED_EXISTING" : "CREATIVE_DETAIL_QUEUED",
        creativeId: listOnly.creativeId
      }
    }, db);
    return "collected" as const;
  } catch (error) {
    if (isBlockedError(error)) throw error;
    await recordScanEvent({
      scanJobId: input.scanJobId,
      scanId,
      level: "warn",
      message: `Не удалось собрать креатив ${listCreative.creativeId}`,
      data: {
        reasonCode: "CREATIVE_COLLECT_FAILED",
        creativeId: listCreative.creativeId,
        error: errorMessage(error)
      }
    }, db);
    return "failed" as const;
  }
}

async function collectPendingCreativeDetails({
  input,
  scanId,
  pendingDetails,
  counters,
  seen,
  creativeDelayMs,
  progressPersister,
  db,
  client,
  detailClients,
  maxItems
}: {
  input: RunScanInput;
  scanId: string;
  pendingDetails: PendingCreativeDetail[];
  counters: ScanCounters;
  seen: Map<string, NormalizedCreative>;
  creativeDelayMs: number;
  progressPersister: ProgressPersister;
  db: DbClient;
  client: GoogleCreativeClient;
  detailClients?: GoogleCreativeClient[];
  maxItems: number;
}) {
  if (!pendingDetails.length) return 0;

  let errors = 0;
  const items = pendingDetails.splice(0, Math.min(pendingDetails.length, maxItems));
  const clients = detailClients?.length ? detailClients : [client];
  await recordScanEvent({
    scanJobId: input.scanJobId,
    scanId,
    level: "info",
    message: `Быстрый сбор выдачи завершен, detail RPC в очереди: ${pendingDetails.length}`,
    data: { reasonCode: "DETAIL_PHASE_STARTED", creatives: items.length, remaining: pendingDetails.length }
  }, db);

  let cursor = 0;
  const nextItem = () => items[cursor++];
  await Promise.all(clients.map(async (detailClient, slot) => {
    for (;;) {
      const item = nextItem();
      if (!item) return;
      await assertNotCanceled(input.scanJobId, db);
      if (creativeDelayMs > 0) await delay(creativeDelayMs + Math.floor(Math.random() * Math.min(creativeDelayMs, 3_000)));
      try {
        const normalized = await detailClient.collectCreative({
          advertiserId: input.googleAdvertiserId,
          creativeId: item.listCreative.creativeId,
          listCreative: item.listCreative,
          collectDetail: true
        });
        const previous = seen.get(normalized.creativeId);
        if (normalized.raw.detail) counters.detailsFetched += 1;
        if (normalized.raw.preview && !previous?.raw.preview) counters.previewsFetched += 1;
        seen.set(normalized.creativeId, normalized);
        await saveNormalizedCreative(input.advertiserDbId, normalized, db);
        await maybePersistCounters(progressPersister, input.scanJobId, scanId, counters, seen.size, db);
        await recordScanEvent({
          scanJobId: input.scanJobId,
          scanId,
          level: "info",
          message: `Detail RPC дозаполнен: ${normalized.creativeId}`,
          data: { reasonCode: "CREATIVE_DETAIL_COLLECTED", creativeId: normalized.creativeId, slot: slot + 1 }
        }, db);
      } catch (error) {
        errors += 1;
        pendingDetails.unshift(item);
        const blocked = isBlockedError(error);
        await recordScanEvent({
          scanJobId: input.scanJobId,
          scanId,
          level: "warn",
          message: blocked
            ? `Detail RPC ограничен Google, быстрый сбор уже сохранен: ${item.listCreative.creativeId}`
            : `Не удалось дозаполнить detail RPC: ${item.listCreative.creativeId}`,
          data: {
            reasonCode: blocked ? "DETAIL_RPC_BLOCKED" : "DETAIL_RPC_FAILED",
            creativeId: item.listCreative.creativeId,
            error: errorMessage(error),
            slot: slot + 1
          }
        }, db);
        if (blocked) return;
      }
    }
  }));

  await persistCounters(input.scanJobId, scanId, counters, seen.size, db);
  return errors;
}

function humanScanError(message: string) {
  if (message.startsWith("browser-native:profile-locked:")) return "Browser-профиль занят другим процессом. Задача будет перезапущена на новом профиле.";
  if (message === "browser-native:empty-search-page" || message === "browser-native:no-search-results") return "Страница рекламодателя открылась, но креативы не удалось собрать даже после повторной попытки.";
  if (message.startsWith("browser-native:challenge:")) return "Нужна ручная проверка proxy: Google показал captcha или challenge.";
  if (message.startsWith("browser-native:timeout:")) return "Proxy не открыл страницу Google вовремя.";
  if (message.startsWith("browser-native:preview-incomplete:")) return "Preview карточки не догрузились полностью. Сбор остановлен, чтобы не пропустить данные.";
  if (message.startsWith("unknown-country-codes:")) return `Неизвестные коды стран: ${message.slice("unknown-country-codes:".length)}`;
  if (message.startsWith("blocked:")) return "Google ограничил запрос. Нужна пауза или рабочий proxy.";
  if (message === "scan-canceled") return "Сканирование отменено.";
  return message;
}

function scanFailureReasonCode(message: string) {
  if (message === "scan-canceled") return "SCAN_CANCELED";
  if (message.startsWith("browser-native:profile-locked:")) return "PROFILE_LOCKED";
  if (message === "browser-native:empty-search-page" || message === "browser-native:no-search-results") return "EMPTY_SEARCH_PAGE";
  if (message.startsWith("browser-native:challenge:")) return "PROXY_CHALLENGE_REQUIRED";
  if (message.startsWith("browser-native:timeout:")) return "PROXY_TIMEOUT";
  if (message.startsWith("browser-native:empty:")) return "GOOGLE_PAGE_EMPTY";
  if (message.startsWith("browser-native:preview-incomplete:")) return "PREVIEW_INCOMPLETE";
  if (message.startsWith("unknown-country-codes:")) return "UNKNOWN_COUNTRY_CODES";
  if (message.startsWith("blocked:")) return "GOOGLE_BLOCKED";
  if (message.includes("SearchService/SearchCreatives:404")) return "GOOGLE_SEARCH_RPC_NOT_FOUND";
  if (message.startsWith("rpc:")) return "GOOGLE_RPC_FAILED";
  if (message.startsWith("creative-details-failed:")) return "CREATIVE_DETAILS_FAILED";
  return "SCAN_FAILED";
}

function isBlockedError(error: unknown) {
  const message = errorMessage(error);
  return message.startsWith("blocked:")
    || message.startsWith("browser-native:challenge:")
    || message.startsWith("browser-native:timeout:")
    || message.startsWith("creative-detail-empty:");
}

function isBrowserNativeClient(client: GoogleCreativeClient) {
  return client.constructor.name === "BrowserNativeGoogleClient";
}

function browserNativePreviewIncomplete(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as { browserNativePreviewIncomplete?: unknown }).browserNativePreviewIncomplete;
  if (!value || typeof value !== "object") return null;
  const found = Number((value as { found?: unknown }).found);
  const total = Number((value as { total?: unknown }).total);
  const missingValue = (value as { missing?: unknown }).missing;
  return {
    found: Number.isFinite(found) ? found : 0,
    total: Number.isFinite(total) ? total : 0,
    missing: Array.isArray(missingValue) ? missingValue.map(String).slice(0, 20) : []
  };
}

export function resolveLimits(input: Pick<RunScanInput, "scanMode" | "requestDelayMs" | "maxPagesPerRun" | "maxCreativesPerRun">) {
  const mode = input.scanMode ?? "FULL";
  const preset = {
    FAST: { requestDelayMs: 1500, maxPagesPerRun: 1, maxCreativesPerRun: 20 },
    FULL: { requestDelayMs: 8000, maxPagesPerRun: Number.POSITIVE_INFINITY, maxCreativesPerRun: Number.POSITIVE_INFINITY },
    CAUTIOUS: { requestDelayMs: 45000, maxPagesPerRun: 1, maxCreativesPerRun: 10 }
  }[mode];
  return {
    requestDelayMs: input.requestDelayMs ?? preset.requestDelayMs,
    maxPagesPerRun: input.maxPagesPerRun ?? preset.maxPagesPerRun,
    maxCreativesPerRun: input.maxCreativesPerRun ?? preset.maxCreativesPerRun
  };
}

export function resolveBrowserNativeDelays(input: Pick<ReturnType<typeof resolveLimits>, "requestDelayMs">) {
  return {
    pageDelayMs: Math.min(input.requestDelayMs, 1_200)
  };
}

export function resolveBrowserNativeResumeFastForwardLimit(seenCreativeCount: number) {
  const pageSize = readPositiveIntegerEnv("GOOGLE_BROWSER_RESUME_PAGE_SIZE", 40);
  const expectedSeenPages = Math.ceil(Math.max(0, seenCreativeCount) / pageSize);
  const extraPages = readPositiveIntegerEnv("GOOGLE_BROWSER_RESUME_FAST_FORWARD_EXTRA_PAGES", DEFAULT_RESUME_FAST_FORWARD_EXTRA_PAGES);
  return Math.max(extraPages, expectedSeenPages + extraPages);
}

type ExistingCreativeDetailState = {
  rawDetail: unknown;
  rawPreview: unknown;
  appDbId?: string | null;
  previewUrl?: string | null;
  countryCount: number;
  detailFetchedAt?: Date | null;
};

export function shouldSkipCreativeDetail(
  existing: ExistingCreativeDetailState | undefined,
  options: { now?: Date; ttlMs?: number; refreshDetails?: boolean } = {}
) {
  if (options.refreshDetails) return false;
  if (!existing?.rawDetail || existing.countryCount <= 0 || !existing.detailFetchedAt) return false;
  if (!hasUsefulRawPreview(existing.rawPreview)) return false;
  if (!existing.appDbId && isGooglePreviewContentUrl(existing.previewUrl)) return false;

  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_DETAIL_TTL_MS;
  return now.getTime() - existing.detailFetchedAt.getTime() <= ttlMs;
}

function hasUsefulRawPreview(value: unknown) {
  if (!value) return false;
  if (typeof value !== "object") return true;

  const record = value as Record<string, unknown>;
  const textFields = [
    "appId",
    "appName",
    "shortAppName",
    "appStoreName",
    "storeUrl",
    "landingUrl",
    "destination_url",
    "description",
    "description1",
    "shortDescription",
    "body",
    "landscapeImage",
    "coverImage",
    "videoUrl",
    "youtube_video_id"
  ];
  if (textFields.some((field) => isUsefulPreviewText(record[field]))) return true;

  const assets = record.assets;
  if (Array.isArray(assets) && assets.some(Boolean)) return true;

  const looksLikeEmptyDomSnapshot = record.source === "dom_card"
    || record.domSource === "dom_card"
    || "domCreativeUrl" in record
    || "domAppName" in record
    || "domAppId" in record;
  if (looksLikeEmptyDomSnapshot) return false;

  return Object.keys(record).length > 0;
}

function isUsefulPreviewText(value: unknown) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return Boolean(text && text !== "-" && text.toLowerCase() !== "unknown");
}

function isGooglePreviewContentUrl(value?: string | null) {
  return Boolean(value && /displayads-formats\.googleusercontent\.com\/ads\/preview\/content\.js/i.test(value));
}

async function existingCreativeDetailStates(creativeIds: string[], advertiserDbId: string, db: DbClient) {
  if (!creativeIds.length) return new Map<string, ExistingCreativeDetailState>();

  const rows = await db.creative.findMany({
    where: {
      advertiserId: advertiserDbId,
      creativeId: { in: creativeIds }
    },
    select: {
      creativeId: true,
      rawDetail: true,
      rawPreview: true,
      appDbId: true,
      previewUrl: true,
      detailFetchedAt: true,
      _count: { select: { countries: true } }
    }
  });

  return new Map(rows.map((row) => [
    row.creativeId,
    {
      rawDetail: row.rawDetail,
      rawPreview: row.rawPreview,
      appDbId: row.appDbId,
      previewUrl: row.previewUrl,
      countryCount: row._count.countries,
      detailFetchedAt: row.detailFetchedAt
    }
  ]));
}

async function loadScanJobSeenCreativeIds(scanJobId: string, db: DbClient) {
  const rows = await db.$queryRaw<Array<{ creativeId: string | null }>>`
    SELECT DISTINCT data->>'creativeId' AS "creativeId"
    FROM "ScanEvent"
    WHERE "scanJobId" = ${scanJobId}
      AND data ? 'creativeId'
      AND data->>'creativeId' LIKE 'CR%'
  `;

  return rows
    .map((row) => row.creativeId)
    .filter((creativeId): creativeId is string => Boolean(creativeId));
}

function seenCreativePlaceholder(advertiserId: string, creativeId: string): NormalizedCreative {
  return {
    advertiserId,
    creativeId,
    title: undefined,
    description: undefined,
    format: "UNKNOWN",
    status: "UNKNOWN",
    previewUrls: [],
    countries: [],
    assets: [],
    raw: {}
  };
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function saveChunkProgress(
  scanJobId: string,
  scanId: string,
  countryCode: string | undefined,
  nextPageToken: string | undefined,
  counters: ScanCounters,
  creativesFound: number,
  db: DbClient,
  options: { chunkComplete?: boolean } = {}
) {
  const jobCounters = await monotonicJobCounters(scanJobId, counters, creativesFound, db);
  await touchWorkerHeartbeat(db, `scan ${scanJobId}: ${jobCounters.pagesFetched} стр., ${jobCounters.creativesFound} кр.`);
  await Promise.all([
    db.scanJob.update({
      where: { id: scanJobId },
      data: {
        ...jobCounters,
        nextPageToken: nextPageToken ?? null,
        currentCountryCode: countryCode ?? null,
        chunkStartedAt: new Date()
      }
    }),
    db.scan.update({
      where: { id: scanId },
      data: options.chunkComplete
        ? {
          ...counters,
          creativesFound,
          status: "SUCCESS",
          finishedAt: new Date()
        }
        : {
          ...counters,
          creativesFound
        }
    })
  ]);
}

async function persistCounters(
  scanJobId: string,
  scanId: string,
  counters: ScanCounters,
  creativesFound: number,
  db: DbClient
) {
  const jobCounters = await monotonicJobCounters(scanJobId, counters, creativesFound, db);
  await touchWorkerHeartbeat(db, `scan ${scanJobId}: ${jobCounters.pagesFetched} стр., ${jobCounters.creativesFound} кр.`);
  await Promise.all([
    db.scanJob.update({
      where: { id: scanJobId },
      data: jobCounters
    }),
    db.scan.update({
      where: { id: scanId },
      data: { ...counters, creativesFound }
    })
  ]);
}

type ProgressPersister = {
  lastFlushAt: number;
  lastCreativesFound: number;
  intervalMs: number;
  creativeBatch: number;
};

function createProgressPersister(): ProgressPersister {
  return {
    lastFlushAt: Date.now(),
    lastCreativesFound: 0,
    intervalMs: readPositiveIntegerEnv("SCAN_PROGRESS_FLUSH_INTERVAL_MS", DEFAULT_PROGRESS_FLUSH_INTERVAL_MS),
    creativeBatch: readPositiveIntegerEnv("SCAN_PROGRESS_FLUSH_CREATIVE_BATCH", DEFAULT_PROGRESS_FLUSH_CREATIVE_BATCH)
  };
}

async function maybePersistCounters(
  persister: ProgressPersister,
  scanJobId: string,
  scanId: string,
  counters: ScanCounters,
  creativesFound: number,
  db: DbClient
) {
  const now = Date.now();
  const enoughCreatives = creativesFound - persister.lastCreativesFound >= persister.creativeBatch;
  const enoughTime = now - persister.lastFlushAt >= persister.intervalMs;
  if (!enoughCreatives && !enoughTime) return;

  await persistCounters(scanJobId, scanId, counters, creativesFound, db);
  persister.lastFlushAt = now;
  persister.lastCreativesFound = creativesFound;
}

async function recordBrowserNativeDomDiagnostics({
  input,
  scanId,
  db,
  client,
  stage,
  extra
}: {
  input: RunScanInput;
  scanId: string;
  db: DbClient;
  client: GoogleCreativeClient;
  stage: string;
  extra?: Record<string, unknown>;
}) {
  if (!isBrowserNativeClient(client) || !client.getCollectionDiagnostics) return;
  if (process.env.GOOGLE_BROWSER_SCAN_DEBUG === "false") return;

  const diagnostics = await withOperationTimeout(
    client.getCollectionDiagnostics(),
    readPositiveIntegerEnv("GOOGLE_BROWSER_DIAGNOSTICS_TIMEOUT_MS", 5_000),
    "browser-native:timeout:CollectionDiagnostics"
  ).catch((error) => ({
    error: errorMessage(error)
  }));

  await recordScanEvent({
    scanJobId: input.scanJobId,
    scanId,
    level: "info",
    message: `DOM диагностика сбора: ${stage}`,
    data: {
      reasonCode: "BROWSER_NATIVE_DOM_DIAGNOSTICS",
      stage,
      ...extra,
      diagnostics
    }
  }, db);
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

async function touchWorkerHeartbeat(db: DbClient, message: string) {
  const now = Date.now();
  if (now - lastWorkerHeartbeatTouchAt < 10_000) return;
  lastWorkerHeartbeatTouchAt = now;
  await db.workerHeartbeat.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      status: "running",
      message,
      pid: process.pid,
      lastSeenAt: new Date(now)
    },
    update: {
      status: "running",
      message,
      pid: process.pid,
      lastSeenAt: new Date(now)
    }
  }).catch(() => undefined);
}

async function monotonicJobCounters(
  scanJobId: string,
  counters: ScanCounters,
  creativesFound: number,
  db: DbClient
): Promise<PersistedScanCounters> {
  const current = await db.scanJob.findUnique({
    where: { id: scanJobId },
    select: {
      pagesFetched: true,
      creativesFound: true,
      detailsFetched: true,
      previewsFetched: true
    }
  });

  return mergeMonotonicCounters(current, counters, creativesFound);
}

export function mergeMonotonicCounters(
  current: PersistedScanCounters | null,
  counters: ScanCounters,
  creativesFound: number
): PersistedScanCounters {
  return {
    pagesFetched: Math.max(current?.pagesFetched ?? 0, counters.pagesFetched),
    creativesFound: Math.max(current?.creativesFound ?? 0, creativesFound),
    detailsFetched: Math.max(current?.detailsFetched ?? 0, counters.detailsFetched),
    previewsFetched: Math.max(current?.previewsFetched ?? 0, counters.previewsFetched)
  };
}

async function assertNotCanceled(scanJobId: string, db: DbClient) {
  const job = await db.scanJob.findUnique({ where: { id: scanJobId }, select: { cancelRequested: true } });
  if (job?.cancelRequested) throw new Error("scan-canceled");
}

export function shouldStopOnIncompletePreview(input: RunScanInput, previewIncomplete?: { found: number; total: number }) {
  if (process.env.GOOGLE_BROWSER_PREVIEW_STRICT === "true") return true;
  return false;
}

export function resolveBrowserNativeInlineDetailBatch() {
  if (process.env.GOOGLE_BROWSER_DETAIL_INLINE !== "true") return 0;
  return readPositiveIntegerEnv("GOOGLE_BROWSER_DETAIL_BATCH_PER_PAGE", 3);
}

async function markDisappearedCreatives(input: RunScanInput, scanStartedAt: Date, db: DbClient) {
  const isCompleteAdvertiserScan =
    (input.scanMode ?? "FULL") === "FULL" &&
    input.countryCodes.length === 0 &&
    !input.dateRange?.start &&
    !input.dateRange?.end;

  if (!isCompleteAdvertiserScan) return 0;

  const result = await db.creative.updateMany({
    where: {
      advertiserId: input.advertiserDbId,
      status: { not: "STOPPED" },
      lastFoundAt: { lt: scanStartedAt }
    },
    data: { status: "STOPPED" }
  });
  return result.count;
}

async function countNewCreatives(advertiserId: string, scanStartedAt: Date, db: DbClient) {
  return db.creative.count({
    where: {
      advertiserId,
      firstFoundAt: { gte: scanStartedAt }
    }
  });
}

function delay(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function withOperationTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function assertBeforePageProcessDeadline(deadline: number) {
  if (Date.now() <= deadline) return;
  throw new Error("browser-native:timeout:PageProcess");
}

function isBrowserNativeResumeRpcPage(raw: unknown) {
  return Boolean(raw && typeof raw === "object" && (raw as { browserNativeResumeRpc?: unknown }).browserNativeResumeRpc);
}

function findGeoByCountryCode(countryCode: string) {
  for (let id = 1; id <= 3000; id += 1) {
    const geo = getGeoTarget(id);
    if (geo?.countryCode === countryCode.toUpperCase()) return geo;
  }
  return undefined;
}
