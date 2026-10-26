import {
  normalizeCreative,
  parseCreativeDetails,
  parsePreviewContentJs,
  parseSearchCreatives,
  type NormalizedCreative
} from "@ad-monitor/core";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { enrichAppMetadata } from "./app-metadata.js";
import { BrowserNativeGoogleClient } from "./browser-native-client.js";
import {
  buildCreativeDetailPayload,
  assertUsableCreativeDetail,
  buildSearchCreativesPayload,
  collectBestPreview,
  defaultUserAgent,
  GoogleTransparencyClient,
  normalizeGooglePreviewUrl,
  type GoogleCreativeClient,
  type GoogleRpcClientOptions,
  type SearchPayloadInput
} from "./google-client.js";
import { normalizeRuntimeProxyUrl, resolvePlaywrightProxy } from "./proxy-bridge.js";

export class BrowserGoogleTransparencyClient implements GoogleCreativeClient {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private previewPage?: Page;
  private bootstrappedAdvertiserId?: string;

  constructor(private readonly options: GoogleRpcClientOptions = {}) {}

  async searchCreatives(input: SearchPayloadInput) {
    const response = await this.postRpc(
      input.advertiserId,
      "SearchService",
      "SearchCreatives",
      buildSearchCreativesPayload(input)
    );
    return parseSearchCreatives(response);
  }

  async getCreativeById(input: { advertiserId: string; creativeId: string }) {
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
    if (!this.previewPage || this.previewPage.isClosed()) {
      this.previewPage = await context.newPage();
    }
    const response = await this.previewPage.goto(safePreviewUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    });
    if (!response?.ok()) {
      throw new Error(`Preview fetch failed with ${response?.status() ?? "no-response"}`);
    }
    return parsePreviewContentJs(await response.text());
  }

  async collectCreative(input: {
    advertiserId: string;
    creativeId: string;
    listCreative?: ReturnType<typeof parseSearchCreatives>["creatives"][number];
    collectDetail?: boolean;
    deferEconomyPrune?: boolean;
  }): Promise<NormalizedCreative> {
    const detail = input.collectDetail === false ? undefined : await this.getCreativeById(input);
    if (input.collectDetail !== false) assertUsableCreativeDetail(input.creativeId, detail);
    const preview = input.collectDetail === false
      ? undefined
      : await collectBestPreview(
        [input.listCreative?.previewUrl, ...(detail?.previewUrls ?? [])],
        (previewUrl) => this.fetchPreviewContent(previewUrl)
      );
    return enrichAppMetadata(normalizeCreative({ list: input.listCreative, detail, preview }));
  }

  async close() {
    await withTimeout(
      this.browser?.close() ?? Promise.resolve(),
      readPositiveIntegerEnv("GOOGLE_BROWSER_CLOSE_TIMEOUT_MS", 8_000),
      undefined
    );
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
    this.bootstrappedAdvertiserId = undefined;
  }

  private async postRpc(advertiserId: string, service: string, method: string, payload: unknown): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const page = await this.ensurePage(advertiserId);
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
              const text = await response.text();
              return {
                ok: response.ok,
                status: response.status,
                text
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
      } catch (error) {
        lastError = error;
        this.bootstrappedAdvertiserId = undefined;
        if (attempt < 3) await this.page?.waitForTimeout(1_000).catch(() => undefined);
      }
    }

    throw lastError;
  }

  private async ensurePage(advertiserId: string) {
    const context = await this.ensureContext();
    if (!this.page || this.page.isClosed()) {
      this.page = await context.newPage();
    }

    if (this.bootstrappedAdvertiserId !== advertiserId || !this.page.url().startsWith("https://adstransparency.google.com/")) {
      const response = await this.page.goto(`https://adstransparency.google.com/advertiser/${advertiserId}?region=anywhere`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000
      });
      await this.page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      if (!response?.ok() || !this.page.url().startsWith("https://adstransparency.google.com/")) {
        throw new Error(`blocked:GooglePage:${response?.status() ?? "redirect"}:${this.page.url()}`);
      }
      this.bootstrappedAdvertiserId = advertiserId;
    }

    return this.page;
  }

  private async ensureContext() {
    if (this.context) return this.context;

    const rawProxyUrl = this.options.proxyUrl ?? (this.options.useEnvProxy !== false && process.env.GOOGLE_PROXY_ENABLED === "true" ? process.env.GOOGLE_PROXY_URL : undefined);
    const proxyUrl = rawProxyUrl ? normalizeRuntimeProxyUrl(rawProxyUrl) : undefined;
    this.browser = await chromium.launch({
      headless: process.env.GOOGLE_BROWSER_HEADLESS !== "false",
      channel: process.env.GOOGLE_BROWSER_CHANNEL || undefined,
      proxy: proxyUrl ? await resolvePlaywrightProxy(proxyUrl) : undefined,
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
    this.context = await this.browser.newContext({
      locale: "ru-RU",
      userAgent: defaultUserAgent()
    });
    return this.context;
  }
}

export function createGoogleClient(options: GoogleRpcClientOptions = {}): GoogleCreativeClient {
  if (process.env.GOOGLE_CLIENT === "browser-native") {
    return new BrowserNativeGoogleClient(options);
  }
  if (process.env.GOOGLE_CLIENT === "browser") {
    return new BrowserGoogleTransparencyClient(options);
  }
  return new FallbackGoogleTransparencyClient(options);
}

class FallbackGoogleTransparencyClient implements GoogleCreativeClient {
  private readonly direct: GoogleTransparencyClient;
  private browser?: BrowserGoogleTransparencyClient;

  constructor(private readonly options: GoogleRpcClientOptions = {}) {
    this.direct = new GoogleTransparencyClient(options);
  }

  async searchCreatives(input: SearchPayloadInput) {
    try {
      return await this.direct.searchCreatives(input);
    } catch (error) {
      if (!shouldFallbackToBrowser(error)) throw error;
      return this.ensureBrowser().searchCreatives(input);
    }
  }

  async getCreativeById(input: { advertiserId: string; creativeId: string }) {
    return this.browser ? this.browser.getCreativeById(input) : this.direct.getCreativeById(input);
  }

  async fetchPreviewContent(previewUrl: string) {
    return this.browser ? this.browser.fetchPreviewContent(previewUrl) : this.direct.fetchPreviewContent(previewUrl);
  }

  async collectCreative(input: {
    advertiserId: string;
    creativeId: string;
    listCreative?: ReturnType<typeof parseSearchCreatives>["creatives"][number];
    collectDetail?: boolean;
    deferEconomyPrune?: boolean;
  }) {
    return this.browser ? this.browser.collectCreative(input) : this.direct.collectCreative(input);
  }

  async close() {
    await this.browser?.close();
  }

  private ensureBrowser() {
    this.browser ??= new BrowserGoogleTransparencyClient(this.options);
    return this.browser;
  }
}

function shouldFallbackToBrowser(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("SearchService/SearchCreatives:404") || message.includes("UND_ERR_CONNECT_TIMEOUT") || message.includes("fetch failed");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timer));
  });
}

function withRejectTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}
