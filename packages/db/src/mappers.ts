import type { AppStore, CreativeFormat, CreativeStatus, NormalizedCreative, PreviewAsset } from "@ad-monitor/core";

export interface ParsedAdvertiserInput {
  googleAdvertiserId: string;
  transparencyUrl: string;
}

export interface CreativePersistenceModel {
  creative: {
    creativeId: string;
    title?: string;
    description?: string;
    format: CreativeFormat;
    status: CreativeStatus;
    previewUrl?: string;
    firstShownAt?: Date;
    lastShownAt?: Date;
    publicDays?: number;
    impressionsMin?: number;
    impressionsMax?: number;
    rawList?: unknown;
    rawDetail?: unknown;
    detailFetchedAt?: Date;
    rawPreview?: unknown;
  };
  app?: {
    where: { store_appId: { store: AppStore; appId: string } };
    create: {
      store: AppStore;
      appId: string;
      storeUrl?: string;
      name?: string;
      developer?: string;
      category?: string;
      description?: string;
      shortDescription?: string;
    };
    update: {
      storeUrl?: string;
      name?: string;
      developer?: string;
      category?: string;
      description?: string;
      shortDescription?: string;
      lastSeenAt: Date;
    };
  };
  assets: Array<{
    kind: PreviewAsset["kind"];
    url: string;
    width?: number;
    height?: number;
  }>;
  countries: Array<{
    googleGeoId: number;
    countryCode?: string;
    countryName?: string;
    impressionsMin?: number;
    impressionsMax?: number;
    firstShownDate?: string;
    lastShownDate?: string;
    raw?: unknown;
  }>;
  rawSnapshots: SnapshotPersistenceModel[];
}

type SnapshotPersistenceModel = {
    kind: "SEARCH_CREATIVES" | "CREATIVE_DETAIL" | "PREVIEW_SCRIPT";
    payload: unknown;
};

export function parseAdvertiserInput(input: string): ParsedAdvertiserInput {
  const trimmed = input.trim();
  const match = trimmed.match(/(AR\d{8,})/);
  if (!match) {
    throw new Error("Advertiser ID must look like AR14577439029227159553 or a Transparency Center advertiser URL.");
  }

  const googleAdvertiserId = match[1];
  return {
    googleAdvertiserId,
    transparencyUrl: `https://adstransparency.google.com/advertiser/${googleAdvertiserId}`
  };
}

export function buildCreativePersistenceModel(normalized: NormalizedCreative): CreativePersistenceModel {
  const appId = normalized.app?.appId;
  const store = normalized.app?.store ?? "UNKNOWN";
  const rawSnapshots: SnapshotPersistenceModel[] = [];
  if (normalized.raw.list) rawSnapshots.push({ kind: "SEARCH_CREATIVES", payload: normalized.raw.list });
  if (normalized.raw.detail) rawSnapshots.push({ kind: "CREATIVE_DETAIL", payload: normalized.raw.detail });
  if (normalized.raw.preview) rawSnapshots.push({ kind: "PREVIEW_SCRIPT", payload: normalized.raw.preview });
  const detailFetchedAt = normalized.raw.detail ? new Date() : undefined;

  return {
    creative: {
      creativeId: normalized.creativeId,
      title: normalized.title,
      description: normalized.description,
      format: normalized.format,
      status: normalized.status,
      previewUrl: normalized.previewUrls[0],
      firstShownAt: normalized.firstShownAt,
      lastShownAt: normalized.lastShownAt,
      publicDays: normalized.publicDays,
      impressionsMin: normalized.totalStats?.impressionsMin,
      impressionsMax: normalized.totalStats?.impressionsMax,
      rawList: normalized.raw.list,
      rawDetail: normalized.raw.detail,
      detailFetchedAt,
      rawPreview: normalized.raw.preview
    },
    app: appId ? {
      where: { store_appId: { store, appId } },
      create: {
        store,
        appId,
        storeUrl: normalized.app?.storeUrl,
        name: normalized.app?.appName,
        developer: normalized.app?.developer,
        category: normalized.app?.category,
        description: normalized.app?.description,
        shortDescription: normalized.app?.shortDescription
      },
      update: {
        storeUrl: normalized.app?.storeUrl,
        name: normalized.app?.appName,
        developer: normalized.app?.developer,
        category: normalized.app?.category,
        description: normalized.app?.description,
        shortDescription: normalized.app?.shortDescription,
        lastSeenAt: new Date()
      }
    } : undefined,
    assets: normalized.assets.map((asset) => ({
      kind: asset.kind,
      url: asset.url,
      width: asset.width,
      height: asset.height
    })),
    countries: normalized.countries.map((country) => ({
      googleGeoId: country.googleGeoId,
      countryCode: country.countryCode,
      countryName: country.countryName,
      impressionsMin: country.impressionsMin,
      impressionsMax: country.impressionsMax,
      firstShownDate: country.firstShownDate,
      lastShownDate: country.lastShownDate,
      raw: country.raw
    })),
    rawSnapshots
  };
}
