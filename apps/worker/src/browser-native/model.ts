import { type ParsedSearchCreatives } from "@ad-monitor/core";

export type SearchPage = ParsedSearchCreatives & { consumed?: boolean };

export type BrowserNativeDomCreative =
  ParsedSearchCreatives["creatives"][number] & {
    raw: {
      browserNativeDom: true;
      source: string;
      creativeUrl?: string;
      appId?: string;
      appName?: string;
      store?: "GOOGLE_PLAY" | "APP_STORE" | "UNKNOWN";
      storeUrl?: string;
      title?: string;
      description?: string;
      assets?: Array<{
        kind:
          | "LANDSCAPE_IMAGE"
          | "APP_ICON"
          | "SCREENSHOT"
          | "COVER_IMAGE"
          | "VIDEO"
          | "LANDING_URL";
        url: string;
      }>;
    };
  };

export type BrowserNativeFramePayload = Omit<
  BrowserNativeDomCreative["raw"],
  "browserNativeDom" | "creativeUrl"
> & {
  creativeUrl?: string;
};

export type BrowserNativeFrameOwner = {
  creativeId?: string;
  creativeUrl?: string;
  previewUrl?: string;
};

export type DomCreativeContentInput = {
  previewUrl?: string;
  raw: Pick<
    BrowserNativeDomCreative["raw"],
    "assets" | "storeUrl" | "appId" | "appName" | "title" | "description"
  >;
};

export type VisibleCollectionState = {
  ranks: Record<
    string,
    { priority: number; top: number; ready: boolean; visible: boolean }
  >;
  visible: Array<{
    id: string;
    ready: boolean;
    processed: boolean;
    cleared: boolean;
    top: number;
    bottom: number;
  }>;
  visibleReadyUnprocessed: number;
  visibleUnprocessed: number;
  visibleProcessed: number;
  error?: string;
};

export type FocusCreativeState = {
  found: boolean;
  ready: boolean;
  visible: boolean;
  top: number;
  bottom: number;
  y: number;
  visibleCards: number;
  error?: string;
};
