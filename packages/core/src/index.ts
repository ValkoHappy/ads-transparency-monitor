import countries from "i18n-iso-countries";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const enLocale = require("i18n-iso-countries/langs/en.json");

export type CreativeFormat = "TEXT" | "IMAGE" | "VIDEO" | "UNKNOWN";
export type AppStore = "GOOGLE_PLAY" | "APP_STORE" | "UNKNOWN";
export type CreativeStatus = "ACTIVE" | "STOPPED" | "UNKNOWN";
const ACTIVE_LAST_SHOWN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const ACTIVE_LAST_FOUND_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface GeoTarget {
  googleGeoId: number;
  countryCode: string;
  name: string;
}

export interface ParsedSearchCreative {
  advertiserId: string;
  advertiserName?: string;
  creativeId: string;
  previewUrl?: string;
  format: CreativeFormat;
  firstShownAt?: Date;
  lastShownAt?: Date;
  publicDays?: number;
  assets?: PreviewAsset[];
  raw: unknown;
}

export interface ParsedSearchCreatives {
  creatives: ParsedSearchCreative[];
  nextPageToken?: string;
  lowerBound?: number;
  upperBound?: number;
  raw: unknown;
}

export interface CountryStats {
  googleGeoId: number;
  countryCode?: string;
  countryName?: string;
  impressionsMin?: number;
  impressionsMax?: number;
  firstShownDate?: string;
  lastShownDate?: string;
  placementBreakdown?: PlacementImpressions[];
  raw: unknown;
}

export interface ParsedCreativeDetails {
  advertiserId: string;
  creativeId: string;
  format: CreativeFormat;
  lastShownAt?: Date;
  previewUrls: string[];
  countries: CountryStats[];
  totalStats?: Omit<CountryStats, "googleGeoId" | "countryCode" | "countryName">;
  raw: unknown;
}

export type PlacementPlatform =
  | "GOOGLE_PLAY"
  | "GOOGLE_MAPS"
  | "GOOGLE_SEARCH"
  | "GOOGLE_SHOPPING"
  | "YOUTUBE"
  | "UNKNOWN";

export interface PlacementImpressions {
  code: number;
  platform: PlacementPlatform;
  label: string;
  impressionsMin?: number;
  impressionsMax?: number;
  raw: unknown;
}

export interface PreviewAsset {
  kind: "LANDSCAPE_IMAGE" | "APP_ICON" | "SCREENSHOT" | "COVER_IMAGE" | "VIDEO" | "LANDING_URL";
  url: string;
  width?: number;
  height?: number;
}

export interface ParsedPreviewContent {
  appId?: string;
  appName?: string;
  shortAppName?: string;
  store: AppStore;
  storeUrl?: string;
  landingUrl?: string;
  developer?: string;
  category?: string;
  description?: string;
  shortDescription?: string;
  assets: PreviewAsset[];
  rawFields: Record<string, string>;
}

export interface NormalizedCreative {
  advertiserId: string;
  advertiserName?: string;
  creativeId: string;
  title?: string;
  description?: string;
  format: CreativeFormat;
  status: CreativeStatus;
  previewUrls: string[];
  firstShownAt?: Date;
  lastShownAt?: Date;
  publicDays?: number;
  app?: {
    appId?: string;
    appName?: string;
    store: AppStore;
    storeUrl?: string;
    developer?: string;
    category?: string;
    description?: string;
    shortDescription?: string;
  };
  countries: CountryStats[];
  totalStats?: ParsedCreativeDetails["totalStats"];
  assets: PreviewAsset[];
  raw: {
    list?: unknown;
    detail?: unknown;
    preview?: Record<string, string>;
  };
}

export interface RpcCall {
  service: string;
  method: string;
  request?: unknown;
  response?: unknown;
  url: string;
  raw: unknown;
}

const GEO_TARGETS: Record<number, GeoTarget> = {
  2028: { googleGeoId: 2028, countryCode: "AG", name: "Antigua and Barbuda" },
  2036: { googleGeoId: 2036, countryCode: "AU", name: "Australia" },
  2040: { googleGeoId: 2040, countryCode: "AT", name: "Austria" },
  2056: { googleGeoId: 2056, countryCode: "BE", name: "Belgium" },
  2191: { googleGeoId: 2191, countryCode: "HR", name: "Croatia" },
  2196: { googleGeoId: 2196, countryCode: "CY", name: "Cyprus" },
  2203: { googleGeoId: 2203, countryCode: "CZ", name: "Czechia" },
  2208: { googleGeoId: 2208, countryCode: "DK", name: "Denmark" },
  2250: { googleGeoId: 2250, countryCode: "FR", name: "France" },
  2276: { googleGeoId: 2276, countryCode: "DE", name: "Germany" },
  2300: { googleGeoId: 2300, countryCode: "GR", name: "Greece" },
  2348: { googleGeoId: 2348, countryCode: "HU", name: "Hungary" },
  2352: { googleGeoId: 2352, countryCode: "IS", name: "Iceland" },
  2372: { googleGeoId: 2372, countryCode: "IE", name: "Ireland" },
  2380: { googleGeoId: 2380, countryCode: "IT", name: "Italy" },
  2442: { googleGeoId: 2442, countryCode: "LU", name: "Luxembourg" },
  2528: { googleGeoId: 2528, countryCode: "NL", name: "Netherlands" },
  2578: { googleGeoId: 2578, countryCode: "NO", name: "Norway" },
  2616: { googleGeoId: 2616, countryCode: "PL", name: "Poland" },
  2620: { googleGeoId: 2620, countryCode: "PT", name: "Portugal" },
  2642: { googleGeoId: 2642, countryCode: "RO", name: "Romania" },
  2705: { googleGeoId: 2705, countryCode: "SI", name: "Slovenia" },
  2724: { googleGeoId: 2724, countryCode: "ES", name: "Spain" },
  2752: { googleGeoId: 2752, countryCode: "SE", name: "Sweden" },
  2756: { googleGeoId: 2756, countryCode: "CH", name: "Switzerland" },
  2784: { googleGeoId: 2784, countryCode: "AE", name: "United Arab Emirates" },
  2826: { googleGeoId: 2826, countryCode: "GB", name: "United Kingdom" },
  2840: { googleGeoId: 2840, countryCode: "US", name: "United States" },
  2736: { googleGeoId: 2736, countryCode: "SD", name: "Sudan" },
  2900: { googleGeoId: 2900, countryCode: "XK", name: "Kosovo" }
};

countries.registerLocale(enLocale);

export function getGeoTarget(googleGeoId: number): GeoTarget | undefined {
  return GEO_TARGETS[googleGeoId] ?? getIsoCountryGeoTarget(googleGeoId);
}

function getIsoCountryGeoTarget(googleGeoId: number): GeoTarget | undefined {
  const numericCode = googleGeoId - 2000;
  if (!Number.isInteger(numericCode) || numericCode < 1 || numericCode > 999) return undefined;

  const countryCode = countries.numericToAlpha2(String(numericCode).padStart(3, "0"));
  if (!countryCode) return undefined;

  return {
    googleGeoId,
    countryCode,
    name: countries.getName(countryCode, "en") ?? countryCode
  };
}

export function parseSearchCreatives(raw: unknown): ParsedSearchCreatives {
  const response = asRecord(raw);
  const creatives = arrayOf(response["1"]).map((item) => {
    const row = asRecord(item);
    const inlineAssets = extractListAssets(row);
    const timestamps = {
      firstShownAt: parseTimestamp(row["6"]),
      lastShownAt: parseTimestamp(row["7"])
    };

    return {
      advertiserId: stringValue(row["1"]) ?? "",
      creativeId: stringValue(row["2"]) ?? "",
      previewUrl: stringValue(asRecord(asRecord(row["3"])["1"])["4"]),
      format: inferListFormat(row["4"], inlineAssets),
      firstShownAt: timestamps.firstShownAt,
      lastShownAt: timestamps.lastShownAt,
      publicDays: numberValue(row["13"]),
      assets: inlineAssets,
      advertiserName: stringValue(row["12"]),
      raw: item
    };
  }).filter((item) => item.advertiserId && item.creativeId);

  return {
    creatives,
    nextPageToken: stringValue(response["2"]),
    lowerBound: numberValue(response["4"]),
    upperBound: numberValue(response["5"]),
    raw
  };
}

export function parseCreativeDetails(raw: unknown): ParsedCreativeDetails {
  const detail = asRecord(asRecord(raw)["1"]);
  const countries = arrayOf(detail["17"]).map(parseCountryStats);

  return {
    advertiserId: stringValue(detail["1"]) ?? "",
    creativeId: stringValue(detail["2"]) ?? "",
    lastShownAt: parseTimestamp(detail["4"]),
    previewUrls: arrayOf(detail["5"])
      .map((item) => stringValue(asRecord(asRecord(item)["1"])["4"]))
      .filter(isNonEmptyString),
    format: parseFormat(detail["8"]),
    countries,
    totalStats: detail["19"] ? parseTotalStats(detail["19"]) : undefined,
    raw
  };
}

export function parsePreviewContentJs(script: string): ParsedPreviewContent {
  const decoded = decodeEscapedJs(script);
  const rawFields = extractKnownPreviewFields(decoded);
  const embeddedStoreApp = extractEmbeddedStoreApp(decoded);
  const asochStoreApp = extractAsochStoreApp(decoded);
  const fallbackStoreUrl = extractStoreUrl(decoded);
  const landingUrl = cleanUrl(rawFields.destination_url ?? rawFields.landingUrl ?? rawFields.final_url ?? fallbackStoreUrl);
  const storeHint = inferStore(rawFields, landingUrl);
  const appId = normalizePreviewAppId(rawFields.appId, storeHint)
    ?? normalizePreviewAppId(extractAppIdFromStoreUrl(landingUrl), storeHint)
    ?? normalizePreviewAppId(embeddedStoreApp?.appId, storeHint)
    ?? normalizePreviewAppId(asochStoreApp?.appId, storeHint);
  if (appId && !rawFields.appId) rawFields.appId = appId;
  if (!appId) delete rawFields.appId;
  const appName = sanitizePreviewAppName(rawFields.appName)
    ?? sanitizePreviewAppName(embeddedStoreApp?.appName)
    ?? sanitizePreviewAppName(asochStoreApp?.appName);
  if (appName) rawFields.appName = appName;
  else delete rawFields.appName;
  if (landingUrl && !rawFields.landingUrl) rawFields.landingUrl = landingUrl;
  const store = inferStore(rawFields, landingUrl);
  if (store !== "UNKNOWN" && !rawFields.appStoreName) rawFields.appStoreName = store === "GOOGLE_PLAY" ? "Google Play" : "App Store";
  const storeUrl = inferStoreUrl(rawFields, landingUrl);

  return {
    appId,
    appName,
    shortAppName: rawFields.shortAppName,
    store,
    storeUrl,
    landingUrl,
    developer: rawFields.developer,
    category: rawFields.appCategory,
    description: rawFields.description1 ?? rawFields.description ?? rawFields.body,
    shortDescription: rawFields.shortDescription,
    assets: extractPreviewAssets(rawFields),
    rawFields
  };
}

export function normalizeCreative(input: {
  list?: ParsedSearchCreative;
  detail?: ParsedCreativeDetails;
  preview?: ParsedPreviewContent;
}): NormalizedCreative {
  const previewUrls = uniqueStrings([
    input.list?.previewUrl,
    ...(input.detail?.previewUrls ?? [])
  ]);
  const firstShownAt = input.list?.firstShownAt;
  const lastShownAt = input.detail?.lastShownAt ?? input.list?.lastShownAt;
  const detailFormat = input.detail?.format;
  const computedPublicDays = firstShownAt && lastShownAt
    ? Math.max(0, Math.round((lastShownAt.getTime() - firstShownAt.getTime()) / 86_400_000))
    : undefined;
  const wasCollected = Boolean(input.list || input.detail || input.preview);

  return {
    advertiserId: input.detail?.advertiserId || input.list?.advertiserId || "",
    advertiserName: input.list?.advertiserName,
    creativeId: input.detail?.creativeId || input.list?.creativeId || "",
    title: input.preview?.appName,
    description: input.preview?.description,
    format: detailFormat && detailFormat !== "UNKNOWN" ? detailFormat : input.list?.format ?? "UNKNOWN",
    status: wasCollected ? "ACTIVE" : resolveCreativeStatus(lastShownAt),
    previewUrls,
    firstShownAt,
    lastShownAt,
    publicDays: input.detail ? computedPublicDays : input.list?.publicDays ?? computedPublicDays,
    app: input.preview ? {
      appId: input.preview.appId,
      appName: input.preview.appName,
      store: input.preview.store,
      storeUrl: input.preview.storeUrl,
      developer: input.preview.developer,
      category: input.preview.category,
      description: input.preview.description,
      shortDescription: input.preview.shortDescription
    } : undefined,
    countries: input.detail?.countries ?? [],
    totalStats: input.detail?.totalStats,
    assets: input.preview?.assets?.length ? input.preview.assets : input.list?.assets ?? [],
    raw: {
      list: input.list?.raw,
      detail: input.detail?.raw,
      preview: input.preview?.rawFields
    }
  };
}

export function resolveCreativeStatus(lastShownAt?: Date, lastFoundAt?: Date, now = new Date()): CreativeStatus {
  if (lastFoundAt && now.getTime() - lastFoundAt.getTime() <= ACTIVE_LAST_FOUND_WINDOW_MS) return "ACTIVE";
  if (!lastShownAt) return "UNKNOWN";
  return now.getTime() - lastShownAt.getTime() <= ACTIVE_LAST_SHOWN_WINDOW_MS ? "ACTIVE" : "STOPPED";
}

export function extractRpcCalls(exportJson: unknown): RpcCall[] {
  return arrayOf(asRecord(exportJson)["calls"]).flatMap((call) => {
    const row = asRecord(call);
    const url = stringValue(row.url);
    if (!url) return [];

    const match = url.match(/\/anji\/_\/rpc\/([^/]+)\/([^/?]+)/);
    if (!match) return [];

    return [{
      service: match[1],
      method: match[2],
      request: parseFormRequest(row.requestBody),
      response: parseMaybeJson(row.responseBody),
      url,
      raw: call
    }];
  });
}

function parseCountryStats(raw: unknown): CountryStats {
  const row = asRecord(raw);
  const googleGeoId = numberValue(row["1"]) ?? 0;
  const geo = getGeoTarget(googleGeoId);

  return {
    googleGeoId,
    countryCode: geo?.countryCode,
    countryName: geo?.name,
    impressionsMin: numberValue(row["2"]),
    impressionsMax: numberValue(row["3"]),
    firstShownDate: parseGoogleDate(row["4"]),
    lastShownDate: parseGoogleDate(row["5"]),
    placementBreakdown: parsePlacementBreakdown(row["8"]),
    raw
  };
}

function parseTotalStats(raw: unknown): ParsedCreativeDetails["totalStats"] {
  const row = asRecord(raw);
  return {
    impressionsMin: numberValue(row["2"]),
    impressionsMax: numberValue(row["3"]),
    firstShownDate: parseGoogleDate(row["4"]),
    lastShownDate: parseGoogleDate(row["5"]),
    placementBreakdown: parsePlacementBreakdown(row["8"]),
    raw
  };
}

export function parsePlacementBreakdown(raw: unknown): PlacementImpressions[] {
  return arrayOf(raw)
    .flatMap((item) => {
      const row = asRecord(item);
      const code = numberValue(row["1"]);
      if (!code) return [];
      const platform = placementPlatformFromCode(code);
      return [{
        code,
        platform,
        label: placementPlatformLabel(platform, code),
        impressionsMin: numberValue(row["2"]),
        impressionsMax: numberValue(row["3"]),
        raw: item
      }];
    });
}

export function placementPlatformFromCode(code: number): PlacementPlatform {
  switch (code) {
    case 1:
      return "GOOGLE_PLAY";
    case 2:
      return "GOOGLE_MAPS";
    case 3:
      return "GOOGLE_SEARCH";
    case 4:
      return "GOOGLE_SHOPPING";
    case 5:
      return "YOUTUBE";
    default:
      return "UNKNOWN";
  }
}

function placementPlatformLabel(platform: PlacementPlatform, code: number) {
  switch (platform) {
    case "GOOGLE_PLAY":
      return "Google Play";
    case "GOOGLE_MAPS":
      return "Google Maps";
    case "GOOGLE_SEARCH":
      return "Google Search";
    case "GOOGLE_SHOPPING":
      return "Google Shopping";
    case "YOUTUBE":
      return "YouTube";
    default:
      return `Unknown platform ${code}`;
  }
}

function parseTimestamp(value: unknown): Date | undefined {
  const seconds = numberValue(asRecord(value)["1"]);
  return seconds ? new Date(seconds * 1000) : undefined;
}

function parseGoogleDate(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw || !/^\d{8}$/.test(raw)) return undefined;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function parseFormat(value: unknown): CreativeFormat {
  switch (numberValue(value)) {
    case 1:
      return "TEXT";
    case 2:
      return "IMAGE";
    case 3:
      return "VIDEO";
    default:
      return "UNKNOWN";
  }
}

function inferListFormat(value: unknown, assets: PreviewAsset[]): CreativeFormat {
  const parsed = parseFormat(value);
  if (assets.some((asset) => asset.kind === "VIDEO")) return "VIDEO";
  if (assets.some((asset) => asset.kind !== "LANDING_URL")) return "IMAGE";
  return parsed;
}

function extractListAssets(row: Record<string, unknown>): PreviewAsset[] {
  const root = asRecord(row["3"]);
  const candidates = [
    stringValue(asRecord(root["3"])["2"]),
    stringValue(asRecord(root["3"])["1"]),
    stringValue(root["2"]),
    stringValue(root["3"]),
    stringValue(row["3"])
  ].filter(isNonEmptyString);

  const assets: PreviewAsset[] = [];
  for (const source of candidates) {
    const decoded = decodeHtmlEntities(source).replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    for (const match of decoded.matchAll(/<(img|source|video)\b[^>]*\bsrc=(["'])(.*?)\2/gi)) {
      pushAsset(assets, match[1].toLowerCase() === "video" || /googlevideo|youtube|ytimg/i.test(match[3]) ? "VIDEO" : "LANDSCAPE_IMAGE", match[3]);
    }
    for (const match of decoded.matchAll(/https?:\/\/[^"'<>\s\\]+(?:tpc\.googlesyndication\.com|googleusercontent\.com|ytimg\.com|googlevideo\.com)[^"'<>\s\\]*/gi)) {
      pushAsset(assets, /googlevideo|youtube|ytimg/i.test(match[0]) ? "VIDEO" : "LANDSCAPE_IMAGE", match[0]);
    }
  }
  return dedupeAssets(assets);
}

function parseFormRequest(value: unknown): unknown {
  const body = stringValue(value);
  if (!body) return undefined;
  const params = new URLSearchParams(body);
  return parseMaybeJson(params.get("f.req"));
}

function parseMaybeJson(value: unknown): unknown {
  const text = stringValue(value);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function decodeEscapedJs(input: string): string {
  return input
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/\\\//g, "/");
}

function extractKnownPreviewFields(decoded: string): Record<string, string> {
  const fields = [
    "description1",
    "description",
    "body",
    "appStore",
    "appId",
    "landscapeImage",
    "appName",
    "shortAppName",
    "developer",
    "appStoreName",
    "appCategory",
    "shortDescription",
    "destination_url",
    "landingUrl",
    "final_url",
    "appIconHighRes",
    "appIconStandard",
    "coverImage",
    "videoUrl",
    "youtube_video_id"
  ];

  const output: Record<string, string> = {};
  for (const field of fields) {
    const value = extractQuotedValue(decoded, field);
    if (value) output[field] = value;
  }

  for (let index = 1; index <= 10; index += 1) {
    const value = extractQuotedValue(decoded, `screenshot${index}`);
    if (value) output[`screenshot${index}`] = value;
    const width = extractQuotedValue(decoded, `screenshot${index}Width`);
    const height = extractQuotedValue(decoded, `screenshot${index}Height`);
    if (width) output[`screenshot${index}Width`] = width;
    if (height) output[`screenshot${index}Height`] = height;
  }

  return output;
}

function extractQuotedValue(source: string, field: string): string | undefined {
  const pattern = new RegExp(`['"]${escapeRegExp(field)}['"]\\s*:\\s*(['"])((?:\\\\.|(?!\\1).)*?)\\1`);
  const match = source.match(pattern);
  return match?.[2]
    ?.replace(/\\'/g, "'")
    .replace(/\\"/g, "\"")
    .replace(/\\=/g, "=")
    .trim();
}

function inferStore(fields: Record<string, string>, landingUrl?: string, source?: string): AppStore {
  const storeName = `${fields.appStoreName ?? ""} ${fields.destination_url ?? ""} ${fields.landingUrl ?? ""} ${landingUrl ?? ""} ${source ?? ""}`.toLowerCase();
  if (fields.appStore === "2" || storeName.includes("google play") || storeName.includes("play.google.com")) {
    return "GOOGLE_PLAY";
  }
  if (fields.appStore === "1" || storeName.includes("app store") || storeName.includes("apps.apple.com") || storeName.includes("itunes.apple.com")) {
    return "APP_STORE";
  }
  if (/^[a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+$/i.test(fields.appId ?? "")) return "GOOGLE_PLAY";
  if (/^\d{6,}$/.test(fields.appId ?? "")) return "APP_STORE";
  return "UNKNOWN";
}

function inferStoreUrl(fields: Record<string, string>, landingUrl?: string): string | undefined {
  if (landingUrl?.includes("play.google.com") || landingUrl?.includes("apps.apple.com") || landingUrl?.includes("itunes.apple.com")) {
    return landingUrl;
  }
  if (fields.appId && inferStore(fields) === "GOOGLE_PLAY") {
    return `https://play.google.com/store/apps/details?id=${fields.appId}`;
  }
  if (fields.appId && inferStore(fields) === "APP_STORE") {
    return `https://apps.apple.com/app/id${fields.appId}`;
  }
  return undefined;
}

function isBlockedPreviewAppId(appId?: string) {
  const value = appId?.trim() ?? "";
  const lower = value.toLowerCase();
  return /^(window|document|globalthis|google|wiz|json|object|this|self)\./i.test(value)
    || /^(19|20)\d{6}$/.test(value)
    || lower.includes("global_data")
    || lower.includes("wiz_global")
    || lower.includes("googleusercontent")
    || lower.includes("googlesyndication")
    || lower.includes("doubleclick")
    || lower.includes("googleadservices")
    || lower.includes("adstransparency")
    || /(^|\.)(prototype|parentnode|performance|constructor|queryselector|addeventlistener|getattribute|setattribute|appendchild|createelement|classname|innerhtml|textcontent|classlist|dataset|style|length)$/i.test(value);
}

function isLikelyGooglePlayAppId(appId?: string) {
  const value = appId?.trim() ?? "";
  return Boolean(value
    && !isBlockedPreviewAppId(value)
    && /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_-]*)+$/i.test(value));
}

function normalizePreviewAppId(appId?: string, store: AppStore = "UNKNOWN") {
  const value = appId?.trim() ?? "";
  if (!value || isBlockedPreviewAppId(value)) return undefined;
  if (store === "APP_STORE") return /^\d{5,}$/.test(value) ? value : undefined;
  if (store === "GOOGLE_PLAY") return isLikelyGooglePlayAppId(value) ? value : undefined;
  if (/^\d{5,}$/.test(value)) return value;
  return isLikelyGooglePlayAppId(value) ? value : undefined;
}

function sanitizePreviewAppName(value?: string) {
  const normalized = decodeHtmlEntities(value?.replace(/\\u0026/g, "&").replace(/\\&/g, "&").trim() ?? "");
  if (!normalized) return undefined;
  const lower = normalized.toLowerCase();
  if (lower.includes("googleusercontent.com") || lower.includes("window.") || lower.includes("this.") || lower.includes("parentnode")) return undefined;
  if (/^[a-z_$][\w$]*\.(prototype|parentnode|performance|constructor|queryselector|addeventlistener|getattribute|setattribute|appendchild|createelement|classname|innerhtml|textcontent|classlist|dataset|style|length)$/i.test(normalized)) return undefined;
  return normalized;
}

function extractEmbeddedStoreApp(source: string): { appId: string; appName?: string } | undefined {
  const appIdMatch = source.match(/\[\s*(?:2\s*,\s*"([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+)"|1\s*,\s*"(\d{6,})")/i);
  if (!appIdMatch) return undefined;
  const appId = appIdMatch[1];
  const appleAppId = appIdMatch[2];
  const resolvedAppId = appId ?? appleAppId;
  const normalizedAppId = normalizePreviewAppId(resolvedAppId);
  if (!normalizedAppId) return undefined;

  const appIdOffset = (appIdMatch.index ?? 0) + appIdMatch[0].length;
  const afterAppId = source.slice(appIdOffset, appIdOffset + 800);
  const appName = [...afterAppId.matchAll(/"([^"\\]{3,120})"/g)]
    .map((match) => match[1].trim())
    .find((value) => value && value !== normalizedAppId && !/[{}[\]]/.test(value) && !value.startsWith(":") && !value.startsWith("//") && sanitizePreviewAppName(value) && !isLikelyGooglePlayAppId(value));

  return { appId: normalizedAppId, appName: sanitizePreviewAppName(appName) ?? extractEmbeddedStoreTitle(source) };
}

function extractEmbeddedStoreTitle(source: string): string | undefined {
  const match = source.match(/"((?:\\.|[^"\\]){3,200})"\s*,\s*"(?:play\.google\.com\/store|itunes\.apple\.com\/|apps\.apple\.com\/)"/i);
  return decodeHtmlEntities(match?.[1]?.replace(/\\u0026/g, "&").replace(/\\&/g, "&").trim() ?? "") || undefined;
}

function extractAsochStoreApp(source: string): { appId?: string; appName?: string } | undefined {
  const appName = decodeHtmlEntities(
    source.match(/data-asoch-targets=["']ad0,ochAppName["'][^>]*>\s*([^<]{2,200})\s*</i)?.[1]?.trim() ?? ""
  ) || undefined;

  const ad0Index = source.indexOf('"ad0"');
  const ad0Block = ad0Index >= 0 ? source.slice(ad0Index, ad0Index + 4000) : source;
  const appId = ad0Block.match(/\[null\s*,\s*"\s*"\s*,\s*"\s*"\s*,\s*"([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+|\d{6,})"/i)?.[1]
    ?? source.match(/(?:appId|app_id|package_name|package|docid)["']?\s*[:=]\s*["']?([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+|\d{8,})/i)?.[1];

  const normalizedAppId = normalizePreviewAppId(appId);
  const normalizedAppName = sanitizePreviewAppName(appName);
  if (!normalizedAppId && !normalizedAppName) return undefined;
  return { appId: normalizedAppId, appName: normalizedAppName };
}

function extractStoreUrl(source: string): string | undefined {
  const htmlDecoded = decodeHtmlEntities(source);
  const direct = htmlDecoded.match(/https?:\/\/(?:play\.google\.com\/store\/apps\/details\?id=[^"'&<\\\s]+|apps\.apple\.com\/[^"'&<\\\s]+|itunes\.apple\.com\/[^"'&<\\\s]+)/i)?.[0];
  if (direct) return direct;

  const encoded = htmlDecoded.match(/https?%3A%2F%2F(?:play\.google\.com%2Fstore%2Fapps%2Fdetails%3Fid%3D[^"'&<\\\s]+|apps\.apple\.com%2F[^"'&<\\\s]+|itunes\.apple\.com%2F[^"'&<\\\s]+)/i)?.[0];
  return encoded ? decodeURIComponent(encoded) : undefined;
}

function extractAppIdFromStoreUrl(storeUrl?: string): string | undefined {
  if (!storeUrl) return undefined;
  try {
    const url = new URL(storeUrl);
    if (url.hostname.includes("play.google.com")) return url.searchParams.get("id") ?? undefined;
    const appleId = url.pathname.match(/\/id(\d+)/)?.[1];
    return appleId;
  } catch {
    return undefined;
  }
}

function extractPreviewAssets(fields: Record<string, string>): PreviewAsset[] {
  const assets: PreviewAsset[] = [];
  pushAsset(assets, "LANDSCAPE_IMAGE", fields.landscapeImage);
  pushAsset(assets, "APP_ICON", fields.appIconHighRes ?? fields.appIconStandard);
  pushAsset(assets, "COVER_IMAGE", fields.coverImage);
  pushAsset(assets, "VIDEO", fields.videoUrl);
  if (fields.youtube_video_id) {
    pushAsset(assets, "VIDEO", `https://www.youtube.com/watch?v=${fields.youtube_video_id}`);
  }
  for (let index = 1; index <= 10; index += 1) {
    pushAsset(
      assets,
      "SCREENSHOT",
      fields[`screenshot${index}`],
      numberValue(fields[`screenshot${index}Width`]),
      numberValue(fields[`screenshot${index}Height`])
    );
  }
  pushAsset(assets, "LANDING_URL", fields.destination_url ?? fields.landingUrl ?? fields.final_url);
  return dedupeAssets(assets);
}

function pushAsset(assets: PreviewAsset[], kind: PreviewAsset["kind"], rawUrl?: string, width?: number, height?: number): void {
  const url = cleanUrl(rawUrl, kind);
  if (!url) return;
  assets.push({ kind, url, width, height });
}

function cleanUrl(rawUrl?: string, kind?: PreviewAsset["kind"]): string | undefined {
  if (!rawUrl) return undefined;
  const normalized = decodeHtmlEntities(rawUrl).replace(/\\=/g, "=").trim();
  if (!normalized) return undefined;
  const withProtocol = normalized.startsWith("//") ? `https:${normalized}` : normalized;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (shouldDropAssetUrl(url, kind)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function shouldDropAssetUrl(url: URL, kind?: PreviewAsset["kind"]) {
  if (!kind || kind === "LANDING_URL") return false;
  return url.hostname === "displayads-formats.googleusercontent.com"
    && url.pathname === "/ads/preview/content.js";
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function dedupeAssets(assets: PreviewAsset[]): PreviewAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.kind}:${asset.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter(isNonEmptyString))];
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value && value.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
