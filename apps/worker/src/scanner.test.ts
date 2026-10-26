import { describe, expect, it } from "vitest";
import {
  mergeMonotonicCounters,
  resolveBrowserNativeDelays,
  resolveBrowserNativeInlineDetailBatch,
  resolveBrowserNativeResumeFastForwardLimit,
  resolveLimits,
  shouldSkipCreativeDetail,
  shouldStopOnIncompletePreview
} from "./scanner";

describe("scanner limits", () => {
  it("keeps full scans unlimited when limits are nullish", () => {
    const limits = resolveLimits({ scanMode: "FULL", maxPagesPerRun: undefined, maxCreativesPerRun: undefined });
    expect(limits.requestDelayMs).toBe(8000);
    expect(limits.maxPagesPerRun).toBe(Number.POSITIVE_INFINITY);
    expect(limits.maxCreativesPerRun).toBe(Number.POSITIVE_INFINITY);
  });

  it("defaults missing scan mode to full scan limits", () => {
    const limits = resolveLimits({ maxPagesPerRun: undefined, maxCreativesPerRun: undefined });
    expect(limits.requestDelayMs).toBe(8000);
    expect(limits.maxPagesPerRun).toBe(Number.POSITIVE_INFINITY);
    expect(limits.maxCreativesPerRun).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps fast and cautious finite when explicit limits are passed", () => {
    expect(resolveLimits({ scanMode: "FAST", maxPagesPerRun: 1, maxCreativesPerRun: 20 }).maxCreativesPerRun).toBe(20);
    expect(resolveLimits({ scanMode: "CAUTIOUS", maxPagesPerRun: 1, maxCreativesPerRun: 10 }).maxPagesPerRun).toBe(1);
  });

  it("does not make cautious scans unlimited when stored limits are empty", () => {
    const limits = resolveLimits({ scanMode: "CAUTIOUS", maxPagesPerRun: undefined, maxCreativesPerRun: undefined });
    expect(limits.requestDelayMs).toBe(45000);
    expect(limits.maxPagesPerRun).toBe(1);
    expect(limits.maxCreativesPerRun).toBe(10);
  });

  it("does not roll scan job counters back after worker restart", () => {
    expect(
      mergeMonotonicCounters(
        { pagesFetched: 11, creativesFound: 440, detailsFetched: 440, previewsFetched: 438 },
        { pagesFetched: 6, detailsFetched: 215, previewsFetched: 214 },
        215
      )
    ).toEqual({ pagesFetched: 11, creativesFound: 440, detailsFetched: 440, previewsFetched: 438 });
  });

  it("keeps browser-native page scrolling fast", () => {
    expect(resolveBrowserNativeDelays({ requestDelayMs: 1000 })).toEqual({ pageDelayMs: 1000 });
    expect(resolveBrowserNativeDelays({ requestDelayMs: 8000 })).toEqual({ pageDelayMs: 1200 });
  });

  it("caps browser-native resume fast-forward to expected old pages plus slack", () => {
    expect(resolveBrowserNativeResumeFastForwardLimit(0)).toBe(10);
    expect(resolveBrowserNativeResumeFastForwardLimit(160)).toBe(14);
    expect(resolveBrowserNativeResumeFastForwardLimit(3460)).toBe(97);
  });

  it("continues browser scans when preview cards are missing unless strict mode is enabled", () => {
    const previous = process.env.GOOGLE_BROWSER_PREVIEW_STRICT;
    delete process.env.GOOGLE_BROWSER_PREVIEW_STRICT;
    try {
      expect(shouldStopOnIncompletePreview({ scanJobId: "job", advertiserDbId: "adv", googleAdvertiserId: "AR1", countryCodes: [], scanMode: "FULL" }, { found: 0, total: 40 })).toBe(false);
      expect(shouldStopOnIncompletePreview({ scanJobId: "job", advertiserDbId: "adv", googleAdvertiserId: "AR1", countryCodes: [], scanMode: "FULL" }, { found: 12, total: 40 })).toBe(false);
      expect(shouldStopOnIncompletePreview({ scanJobId: "job", advertiserDbId: "adv", googleAdvertiserId: "AR1", countryCodes: [], scanMode: "FAST" }, { found: 0, total: 40 })).toBe(false);
      process.env.GOOGLE_BROWSER_PREVIEW_STRICT = "true";
      expect(shouldStopOnIncompletePreview({ scanJobId: "job", advertiserDbId: "adv", googleAdvertiserId: "AR1", countryCodes: [], scanMode: "FULL" }, { found: 0, total: 40 })).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_BROWSER_PREVIEW_STRICT;
      else process.env.GOOGLE_BROWSER_PREVIEW_STRICT = previous;
    }
  });

  it("does not collect browser detail inline unless explicitly enabled", () => {
    const inline = process.env.GOOGLE_BROWSER_DETAIL_INLINE;
    const batch = process.env.GOOGLE_BROWSER_DETAIL_BATCH_PER_PAGE;
    delete process.env.GOOGLE_BROWSER_DETAIL_INLINE;
    process.env.GOOGLE_BROWSER_DETAIL_BATCH_PER_PAGE = "9";
    try {
      expect(resolveBrowserNativeInlineDetailBatch()).toBe(0);
      process.env.GOOGLE_BROWSER_DETAIL_INLINE = "true";
      expect(resolveBrowserNativeInlineDetailBatch()).toBe(9);
    } finally {
      if (inline === undefined) delete process.env.GOOGLE_BROWSER_DETAIL_INLINE;
      else process.env.GOOGLE_BROWSER_DETAIL_INLINE = inline;
      if (batch === undefined) delete process.env.GOOGLE_BROWSER_DETAIL_BATCH_PER_PAGE;
      else process.env.GOOGLE_BROWSER_DETAIL_BATCH_PER_PAGE = batch;
    }
  });

  it("skips detail collection only while existing detail and preview are fresh and refresh is not forced", () => {
    const now = new Date("2026-05-28T12:00:00.000Z");
    const fresh = new Date("2026-05-24T12:00:00.000Z");
    const stale = new Date("2026-05-20T11:59:59.000Z");
    const complete = { rawDetail: { ok: true }, rawPreview: { ok: true }, appDbId: "app-1", countryCount: 2, detailFetchedAt: fresh };

    expect(shouldSkipCreativeDetail(complete, { now })).toBe(true);
    expect(shouldSkipCreativeDetail({ ...complete, rawDetail: null }, { now })).toBe(false);
    expect(shouldSkipCreativeDetail({ ...complete, rawPreview: null }, { now })).toBe(false);
    expect(shouldSkipCreativeDetail({
      ...complete,
      appDbId: null,
      rawPreview: {
        source: "dom_card",
        appId: "",
        appName: "",
        appStoreName: "",
        storeUrl: "",
        domAppId: "",
        domAppName: "",
        domStoreUrl: ""
      }
    }, { now })).toBe(false);
    expect(shouldSkipCreativeDetail({
      ...complete,
      appDbId: null,
      previewUrl: "https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=1"
    }, { now })).toBe(false);
    expect(shouldSkipCreativeDetail({
      ...complete,
      appDbId: null,
      previewUrl: "https://tpc.googlesyndication.com/archive/simgad/1"
    }, { now })).toBe(true);
    expect(shouldSkipCreativeDetail({ ...complete, countryCount: 0 }, { now })).toBe(false);
    expect(shouldSkipCreativeDetail({ ...complete, detailFetchedAt: stale }, { now })).toBe(false);
    expect(shouldSkipCreativeDetail(complete, { now, refreshDetails: true })).toBe(false);
    expect(shouldSkipCreativeDetail(undefined, { now })).toBe(false);
  });
});
