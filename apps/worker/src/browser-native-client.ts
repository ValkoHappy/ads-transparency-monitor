import { normalizeCreative, parseCreativeDetails, parsePreviewContentJs, parseSearchCreatives, type NormalizedCreative, type ParsedSearchCreatives } from "@ad-monitor/core";
import { chromium, type BrowserContext, type Frame, type Page } from "playwright";
import { enrichAppMetadata } from "./app-metadata.js";
import { browserNativeProfileDir, cleanupStaleBrowserProfiles, isBrowserProfileLockError, prepareBrowserProfileDir, releaseBrowserProfileDir } from "./browser-native-diagnostics.js";
import { assertUsableCreativeDetail, defaultUserAgent, normalizeGooglePreviewUrl, type GoogleCreativeClient, type GoogleRpcClientOptions, type SearchPayloadInput } from "./google-client.js";
import { buildCreativeDetailPayload, buildSearchCreativesPayload, collectBestPreview } from "./google-client.js";
import { normalizeRuntimeProxyUrl, resolvePlaywrightProxy } from "./proxy-bridge.js";
import { SearchPage, BrowserNativeDomCreative, BrowserNativeFramePayload, BrowserNativeFrameOwner, VisibleCollectionState } from "./browser-native/model.js";
import { extractDomCreatives, extractFrameOwner, extractFrameTemplateDataSources, extractFramePreviewPayloads } from "./browser-native/page-capture.js";
import { gotoAdvertiser, assertPageIsUsable, pageMetrics, humanScroll, humanPause, keepNewestCardsInViewport, revealMissingPreviewCards } from "./browser-native/browser-operations.js";
import { isBrowserNativeDomCreative, shouldWaitForDomPreviewCapture, mergeListCreativeWithDom, normalizeDomCreative, domRawFromList, domCreativeFromList, applyDomToNormalized, extractCreativeIdFromText, parseBrowserNativeAdDataTemplate, selectFramesForDomCapture, domCreativeContentScore, isDomCreativeReadyForPreview, richerDomCreative } from "./browser-native/normalization.js";
import { resolvePreviewWaitConfig, resolveEconomyClearBatch, registerSearchPageCreativeIds, shouldCollectBrowserDetail, shouldUseBrowserNativeResumeRpc, resolveBrowserNativeDetailDelayMs, delay, withTimeout, withRejectTimeout, readPositiveIntegerEnv, readNonNegativeIntegerEnv, isBlockedDetailError } from "./browser-native/runtime-policy.js";
export { shouldWaitForDomPreviewCapture, parseBrowserNativeAdDataTemplate, domCreativeContentScore, isDomCreativeReadyForPreview } from "./browser-native/normalization.js";
export { resolvePreviewWaitConfig, resolveEconomyClearBatch, registerSearchPageCreativeIds, shouldUseBrowserNativeResumeRpc } from "./browser-native/runtime-policy.js";

export class BrowserNativeGoogleClient implements GoogleCreativeClient {
  private context?: BrowserContext;
  private page?: Page;
  private profileDir?: string;
  private advertiserPageKey?: string;
  private advertiserId?: string;
  private pages: SearchPage[] = [];
  private seenPageKeys = new Set<string>();
  private seenSearchCreativeIds = new Set<string>();
  private seenDomCreativeIds = new Set<string>();
  private queuedDomCreativeIds = new Set<string>();
  private processedDomCreativeIds = new Set<string>();
  private pendingPruneCreativeIds = new Set<string>();
  private activeCollectionCreativeIds = new Set<string>();
  private domCreatives = new Map<string, BrowserNativeDomCreative>();
  private lastPruneAt = 0;
  private economySweepDirection: 1 | -1 = 1;
  private emptySearchRecoveryAttempted = false;

  constructor(private readonly options: GoogleRpcClientOptions = {}) {}

  async searchCreatives(input: SearchPayloadInput) {
    await this.ensureAdvertiserPage(input);
    if (shouldUseBrowserNativeResumeRpc(input.pageToken)) {
      const response = await this.postRpc(
        input.advertiserId,
        "SearchService",
        "SearchCreatives",
        buildSearchCreativesPayload(input)
      );
      const parsed = parseSearchCreatives(response);
      const ids = parsed.creatives.map((creative) => creative.creativeId).filter(Boolean);
      const key = ids.join(",");
      if (key) {
        for (const id of ids) this.seenSearchCreativeIds.add(id);
        this.seenPageKeys.add(key);
        this.pages = this.pages.filter((page) => page.creatives.map((creative) => creative.creativeId).filter(Boolean).join(",") !== key);
      }
      return {
        ...parsed,
        raw: {
          ...(parsed.raw && typeof parsed.raw === "object" ? parsed.raw : {}),
          rpc: "SearchCreatives",
          browserNativeResumeRpc: true
        }
      };
    }
    const page = await this.nextSearchPage(input);
    return page;
  }

  async getCreativeById(input: { advertiserId: string; creativeId: string }) {
    await delay(resolveBrowserNativeDetailDelayMs());
    const response = await this.postRpc(
      input.advertiserId,
      "LookupService",
      "GetCreativeById",
      buildCreativeDetailPayload(input)
    );
    return parseCreativeDetails(response);
  }

  async fetchPreviewContent(previewUrl: string) {
    const safePreviewUrl = normalizeGooglePreviewUrl(previewUrl);
    const context = await this.ensureContext();
    const response = await context.request.get(safePreviewUrl, {
      timeout: 60_000
    });
    if (!response.ok()) {
      throw new Error(`Preview fetch failed with ${response.status()}`);
    }
    return parsePreviewContentJs(await response.text());
  }

  async collectCreative(input: {
    advertiserId: string;
    creativeId: string;
    listCreative?: ParsedSearchCreatives["creatives"][number];
    collectDetail?: boolean;
    deferEconomyPrune?: boolean;
  }): Promise<NormalizedCreative> {
    const pruneCollected = input.deferEconomyPrune !== true;
    let listCreative = input.listCreative;
    if (input.collectDetail === false) {
      const listDomCreative = domCreativeFromList(input.advertiserId, input.creativeId, listCreative);
      if (listDomCreative && isDomCreativeReadyForPreview(listDomCreative)) {
        const normalized = enrichAppMetadata(normalizeDomCreative(input.advertiserId, listDomCreative));
        await this.markCreativeCollected(input.creativeId, { prune: pruneCollected });
        return normalized;
      }

      const readyDomCreative = this.domCreatives.get(input.creativeId);
      if (readyDomCreative && isDomCreativeReadyForPreview(readyDomCreative)) {
        const normalized = enrichAppMetadata(normalizeDomCreative(input.advertiserId, readyDomCreative));
        await this.markCreativeCollected(input.creativeId, { prune: pruneCollected });
        return normalized;
      }

      await this.captureVisibleReadyCards([input.creativeId]);
      const capturedDomCreative = this.domCreatives.get(input.creativeId);
      if (capturedDomCreative && isDomCreativeReadyForPreview(capturedDomCreative)) {
        const normalized = enrichAppMetadata(normalizeDomCreative(input.advertiserId, capturedDomCreative));
        await this.markCreativeCollected(input.creativeId, { prune: pruneCollected });
        return normalized;
      }

      await this.focusCreativeForCollection(input.creativeId);
      listCreative = listCreative
        ? mergeListCreativeWithDom(listCreative, this.domCreatives.get(input.creativeId))
        : this.domCreatives.get(input.creativeId);
    }

    if (input.collectDetail === false && isBrowserNativeDomCreative(listCreative)) {
      const normalized = enrichAppMetadata(normalizeDomCreative(input.advertiserId, listCreative));
      await this.markCreativeCollected(input.creativeId, { prune: pruneCollected });
      return normalized;
    }

    const detail = input.collectDetail !== false && shouldCollectBrowserDetail()
      ? await this.getCreativeById(input).catch((error) => {
        if (isBlockedDetailError(error) && input.collectDetail === true) throw error;
        if (isBlockedDetailError(error) && !listCreative) throw error;
        return undefined;
      })
      : undefined;
    if (input.collectDetail === true) assertUsableCreativeDetail(input.creativeId, detail);
    const previewUrls = input.collectDetail === false
      ? [listCreative?.previewUrl]
      : [listCreative?.previewUrl, ...(detail?.previewUrls ?? [])];
    const preview = await collectBestPreview(
      previewUrls,
      (previewUrl) => this.fetchPreviewContent(previewUrl)
    );
    const normalized = normalizeCreative({ list: listCreative, detail, preview });
    const dom = domRawFromList(listCreative);
    const enriched = enrichAppMetadata(dom ? applyDomToNormalized(normalized, dom) : normalized);
    await this.markCreativeCollected(input.creativeId, { prune: pruneCollected });
    return enriched;
  }

  async flushCollectedCreatives() {
    const cleared = await this.pruneSeenCards({ force: true });
    await this.scrollAfterEconomyPrune(cleared);
    return cleared;
  }

  async advanceCollectionViewport() {
    const page = await this.ensurePage();
    await this.captureDomBatch({ queueAsPage: false });
    await this.captureVisibleReadyCards([...this.activeCollectionCreativeIds]);
    const before = await page.evaluate(() => ({
      y: window.scrollY,
      h: document.documentElement.scrollHeight || document.body.scrollHeight || 0,
      vh: window.innerHeight,
      previews: document.querySelectorAll("creative-preview").length,
      cleared: document.querySelectorAll("creative-preview[data-economy-cleared='true']").length,
      liveVisible: [...document.querySelectorAll("creative-preview")]
        .filter((card) => {
          const rect = card.getBoundingClientRect();
          return rect.bottom > -120
            && rect.top < window.innerHeight * 2.4
            && (card as HTMLElement).dataset.economyCleared !== "true";
        }).length
    })).catch(() => ({ y: 0, h: 0, vh: 900, previews: 0, cleared: 0, liveVisible: 0 }));
    const stepPx = readPositiveIntegerEnv("GOOGLE_BROWSER_COLLECT_SCROLL_STEP_PX", 170);
    const pauseMs = readNonNegativeIntegerEnv("GOOGLE_BROWSER_COLLECT_SCROLL_PAUSE_MS", 90);
    const onlyClearedInWindow = before.previews > 0 && before.cleared >= before.previews && before.liveVisible === 0;
    const delta = onlyClearedInWindow
      ? Math.max(520, Math.floor(before.vh * 0.7) + Math.floor(Math.random() * 120))
      : Math.max(90, stepPx + Math.floor(Math.random() * 45));
    await humanScroll(page, delta);
    if (pauseMs > 0) await humanPause(page, pauseMs, 50);
    await this.logEconomyState("scroll:collect-window", { delta, onlyClearedInWindow });
    await this.captureDomBatch({ queueAsPage: false });
    await this.captureVisibleReadyCards([...this.activeCollectionCreativeIds]);
    const after = await page.evaluate(() => ({
      y: window.scrollY,
      h: document.documentElement.scrollHeight || document.body.scrollHeight || 0
    })).catch(() => ({ y: before.y, h: before.h }));
    return Math.abs(after.y - before.y) > 5 || after.h > before.h + 20;
  }

  async getCollectionDiagnostics() {
    const page = await this.ensurePage();
    return page.evaluate(() => {
      const extractId = (value: string) => (String(value || "").match(/CR\d{8,}/) || [])[0];
      const cards = [...document.querySelectorAll("creative-preview")].map((card) => {
        const element = card as HTMLElement;
        const rect = element.getBoundingClientRect();
        const id = extractId(`${element.innerText || ""} ${element.outerHTML || ""}`)
          || extractId((element.querySelector("a[href*='/creative/']") as HTMLAnchorElement | null)?.href ?? "");
        const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
        const html = element.outerHTML || "";
        const ready = Boolean(
          element.querySelector("iframe[src], img[src], video, source[src], [style*='url('], [data-asoch-targets], .short-app-name, .headline, .description")
          || /Google Play|App Store|Install|Установить|GET|YÜKLE/i.test(text)
          || /data-asoch-meta|google_template_data|play\.google\.com|apps\.apple\.com/i.test(html)
        );
        return {
          id,
          ready,
          cleared: element.dataset.economyCleared === "true",
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          visible: rect.bottom > 0 && rect.top < window.innerHeight,
          hasIframe: Boolean(element.querySelector("iframe[src]")),
          hasImage: Boolean(element.querySelector("img[src], [style*='url(']")),
          text: text.slice(0, 90)
        };
      });
      return {
        url: location.href,
        y: Math.round(window.scrollY),
        height: document.documentElement.scrollHeight || document.body.scrollHeight || 0,
        viewport: window.innerHeight,
        previews: cards.length,
        cleared: cards.filter((card) => card.cleared).length,
        visible: cards.filter((card) => card.visible).slice(0, 12),
        readyVisible: cards.filter((card) => card.visible && card.ready && !card.cleared).length,
        pendingVisible: cards.filter((card) => card.visible && !card.ready && !card.cleared).length
      };
    }).catch((error) => ({
      error: error instanceof Error ? error.message : String(error)
    }));
  }

  async orderCreativesForCollection(
    creatives: ParsedSearchCreatives["creatives"],
    seenIds: string[]
  ): Promise<ParsedSearchCreatives["creatives"]> {
    if (!creatives.length) return creatives;
    const seenSet = new Set(seenIds);
    const inputIds = new Set(creatives.map((creative) => creative.creativeId).filter(Boolean));
    this.activeCollectionCreativeIds = new Set(inputIds);
    await this.captureDomBatch({ queueAsPage: false });
    await this.captureVisibleReadyCards([...this.activeCollectionCreativeIds]);
    await this.pruneSeenCards({ force: true });
    let workingCreatives = [...creatives];
    const state = await this.readVisibleCollectionState([...this.activeCollectionCreativeIds], seenIds);
    let broadCaptured = 0;
    if (state.visibleReadyUnprocessed === 0 || creatives.length <= 3) {
      const visibleItems = await this.captureVisibleReadyCards([]);
      const extraCreatives = visibleItems.filter((item) => {
        if (!item.creativeId || seenSet.has(item.creativeId) || inputIds.has(item.creativeId)) return false;
        return isDomCreativeReadyForPreview(item);
      });
      if (extraCreatives.length > 0) {
        broadCaptured = extraCreatives.length;
        for (const item of extraCreatives) {
          inputIds.add(item.creativeId);
          this.activeCollectionCreativeIds.add(item.creativeId);
          workingCreatives.push(item);
        }
      }
    }
    const originalIndex = new Map(workingCreatives.map((creative, index) => [creative.creativeId, index]));
    const domOrder = new Map([...this.domCreatives.keys()].map((creativeId, index) => [creativeId, index]));
    let readyDomIds = new Set(workingCreatives
      .filter((creative) => {
        const rank = state.ranks[creative.creativeId];
        return isBrowserNativeDomCreative(creative) || (rank?.ready === true && rank.priority <= 1);
      })
      .map((creative) => creative.creativeId));
    const settleMs = readNonNegativeIntegerEnv("GOOGLE_BROWSER_READY_SETTLE_MS", 80);
    if (readyDomIds.size === 0 && settleMs > 0) {
      const page = await this.ensurePage();
      await humanPause(page, settleMs, 40);
      await this.captureDomBatch({ queueAsPage: false });
      await this.captureVisibleReadyCards([...this.activeCollectionCreativeIds]);
      const settledState = await this.readVisibleCollectionState([...this.activeCollectionCreativeIds], seenIds);
      for (const creative of workingCreatives) {
        const rank = settledState.ranks[creative.creativeId];
        if (rank?.ready === true && rank.priority <= 1) readyDomIds.add(creative.creativeId);
      }
    }
    const ordered = [...workingCreatives].sort((left, right) => {
      const leftReady = readyDomIds.has(left.creativeId) ? 0 : 1;
      const rightReady = readyDomIds.has(right.creativeId) ? 0 : 1;
      const leftRank = state.ranks[left.creativeId] ?? { priority: 9, top: 9_999_999 };
      const rightRank = state.ranks[right.creativeId] ?? { priority: 9, top: 9_999_999 };
      return leftReady - rightReady
        || leftRank.priority - rightRank.priority
        || leftRank.top - rightRank.top
        || (domOrder.get(left.creativeId) ?? 9_999_999) - (domOrder.get(right.creativeId) ?? 9_999_999)
        || (originalIndex.get(left.creativeId) ?? 0) - (originalIndex.get(right.creativeId) ?? 0);
    });
    if (process.env.GOOGLE_BROWSER_ECONOMY_DEBUG === "true") {
      console.log("[economy-order]", JSON.stringify({
        candidates: creatives.length,
        working: workingCreatives.length,
        broadCaptured,
        readyDom: readyDomIds.size,
        visibleReady: state.visibleReadyUnprocessed,
        visibleUnprocessed: state.visibleUnprocessed,
        visibleProcessed: state.visibleProcessed,
        stateError: (state as { error?: string }).error,
        visible: state.visible.slice(0, 8),
        first: ordered.slice(0, 5).map((creative) => ({
          creativeId: creative.creativeId,
          readyDom: readyDomIds.has(creative.creativeId),
          rank: state.ranks[creative.creativeId] ?? null
        }))
      }));
    }
    return ordered.map((creative) => mergeListCreativeWithDom(creative, this.domCreatives.get(creative.creativeId)));
  }

  async close() {
    if (this.pendingPruneCreativeIds.size > 0) {
      await this.pruneSeenCards({ force: true }).catch(() => 0);
    }
    await withTimeout(
      this.context?.close() ?? Promise.resolve(),
      readPositiveIntegerEnv("GOOGLE_BROWSER_CLOSE_TIMEOUT_MS", 8_000),
      undefined
    );
    this.context = undefined;
    this.page = undefined;
    if (this.profileDir) {
      await releaseBrowserProfileDir(this.profileDir).catch(() => undefined);
      this.profileDir = undefined;
    }
  }

  private async nextSearchPage(input?: SearchPayloadInput) {
    let noChangeCount = 0;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const cached = this.pages.find((item) => !item.consumed);
      if (cached) return this.consumeSearchPage(cached);
      const pageCountBefore = this.pages.length;
      const expanded = await this.smartScrollStep(pageCountBefore);
      await this.captureDomBatch({ queueAsPage: false });
      if (this.pages.length > pageCountBefore) continue;
      noChangeCount = expanded ? 0 : noChangeCount + 1;
      if (noChangeCount >= 20) {
        const fallback = this.buildDomFallbackPage();
        if (fallback) return fallback;
        if (input && !this.emptySearchRecoveryAttempted) {
          const recovered = await this.recoverEmptySearchPage(input);
          if (recovered) return recovered;
        }
        break;
      }
    }
    throw new Error("browser-native:no-search-results");
  }

  private async ensureAdvertiserPage(input: SearchPayloadInput) {
    const page = await this.ensurePage();
    const pageKey = `${input.advertiserId}:${input.dateRange?.start ?? ""}:${input.dateRange?.end ?? ""}`;
    if (this.advertiserPageKey === pageKey && page.url().startsWith("https://adstransparency.google.com/")) return;

    this.advertiserPageKey = pageKey;
    this.advertiserId = input.advertiserId;
    this.pages = [];
    this.seenPageKeys.clear();
    this.seenSearchCreativeIds.clear();
    this.seenDomCreativeIds.clear();
    this.queuedDomCreativeIds.clear();
    this.processedDomCreativeIds.clear();
    this.pendingPruneCreativeIds.clear();
    this.activeCollectionCreativeIds.clear();
    this.domCreatives.clear();
    this.economySweepDirection = 1;
    this.emptySearchRecoveryAttempted = false;

    const response = await gotoAdvertiser(page, input.advertiserId, input.dateRange);
    await assertPageIsUsable(page, response);
    await humanPause(page, readPositiveIntegerEnv("GOOGLE_BROWSER_INITIAL_WAIT_MS", 1_200), 300);
    await this.captureDomBatch({ queueAsPage: false });
    await this.pruneSeenCards({ force: true });
    if (!this.pages.length) {
      await this.smartScrollStep(this.pages.length);
    }
    await this.captureDomBatch({ queueAsPage: false });
  }

  private async ensurePage() {
    const context = await this.ensureContext();
    if (!this.page || this.page.isClosed()) {
      this.page = await context.newPage();
      this.page.on("response", async (response) => {
        const url = response.url();
        if (!url.includes("/anji/_/rpc/SearchService/SearchCreatives")) return;
        if (!response.ok()) return;
        try {
          const parsed = parseSearchCreatives(await response.json());
          const { ids: pageIds, newIds } = registerSearchPageCreativeIds(parsed.creatives, this.seenSearchCreativeIds);
          const key = pageIds.join(",");
          if (!pageIds.length || this.seenPageKeys.has(key) || !newIds.length) return;
          this.seenPageKeys.add(key);
          this.pages.push(parsed);
        } catch {
          // Ignore non-standard internal responses; the page may issue auxiliary requests.
        }
      });
    }
    return this.page;
  }

  private async postRpc(advertiserId: string, service: string, method: string, payload: unknown): Promise<unknown> {
    const page = await this.ensurePage();
    if (!page.url().startsWith("https://adstransparency.google.com/")) {
      await this.ensureAdvertiserPage({ advertiserId });
    }
    const rpcTimeoutMs = readPositiveIntegerEnv("GOOGLE_BROWSER_RPC_TIMEOUT_MS", 30_000);
    const result = await withRejectTimeout(page.evaluate(
      async ({ serviceName, methodName, rpcPayload, timeoutMs }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(`/anji/_/rpc/${serviceName}/${methodName}?authuser=0`, {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
              "x-same-domain": "1"
            },
            body: new URLSearchParams({ "f.req": JSON.stringify(rpcPayload) }).toString(),
            credentials: "include",
            signal: controller.signal
          });
          return {
            ok: response.ok,
            status: response.status,
            text: await response.text()
          };
        } finally {
          clearTimeout(timer);
        }
      },
      { serviceName: service, methodName: method, rpcPayload: payload, timeoutMs: rpcTimeoutMs }
    ), rpcTimeoutMs + 2_000, `browser-native:timeout:Rpc:${service}/${method}`);

    if (!result.ok) {
      const blocked = result.status === 403 || result.status === 429;
      throw new Error(`${blocked ? "blocked" : "rpc"}:${service}/${method}:${result.status}`);
    }
    return JSON.parse(result.text);
  }

  private async ensureContext() {
    if (this.context) return this.context;
    const rawProxyUrl = this.options.proxyUrl ?? (this.options.useEnvProxy !== false && process.env.GOOGLE_PROXY_ENABLED === "true" ? process.env.GOOGLE_PROXY_URL : undefined);
    const proxyUrl = rawProxyUrl ? normalizeRuntimeProxyUrl(rawProxyUrl) : undefined;
    this.profileDir = browserNativeProfileDir(proxyUrl, this.options.profileKey);
    await cleanupStaleBrowserProfiles().catch(() => undefined);
    await prepareBrowserProfileDir(this.profileDir);
    try {
      this.context = await chromium.launchPersistentContext(this.profileDir, {
        headless: process.env.GOOGLE_BROWSER_HEADLESS !== "false",
        channel: process.env.GOOGLE_BROWSER_CHANNEL || undefined,
        slowMo: readNonNegativeIntegerEnv("GOOGLE_BROWSER_SLOW_MO_MS", 0),
        proxy: proxyUrl ? await resolvePlaywrightProxy(proxyUrl) : undefined,
        locale: "ru-RU",
        userAgent: defaultUserAgent(),
        viewport: { width: 1365, height: 900 },
        args: [
          "--disable-quic",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-extensions",
          "--disable-sync",
          "--no-default-browser-check",
          "--no-first-run",
          "--renderer-process-limit=4",
          "--webrtc-ip-handling-policy=default_public_interface_only"
        ]
      });
    } catch (error) {
      await releaseBrowserProfileDir(this.profileDir).catch(() => undefined);
      this.profileDir = undefined;
      if (isBrowserProfileLockError(error)) {
        throw new Error(`browser-native:profile-locked:${this.options.profileKey ?? "unknown"}`);
      }
      throw error;
    }
    this.context.setDefaultTimeout(readPositiveIntegerEnv("GOOGLE_BROWSER_ACTION_TIMEOUT_MS", 10_000));
    this.context.setDefaultNavigationTimeout(readPositiveIntegerEnv("GOOGLE_BROWSER_NAVIGATION_TIMEOUT_MS", 60_000));
    return this.context;
  }

  private async recoverEmptySearchPage(input: SearchPayloadInput) {
    this.emptySearchRecoveryAttempted = true;
    await this.options.onProgress?.("empty search page, trying recovery");
    const page = await this.ensurePage();

    await humanPause(page, 900, 240);
    await this.captureDomBatch({ queueAsPage: false });
    const domFallback = this.buildDomFallbackPage();
    if (domFallback) return domFallback;

    const response = await gotoAdvertiser(page, input.advertiserId, input.dateRange);
    await assertPageIsUsable(page, response);
    await humanPause(page, readPositiveIntegerEnv("GOOGLE_BROWSER_INITIAL_WAIT_MS", 1_200), 300);
    await this.captureDomBatch({ queueAsPage: false });
    const pageCountBefore = this.pages.length;
    await this.smartScrollStep(pageCountBefore);
    await this.captureDomBatch({ queueAsPage: false });

    const cached = this.pages.find((item) => !item.consumed);
    if (cached) return this.consumeSearchPage(cached);

    const fallback = this.buildDomFallbackPage();
    if (fallback) return fallback;

    try {
      const responsePayload = await this.postRpc(
        input.advertiserId,
        "SearchService",
        "SearchCreatives",
        buildSearchCreativesPayload(input)
      );
      const parsed = parseSearchCreatives(responsePayload);
      if (parsed.creatives.length) return parsed;
    } catch {
      // Keep the original empty-search error when recovery does not help.
    }

    throw new Error("browser-native:empty-search-page");
  }

  private async consumeSearchPage(pageBatch: SearchPage) {
    const shouldWaitForDomPreview = shouldWaitForDomPreviewCapture(pageBatch.raw);
    if (shouldWaitForDomPreview) {
      const previewCapture = await this.waitForPagePreviewCapture(pageBatch);
      if (previewCapture.missing.length) {
        const raw = pageBatch.raw && typeof pageBatch.raw === "object" ? pageBatch.raw : {};
        pageBatch.raw = {
          ...raw,
          browserNativePreviewIncomplete: previewCapture
        };
      }
    } else {
      await this.captureDomBatch({ queueAsPage: false });
      await this.pruneSeenCards();
    }
    pageBatch.creatives = pageBatch.creatives.map((item) => mergeListCreativeWithDom(item, this.domCreatives.get(item.creativeId)));
    pageBatch.consumed = true;
    for (const item of pageBatch.creatives) this.queuedDomCreativeIds.add(item.creativeId);
    await this.pruneSeenCards();
    return pageBatch;
  }

  private async smartScrollStep(pageCountBefore: number) {
    const page = await this.ensurePage();
    await this.logEconomyState("scroll:start", { pageCountBefore });
    const scrollMode = process.env.GOOGLE_BROWSER_SCROLL_MODE ?? "smooth";
    if (scrollMode === "smooth") {
      const viewportHeight = await page.evaluate(() => window.innerHeight).catch(() => 900);
      const steps = readPositiveIntegerEnv("GOOGLE_BROWSER_SCROLL_STEPS", 12);
      const baseStepPx = readPositiveIntegerEnv("GOOGLE_BROWSER_SCROLL_STEP_PX", Math.max(220, Math.floor(viewportHeight * 0.28)));
      const pauseMs = readPositiveIntegerEnv("GOOGLE_BROWSER_SCROLL_PAUSE_MS", 180);
      const sweepEnabled = process.env.GOOGLE_BROWSER_SCROLL_SWEEP === "true";
      for (let step = 0; step < steps; step += 1) {
        const sweep = sweepEnabled
          ? await this.nextEconomySweepScroll(baseStepPx, 90)
          : { delta: Math.max(160, baseStepPx + Math.floor(Math.random() * 90)), direction: "down" as const };
        const delta = sweep.delta;
        await humanScroll(page, delta);
        await this.logEconomyState("scroll:smooth-step", { step: step + 1, direction: sweep.direction, delta });
        await this.captureDomBatch({ queueAsPage: false });
        await this.captureVisibleReadyCards([...this.activeCollectionCreativeIds]);
        await this.pruneSeenCards();
        if (this.pages.length > pageCountBefore) return true;
        await humanPause(page, pauseMs, 140);
      }
      return this.pages.length > pageCountBefore;
    }

    const previous = await pageMetrics(page);
    const viewportHeight = await page.evaluate(() => window.innerHeight).catch(() => 900);
    for (let step = 0; step < 8; step += 1) {
      await humanScroll(page, Math.max(650, Math.floor(viewportHeight * (0.65 + Math.random() * 0.25)))).catch(async () => {
        await page.evaluate((delta) => {
          window.scrollBy({ top: delta, behavior: "instant" });
          window.dispatchEvent(new Event("scroll"));
        }, Math.max(650, Math.floor(viewportHeight * 0.8))).catch(() => undefined);
      });
      await this.logEconomyState("scroll:step", { step: step + 1 });
      await humanPause(page, 420, 360);
      if (this.pages.length > pageCountBefore) return true;
      await this.captureDomBatch({ queueAsPage: false });
      await this.pruneSeenCards();
      if (this.pages.length > pageCountBefore) return true;
      const current = await pageMetrics(page);
      if (current.height > previous.height + 50 || current.cards > previous.cards) {
        await humanPause(page, 520, 380);
        return true;
      }
    }

    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight || 9_999_999);
      window.dispatchEvent(new Event("scroll"));
    }).catch(() => undefined);
    await this.logEconomyState("scroll:bottom");

    const checkIntervalMs = 300;
    const maxWaitMs = 6_000;
    for (let waited = 0; waited < maxWaitMs; waited += checkIntervalMs) {
      await humanPause(page, checkIntervalMs, 160);
      const current = await pageMetrics(page);
      await this.captureDomBatch({ queueAsPage: false });
      await this.pruneSeenCards();
      if (this.pages.length > pageCountBefore) return true;
      if (current.height > previous.height + 50 || current.cards > previous.cards) {
        await humanPause(page, 520, 380);
        return true;
      }
    }
    return this.pages.length > pageCountBefore;
  }

  private async warmInitialViewport() {
    if (process.env.GOOGLE_BROWSER_INITIAL_SCROLL === "false") return;
    const page = await this.ensurePage();
    const steps = readNonNegativeIntegerEnv("GOOGLE_BROWSER_INITIAL_SCROLL_STEPS", 1);
    const stepPx = readPositiveIntegerEnv("GOOGLE_BROWSER_INITIAL_SCROLL_STEP_PX", 120);
    const pauseMs = readNonNegativeIntegerEnv("GOOGLE_BROWSER_INITIAL_SCROLL_PAUSE_MS", 220);
    await this.captureDomBatch({ queueAsPage: false });
    await this.pruneSeenCards();
    for (let step = 0; step < steps; step += 1) {
      await humanScroll(page, Math.max(70, stepPx + Math.floor(Math.random() * 35)));
      await this.logEconomyState("scroll:warmup", { step: step + 1 });
      if (pauseMs > 0) await humanPause(page, pauseMs, 80);
      await this.captureDomBatch({ queueAsPage: false });
      await this.pruneSeenCards();
    }
  }

  private async scrollAfterEconomyPrune(cleared: number) {
    if (cleared <= 0 || process.env.GOOGLE_BROWSER_SCROLL_AFTER_PRUNE === "false") return;
    const page = await this.ensurePage();
    const stepPx = readPositiveIntegerEnv("GOOGLE_BROWSER_PRUNE_SCROLL_STEP_PX", 260);
    const pauseMs = readNonNegativeIntegerEnv("GOOGLE_BROWSER_PRUNE_SCROLL_PAUSE_MS", 0);
    const delta = Math.max(180, stepPx + Math.floor(Math.random() * 90));
    if (pauseMs > 0) await humanPause(page, pauseMs, 60);
    await humanScroll(page, delta);
    await this.logEconomyState("scroll:after-prune-down", { cleared, delta });
    await this.captureDomBatch({ queueAsPage: false });
    await this.captureVisibleReadyCards([...this.activeCollectionCreativeIds]);
  }

  private async nextEconomySweepScroll(baseStepPx: number, randomPx = 80) {
    const page = await this.ensurePage();
    const metrics = await page.evaluate(() => ({
      y: window.scrollY,
      h: document.documentElement.scrollHeight || document.body.scrollHeight || 0,
      vh: window.innerHeight
    })).catch(() => ({ y: 0, h: 0, vh: 900 }));
    const bottomEdge = Math.max(360, Math.floor(metrics.vh * 0.55));
    const topEdge = Math.max(60, Math.floor(metrics.vh * 0.12));
    let edge: "top" | "bottom" | "middle" = "middle";
    if (metrics.h > 0 && metrics.y + metrics.vh >= metrics.h - bottomEdge) {
      this.economySweepDirection = -1;
      edge = "bottom";
    } else if (metrics.y <= topEdge) {
      this.economySweepDirection = 1;
      edge = "top";
    }
    const delta = this.economySweepDirection * Math.max(140, baseStepPx + Math.floor(Math.random() * Math.max(1, randomPx)));
    return {
      delta,
      direction: this.economySweepDirection === 1 ? "down" as const : "up" as const,
      edge,
      metrics
    };
  }

  private async captureVisibleReadyCards(candidateIds: string[] = []) {
    const page = await this.ensurePage();
    const extractReadyCards = Function("input", String.raw`
      const advertiserId = input.advertiserId || "";
      const candidateIds = new Set(input.candidateIds || []);
      const decode = (value) => {
        const textarea = document.createElement("textarea");
        textarea.innerHTML = String(value || "");
        const htmlDecoded = textarea.value
          .replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
          .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
          .replace(/\\u0026/g, "&")
          .replace(/\\\//g, "/");
        try { return decodeURIComponent(htmlDecoded); } catch { return htmlDecoded; }
      };
      const absoluteUrl = (value) => {
        if (!value) return undefined;
        const cleaned = decode(String(value).trim());
        if (!cleaned || cleaned.startsWith("data:")) return undefined;
        try {
          const url = new URL(cleaned, location.origin);
          return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
        } catch { return undefined; }
      };
      const isBlockedText = (value) => {
        const text = String(value || "").replace(/\s+/g, " ").trim();
        const lower = text.toLowerCase();
        return !text
          || text.length > 180
          || /^(window|document|globalthis|google|wiz|json|object|this|self)\./i.test(text)
          || /^(function|var |const |let |return |if\(|for\(|while\()/i.test(text)
          || lower.includes("wiz_global_data")
          || lower.includes("window.wiz")
          || lower.includes("this.parentnode")
          || lower.includes("a.performance")
          || /^[a-z][a-z0-9_$]*\.[a-z][a-z0-9_$]*$/i.test(text)
          || /[{};]/.test(text);
      };
      const normalizeText = (value) => {
        const text = String(value || "").replace(/\s+/g, " ").trim();
        return text && !isBlockedText(text) ? text : undefined;
      };
      const extractId = (value) => (String(value || "").match(/CR\d{8,}/) || [])[0];
      const storeFromLabel = (label) => {
        const lower = String(label || "").toLowerCase();
        if (lower.includes("google play") || lower.includes("play.google") || lower.includes("market://")) return "GOOGLE_PLAY";
        if (lower.includes("app store") || lower.includes("apps.apple") || lower.includes("itunes.apple")) return "APP_STORE";
        return "UNKNOWN";
      };
      const extractStoreUrl = (source) => {
        const decoded = decode(source);
        const direct = decoded.match(/https?:\/\/(?:play\.google\.com\/store\/apps\/details\?id=[^"'<>\s\\]+|apps\.apple\.com\/[^"'<>\s\\]+|itunes\.apple\.com\/[^"'<>\s\\]+)/i)?.[0];
        if (direct) return direct;
        const market = decoded.match(/market:\/\/details\?id=([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+)/i)?.[0];
        if (market) return "https://play.google.com/store/apps/details?id=" + market.match(/id=([^&]+)/)?.[1];
        return undefined;
      };
      const appIdFromStoreUrl = (storeUrl) => {
        if (!storeUrl) return undefined;
        try {
          const url = new URL(storeUrl);
          if (url.hostname.includes("play.google.com")) return url.searchParams.get("id") || undefined;
          return (url.pathname.match(/\/id(\d{5,})/) || [])[1];
        } catch {
          return (String(storeUrl).match(/[?&]id=([a-zA-Z][a-zA-Z0-9_.]+)/) || [])[1] || (String(storeUrl).match(/id(\d{5,})/) || [])[1];
        }
      };
      const validStoreAppId = (appId, store) => {
        const value = String(appId || "").trim();
        if (!value) return undefined;
        const lower = value.toLowerCase();
        if (/^(window|document|globalthis|google|wiz|json|object|this|self)\./i.test(value)
          || lower.includes("global_data")
          || lower.includes("wiz_global")
          || lower.includes("googleusercontent")
          || lower.includes("googlesyndication")
          || lower.includes("doubleclick")
          || lower.includes("googleadservices")
          || lower.includes("adstransparency")
          || /(^|\.)(prototype|parentnode|performance|constructor|queryselector|addeventlistener|getattribute|setattribute|appendchild|createelement|classname|innerhtml|textcontent|classlist|dataset|style|length)$/i.test(value)) return undefined;
        if (store === "APP_STORE") return /^\d{5,}$/.test(value) ? value : undefined;
        if (store === "GOOGLE_PLAY") return /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_-]*)+$/i.test(value) ? value : undefined;
        if (/^\d{5,}$/.test(value) || /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_-]*)+$/i.test(value)) return value;
        return undefined;
      };
      const appIdFromSource = (source, store) => {
        const decoded = decode(source);
        if (store === "APP_STORE" || store === "UNKNOWN") {
          const apple = decoded.match(/(?:App Store|itunes|apps\.apple|adamId|App Store TDI)[^\d]{0,80}(\d{6,})/i)
            || decoded.match(/\bid(\d{6,})\b/i);
          const value = validStoreAppId(apple?.[1], "APP_STORE");
          if (value) return value;
        }
        if (store === "GOOGLE_PLAY" || store === "UNKNOWN") {
          const play = decoded.match(/(?:Google Play|play\.google|market:\/\/details|package_name|docid|appId)[^a-zA-Z0-9_]{0,80}([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+)/i)
            || decoded.match(/\b([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+){2,})\b/i);
          const value = validStoreAppId(play?.[1], "GOOGLE_PLAY");
          if (value) return value;
        }
        return undefined;
      };
      const stableSelector = [
        "creative-preview",
        "creative",
        ".creative-preview",
        ".creative-container",
        "div.creative-bounding-box",
        "div.xpd",
        "c-wiz[data-p]",
        "div[data-hveid]",
        "[data-ad-uuid]",
        "material-card",
        ".creative.creative-si"
      ].join(",");
      const stableParent = (element) => {
        const previewRoot = element.closest("creative-preview");
        if (previewRoot) return previewRoot;
        let current = element;
        let range = 0;
        while (current && current !== document.body && range < 15) {
          if (current.tagName === "BODY" || current.tagName === "HTML" || current.id === "main-content") break;
          if (current.matches(stableSelector)) return current;
          current = current.parentElement;
          range += 1;
        }
        return element.closest("creative-preview")
          || element.closest("c-wiz[data-p]")
          || element.closest(".creative.creative-si")
          || element.closest("creative")
          || element.closest("material-card")
          || element;
      };
      const textBySelector = (root, selectors) => {
        for (const selector of selectors) {
          const value = normalizeText(root.querySelector(selector)?.textContent);
          if (value) return value;
        }
        return undefined;
      };
      const fallbackAppName = (root, store) => {
        const lines = String(root.innerText || root.textContent || "")
          .split(/\n+/)
          .map((line) => normalizeText(line))
          .filter(Boolean);
        const blocked = /^(videocam|ad|nan|price|get|install|installer|installieren|installa|instalar|descargar|pasang|установить|karen manukyan)$/i;
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          if (!line || blocked.test(line) || isBlockedText(line) || /CR\d{8,}/.test(line) || /^https?:\/\//i.test(line)) continue;
          if (store !== "UNKNOWN" && /^(google play|app store)$/i.test(line)) {
            const prev = lines[i - 1];
            if (prev && !blocked.test(prev) && !isBlockedText(prev)) return prev;
            continue;
          }
          if (line.length >= 2 && line.length <= 120 && !/^(google play|app store)$/i.test(line)) return line;
        }
        return undefined;
      };
      const pushAsset = (assets, kind, rawUrl) => {
        const url = absoluteUrl(rawUrl);
        if (url) assets.push({ kind, url });
      };
      const extractAssets = (root, source) => {
        const assets = [];
        root.querySelectorAll("img[src]").forEach((item) => pushAsset(assets, "LANDSCAPE_IMAGE", item.getAttribute("src")));
        root.querySelectorAll("video[src], source[src]").forEach((item) => pushAsset(assets, "VIDEO", item.getAttribute("src")));
        root.querySelectorAll("[style*='url(']").forEach((item) => {
          const match = item.getAttribute("style")?.match(/url\s*\(\s*["']?(https?:[^"')]+|\/\/[^"')]+)["']?\s*\)/i);
          pushAsset(assets, /ytimg\.com\/vi\//i.test(match?.[1] || "") ? "VIDEO" : "LANDSCAPE_IMAGE", match?.[1]);
        });
        for (const match of decode(source).matchAll(/https?:\/\/[^"'<>\s\\]+(?:googleusercontent\.com|ytimg\.com|ggpht\.com|googlevideo\.com)[^"'<>\s\\]*/gi)) {
          pushAsset(assets, /googlevideo|youtube|ytimg/i.test(match[0]) ? "VIDEO" : "LANDSCAPE_IMAGE", match[0]);
        }
        const storeUrl = extractStoreUrl(source);
        pushAsset(assets, "LANDING_URL", storeUrl);
        const seen = new Set();
        return assets.filter((asset) => {
          const key = asset.kind + ":" + asset.url;
          if (!asset.url || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };
      const hasCollectedMeta = (root) => {
        const text = String(root.textContent || "").trim();
        const html = root.outerHTML || "";
        const loadedMedia = root.querySelector("iframe[src], img[src], video, source[src], [style*='url(']");
        const appMeta = root.querySelector("[data-asoch-targets*='ochAppName'], [data-asoch-targets*='ochBody'], [data-asoch-targets*='ochDescription'], .short-app-name, .headline, .description");
        const appText = /Google Play|App Store|Install|\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c|\u0418\u043d\u0441\u0442\u0430\u043b\u0438\u0440\u0430\u0439|Y\u00dcKLE|GET/i.test(text);
        const sourceMeta = /data-asoch-meta|google_template_data|app-store-container|play\.google\.com|apps\.apple\.com|itunes\.apple\.com/i.test(html);
        return Boolean((loadedMedia || appMeta || sourceMeta) && (text.length > 8 || appText || loadedMedia));
      };

      const roots = [...document.querySelectorAll(stableSelector + ", a[href*='/creative/'], iframe[src]")];
      const seenRoots = new Set();
      const output = new Map();
      const visible = [];
      for (const candidate of roots) {
        if (!candidate.isConnected) continue;
        const root = stableParent(candidate);
        if (!root || !root.isConnected || seenRoots.has(root)) continue;
        seenRoots.add(root);
        if (root.dataset && root.dataset.economyCleared === "true") continue;
        const element = root;
        const ids = [...new Set([
          ...[...root.querySelectorAll("a[href*='/creative/']")].map((link) => extractId(link.href)),
          extractId((element.innerText || "") + " " + (element.outerHTML || ""))
        ].filter(Boolean))];
        const creativeId = ids[0];
        if (!creativeId || ids.length > 1) continue;
        if (candidateIds.size > 0 && !candidateIds.has(creativeId)) continue;
        const rect = element.getBoundingClientRect();
        const nearViewport = rect.bottom > -120 && rect.top < window.innerHeight * 2.4;
        const ready = hasCollectedMeta(root);
        if (rect.bottom > 0 && rect.top < window.innerHeight) {
          visible.push({ id: creativeId, ready, top: Math.round(rect.top), bottom: Math.round(rect.bottom) });
        }
        if (!nearViewport || !ready) continue;

        const html = element.outerHTML || "";
        const bodyText = element.innerText || element.textContent || "";
        const source = bodyText + " " + html;
        const creativeUrl = absoluteUrl(root.querySelector("a[href*='/creative/']")?.getAttribute("href")) || absoluteUrl(root.href);
        const storeUrl = extractStoreUrl(source)
          || absoluteUrl(root.querySelector("a[href*='play.google.com'], a[href*='apps.apple.com'], a[href*='itunes.apple.com'], a[href^='market://']")?.getAttribute("href"));
        const store = storeFromLabel((storeUrl || "") + " " + bodyText + " " + html);
        const appId = validStoreAppId(appIdFromStoreUrl(storeUrl) || appIdFromSource(source, store), store);
        const appName = textBySelector(root, [
          "[data-asoch-targets*='ochAppName']",
          "[data-asoch-targets*='ochEndCardAppName']",
          ".short-app-name a",
          ".end-frame-app-name span",
          ".end-frame-app-name-v0 span",
          ".app-name",
          ".headline [dir='auto']"
        ]) || fallbackAppName(root, store);
        const description = textBySelector(root, [
          ".headline [dir='auto']",
          ".headline",
          "[data-asoch-targets*='ochBody']",
          "[data-asoch-targets*='ochDescription']",
          ".description",
          ".app-description"
        ]);
        const assets = extractAssets(root, source);
        const previewUrl = absoluteUrl(root.querySelector("iframe[src]")?.getAttribute("src")) || creativeUrl;
        const hasVideo = assets.some((asset) => asset.kind === "VIDEO")
          || Boolean(root.querySelector("video, iframe[src*='youtube'], iframe[src*='video'], [aria-label*='video' i]"))
          || /videocam/i.test(bodyText);
        output.set(creativeId, {
          advertiserId,
          creativeId,
          previewUrl,
          format: hasVideo ? "VIDEO" : assets.some((asset) => asset.kind !== "LANDING_URL") ? "IMAGE" : "UNKNOWN",
          raw: {
            browserNativeDom: true,
            source: "visible_ready_card",
            creativeUrl,
            appId,
            appName,
            store,
            storeUrl,
            title: appName,
            description,
            assets
          }
        });
      }
      return { items: [...output.values()], visible };
    `) as unknown as (input: { advertiserId?: string; candidateIds: string[] }) => {
      items: BrowserNativeDomCreative[];
      visible: Array<Record<string, unknown>>;
    };

    const result = await withTimeout(page.evaluate(extractReadyCards, {
      advertiserId: this.advertiserId,
      candidateIds
    }), readPositiveIntegerEnv("GOOGLE_BROWSER_VISIBLE_CAPTURE_TIMEOUT_MS", 2_500), {
      items: [] as BrowserNativeDomCreative[],
      visible: [{ error: "visible-capture-timeout" }]
    }).catch((error) => ({
      items: [] as BrowserNativeDomCreative[],
      visible: [{ error: error instanceof Error ? error.message : String(error) }]
    }));

    for (const item of result.items) {
      this.mergeDomCreative(item, [], false);
    }
    if (process.env.GOOGLE_BROWSER_ECONOMY_DEBUG === "true" && (result.items.length > 0 || result.visible.some((item) => (item as { error?: string }).error))) {
      console.log("[economy-visible-capture]", JSON.stringify({
        items: result.items.length,
        first: result.items.slice(0, 8).map((item) => ({
          creativeId: item.creativeId,
          appName: item.raw.appName,
          store: item.raw.store,
          format: item.format,
          score: domCreativeContentScore(item)
        })),
        visible: result.visible.slice(0, 8)
      }));
    }
    return result.items;
  }

  private async focusCreativeForCollection(creativeId: string) {
    if (!creativeId || process.env.GOOGLE_BROWSER_FOCUS_BEFORE_COLLECT !== "true") return;
    const page = await this.ensurePage();
    const waitMs = readNonNegativeIntegerEnv("GOOGLE_BROWSER_VISIBLE_COLLECT_WAIT_MS", 1_200);
    const readState = async () => page.evaluate((creativeId) => {
      const extractId = (value: string) => (String(value || "").match(/CR\d{8,}/) || [])[0];
      const hasCollectedMeta = (root: Element) => {
        const text = (root.textContent || "").trim();
        const html = (root as HTMLElement).outerHTML || "";
        const loadedMedia = root.querySelector("iframe[src], img[src], video, source[src], [style*='url(']");
        const appMeta = root.querySelector("[data-asoch-targets*='ochAppName'], [data-asoch-targets*='ochBody'], [data-asoch-targets*='ochDescription'], .short-app-name, .headline, .description");
        const appText = /Google Play|App Store|Install|Установить|Инсталирай|YÜKLE|GET/i.test(text);
        const sourceMeta = /data-asoch-meta|google_template_data|app-store-container|play\.google\.com|apps\.apple\.com|itunes\.apple\.com/i.test(html);
        return Boolean((loadedMedia || appMeta || sourceMeta) && (text.length > 8 || appText || loadedMedia));
      };
      const stableSelector = [
        "creative-preview",
        "creative",
        ".creative-preview",
        ".creative-container",
        "div.creative-bounding-box",
        "div.xpd",
        "c-wiz[data-p]",
        "div[data-hveid]",
        "[data-ad-uuid]",
        "material-card",
        ".creative.creative-si"
      ].join(",");
      const stableParent = (element: Element) => {
        const previewRoot = element.closest("creative-preview");
        if (previewRoot) return previewRoot;
        let current: Element | null = element;
        let range = 0;
        while (current && current !== document.body && range < 15) {
          if (current.tagName === "BODY" || current.tagName === "HTML" || (current as HTMLElement).id === "main-content") break;
          if (current.matches(stableSelector)) return current;
          current = current.parentElement;
          range += 1;
        }
        return element.closest("creative-preview")
          ?? element.closest("c-wiz[data-p]")
          ?? element.closest(".creative.creative-si")
          ?? element.closest("creative")
          ?? element.closest("material-card")
          ?? element;
      };
      const roots = [...document.querySelectorAll(stableSelector + ", a[href*='/creative/'], iframe[src]")];
      const seen = new Set<Element>();
      for (const candidate of roots) {
        const root = stableParent(candidate);
        if (!root?.isConnected || seen.has(root)) continue;
        seen.add(root);
        const element = root as HTMLElement;
        if (element.dataset.economyCleared === "true") continue;
        const ids = [...new Set([
          ...[...root.querySelectorAll("a[href*='/creative/']")].map((link) => extractId((link as HTMLAnchorElement).href)),
          extractId((element.innerText || "") + " " + (element.outerHTML || ""))
        ].filter(Boolean))];
        if (!ids.includes(creativeId)) continue;
        const rect = element.getBoundingClientRect();
        return {
          found: true,
          ready: hasCollectedMeta(root),
          visible: rect.bottom > 0 && rect.top < window.innerHeight,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          y: Math.round(window.scrollY),
          visibleCards: [...document.querySelectorAll("creative-preview")]
            .filter((card) => {
              const cardRect = card.getBoundingClientRect();
              return cardRect.bottom > 0 && cardRect.top < window.innerHeight;
            })
            .length
        };
      }
      return {
        found: false,
        ready: false,
        visible: false,
        top: 0,
        bottom: 0,
        y: Math.round(window.scrollY),
        visibleCards: [...document.querySelectorAll("creative-preview")]
          .filter((card) => {
            const cardRect = card.getBoundingClientRect();
            return cardRect.bottom > 0 && cardRect.top < window.innerHeight;
          })
          .length
      };
    }, creativeId).catch((error) => ({
      found: false,
      ready: false,
      visible: false,
      top: 0,
      bottom: 0,
      y: 0,
      visibleCards: 0,
      error: error instanceof Error ? error.message : String(error)
    }));

    let before = await readState();
    if (before.found && !before.visible) {
      await page.evaluate((creativeId) => {
        const extractId = (value: string) => (String(value || "").match(/CR\d{8,}/) || [])[0];
        const candidates = [...document.querySelectorAll("creative-preview, creative, c-wiz[data-p], div[data-hveid], material-card, a[href*='/creative/']")];
        const target = candidates.find((candidate) => {
          const element = candidate as HTMLElement;
          return `${element.innerText || ""} ${element.outerHTML || ""}`.includes(creativeId)
            || [...candidate.querySelectorAll("a[href*='/creative/']")].some((link) => extractId((link as HTMLAnchorElement).href) === creativeId);
        });
        const root = target?.closest("creative-preview") ?? target;
        if (!root) return;
        (root as HTMLElement).scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        window.dispatchEvent(new Event("scroll"));
      }, creativeId).catch(() => undefined);
      await humanPause(page, 180, 80);
      await this.captureDomBatch({ queueAsPage: false });
      before = await readState();
    }

    const startedAt = Date.now();
    let after = before;
    while (after.found && !after.ready && Date.now() - startedAt < waitMs) {
      await humanPause(page, 120, 60);
      await this.captureDomBatch({ queueAsPage: false });
      after = await readState();
      if (after.ready) break;
    }

    if (process.env.GOOGLE_BROWSER_ECONOMY_DEBUG === "true") {
      console.log("[economy-focus]", JSON.stringify({
        creativeId,
        found: after.found,
        visibleBefore: before.visible,
        readyBefore: before.ready,
        visibleAfter: after.visible,
        readyAfter: after.ready,
        top: after.top,
        visibleCards: after.visibleCards,
        error: (after as { error?: string }).error
      }));
    }
  }

  private async readVisibleCollectionState(candidateIds: string[], seenIds: string[]) {
    await this.captureVisibleReadyCards(candidateIds);
    const page = await this.ensurePage();
    const processedIds = [...new Set([...seenIds, ...this.processedDomCreativeIds])];
    const readStatePage = Function("input", String.raw`
      const candidateIds = input.candidateIds || [];
      const processedIds = input.processedIds || [];
      const candidateSet = new Set(candidateIds);
      const processedSet = new Set(processedIds);
      const extractId = (value) => (String(value || "").match(/CR\d{8,}/) || [])[0];
      const hasCollectedMeta = (root) => {
        const text = (root.textContent || "").trim();
        const html = root.outerHTML || "";
        const loadedMedia = root.querySelector("iframe[src], img[src], video, source[src], [style*='url(']");
        const appMeta = root.querySelector("[data-asoch-targets*='ochAppName'], [data-asoch-targets*='ochBody'], [data-asoch-targets*='ochDescription'], .short-app-name, .headline, .description");
        const appText = /Google Play|App Store|Install|\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c|\u0418\u043d\u0441\u0442\u0430\u043b\u0438\u0440\u0430\u0439|Y\u00dcKLE|GET/i.test(text);
        const sourceMeta = /data-asoch-meta|google_template_data|app-store-container|play\.google\.com|apps\.apple\.com|itunes\.apple\.com/i.test(html);
        return Boolean((loadedMedia || appMeta || sourceMeta) && (text.length > 8 || appText || loadedMedia));
      };
      const stableSelector = [
        "creative-preview",
        "creative",
        ".creative-preview",
        ".creative-container",
        "div.creative-bounding-box",
        "div.xpd",
        "c-wiz[data-p]",
        "div[data-hveid]",
        "[data-ad-uuid]",
        "material-card",
        ".creative.creative-si"
      ].join(",");
      const stableParent = (element) => {
        const previewRoot = element.closest("creative-preview");
        if (previewRoot) return previewRoot;
        let current = element;
        let range = 0;
        while (current && current !== document.body && range < 15) {
          if (current.tagName === "BODY" || current.tagName === "HTML" || current.id === "main-content") break;
          if (current.matches(stableSelector)) return current;
          current = current.parentElement;
          range += 1;
        }
        return element.closest("creative-preview")
          ?? element.closest("c-wiz[data-p]")
          ?? element.closest(".creative.creative-si")
          ?? element.closest("creative")
          ?? element.closest("material-card")
          ?? element;
      };
      const roots = [...document.querySelectorAll(stableSelector + ", a[href*='/creative/'], iframe[src]")];
      const ranks = {};
      const visible = [];
      const seenRoots = new Set();
      for (const candidate of roots) {
        const root = stableParent(candidate);
        if (!root?.isConnected || seenRoots.has(root)) continue;
        seenRoots.add(root);
        const element = root;
        if (!element.isConnected || element.dataset.economyCleared === "true") continue;
        const ids = [...new Set([
          ...[...root.querySelectorAll("a[href*='/creative/']")].map((link) => extractId(link.href)),
          extractId((element.innerText || "") + " " + (element.outerHTML || ""))
        ].filter(Boolean))];
        const id = ids[0];
        if (!id || ids.length > 1) continue;
        if (candidateSet.size > 0 && !candidateSet.has(id)) continue;
        const rect = element.getBoundingClientRect();
        const visibleNow = rect.bottom > 0 && rect.top < window.innerHeight;
        const collectWindow = rect.bottom > -120 && rect.top < window.innerHeight * 2.4;
        const ready = hasCollectedMeta(root);
        const processed = processedSet.has(id);
        if (visibleNow) {
          visible.push({
            id,
            ready,
            processed,
            cleared: element.dataset.economyCleared === "true",
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom)
          });
        }
        if (processed) continue;
        if (!collectWindow) continue;
        const priority = visibleNow && ready ? 0 : visibleNow ? 1 : ready ? 2 : 3;
        const current = ranks[id];
        if (!current || priority < current.priority || (priority === current.priority && rect.top < current.top)) {
          ranks[id] = {
            priority,
            top: Math.round(rect.top),
            ready,
            visible: visibleNow
          };
        }
      }
      return {
        ranks,
        visible,
        visibleReadyUnprocessed: visible.filter((item) => item.ready && !item.processed && !item.cleared).length,
        visibleUnprocessed: visible.filter((item) => !item.processed && !item.cleared).length,
        visibleProcessed: visible.filter((item) => item.processed || item.cleared).length
      };
    `) as unknown as (input: { candidateIds: string[]; processedIds: string[] }) => VisibleCollectionState;
    return page.evaluate(readStatePage, { candidateIds, processedIds }).catch((error) => ({
      ranks: {} as Record<string, { priority: number; top: number; ready: boolean; visible: boolean }>,
      visible: [] as Array<{ id: string; ready: boolean; processed: boolean; cleared: boolean; top: number; bottom: number }>,
      visibleReadyUnprocessed: 0,
      visibleUnprocessed: 0,
      visibleProcessed: 0,
      error: error instanceof Error ? error.message : String(error)
    }));
    return page.evaluate(({ candidateIds, processedIds }) => {
      const candidateSet = new Set(candidateIds);
      const processedSet = new Set(processedIds);
      const extractId = (value: string) => (String(value || "").match(/CR\d{8,}/) || [])[0];
      const hasCollectedMeta = (root: Element) => {
        const text = (root.textContent || "").trim();
        const html = (root as HTMLElement).outerHTML || "";
        const loadedMedia = root.querySelector("iframe[src], img[src], video, source[src], [style*='url(']");
        const appMeta = root.querySelector("[data-asoch-targets*='ochAppName'], [data-asoch-targets*='ochBody'], [data-asoch-targets*='ochDescription'], .short-app-name, .headline, .description");
        const appText = /Google Play|App Store|Install|Установить|Инсталирай|YÜKLE|GET/i.test(text);
        const sourceMeta = /data-asoch-meta|google_template_data|app-store-container|play\.google\.com|apps\.apple\.com|itunes\.apple\.com/i.test(html);
        return Boolean((loadedMedia || appMeta || sourceMeta) && (text.length > 8 || appText || loadedMedia));
      };
      const stableSelector = [
        "creative-preview",
        "creative",
        ".creative-preview",
        ".creative-container",
        "div.creative-bounding-box",
        "div.xpd",
        "c-wiz[data-p]",
        "div[data-hveid]",
        "[data-ad-uuid]",
        "material-card",
        ".creative.creative-si"
      ].join(",");
      const stableParent = (element: Element) => {
        const previewRoot = element.closest("creative-preview");
        if (previewRoot) return previewRoot;
        let current: Element | null = element;
        let range = 0;
        while (current && current !== document.body && range < 15) {
          if (current.tagName === "BODY" || current.tagName === "HTML" || (current as HTMLElement).id === "main-content") break;
          if (current.matches(stableSelector)) return current;
          current = current.parentElement;
          range += 1;
        }
        return element.closest("creative-preview")
          ?? element.closest("c-wiz[data-p]")
          ?? element.closest(".creative.creative-si")
          ?? element.closest("creative")
          ?? element.closest("material-card")
          ?? element;
      };
      const roots = [...document.querySelectorAll(`${stableSelector}, a[href*='/creative/'], iframe[src]`)];
      const ranks: Record<string, { priority: number; top: number; ready: boolean; visible: boolean }> = {};
      const visible: Array<{ id: string; ready: boolean; processed: boolean; cleared: boolean; top: number; bottom: number }> = [];
      const seenRoots = new Set<Element>();
      for (const candidate of roots) {
        const root = stableParent(candidate);
        if (!root?.isConnected || seenRoots.has(root)) continue;
        seenRoots.add(root);
        const element = root as HTMLElement;
        if (!element.isConnected || element.dataset.economyCleared === "true") continue;
        const ids = [...new Set([
          ...[...root.querySelectorAll("a[href*='/creative/']")].map((link) => extractId((link as HTMLAnchorElement).href)),
          extractId(`${element.innerText || ""} ${element.outerHTML || ""}`)
        ].filter(Boolean))];
        const id = ids[0];
        if (!id || ids.length > 1) continue;
        if (candidateSet.size > 0 && !candidateSet.has(id)) continue;
        const rect = element.getBoundingClientRect();
        const visibleNow = rect.bottom > 0 && rect.top < window.innerHeight;
        const ready = hasCollectedMeta(root);
        const processed = processedSet.has(id);
        if (visibleNow) {
          visible.push({
            id,
            ready,
            processed,
            cleared: element.dataset.economyCleared === "true",
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom)
          });
        }
        if (processed) continue;
        const priority = visibleNow && ready ? 0 : visibleNow ? 1 : ready ? 2 : 3;
        const current = ranks[id];
        if (!current || priority < current.priority || (priority === current.priority && rect.top < current.top)) {
          ranks[id] = {
            priority,
            top: Math.round(rect.top),
            ready,
            visible: visibleNow
          };
        }
      }
      return {
        ranks,
        visible,
        visibleReadyUnprocessed: visible.filter((item) => item.ready && !item.processed && !item.cleared).length,
        visibleUnprocessed: visible.filter((item) => !item.processed && !item.cleared).length,
        visibleProcessed: visible.filter((item) => item.processed || item.cleared).length
      };
    }, { candidateIds, processedIds }).catch((error) => ({
      ranks: {} as Record<string, { priority: number; top: number; ready: boolean; visible: boolean }>,
      visible: [] as Array<{ id: string; ready: boolean; processed: boolean; cleared: boolean; top: number; bottom: number }>,
      visibleReadyUnprocessed: 0,
      visibleUnprocessed: 0,
      visibleProcessed: 0,
      error: error instanceof Error ? error.message : String(error)
    }));
  }

  private async captureDomBatch(options: { queueAsPage?: boolean } = {}) {
    const queueAsPage = options.queueAsPage !== false;
    const page = await this.ensurePage();
    const queuedItems: BrowserNativeDomCreative[] = [];
    const frameTimeoutMs = readPositiveIntegerEnv("GOOGLE_BROWSER_FRAME_CAPTURE_TIMEOUT_MS", 2_500);
    const frames = selectFramesForDomCapture(
      page.frames(),
      page.mainFrame(),
      readPositiveIntegerEnv("GOOGLE_BROWSER_FRAME_SCAN_LIMIT", 24)
    );
    const frameResults = await Promise.all(frames.map(async (frame) => {
      const frameItems = await withTimeout(
        frame.evaluate(extractDomCreatives, this.advertiserId),
        frameTimeoutMs,
        [] as BrowserNativeDomCreative[]
      );
      if (frame === page.mainFrame()) return { frameItems, framePayloads: [] as BrowserNativeFramePayload[], frameOwner: undefined as BrowserNativeFrameOwner | undefined };
      const { payloads: framePayloads, owner: frameOwner } = await this.captureFramePreviewPayloads(frame);
      return { frameItems, framePayloads, frameOwner };
    }));

    for (const result of frameResults) {
      for (const item of result.frameItems) {
        this.mergeDomCreative(item, queuedItems, queueAsPage);
      }
      for (const payload of result.framePayloads) {
        const frameOwner = result.frameOwner;
        const creativeId = extractCreativeIdFromText(`${frameOwner?.creativeId ?? ""} ${frameOwner?.creativeUrl ?? ""} ${payload.creativeUrl ?? ""}`);
        if (!creativeId) continue;
        this.mergeDomCreative({
          advertiserId: this.advertiserId ?? "",
          creativeId,
          previewUrl: frameOwner?.previewUrl,
          format: payload.assets?.some((asset) => asset.kind === "VIDEO") ? "VIDEO" : payload.assets?.some((asset) => asset.kind !== "LANDING_URL") ? "IMAGE" : "UNKNOWN",
          raw: {
            browserNativeDom: true,
            ...payload,
            source: payload.source || "iframe_payload",
            creativeUrl: frameOwner?.creativeUrl ?? payload.creativeUrl
          }
        }, queuedItems, queueAsPage);
      }
    }
    if (!queueAsPage) return;
    for (const item of this.domCreatives.values()) {
      if (this.queuedDomCreativeIds.has(item.creativeId)) continue;
      this.queuedDomCreativeIds.add(item.creativeId);
      queuedItems.push(item);
    }
    if (!queuedItems.length) return;
    this.pages.push({
      creatives: queuedItems,
      nextPageToken: "browser-native-dom-scroll",
      raw: { browserNativeDomBatch: true, count: queuedItems.length }
    });
  }

  private async captureFramePreviewPayloads(frame: Frame) {
    const page = await this.ensurePage();
    const maxRetries = readNonNegativeIntegerEnv("GOOGLE_BROWSER_IFRAME_RETRY_COUNT", 1);
    const frameTimeoutMs = readPositiveIntegerEnv("GOOGLE_BROWSER_FRAME_CAPTURE_TIMEOUT_MS", 2_500);
    let bestPayloads: BrowserNativeFramePayload[] = [];
    let bestOwner: BrowserNativeFrameOwner | undefined;

    for (let retry = 0; retry <= maxRetries; retry += 1) {
      const [payloads, owner] = await Promise.all([
        Promise.all([
          withTimeout(frame.evaluate(extractFramePreviewPayloads), frameTimeoutMs, [] as BrowserNativeFramePayload[]),
          withTimeout(frame.evaluate(extractFrameTemplateDataSources), frameTimeoutMs, [] as unknown[])
        ]).then(([domPayloads, dataSources]) => [
          ...domPayloads,
          ...dataSources.map((source) => parseBrowserNativeAdDataTemplate(source)).filter((payload): payload is BrowserNativeFramePayload => Boolean(payload))
        ]),
        withTimeout(
          frame.frameElement().then((element) => element.evaluate(extractFrameOwner)),
          frameTimeoutMs,
          undefined as BrowserNativeFrameOwner | undefined
        )
      ]);
      if (payloads.length) bestPayloads = payloads;
      if (owner?.creativeId || owner?.creativeUrl) bestOwner = owner;
      if (bestPayloads.length && (bestOwner?.creativeId || bestOwner?.creativeUrl)) break;
      if (retry >= maxRetries) break;
      await page.waitForTimeout(500 * (retry + 1));
    }

    return { payloads: bestPayloads, owner: bestOwner };
  }

  private mergeDomCreative(item: BrowserNativeDomCreative, queuedItems: BrowserNativeDomCreative[], queueAsPage: boolean) {
    if (!item.creativeId) return;
    const existing = this.domCreatives.get(item.creativeId);
    if (existing) {
      this.domCreatives.set(item.creativeId, richerDomCreative(existing, item));
      return;
    }
    this.seenDomCreativeIds.add(item.creativeId);
    this.domCreatives.set(item.creativeId, item);
    if (queueAsPage && !this.queuedDomCreativeIds.has(item.creativeId)) {
      this.queuedDomCreativeIds.add(item.creativeId);
      queuedItems.push(item);
    }
  }

  private buildDomFallbackPage(): SearchPage | undefined {
    const queuedItems = [...this.domCreatives.values()].filter((item) => !this.queuedDomCreativeIds.has(item.creativeId) && isDomCreativeReadyForPreview(item));
    if (!queuedItems.length) return undefined;
    for (const item of queuedItems) this.queuedDomCreativeIds.add(item.creativeId);
    return {
      creatives: queuedItems,
      nextPageToken: "browser-native-dom-scroll",
      raw: { browserNativeDomFallback: true, count: queuedItems.length },
      consumed: true
    };
  }

  private async waitForPagePreviewCapture(pageBatch: SearchPage) {
    const page = await this.ensurePage();
    const expected = pageBatch.creatives
      .filter((item) => item.creativeId && !isBrowserNativeDomCreative(item))
      .map((item) => item.creativeId);

    if (!expected.length) {
      await this.captureDomBatch({ queueAsPage: false });
      await this.pruneSeenCards();
      return { found: 0, total: 0, missing: [] as string[] };
    }

    const { maxChecks, staleChecks } = resolvePreviewWaitConfig();
    let bestFound = 0;
    let staleCount = 0;
    for (let check = 0; check < maxChecks; check += 1) {
      await this.captureDomBatch({ queueAsPage: false });
      await this.pruneSeenCards();
      const missing = expected.filter((creativeId) => {
        const dom = this.domCreatives.get(creativeId);
        return !dom || !isDomCreativeReadyForPreview(dom);
      });
      const found = expected.length - missing.length;
      if (!missing.length) return { found: expected.length, total: expected.length, missing };
      if (found > bestFound) {
        bestFound = found;
        staleCount = 0;
      } else {
        staleCount += 1;
      }
      if (check === 0 || check % 10 === 0) {
        await this.options.onProgress?.(`preview ${found}/${expected.length}, попытка ${check + 1}`);
      }
      if (staleCount >= staleChecks) break;
      if (missing.length === expected.length) {
        await keepNewestCardsInViewport(page, check);
      } else {
        await revealMissingPreviewCards(page, missing, check);
      }
      await humanPause(page, 520, 420);
    }

    const missing = expected.filter((creativeId) => {
      const dom = this.domCreatives.get(creativeId);
      return !dom || !isDomCreativeReadyForPreview(dom);
    });
    return {
      found: expected.length - missing.length,
      total: expected.length,
      missing: missing.slice(0, 20)
    };
  }

  private async markCreativeCollected(creativeId: string, options: { prune?: boolean } = {}) {
    const shouldPrune = options.prune !== false;
    const maxClearBatch = resolveEconomyClearBatch();
    if (creativeId) {
      this.processedDomCreativeIds.add(creativeId);
      this.pendingPruneCreativeIds.add(creativeId);
      this.activeCollectionCreativeIds.delete(creativeId);
    }
    if (process.env.GOOGLE_BROWSER_ECONOMY_DEBUG === "true") {
      console.log("[economy-collect]", JSON.stringify({
        creativeId,
        processed: this.processedDomCreativeIds.size,
        pendingPrune: this.pendingPruneCreativeIds.size,
        clearBatch: maxClearBatch,
        prune: shouldPrune
      }));
    }
    if (!shouldPrune) return;
    const cleared = await this.pruneSeenCards({ force: true });
    await this.scrollAfterEconomyPrune(cleared);
  }

  private async pruneSeenCards(options: { force?: boolean } = {}) {
    if (process.env.GOOGLE_BROWSER_ECONOMY !== "delete") return 0;
    const now = Date.now();
    if (!options.force && now - this.lastPruneAt < 150) return 0;
    this.lastPruneAt = now;
    const page = await this.ensurePage();
    const processedIds = [...this.processedDomCreativeIds];
    const maxClearBatch = resolveEconomyClearBatch();
    const prunePage = Function("input", String.raw`
      const processedIds = input.processedIds || [];
      const debug = Boolean(input.debug);
      const maxClearBatch = Math.max(1, Math.min(50, Number(input.maxClearBatch) || 1));
      const processed = new Set(processedIds);
      const extractId = (value) => (String(value || "").match(/CR\d{8,}/) || [])[0];
      const hasCollectedMeta = (root) => {
        const text = (root.textContent || "").trim();
        const html = root.outerHTML || "";
        const loadedMedia = root.querySelector("iframe[src], img[src], video, source[src], [style*='url(']");
        const appMeta = root.querySelector("[data-asoch-targets*='ochAppName'], [data-asoch-targets*='ochBody'], [data-asoch-targets*='ochDescription'], .short-app-name, .headline, .description");
        const appText = /Google Play|App Store|Install|\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c|\u0418\u043d\u0441\u0442\u0430\u043b\u0438\u0440\u0430\u0439|Y\u00dcKLE|GET/i.test(text);
        const sourceMeta = /data-asoch-meta|google_template_data|app-store-container|play\.google\.com|apps\.apple\.com|itunes\.apple\.com/i.test(html);
        return Boolean((loadedMedia || appMeta || sourceMeta) && (text.length > 8 || appText || loadedMedia));
      };
      const stableSelector = [
        "creative-preview",
        "creative",
        ".creative-preview",
        ".creative-container",
        "div.creative-bounding-box",
        "div.xpd",
        "c-wiz[data-p]",
        "div[data-hveid]",
        "[data-ad-uuid]",
        ".gws-plugins-ads-cards-jslayout__highlight-overlay",
        "material-card",
        ".creative.creative-si"
      ].join(",");
      const stableParent = (element) => {
        const previewRoot = element.closest("creative-preview");
        if (previewRoot) return previewRoot;
        let current = element;
        let range = 0;
        while (current && current !== document.body && range < 15) {
          if (current.tagName === "BODY" || current.tagName === "HTML" || current.id === "main-content") break;
          if (current.matches(stableSelector)) return current;
          current = current.parentElement;
          range += 1;
        }
        return element.closest("creative-preview")
          ?? element.closest("c-wiz[data-p]")
          ?? element.closest(".creative.creative-si")
          ?? element.closest("creative")
          ?? element.closest("material-card")
          ?? element;
      };
      const roots = [
        ...document.querySelectorAll(stableSelector + ", a[href*='/creative/'], iframe[src]")
      ];
      const seen = new Set();
      let clearedCount = 0;
      const clearedIds = [];
      const decisions = [];
      const pushDecision = (root, reason, ids, matched, meta, inBlockedRoot) => {
        if (!debug || decisions.length >= 12) return;
        decisions.push({
          id: ids[0],
          tag: root.tagName,
          reason,
          matched,
          hasMeta: meta,
          connected: root.isConnected,
          inBlockedRoot,
          ids,
          text: (root.innerText || root.textContent || "").trim().slice(0, 100)
        });
      };

      for (const candidate of roots) {
        if (!candidate.isConnected) continue;
        const root = stableParent(candidate);
        if (!root.isConnected) continue;
        if (seen.has(root)) continue;
        seen.add(root);

        const element = root;
        if (element.dataset.economyCleared === "true") continue;
        const inBlockedRoot = Boolean(element.closest("[role='dialog'], header, nav"));

        const creativeIds = new Set(
          [...root.querySelectorAll("a[href*='/creative/']")]
            .map((link) => extractId(link.href))
            .filter(Boolean)
        );
        const sourceId = extractId((element.innerText || "") + " " + (element.outerHTML || ""));
        if (sourceId) creativeIds.add(sourceId);
        const ids = [...creativeIds];
        const meta = hasCollectedMeta(root);
        const creativeId = ids[0];
        const matchedProcessedCreative = Boolean(creativeId && processed.has(creativeId));
        if (inBlockedRoot) {
          pushDecision(root, "skip:blocked-root", ids, matchedProcessedCreative, meta, inBlockedRoot);
          continue;
        }
        if (creativeIds.size > 1) {
          pushDecision(root, "skip:multi-id", ids, matchedProcessedCreative, meta, inBlockedRoot);
          continue;
        }

        if (!matchedProcessedCreative) {
          pushDecision(root, "skip:not-collected", ids, matchedProcessedCreative, meta, inBlockedRoot);
          continue;
        }
        if (!meta) {
          pushDecision(root, "skip:not-ready", ids, matchedProcessedCreative, meta, inBlockedRoot);
          continue;
        }
        if (!element.matches(stableSelector)
          && !element.querySelector("iframe, img, video, [data-asoch-meta], [data-p], [data-asoch-targets]")) {
          pushDecision(root, "skip:not-card", ids, matchedProcessedCreative, meta, inBlockedRoot);
          continue;
        }

        element.innerHTML = "";
        element.style.minHeight = "350px";
        element.style.backgroundColor = "transparent";
        element.dataset.economyCleared = "true";
        pushDecision(root, "cleared", ids, matchedProcessedCreative, meta, inBlockedRoot);
        clearedIds.push(...ids);
        clearedCount += 1;
        if (clearedCount >= maxClearBatch) break;
      }

      return {
        cleared: clearedCount,
        clearedIds,
        decisions,
        visible: [...document.querySelectorAll("creative-preview")]
          .filter((card) => {
            const rect = card.getBoundingClientRect();
            return rect.bottom > 0 && rect.top < window.innerHeight;
          })
          .slice(0, 10)
          .map((card) => {
            const element = card;
            const ids = [...card.querySelectorAll("a[href*='/creative/']")]
              .map((link) => extractId(link.href))
              .filter(Boolean);
            return {
              id: ids[0],
              cleared: element.dataset.economyCleared === "true",
              text: (element.innerText || element.textContent || "").trim().slice(0, 80),
              hasIframe: Boolean(card.querySelector("iframe[src]")),
              top: Math.round(card.getBoundingClientRect().top)
            };
          }),
        totals: {
          previews: document.querySelectorAll("creative-preview").length,
          clearedPreviews: document.querySelectorAll("creative-preview[data-economy-cleared='true']").length,
          links: document.querySelectorAll("creative-preview a[href*='/creative/']").length,
          y: Math.round(window.scrollY),
          h: document.documentElement.scrollHeight
        }
      };
    `) as unknown as (input: { processedIds: string[]; debug: boolean; maxClearBatch: number }) => {
      cleared: number;
      clearedIds?: string[];
      decisions: Array<Record<string, unknown>>;
      visible: Array<Record<string, unknown>>;
      totals: Record<string, number>;
    };
    const result = await withTimeout(page.evaluate(prunePage, {
      processedIds,
      debug: process.env.GOOGLE_BROWSER_ECONOMY_DEBUG === "true",
      maxClearBatch
    }), readPositiveIntegerEnv("GOOGLE_BROWSER_PRUNE_TIMEOUT_MS", 2_500), {
      cleared: 0,
      clearedIds: [] as string[],
      decisions: [{ reason: "prune-timeout", tag: "", matched: false, hasMeta: false, connected: false, inBlockedRoot: false, ids: [], text: "" }],
      visible: [] as Array<Record<string, unknown>>,
      totals: { previews: 0, clearedPreviews: 0, links: 0, y: 0, h: 0 }
    }).catch((error) => ({
      cleared: 0,
      clearedIds: [],
      decisions: [{ reason: `error:${error instanceof Error ? error.message : String(error)}`, tag: "", matched: false, hasMeta: false, connected: false, inBlockedRoot: false, ids: [], text: "" }],
      visible: [],
      totals: { previews: 0, clearedPreviews: 0, links: 0, y: 0, h: 0 }
    }));
    const cleared = result.cleared;
    for (const creativeId of result.clearedIds ?? []) {
      this.pendingPruneCreativeIds.delete(String(creativeId));
    }

    if (process.env.GOOGLE_BROWSER_ECONOMY_DEBUG === "true") {
      console.log("[economy-prune]", JSON.stringify({
        cleared,
        maxClearBatch,
        processed: processedIds.length,
        pendingPrune: this.pendingPruneCreativeIds.size,
        processedFirst: processedIds.slice(0, 8),
        decisions: result.decisions,
        visible: result.visible,
        totals: result.totals
      }));
    }
    if (cleared > 0) {
      await this.options.onProgress?.(`economy: cleared cards ${cleared}`);
    }
    return cleared;
  }
  private async logEconomyState(stage: string, extra: Record<string, unknown> = {}) {
    if (process.env.GOOGLE_BROWSER_ECONOMY_DEBUG !== "true") return;
    const page = await this.ensurePage();
    const state = await page.evaluate(() => ({
      url: location.href,
      y: Math.round(window.scrollY),
      h: document.documentElement.scrollHeight,
      previews: document.querySelectorAll("creative-preview").length,
      cleared: document.querySelectorAll("creative-preview[data-economy-cleared='true']").length,
      visible: [...document.querySelectorAll("creative-preview")]
        .filter((card) => {
          const rect = card.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < window.innerHeight;
        })
        .slice(0, 8)
        .map((card) => ({
          id: (card.querySelector("a[href*='/creative/']") as HTMLAnchorElement | null)?.href.match(/CR\d{8,}/)?.[0],
          cleared: (card as HTMLElement).dataset.economyCleared === "true",
          top: Math.round(card.getBoundingClientRect().top),
          hasIframe: Boolean(card.querySelector("iframe[src]")),
          text: ((card as HTMLElement).innerText ?? card.textContent ?? "").trim().slice(0, 80)
        }))
    })).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    console.log("[economy-state]", JSON.stringify({
      stage,
      processed: this.processedDomCreativeIds.size,
      ...extra,
      state
    }));
  }
}
