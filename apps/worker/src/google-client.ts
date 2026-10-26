import {
  normalizeCreative,
  parseCreativeDetails,
  parsePreviewContentJs,
  parseSearchCreatives,
  type CreativeFormat,
  type NormalizedCreative
} from "@ad-monitor/core";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { enrichAppMetadata } from "./app-metadata.js";

export interface ScanDateRange {
  start: string;
  end: string;
}

export interface SearchPayloadInput {
  advertiserId: string;
  geoId?: number;
  dateRange?: ScanDateRange;
  pageToken?: string;
  format?: Exclude<CreativeFormat, "UNKNOWN">;
  platform?: "PLAY" | "APP_STORE";
}

export interface GoogleRpcClientOptions {
  fetchImpl?: typeof fetch;
  proxyUrl?: string | null;
  profileKey?: string;
  useEnvProxy?: boolean;
  onProgress?: (message: string) => void | Promise<void>;
}

export interface GoogleCreativeClient {
  searchCreatives(input: SearchPayloadInput): Promise<ReturnType<typeof parseSearchCreatives>>;
  getCreativeById(input: { advertiserId: string; creativeId: string }): Promise<ReturnType<typeof parseCreativeDetails>>;
  fetchPreviewContent(previewUrl: string): Promise<ReturnType<typeof parsePreviewContentJs>>;
  orderCreativesForCollection?(
    creatives: ReturnType<typeof parseSearchCreatives>["creatives"],
    seenIds: string[]
  ): Promise<ReturnType<typeof parseSearchCreatives>["creatives"]>;
  collectCreative(input: {
    advertiserId: string;
    creativeId: string;
    listCreative?: ReturnType<typeof parseSearchCreatives>["creatives"][number];
    collectDetail?: boolean;
    deferEconomyPrune?: boolean;
  }): Promise<NormalizedCreative>;
  flushCollectedCreatives?(): Promise<number>;
  advanceCollectionViewport?(): Promise<boolean>;
  getCollectionDiagnostics?(): Promise<Record<string, unknown>>;
  close?(): Promise<void>;
}

export function buildSearchCreativesPayload(input: SearchPayloadInput): Record<string, unknown> {
  const filters: Record<string, unknown> = {
    "12": { "1": "", "2": true },
    "13": { "1": [input.advertiserId] }
  };

  if (input.format) filters["4"] = { TEXT: 1, IMAGE: 2, VIDEO: 3 }[input.format];
  if (input.dateRange) {
    filters["6"] = Number(input.dateRange.start);
    filters["7"] = Number(input.dateRange.end);
  }
  if (input.geoId) filters["8"] = [input.geoId];
  if (input.platform) filters["14"] = [{ PLAY: 1, APP_STORE: 2 }[input.platform]];

  const payload: Record<string, unknown> = {
    "2": 40,
    "3": filters,
    "7": { "1": 1, "2": 26, "3": 2528 }
  };

  if (input.pageToken) payload["4"] = input.pageToken;
  return payload;
}

export function buildCreativeDetailPayload(input: { advertiserId: string; creativeId: string }): Record<string, unknown> {
  return {
    "1": input.advertiserId,
    "2": input.creativeId,
    "5": { "1": 1, "2": 26, "3": 2528 }
  };
}

export function encodeRpcFormBody(payload: unknown): string {
  return new URLSearchParams({ "f.req": JSON.stringify(payload) }).toString();
}

export function decodeRpcFormBody(body: string): unknown {
  const value = new URLSearchParams(body).get("f.req");
  return value ? JSON.parse(value) : undefined;
}

export class GoogleTransparencyClient implements GoogleCreativeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly proxyAgent?: ProxyAgent;
  private readonly cookies = new Map<string, string>();
  private bootstrappedAdvertiserId?: string;

  constructor(private readonly options: GoogleRpcClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    const proxyUrl = options.proxyUrl ?? (options.useEnvProxy !== false && process.env.GOOGLE_PROXY_ENABLED === "true" ? process.env.GOOGLE_PROXY_URL : undefined);
    this.proxyAgent = proxyUrl && !options.fetchImpl ? new ProxyAgent(proxyUrl) : undefined;
  }

  async searchCreatives(input: SearchPayloadInput) {
    await this.bootstrapSession(input.advertiserId);
    const response = await this.postRpc("SearchService", "SearchCreatives", buildSearchCreativesPayload(input));
    return parseSearchCreatives(response);
  }

  async getCreativeById(input: { advertiserId: string; creativeId: string }) {
    await this.bootstrapSession(input.advertiserId);
    const response = await this.postRpc("LookupService", "GetCreativeById", buildCreativeDetailPayload(input));
    return parseCreativeDetails(response);
  }

  async fetchPreviewContent(previewUrl: string) {
    const safePreviewUrl = normalizeGooglePreviewUrl(previewUrl);
    const response = await this.request(safePreviewUrl, {
      headers: { "user-agent": defaultUserAgent() }
    });
    if (!response.ok) {
      throw new Error(`Preview fetch failed with ${response.status}`);
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
    const previewUrls = input.collectDetail === false
      ? [input.listCreative?.previewUrl]
      : [input.listCreative?.previewUrl, ...(detail?.previewUrls ?? [])];
    const preview = await collectBestPreview(
      previewUrls,
      (previewUrl) => this.fetchPreviewContent(previewUrl)
    );
    return enrichAppMetadata(normalizeCreative({ list: input.listCreative, detail, preview }), this.fetchImpl);
  }

  private async postRpc(service: string, method: string, payload: unknown): Promise<unknown> {
    const response = await this.request(`https://adstransparency.google.com/anji/_/rpc/${service}/${method}?authuser=0`, {
      method: "POST",
      headers: this.withSessionHeaders({
        "accept": "*/*",
        "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "origin": "https://adstransparency.google.com",
        "referer": "https://adstransparency.google.com/",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-same-domain": "1",
        "user-agent": defaultUserAgent()
      }),
      body: encodeRpcFormBody(payload)
    });
    this.rememberCookies(response);

    if (!response.ok) {
      const blocked = response.status === 403 || response.status === 429;
      throw new Error(`${blocked ? "blocked" : "rpc"}:${service}/${method}:${response.status}`);
    }

    return response.json();
  }

  private async bootstrapSession(advertiserId: string) {
    if (this.bootstrappedAdvertiserId === advertiserId && this.cookies.size) return;

    const response = await this.request(`https://adstransparency.google.com/advertiser/${advertiserId}?region=anywhere`, {
      method: "GET",
      headers: this.withSessionHeaders({
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        "user-agent": defaultUserAgent()
      })
    });
    this.rememberCookies(response);
    if (!response.ok) {
      const blocked = response.status === 403 || response.status === 429;
      throw new Error(`${blocked ? "blocked" : "rpc"}:GooglePage:${response.status}`);
    }
    await response.arrayBuffer().catch(() => undefined);
    this.bootstrappedAdvertiserId = advertiserId;
  }

  private rememberCookies(response: { headers: Headers }) {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookie = headers.getSetCookie?.() ?? [];
    for (const header of setCookie) {
      const [pair] = header.split(";");
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  private withSessionHeaders(headers: Record<string, string>): HeadersInit {
    if (!this.cookies.size) return headers;
    return {
      ...headers,
      cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ")
    };
  }

  private request(url: string, init: RequestInit) {
    if (this.proxyAgent) {
      return undiciFetch(url, {
        ...init,
        dispatcher: this.proxyAgent
      } as Parameters<typeof undiciFetch>[1]);
    }
    return this.fetchImpl(url, init);
  }
}

function defaultUserAgent(): string {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136 Safari/537.36";
}

export { defaultUserAgent };

export function assertUsableCreativeDetail(
  creativeId: string,
  detail: Awaited<ReturnType<GoogleCreativeClient["getCreativeById"]>> | undefined
) {
  if (!detail?.creativeId || detail.creativeId !== creativeId) {
    throw new Error(`creative-detail-empty:${creativeId}`);
  }
}

export function normalizeGooglePreviewUrl(previewUrl: string) {
  let url: URL;
  try {
    url = new URL(previewUrl);
  } catch {
    throw new Error("invalid-preview-url");
  }

  const hostname = url.hostname.toLowerCase();
  const allowedHost = hostname === "displayads-formats.googleusercontent.com";
  const allowedPath = url.pathname === "/ads/preview/content.js";
  if (url.protocol !== "https:" || !allowedHost || !allowedPath) {
    throw new Error("blocked-preview-url");
  }

  url.username = "";
  url.password = "";
  url.hash = "";
  return url.toString();
}

export async function collectBestPreview<T extends { appId?: string; assets: unknown[] }>(
  previewUrls: Array<string | undefined>,
  fetchPreview: (previewUrl: string) => Promise<T>
): Promise<T | undefined> {
  let fallback: T | undefined;
  for (const previewUrl of uniquePreviewUrls(previewUrls)) {
    const preview = await fetchPreview(previewUrl).catch(() => undefined);
    if (!preview) continue;
    fallback ??= preview;
    if (preview.appId || preview.assets.length > 0) return preview;
  }
  return fallback;
}

function uniquePreviewUrls(previewUrls: Array<string | undefined>) {
  return [...new Set(previewUrls.filter((url): url is string => Boolean(url)))];
}
