import {
  type NormalizedCreative,
  type ParsedSearchCreatives,
  type PreviewAsset,
} from "@ad-monitor/core";
import { type Frame } from "playwright";
import {
  SearchPage,
  BrowserNativeDomCreative,
  BrowserNativeFramePayload,
  DomCreativeContentInput,
} from "./model.js";

export function isBrowserNativeDomCreative(
  value: ParsedSearchCreatives["creatives"][number] | undefined,
): value is BrowserNativeDomCreative {
  return Boolean(
    value?.raw &&
    typeof value.raw === "object" &&
    (value.raw as { browserNativeDom?: unknown }).browserNativeDom === true,
  );
}

export function isBrowserNativeDomPage(value: SearchPage) {
  return isBrowserNativeDomRaw(value.raw);
}

export function isBrowserNativeDomRaw(raw: unknown) {
  return Boolean(
    raw &&
    typeof raw === "object" &&
    ((raw as { browserNativeDomBatch?: unknown }).browserNativeDomBatch ===
      true ||
      (raw as { browserNativeDomFallback?: unknown })
        .browserNativeDomFallback === true),
  );
}

export function shouldWaitForDomPreviewCapture(pageRaw: unknown) {
  const mode = process.env.GOOGLE_BROWSER_WAIT_FOR_DOM_PREVIEW;
  if (mode === "true" || mode === "strict") return true;
  return isBrowserNativeDomRaw(pageRaw);
}

export function mergeListCreativeWithDom(
  list: ParsedSearchCreatives["creatives"][number],
  dom: BrowserNativeDomCreative | undefined,
): ParsedSearchCreatives["creatives"][number] {
  if (!dom || isBrowserNativeDomCreative(list)) return list;
  return {
    ...list,
    previewUrl: list.previewUrl ?? dom.previewUrl,
    format: list.format !== "UNKNOWN" ? list.format : dom.format,
    raw: {
      list: list.raw,
      dom: dom.raw,
    },
  };
}

export function normalizeDomCreative(
  advertiserId: string,
  item: BrowserNativeDomCreative,
): NormalizedCreative {
  const assets = dedupeDomAssets(item.raw.assets ?? []);
  const appId = normalizeStoreAppId(item.raw.appId, item.raw.store);
  const app =
    appId && item.raw.store && item.raw.store !== "UNKNOWN"
      ? {
          appId,
          appName: item.raw.appName ?? item.raw.title,
          store: item.raw.store,
          storeUrl: item.raw.storeUrl,
          description: item.raw.description,
        }
      : undefined;

  return {
    advertiserId: item.advertiserId || advertiserId,
    advertiserName: item.advertiserName,
    creativeId: item.creativeId,
    title: item.raw.appName ?? item.raw.title,
    description: item.raw.description,
    format: item.format,
    status: "ACTIVE",
    previewUrls: item.previewUrl ? [item.previewUrl] : [],
    firstShownAt: item.firstShownAt,
    lastShownAt: item.lastShownAt,
    app,
    countries: [],
    assets,
    raw: {
      list: item.raw,
      preview: {
        source: item.raw.source,
        appId: item.raw.appId ?? "",
        appName: item.raw.appName ?? "",
        appStoreName:
          item.raw.store === "GOOGLE_PLAY"
            ? "Google Play"
            : item.raw.store === "APP_STORE"
              ? "App Store"
              : "",
        storeUrl: item.raw.storeUrl ?? "",
        description: item.raw.description ?? "",
        destination_url: item.raw.storeUrl ?? item.raw.creativeUrl ?? "",
        domSource: item.raw.source,
        domCreativeUrl: item.raw.creativeUrl ?? "",
        domStoreUrl: item.raw.storeUrl ?? "",
        domAppId: item.raw.appId ?? "",
        domAppName: item.raw.appName ?? "",
        domDescription: item.raw.description ?? "",
      },
    },
  };
}

export function domRawFromList(
  list: ParsedSearchCreatives["creatives"][number] | undefined,
): BrowserNativeDomCreative["raw"] | undefined {
  const raw = list?.raw;
  if (!raw || typeof raw !== "object") return undefined;
  if ((raw as { browserNativeDom?: unknown }).browserNativeDom === true)
    return raw as BrowserNativeDomCreative["raw"];
  const dom = (raw as { dom?: unknown }).dom;
  if (!dom || typeof dom !== "object") return undefined;
  return (dom as { browserNativeDom?: unknown }).browserNativeDom === true
    ? (dom as BrowserNativeDomCreative["raw"])
    : undefined;
}

export function domCreativeFromList(
  advertiserId: string,
  creativeId: string,
  list: ParsedSearchCreatives["creatives"][number] | undefined,
): BrowserNativeDomCreative | undefined {
  const raw = domRawFromList(list);
  if (!list || !raw) return undefined;
  return {
    ...list,
    advertiserId: list.advertiserId || advertiserId,
    creativeId: list.creativeId || creativeId,
    previewUrl: list.previewUrl,
    format: list.format,
    raw,
  };
}

export function applyDomToNormalized(
  normalized: NormalizedCreative,
  dom: BrowserNativeDomCreative["raw"],
): NormalizedCreative {
  const assets = dedupeDomAssets([...normalized.assets, ...(dom.assets ?? [])]);
  const domAppId = normalizeStoreAppId(dom.appId, dom.store);
  const domApp =
    domAppId && dom.store && dom.store !== "UNKNOWN"
      ? {
          appId: domAppId,
          appName: dom.appName ?? dom.title,
          store: dom.store,
          storeUrl: dom.storeUrl,
          description: dom.description,
        }
      : undefined;

  return {
    ...normalized,
    title: normalized.title ?? dom.appName ?? dom.title,
    description: normalized.description ?? dom.description,
    format:
      normalized.format !== "UNKNOWN"
        ? normalized.format
        : assets.some((asset) => asset.kind === "VIDEO")
          ? "VIDEO"
          : assets.length
            ? "IMAGE"
            : "UNKNOWN",
    app: normalized.app ?? domApp,
    assets,
    raw: {
      ...normalized.raw,
      list: normalized.raw.list,
      preview: {
        ...(normalized.raw.preview ?? {}),
        domSource: dom.source,
        domCreativeUrl: dom.creativeUrl ?? "",
        domStoreUrl: dom.storeUrl ?? "",
        domAppId: dom.appId ?? "",
        domAppName: dom.appName ?? "",
        domDescription: dom.description ?? "",
      },
    },
  };
}

export function extractCreativeIdFromText(source: string) {
  return source.match(/CR\d{10,}/)?.[0];
}

export function parseBrowserNativeAdDataTemplate(
  value: unknown,
): BrowserNativeFramePayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = JSON.stringify(value);
  const root = value as Record<string, unknown>;
  const googleTemplate = (root.google_template_data ??
    (Array.isArray(root.adData) ? root : undefined)) as
    | Record<string, unknown>
    | undefined;
  const ad0 = Array.isArray(googleTemplate?.adData)
    ? (googleTemplate.adData[0] as Record<string, unknown> | undefined)
    : undefined;
  const ads = Array.isArray(root.ads)
    ? (root.ads as Record<string, unknown>[])
    : [];
  const ad = ads.find(Boolean);
  const template = ad0 ?? googleTemplate ?? {};
  const destination = String(
    ad?.destination_url ??
      root.destination_url ??
      root.google_click_url ??
      root.clickUrl ??
      root.click_url ??
      "",
  );
  const storeUrl = extractStoreUrlFromSerializedSource(
    `${destination} ${source}`,
  );
  const platform = ad?.platform as Record<string, unknown> | undefined;
  const platformName = String(platform?.name ?? platform?.id ?? "");
  const appId =
    String(
      platform?.id_value ??
        ad?.package_name ??
        ad?.app_id ??
        template.appId ??
        template.adamId ??
        googleTemplate?.appId ??
        root.appId ??
        appIdFromStoreUrlValue(storeUrl) ??
        "",
    ) || undefined;
  const storeByLabel = storeFromLabelValue(
    `${platformName} ${storeUrl ?? ""} ${destination} ${source}`,
  );
  const templateStore = template.appStore ?? googleTemplate?.appStore;
  const store =
    storeByLabel === "UNKNOWN"
      ? inferStoreFromAppIdValue(appId, templateStore)
      : storeByLabel;
  const appName =
    normalizeBrowserNativeText(
      String(
        ad?.app_name ??
          ad?.title ??
          ad?.headline ??
          ad?.name ??
          template.appName ??
          googleTemplate?.appName ??
          googleTemplate?.headline ??
          googleTemplate?.title ??
          "",
      ),
    ) ??
    pickSerializedText(source, [
      /"(?:appName|app_name|headline)"\s*:\s*"([^"]{3,100})"/i,
      /"title"\s*:\s*"([^"]{3,100})"/i,
    ]);
  const description =
    normalizeBrowserNativeText(
      String(
        ad?.description ??
          ad?.description1 ??
          ad?.body ??
          ad?.text ??
          template.description1 ??
          template.shortDescription ??
          googleTemplate?.description ??
          googleTemplate?.description1 ??
          googleTemplate?.body ??
          "",
      ),
    ) ??
    pickSerializedText(source, [
      /"(?:description1?|body)"\s*:\s*"([^"]{10,500})"/i,
      /"text"\s*:\s*"([^"]{10,500})"/i,
    ]);
  const regexAppId =
    source.match(
      /(?:id=|id%3D|id\\u003d|package["']?[:=]\s*["']?|docid["']?[:=]\s*["']?|appId["']?[:=]\s*["']?)([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+)/,
    )?.[1] ??
    source.match(
      /(?:adamId["']?[:=]\s*["']?|appId["']?[:=]\s*["']?)(\d{5,})/,
    )?.[1];
  const inferredStore =
    store === "UNKNOWN"
      ? inferStoreFromAppIdValue(appId ?? regexAppId, templateStore)
      : store;
  const sourceAppId = extractLikelyStoreAppIdFromSerializedSource(
    source,
    inferredStore,
    [appName, description],
  );
  const finalStoreFromSource =
    inferredStore === "UNKNOWN"
      ? inferStoreFromAppIdValue(sourceAppId, templateStore)
      : inferredStore;
  const finalAppId = normalizeStoreAppId(
    appId ?? regexAppId ?? sourceAppId,
    finalStoreFromSource,
  );
  const inferredStoreFromFinal =
    finalStoreFromSource === "UNKNOWN"
      ? inferStoreFromAppIdValue(finalAppId, templateStore)
      : finalStoreFromSource;
  const finalStore = finalAppId ? inferredStoreFromFinal : "UNKNOWN";
  if (finalStore === "UNKNOWN" && !finalAppId) return undefined;
  const assets: PreviewAsset[] = [];
  for (const key of [
    "landscapeImage",
    "coverImage",
    "screenshot1",
    "appIconHighRes",
    "appIconStandard",
    "image",
    "thumbnail_url",
    "icon_url",
  ]) {
    const raw = ad?.[key] ?? template[key] ?? googleTemplate?.[key];
    if (typeof raw === "string")
      assets.push({
        kind: key.toLowerCase().includes("icon")
          ? "APP_ICON"
          : "LANDSCAPE_IMAGE",
        url: normalizeBrowserNativeUrl(raw) ?? raw,
      });
  }
  const video =
    ad?.video_url ??
    ad?.youtube_video_id ??
    template.video_videoId ??
    googleTemplate?.video_videoId ??
    template.video ??
    googleTemplate?.video;
  if (typeof video === "string")
    assets.push({
      kind: "VIDEO",
      url: video.includes("http")
        ? video
        : `https://www.youtube.com/watch?v=${video}`,
    });
  if (storeUrl) assets.push({ kind: "LANDING_URL", url: storeUrl });
  return {
    source: "adData_template",
    appId: finalAppId,
    appName,
    title: appName,
    description,
    store: finalStore,
    storeUrl,
    assets: dedupeDomAssets(assets),
  };
}

export function normalizeBrowserNativeText(value?: string | null) {
  const normalized = value
    ?.replace(/\\x26|\\u0026/g, "&")
    .replace(/[\u2066\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized && !isBlockedBrowserNativeText(normalized)
    ? normalized
    : undefined;
}

export function decodeBrowserNativeText(value: string) {
  const htmlDecoded = value
    .replace(/&amp;/g, "&")
    .replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/");
  try {
    return decodeURIComponent(htmlDecoded);
  } catch {
    return htmlDecoded;
  }
}

export function normalizeBrowserNativeUrl(value?: string | null) {
  if (!value) return undefined;
  const decoded = decodeBrowserNativeText(value.trim());
  if (!decoded || decoded.startsWith("data:")) return undefined;
  if (decoded.startsWith("//")) return `https:${decoded}`;
  return decoded;
}

export function storeFromLabelValue(label?: string) {
  const lower = label?.toLowerCase() ?? "";
  if (
    lower.includes("google play") ||
    lower.includes("play.google") ||
    lower.includes("market://")
  )
    return "GOOGLE_PLAY" as const;
  if (
    lower.includes("app store") ||
    lower.includes("apps.apple") ||
    lower.includes("itunes.apple")
  )
    return "APP_STORE" as const;
  return "UNKNOWN" as const;
}

export function extractStoreUrlFromSerializedSource(source: string) {
  const decoded = decodeBrowserNativeText(source);
  const direct = decoded.match(
    /https?:\/\/(?:play\.google\.com\/store\/apps\/details\?id=[^"'<>\s\\]+|apps\.apple\.com\/[^"'<>\s\\]+|itunes\.apple\.com\/[^"'<>\s\\]+)/i,
  )?.[0];
  if (direct) return direct;
  const encoded = decoded.match(
    /https?%3A%2F%2F(?:play\.google\.com%2Fstore%2Fapps%2Fdetails%3Fid%3D[^"'<>\s\\]+|apps\.apple\.com%2F[^"'<>\s\\]+|itunes\.apple\.com%2F[^"'<>\s\\]+)/i,
  )?.[0];
  return encoded ? decodeURIComponent(encoded) : undefined;
}

export function appIdFromStoreUrlValue(storeUrl?: string) {
  if (!storeUrl) return undefined;
  try {
    const url = new URL(storeUrl);
    if (url.hostname.includes("play.google.com"))
      return url.searchParams.get("id") ?? undefined;
    return url.pathname.match(/\/id(\d{5,})/)?.[1];
  } catch {
    return (
      storeUrl.match(/[?&]id=([a-zA-Z][a-zA-Z0-9_.]+)/)?.[1] ??
      storeUrl.match(/id(\d{5,})/)?.[1]
    );
  }
}

export function extractLikelyStoreAppIdFromSerializedSource(
  source: string,
  store: "GOOGLE_PLAY" | "APP_STORE" | "UNKNOWN",
  preferredTexts: Array<string | undefined> = [],
) {
  const decoded = decodeBrowserNativeText(source);
  const chunks = [decoded, ...decodeAdParameterChunks(decoded)];
  const preferred = preferredTexts
    .map((item) => normalizeBrowserNativeText(item))
    .filter((item): item is string => Boolean(item));
  const candidates: Array<{ value: string; score: number }> = [];

  for (const chunk of chunks) {
    const candidateStore =
      store === "UNKNOWN" ? storeFromLabelValue(chunk) : store;
    if (candidateStore !== "APP_STORE") {
      for (const match of chunk.matchAll(
        /[A-Z]?([a-z][a-z0-9_]{1,50}(?:\.[a-z][a-z0-9_-]{1,80}){2,})/g,
      )) {
        const value = normalizeStoreAppId(match[1], "GOOGLE_PLAY");
        if (!value) continue;
        candidates.push({
          value,
          score: scoreStoreAppIdCandidate(
            chunk,
            match.index ?? 0,
            value,
            preferred,
          ),
        });
      }
    }
    if (candidateStore === "APP_STORE" || candidateStore === "UNKNOWN") {
      for (const match of chunk.matchAll(/[A-Z]?(\d{7,})(?=[A-Z]|\D|$)/g)) {
        const value = normalizeStoreAppId(match[1], "APP_STORE");
        if (!value) continue;
        candidates.push({
          value,
          score: scoreStoreAppIdCandidate(
            chunk,
            match.index ?? 0,
            value,
            preferred,
          ),
        });
      }
    }
  }

  return candidates.sort(
    (left, right) =>
      right.score - left.score || left.value.length - right.value.length,
  )[0]?.value;
}

export function decodeAdParameterChunks(source: string) {
  const chunks: string[] = [];
  for (const match of source.matchAll(/[?&]ad=([^&"'<>\s\\]{30,})/g)) {
    const decoded = decodeBase64UrlText(match[1]);
    if (decoded) chunks.push(decoded);
  }
  return chunks;
}

export function decodeBase64UrlText(value: string) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

export function scoreStoreAppIdCandidate(
  source: string,
  index: number,
  value: string,
  preferredTexts: string[],
) {
  let score = 1;
  if (!isBlockedBrowserNativeAppId(value)) score += 5;
  if (value.startsWith("com.google.") || value.includes("google.")) score -= 5;
  if (
    !/googleusercontent|googlesyndication|doubleclick|gstatic|prod\.corp\.google/i.test(
      value,
    )
  )
    score += 2;
  const windowStart = Math.max(0, index - 500);
  const windowEnd = Math.min(source.length, index + 500);
  const nearby = source.slice(windowStart, windowEnd).toLowerCase();
  for (const text of preferredTexts) {
    const key = text.toLowerCase().slice(0, 80);
    if (key && nearby.includes(key)) score += 12;
  }
  return score;
}

export function selectFramesForDomCapture(
  frames: Frame[],
  mainFrame: Frame,
  limit: number,
) {
  const cappedLimit = Math.max(1, Math.min(80, limit));
  const scored = frames
    .filter((frame) => frame !== mainFrame)
    .map((frame, index) => ({ frame, index, score: frameCaptureScore(frame) }))
    .sort(
      (left, right) => right.score - left.score || right.index - left.index,
    );
  return [
    mainFrame,
    ...scored.slice(0, cappedLimit - 1).map((item) => item.frame),
  ];
}

export function frameCaptureScore(frame: Frame) {
  const url = frame.url().toLowerCase();
  if (url.includes("displayads-formats.googleusercontent.com")) return 5;
  if (url.includes("googleusercontent.com")) return 4;
  if (url.includes("adstransparency.google.com")) return 3;
  if (
    url.includes("googlesyndication.com") ||
    url.includes("googleadservices.com")
  )
    return 2;
  return 1;
}

export function inferStoreFromAppIdValue(appId?: string, appStore?: unknown) {
  if (appStore === "1" || appStore === 1) return "APP_STORE" as const;
  if (appStore === "2" || appStore === 2) return "GOOGLE_PLAY" as const;
  if (!appId || isBlockedBrowserNativeAppId(appId)) return "UNKNOWN" as const;
  if (/^\d{5,}$/.test(appId)) return "APP_STORE" as const;
  return isLikelyGooglePlayAppId(appId)
    ? ("GOOGLE_PLAY" as const)
    : ("UNKNOWN" as const);
}

export function isBlockedBrowserNativeText(value?: string) {
  const text = value?.trim() ?? "";
  const lower = text.toLowerCase();
  return (
    !text ||
    text.length > 180 ||
    /^(window|document|globalthis|google|wiz|json|object|this|self)\./i.test(
      text,
    ) ||
    /^(function|var |const |let |return |if\(|for\(|while\()/i.test(text) ||
    lower.includes("wiz_global_data") ||
    lower.includes("window.wiz") ||
    lower.includes("this.parentnode") ||
    lower.includes("a.performance") ||
    /^[a-z][a-z0-9_$]*\.[a-z][a-z0-9_$]*$/i.test(text) ||
    /[{};]/.test(text)
  );
}

export function isBlockedBrowserNativeAppId(appId?: string) {
  const value = appId?.trim() ?? "";
  const lower = value.toLowerCase();
  return (
    /^(window|document|globalthis|google|wiz|json|object|this|self)\./i.test(
      value,
    ) ||
    /^(19|20)\d{6}$/.test(value) ||
    lower === "www.google.com" ||
    lower === "play.google.com" ||
    lower === "itunes.apple.com" ||
    lower === "apps.apple.com" ||
    lower === "fonts.googleapis.com" ||
    lower === "apis.google.com" ||
    lower === "prod.corp.google.com" ||
    lower.startsWith("com.google.search.") ||
    lower.startsWith("google.search.") ||
    lower.includes(".boq") ||
    lower.includes("boq.") ||
    lower.includes("prod.corp.google") ||
    lower.includes("rendering.framework") ||
    lower.includes("gws.plugins") ||
    lower.includes("global_data") ||
    lower.includes("wiz_global") ||
    lower.includes("googleusercontent") ||
    lower.includes("googlesyndication") ||
    lower.includes("doubleclick") ||
    lower.includes("googleadservices") ||
    lower.includes("adstransparency") ||
    /(^|\.)(prototype|parentnode|performance|constructor|queryselector|addeventlistener|getattribute|setattribute|appendchild|createelement|classname|innerhtml|textcontent|classlist|dataset|style|length)$/i.test(
      value,
    )
  );
}

export function isLikelyGooglePlayAppId(appId?: string) {
  const value = appId?.trim() ?? "";
  return Boolean(
    value &&
    !isBlockedBrowserNativeAppId(value) &&
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_-]*)+$/i.test(value),
  );
}

export function normalizeStoreAppId(
  appId?: string,
  store?: "GOOGLE_PLAY" | "APP_STORE" | "UNKNOWN",
) {
  const value = appId?.trim() ?? "";
  if (!value || isBlockedBrowserNativeAppId(value)) return undefined;
  if (store === "APP_STORE") return /^\d{5,}$/.test(value) ? value : undefined;
  if (store === "GOOGLE_PLAY")
    return isLikelyGooglePlayAppId(value) ? value : undefined;
  if (/^\d{5,}$/.test(value) || isLikelyGooglePlayAppId(value)) return value;
  return undefined;
}

export function pickSerializedText(source: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const value = normalizeBrowserNativeText(match?.[1]);
    if (value && !/^https?:\/\//i.test(value) && !value.includes("www."))
      return decodeBrowserNativeText(value);
  }
  return undefined;
}

export function domCreativeContentScore(item: DomCreativeContentInput) {
  const meaningfulAssets = (item.raw.assets ?? []).filter(
    (asset) => asset.kind !== "LANDING_URL" && Boolean(asset.url),
  ).length;
  let score = 0;
  if (item.raw.storeUrl) score += 3;
  if (item.raw.appId) score += 2;
  if (item.raw.appName || item.raw.title) score += 2;
  if (item.raw.description) score += 1;
  score += Math.min(meaningfulAssets, 4);
  return score;
}

export function isDomCreativeReadyForPreview(item: DomCreativeContentInput) {
  return domCreativeContentScore(item) > 0;
}

export function richerDomCreative(
  existing: BrowserNativeDomCreative,
  next: BrowserNativeDomCreative,
): BrowserNativeDomCreative {
  const merged = {
    ...existing,
    ...next,
    raw: {
      ...existing.raw,
      ...next.raw,
      assets: dedupeDomAssets([
        ...(existing.raw.assets ?? []),
        ...(next.raw.assets ?? []),
      ]),
    },
  };
  return domCreativeContentScore(merged) > domCreativeContentScore(existing)
    ? merged
    : existing;
}

export function dedupeDomAssets(assets: PreviewAsset[]): PreviewAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.kind}:${asset.url}`;
    if (!asset.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
