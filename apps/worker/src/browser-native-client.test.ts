import { describe, expect, it } from "vitest";
import type { ParsedCreativeDetails } from "@ad-monitor/core";
import {
  BrowserNativeGoogleClient,
  domCreativeContentScore,
  isDomCreativeReadyForPreview,
  parseBrowserNativeAdDataTemplate,
  registerSearchPageCreativeIds,
  resolveEconomyClearBatch,
  resolvePreviewWaitConfig,
  shouldUseBrowserNativeResumeRpc,
  shouldWaitForDomPreviewCapture
} from "./browser-native-client";

class DetailBlockedClient extends BrowserNativeGoogleClient {
  async getCreativeById(): Promise<ParsedCreativeDetails> {
    throw new Error("blocked:LookupService/GetCreativeById:429");
  }
}

class PreviewFetchFailClient extends BrowserNativeGoogleClient {
  async fetchPreviewContent(): Promise<never> {
    throw new Error("preview-fetch-should-not-run");
  }
}

describe("BrowserNativeGoogleClient", () => {
  it("keeps list collection alive when detail RPC is rate-limited", async () => {
    const client = new DetailBlockedClient();

    const normalized = await client.collectCreative({
      advertiserId: "AR123",
      creativeId: "CR123",
      listCreative: {
        advertiserId: "AR123",
        advertiserName: "Test advertiser",
        creativeId: "CR123",
        format: "IMAGE",
        raw: { source: "list" }
      }
    });

    expect(normalized.creativeId).toBe("CR123");
    expect(normalized.advertiserId).toBe("AR123");
    expect(normalized.advertiserName).toBe("Test advertiser");
    expect(normalized.raw.detail).toBeUndefined();
  });

  it("waits for meaningful preview card data, not only the creative id", () => {
    const idOnly = {
      raw: {
        assets: [],
        storeUrl: undefined,
        appId: undefined,
        appName: undefined,
        title: undefined,
        description: undefined
      }
    };
    const idAndPreviewUrlOnly = {
      previewUrl: "https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=1",
      raw: {
        assets: [],
        storeUrl: undefined,
        appId: undefined,
        appName: undefined,
        title: undefined,
        description: undefined
      }
    };
    const rich = {
      previewUrl: "https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=1",
      raw: {
        assets: [{ kind: "LANDSCAPE_IMAGE" as const, url: "https://example.com/a.png" }],
        storeUrl: "https://play.google.com/store/apps/details?id=com.example.app",
        appId: "com.example.app",
        appName: "Example",
        title: "Example",
        description: "Ad text"
      }
    };

    expect(isDomCreativeReadyForPreview(idOnly)).toBe(false);
    expect(isDomCreativeReadyForPreview(idAndPreviewUrlOnly)).toBe(false);
    expect(isDomCreativeReadyForPreview(rich)).toBe(true);
    expect(domCreativeContentScore(rich)).toBeGreaterThan(domCreativeContentScore(idOnly));
  });

  it("keeps non-strict preview waiting close to extension scroll patience", () => {
    const strict = process.env.GOOGLE_BROWSER_PREVIEW_STRICT;
    const maxChecks = process.env.GOOGLE_BROWSER_PREVIEW_MAX_CHECKS;
    const staleChecks = process.env.GOOGLE_BROWSER_PREVIEW_STALE_CHECKS;
    try {
      delete process.env.GOOGLE_BROWSER_PREVIEW_STRICT;
      delete process.env.GOOGLE_BROWSER_PREVIEW_MAX_CHECKS;
      delete process.env.GOOGLE_BROWSER_PREVIEW_STALE_CHECKS;

      expect(resolvePreviewWaitConfig()).toMatchObject({
        strictPreview: false,
        maxChecks: 80,
        staleChecks: 20
      });
    } finally {
      if (strict === undefined) delete process.env.GOOGLE_BROWSER_PREVIEW_STRICT;
      else process.env.GOOGLE_BROWSER_PREVIEW_STRICT = strict;
      if (maxChecks === undefined) delete process.env.GOOGLE_BROWSER_PREVIEW_MAX_CHECKS;
      else process.env.GOOGLE_BROWSER_PREVIEW_MAX_CHECKS = maxChecks;
      if (staleChecks === undefined) delete process.env.GOOGLE_BROWSER_PREVIEW_STALE_CHECKS;
      else process.env.GOOGLE_BROWSER_PREVIEW_STALE_CHECKS = staleChecks;
    }
  });

  it("does not block Search RPC pages on DOM preview by default", () => {
    const previous = process.env.GOOGLE_BROWSER_WAIT_FOR_DOM_PREVIEW;
    try {
      delete process.env.GOOGLE_BROWSER_WAIT_FOR_DOM_PREVIEW;

      expect(shouldWaitForDomPreviewCapture({ rpc: "SearchCreatives" })).toBe(false);
      expect(shouldWaitForDomPreviewCapture({ browserNativeDomFallback: true })).toBe(true);
      process.env.GOOGLE_BROWSER_WAIT_FOR_DOM_PREVIEW = "true";
      expect(shouldWaitForDomPreviewCapture({ rpc: "SearchCreatives" })).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_BROWSER_WAIT_FOR_DOM_PREVIEW;
      else process.env.GOOGLE_BROWSER_WAIT_FOR_DOM_PREVIEW = previous;
    }
  });

  it("uses Search RPC resume only when explicitly enabled", () => {
    const previous = process.env.GOOGLE_BROWSER_RESUME_RPC;
    try {
      delete process.env.GOOGLE_BROWSER_RESUME_RPC;
      expect(shouldUseBrowserNativeResumeRpc()).toBe(false);
      expect(shouldUseBrowserNativeResumeRpc("next-token")).toBe(false);
      process.env.GOOGLE_BROWSER_RESUME_RPC = "true";
      expect(shouldUseBrowserNativeResumeRpc("next-token")).toBe(true);
      expect(shouldUseBrowserNativeResumeRpc("browser-native-dom-scroll")).toBe(false);
      process.env.GOOGLE_BROWSER_RESUME_RPC = "false";
      expect(shouldUseBrowserNativeResumeRpc("next-token")).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_BROWSER_RESUME_RPC;
      else process.env.GOOGLE_BROWSER_RESUME_RPC = previous;
    }
  });

  it("ignores repeated Search RPC pages without new creative ids", () => {
    const seen = new Set<string>();
    const first = registerSearchPageCreativeIds([
      { advertiserId: "AR123", creativeId: "CR1", format: "IMAGE", raw: {} },
      { advertiserId: "AR123", creativeId: "CR2", format: "IMAGE", raw: {} }
    ], seen);
    const repeatedWithDifferentToken = registerSearchPageCreativeIds([
      { advertiserId: "AR123", creativeId: "CR1", format: "IMAGE", raw: {} },
      { advertiserId: "AR123", creativeId: "CR2", format: "IMAGE", raw: {} }
    ], seen);
    const overlap = registerSearchPageCreativeIds([
      { advertiserId: "AR123", creativeId: "CR2", format: "IMAGE", raw: {} },
      { advertiserId: "AR123", creativeId: "CR3", format: "IMAGE", raw: {} }
    ], seen);

    expect(first.newIds).toEqual(["CR1", "CR2"]);
    expect(repeatedWithDifferentToken.newIds).toEqual([]);
    expect(overlap.newIds).toEqual(["CR3"]);
  });

  it("keeps economy clearing in bounded live batches", () => {
    const previous = process.env.GOOGLE_BROWSER_ECONOMY_CLEAR_BATCH;
    try {
      delete process.env.GOOGLE_BROWSER_ECONOMY_CLEAR_BATCH;
      expect(resolveEconomyClearBatch()).toBe(20);
      process.env.GOOGLE_BROWSER_ECONOMY_CLEAR_BATCH = "40";
      expect(resolveEconomyClearBatch()).toBe(40);
      process.env.GOOGLE_BROWSER_ECONOMY_CLEAR_BATCH = "99";
      expect(resolveEconomyClearBatch()).toBe(50);
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_BROWSER_ECONOMY_CLEAR_BATCH;
      else process.env.GOOGLE_BROWSER_ECONOMY_CLEAR_BATCH = previous;
    }
  });

  it("does not fetch preview content during list-only browser collection", async () => {
    const client = new PreviewFetchFailClient();
    const normalized = await client.collectCreative({
      advertiserId: "AR123",
      creativeId: "CR123",
      collectDetail: false,
      listCreative: {
        advertiserId: "AR123",
        advertiserName: "Test advertiser",
        creativeId: "CR123",
        previewUrl: "https://displayads-formats.googleusercontent.com/ads/preview/content.js?creativeId=1",
        format: "IMAGE",
        raw: {
          list: { source: "rpc" },
          dom: {
            browserNativeDom: true,
            source: "dom_card",
            appId: "com.example.app",
            appName: "Example",
            store: "UNKNOWN",
            assets: []
          }
        }
      }
    });

    expect(normalized.creativeId).toBe("CR123");
    expect(normalized.raw.preview?.domAppId).toBe("com.example.app");
  });

  it("throws rate-limit errors during explicit detail collection", async () => {
    const client = new DetailBlockedClient();

    await expect(client.collectCreative({
      advertiserId: "AR123",
      creativeId: "CR123",
      collectDetail: true,
      listCreative: {
        advertiserId: "AR123",
        advertiserName: "Test advertiser",
        creativeId: "CR123",
        format: "IMAGE",
        raw: { source: "list" }
      }
    })).rejects.toThrow("blocked:LookupService/GetCreativeById:429");
  });

  it("extracts app, store and format inputs from google_template_data like the extension", () => {
    const payload = parseBrowserNativeAdDataTemplate({
      google_template_data: {
        adData: [{
          appId: "com.example.flight",
          appStore: 2,
          appName: "Cheap Flights & Tickets",
          description1: "Find cheap flights and plane tickets",
          landscapeImage: "//lh3.googleusercontent.com/example-image",
          video_videoId: "abc123"
        }]
      }
    });

    expect(payload?.appId).toBe("com.example.flight");
    expect(payload?.appName).toBe("Cheap Flights & Tickets");
    expect(payload?.store).toBe("GOOGLE_PLAY");
    expect(payload?.description).toBe("Find cheap flights and plane tickets");
    expect(payload?.assets?.some((asset) => asset.kind === "VIDEO")).toBe(true);
  });

  it("extracts app store data from adData ads without detail RPC", () => {
    const payload = parseBrowserNativeAdDataTemplate({
      ads: [{
        platform: { name: "ITUNES", id_value: "1234567890" },
        app_name: "Photo Collage Maker",
        description: "Create photo collages fast",
        destination_url: "https://apps.apple.com/us/app/example/id1234567890"
      }]
    });

    expect(payload?.appId).toBe("1234567890");
    expect(payload?.appName).toBe("Photo Collage Maker");
    expect(payload?.store).toBe("APP_STORE");
    expect(payload?.storeUrl).toContain("apps.apple.com");
  });

  it("does not treat browser globals as app ids", () => {
    const payload = parseBrowserNativeAdDataTemplate({
      google_template_data: {
        appStore: 2,
        title: "",
        script: "window.WIZ_global_data = {}; a.performance; this.parentNode; formats.googleusercontent.com; Google Play"
      }
    });

    expect(payload).toBeUndefined();
  });

  it("extracts Google Play app id from encoded adframe payload instead of JS tokens", () => {
    const ad = Buffer.from(
      "Calo: AI Food Calorie Counter | Free Calorie Counter AppJ play.google.com/store " +
      "Track your calories with ease. h Hcalo.ai.calorie.counter.weight.loss.diet.nutrition.macro.tracker.fastingJ Calo",
      "utf8"
    ).toString("base64url");
    const payload = parseBrowserNativeAdDataTemplate({
      google_template_data: {
        appStore: 2,
        appName: "Calo",
        script: `window.WIZ_global_data={}; this.parentNode; a.performance; https://ads-rendering-prod.corp.google.com/search?ad=${ad}`
      }
    });

    expect(payload?.appId).toBe("calo.ai.calorie.counter.weight.loss.diet.nutrition.macro.tracker.fasting");
    expect(payload?.appName).toBe("Calo");
    expect(payload?.store).toBe("GOOGLE_PLAY");
  });

  it("extracts App Store ids from encoded adframe payloads", () => {
    const ad = Buffer.from(
      "StarSnap: Sports Card Scanner | Free Sports Card Value CheckerJ itunes.apple.com/ " +
      "Scan your sport cards and get instant value. h 6752947519J StarSnap: Sports Card Scanner",
      "utf8"
    ).toString("base64url");
    const payload = parseBrowserNativeAdDataTemplate({
      google_template_data: {
        appStore: 1,
        appName: "StarSnap",
        script: `https://ads-rendering-prod.corp.google.com/search?ad=${ad}`
      }
    });

    expect(payload?.appId).toBe("6752947519");
    expect(payload?.store).toBe("APP_STORE");
  });

  it("extracts App Store TDI ids shown in rendered cards", () => {
    const payload = parseBrowserNativeAdDataTemplate({
      google_template_data: {
        script: "App Store TDI 6502053015 Muttermal Scanner: Haut Prufen apps.apple.com"
      }
    });

    expect(payload?.appId).toBe("6502053015");
    expect(payload?.store).toBe("APP_STORE");
  });

  it("does not treat date-like numbers as App Store ids", () => {
    const payload = parseBrowserNativeAdDataTemplate({
      google_template_data: {
        appStore: 1,
        script: "itunes.apple.com/ lastShown=20260527"
      }
    });

    expect(payload?.appId).toBeUndefined();
  });
});
