import type { NormalizedCreative } from "@ad-monitor/core";

type AppMetadata = {
  appId: string;
  name?: string;
  developer?: string;
  description?: string;
  storeUrl: string;
};

const metadataCache = new Map<string, Promise<AppMetadata | undefined>>();

const GOOGLE_PLAY_APP_ALIASES: Record<string, string> = {
  "com.sarafan.rolly": "com.sarafan.reely"
};

export async function enrichAppMetadata(
  normalized: NormalizedCreative,
  fetchImpl: typeof fetch = fetch
): Promise<NormalizedCreative> {
  const app = normalized.app;
  if (!app?.appId || app.store !== "GOOGLE_PLAY") return normalized;
  if (app.appName && app.developer && app.storeUrl) return normalized;

  const metadata = await fetchGooglePlayMetadata(app.appId, fetchImpl).catch(() => undefined);
  if (!metadata) return normalized;

  return {
    ...normalized,
    app: {
      ...app,
      appId: metadata.appId,
      appName: app.appName || metadata.name,
      developer: app.developer || metadata.developer,
      description: app.description || metadata.description,
      storeUrl: metadata.storeUrl || app.storeUrl
    }
  };
}

async function fetchGooglePlayMetadata(appId: string, fetchImpl: typeof fetch) {
  const cacheKey = `GOOGLE_PLAY:${appId}`;
  const cached = metadataCache.get(cacheKey);
  if (cached) return cached;

  const promise = fetchGooglePlayMetadataUncached(appId, fetchImpl);
  metadataCache.set(cacheKey, promise);
  return promise;
}

async function fetchGooglePlayMetadataUncached(appId: string, fetchImpl: typeof fetch): Promise<AppMetadata | undefined> {
  const candidates = [...new Set([appId, GOOGLE_PLAY_APP_ALIASES[appId]].filter(Boolean))];

  for (const candidate of candidates) {
    const storeUrl = `https://play.google.com/store/apps/details?id=${encodeURIComponent(candidate)}&hl=en&gl=US`;
    const response = await fetchImpl(storeUrl, {
      headers: { "user-agent": defaultStoreUserAgent() }
    });
    if (!response.ok) continue;

    const html = await response.text();
    const title = extractMeta(html, "og:title") ?? extractTitle(html);
    const name = cleanGooglePlayTitle(title);
    if (!name) continue;

    return {
      appId: candidate,
      name,
      developer: extractDeveloper(html),
      description: extractMeta(html, "og:description"),
      storeUrl: `https://play.google.com/store/apps/details?id=${candidate}`
    };
  }

  return undefined;
}

function extractMeta(html: string, property: string) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']+)["']`, "i");
  return decodeHtml(pattern.exec(html)?.[1]);
}

function extractTitle(html: string) {
  return decodeHtml(/<title[^>]*>(.*?)<\/title>/i.exec(html)?.[1]);
}

function extractDeveloper(html: string) {
  const match = html.match(/\/store\/apps\/dev[^>]+>([^<]+)<\/a>/i);
  return decodeHtml(match?.[1]);
}

function cleanGooglePlayTitle(title?: string) {
  return title
    ?.replace(/\s+-\s+Apps on Google Play$/i, "")
    .replace(/\s+-\s+Google Play.*$/i, "")
    .trim();
}

function decodeHtml(value?: string) {
  return value
    ?.replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function defaultStoreUserAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136 Safari/537.36";
}
