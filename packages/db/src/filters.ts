import type { Prisma } from "./generated/prisma/client.js";

export const EXPORT_FIELDS = [
  "creativeId",
  "advertiserId",
  "advertiserName",
  "appId",
  "appName",
  "store",
  "format",
  "status",
  "countries",
  "firstShownAt",
  "lastShownAt",
  "publicDays",
  "impressions",
  "previewUrl"
] as const;

export type ExportField = typeof EXPORT_FIELDS[number];
export type DateField = "firstShownAt" | "lastShownAt" | "firstFoundAt" | "lastFoundAt" | "updatedAt" | "createdAt";
export type CreativeActivity = "NEW_TODAY" | "DISAPPEARED";

const MAX_FILTER_TEXT_LENGTH = 120;
const MAX_CREATIVE_ID_FILTERS = 500;
const MAX_COUNTRY_FILTERS = 300;

export interface CreativeFilters {
  advertiserId?: string;
  creativeIds?: string[];
  country?: string;
  countries?: string[];
  status?: "ACTIVE" | "STOPPED" | "UNKNOWN";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "UNKNOWN";
  store?: "GOOGLE_PLAY" | "APP_STORE" | "UNKNOWN";
  appId?: string;
  appName?: string;
  developer?: string;
  advertiserName?: string;
  q?: string;
  activity?: CreativeActivity;
  dateField?: DateField;
  dateFrom?: string;
  dateTo?: string;
  updatedSince?: string;
  firstShownSince?: string;
  lastShownSince?: string;
  hasTitle?: boolean;
  hasDescription?: boolean;
  hasGeo?: boolean;
  hasVideo?: boolean;
  hasImage?: boolean;
  hasApp?: boolean;
  hasDetails?: boolean;
  hasPreview?: boolean;
  hasAssets?: boolean;
  minPublicDays?: number;
}

export function parseCreativeFilters(searchParams: URLSearchParams): CreativeFilters {
  return {
    advertiserId: clean(searchParams.get("advertiserId")),
    creativeIds: parseListValues(searchParams.getAll("creativeIds"), MAX_CREATIVE_ID_FILTERS),
    country: clean(searchParams.get("country"))?.toUpperCase(),
    countries: parseListValues(searchParams.getAll("countries"), MAX_COUNTRY_FILTERS).map((item) => item.toUpperCase()),
    status: enumValue(searchParams.get("status"), ["ACTIVE", "STOPPED", "UNKNOWN"]),
    format: enumValue(searchParams.get("format"), ["TEXT", "IMAGE", "VIDEO", "UNKNOWN"]),
    store: enumValue(searchParams.get("store"), ["GOOGLE_PLAY", "APP_STORE", "UNKNOWN"]),
    appId: clean(searchParams.get("appId")),
    appName: clean(searchParams.get("appName")),
    developer: clean(searchParams.get("developer")),
    advertiserName: clean(searchParams.get("advertiserName")),
    q: clean(searchParams.get("q")),
    activity: enumValue(searchParams.get("activity"), ["NEW_TODAY", "DISAPPEARED"]) ?? undefined,
    dateField: enumValue(searchParams.get("dateField"), ["firstShownAt", "lastShownAt", "firstFoundAt", "lastFoundAt", "updatedAt", "createdAt"]) ?? undefined,
    dateFrom: cleanDate(searchParams.get("dateFrom")),
    dateTo: cleanDate(searchParams.get("dateTo")),
    updatedSince: cleanDate(searchParams.get("updatedSince")),
    firstShownSince: cleanDate(searchParams.get("firstShownSince")),
    lastShownSince: cleanDate(searchParams.get("lastShownSince")),
    hasTitle: booleanValue(searchParams.get("hasTitle")),
    hasDescription: booleanValue(searchParams.get("hasDescription")),
    hasGeo: booleanValue(searchParams.get("hasGeo")),
    hasVideo: booleanValue(searchParams.get("hasVideo")),
    hasImage: booleanValue(searchParams.get("hasImage")),
    hasApp: booleanValue(searchParams.get("hasApp")),
    hasDetails: booleanValue(searchParams.get("hasDetails")),
    hasPreview: booleanValue(searchParams.get("hasPreview")),
    hasAssets: booleanValue(searchParams.get("hasAssets")),
    minPublicDays: intValue(searchParams.get("minPublicDays"))
  };
}

export function buildCreativeWhere(filters: CreativeFilters): Prisma.CreativeWhereInput {
  const normalized = normalizeCreativeFilters(filters);
  const dateField = normalized.dateField ?? "updatedAt";
  const dateRange = buildDateRange(normalized.dateFrom, normalized.dateTo);
  const activityRange = buildActivityWhere(normalized.activity);
  const countryCodes = normalized.country
    ? [normalized.country]
    : normalized.countries?.length
      ? normalized.countries
      : undefined;
  const assetKinds = [
    ...(normalized.hasVideo ? ["VIDEO"] : []),
    ...(normalized.hasImage ? ["LANDSCAPE_IMAGE", "APP_ICON", "SCREENSHOT", "COVER_IMAGE"] : [])
  ];
  const appWhere = stripUndefined({
    store: normalized.store,
    OR: normalized.appId ? [
      { appId: { contains: normalized.appId, mode: "insensitive" as const } },
      { name: { contains: normalized.appId, mode: "insensitive" as const } }
    ] : undefined,
    name: normalized.appName ? { contains: normalized.appName, mode: "insensitive" as const } : undefined,
    developer: normalized.developer ? { contains: normalized.developer, mode: "insensitive" as const } : undefined
  }) as Prisma.AppWhereInput;
  const andFilters: Prisma.CreativeWhereInput[] = [
    ...textPresenceWhere("title", normalized.hasTitle),
    ...textPresenceWhere("description", normalized.hasDescription)
  ];

  return stripUndefined({
    advertiserId: normalized.advertiserId,
    creativeId: normalized.creativeIds?.length ? { in: normalized.creativeIds } : undefined,
    status: normalized.status ?? activityRange.status,
    format: normalized.format,
    firstFoundAt: activityRange.firstFoundAt,
    publicDays: normalized.minPublicDays !== undefined ? { gte: normalized.minPublicDays } : undefined,
    countries: countryCodes?.length
      ? { some: { countryCode: { in: countryCodes } } }
      : normalized.hasGeo === true
        ? { some: {} }
        : normalized.hasGeo === false
          ? { none: {} }
          : undefined,
    appDbId: normalized.hasApp === true ? { not: null } : normalized.hasApp === false ? null : undefined,
    detailFetchedAt: normalized.hasDetails === true ? { not: null } : normalized.hasDetails === false ? null : undefined,
    previewUrl: normalized.hasPreview === true ? { not: null } : normalized.hasPreview === false ? null : undefined,
    AND: andFilters.length ? andFilters : undefined,
    app: Object.keys(appWhere).length ? appWhere : undefined,
    advertiser: normalized.advertiserName ? { name: { contains: normalized.advertiserName, mode: "insensitive" } } : undefined,
    assets: assetKinds.length
      ? { some: { kind: { in: assetKinds as any } } }
      : normalized.hasAssets === true
        ? { some: {} }
        : normalized.hasAssets === false
          ? { none: {} }
          : undefined,
    OR: normalized.q ? [
      { creativeId: { contains: normalized.q, mode: "insensitive" } },
      { advertiser: { name: { contains: normalized.q, mode: "insensitive" } } },
      { advertiser: { googleAdvertiserId: { contains: normalized.q, mode: "insensitive" } } },
      { app: { appId: { contains: normalized.q, mode: "insensitive" } } },
      { app: { name: { contains: normalized.q, mode: "insensitive" } } },
      { app: { developer: { contains: normalized.q, mode: "insensitive" } } },
        { title: { contains: normalized.q, mode: "insensitive" } },
        { description: { contains: normalized.q, mode: "insensitive" } }
    ] : undefined,
    [dateField]: dateRange,
    updatedAt: mergeDateRanges(dateField === "updatedAt" ? dateRange : undefined, buildDateRange(normalized.updatedSince)),
    firstShownAt: mergeDateRanges(dateField === "firstShownAt" ? dateRange : undefined, buildDateRange(normalized.firstShownSince)),
    lastShownAt: mergeDateRanges(dateField === "lastShownAt" ? dateRange : undefined, buildDateRange(normalized.lastShownSince))
  });
}

export function resolveExportFields(value?: string | string[] | null): ExportField[] {
  const requested = Array.isArray(value) ? value : parseList(value ?? undefined);
  if (!requested.length) return [...EXPORT_FIELDS];
  return EXPORT_FIELDS.filter((field) => requested.includes(field));
}

function buildDateRange(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    gte: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
    lte: to ? new Date(`${to}T23:59:59.999Z`) : undefined
  };
}

function mergeDateRanges(base?: { gte?: Date; lte?: Date }, extra?: { gte?: Date; lte?: Date }) {
  if (!base) return extra;
  if (!extra) return base;
  return {
    gte: extra.gte ?? base.gte,
    lte: extra.lte ?? base.lte
  };
}

function buildActivityWhere(activity?: CreativeActivity): Prisma.CreativeWhereInput {
  if (activity === "DISAPPEARED") return { status: "STOPPED" };
  if (activity === "NEW_TODAY") {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    return { firstFoundAt: { gte: from } };
  }
  return {};
}

function clean(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "ALL") return undefined;
  return trimmed.slice(0, MAX_FILTER_TEXT_LENGTH);
}

function parseList(value?: string | null) {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseListValues(values: string[], max = MAX_CREATIVE_ID_FILTERS) {
  return values
    .flatMap((value) => parseList(value))
    .map((item) => item.slice(0, MAX_FILTER_TEXT_LENGTH))
    .slice(0, max);
}

function enumValue<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  const cleaned = clean(value);
  return allowed.includes(cleaned as T) ? cleaned as T : undefined;
}

function booleanValue(value: string | null) {
  const cleaned = clean(value);
  if (cleaned === "true" || cleaned === "1" || cleaned === "yes") return true;
  if (cleaned === "false" || cleaned === "0" || cleaned === "no") return false;
  return undefined;
}

function intValue(value: string | null) {
  const cleaned = clean(value);
  if (!cleaned || !/^\d+$/.test(cleaned)) return undefined;
  return Number(cleaned);
}

function normalizeCreativeFilters(filters: CreativeFilters): CreativeFilters {
  return {
    advertiserId: clean(filters.advertiserId ?? null),
    creativeIds: filters.creativeIds?.filter(Boolean).map((item) => item.slice(0, MAX_FILTER_TEXT_LENGTH)).slice(0, MAX_CREATIVE_ID_FILTERS),
    country: clean(filters.country ?? null)?.toUpperCase(),
    countries: filters.countries?.filter(Boolean).map((item) => item.slice(0, MAX_FILTER_TEXT_LENGTH).toUpperCase()).slice(0, MAX_COUNTRY_FILTERS),
    status: filters.status,
    format: filters.format,
    store: filters.store,
    appId: clean(filters.appId ?? null),
    appName: clean(filters.appName ?? null),
    developer: clean(filters.developer ?? null),
    advertiserName: clean(filters.advertiserName ?? null),
    q: clean(filters.q ?? null),
    activity: filters.activity,
    dateField: filters.dateField,
    dateFrom: cleanDate(filters.dateFrom ?? null),
    dateTo: cleanDate(filters.dateTo ?? null),
    updatedSince: cleanDate(filters.updatedSince ?? null),
    firstShownSince: cleanDate(filters.firstShownSince ?? null),
    lastShownSince: cleanDate(filters.lastShownSince ?? null),
    hasTitle: filters.hasTitle,
    hasDescription: filters.hasDescription,
    hasGeo: filters.hasGeo,
    hasVideo: filters.hasVideo,
    hasImage: filters.hasImage,
    hasApp: filters.hasApp,
    hasDetails: filters.hasDetails,
    hasPreview: filters.hasPreview,
    hasAssets: filters.hasAssets,
    minPublicDays: typeof filters.minPublicDays === "number" && Number.isFinite(filters.minPublicDays)
      ? Math.max(0, Math.floor(filters.minPublicDays))
      : undefined
  };
}

function cleanDate(value: string | null) {
  const cleaned = clean(value);
  if (!cleaned || !/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return undefined;
  const [year, month, day] = cleaned.split("-").map(Number);
  const date = new Date(`${cleaned}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? cleaned
    : undefined;
}

function textPresenceWhere(field: "title" | "description", flag?: boolean): Prisma.CreativeWhereInput[] {
  if (flag === undefined) return [];
  return flag
    ? [
      { [field]: { not: null } },
      { NOT: { [field]: "" } }
    ] as Prisma.CreativeWhereInput[]
    : [
      {
        OR: [
          { [field]: null },
          { [field]: "" }
        ]
      }
    ] as Prisma.CreativeWhereInput[];
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}
