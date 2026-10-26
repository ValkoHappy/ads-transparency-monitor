const MEDIA_ASSET_KINDS = new Set(["LANDSCAPE_IMAGE", "APP_ICON", "SCREENSHOT", "COVER_IMAGE", "VIDEO"]);
const GOOGLE_PREVIEW_SCRIPT_HOST = "displayads-formats.googleusercontent.com";
const GOOGLE_PREVIEW_SCRIPT_PATH = "/ads/preview/content.js";

export function safeExternalHttpUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function isPreviewMediaAsset(asset: { kind?: string | null; url?: string | null }) {
  return Boolean(
    asset.kind
    && MEDIA_ASSET_KINDS.has(asset.kind)
    && safeExternalHttpUrl(asset.url)
    && !isGooglePreviewScriptUrl(asset.url)
  );
}

function isGooglePreviewScriptUrl(value?: string | null) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.hostname === GOOGLE_PREVIEW_SCRIPT_HOST && url.pathname === GOOGLE_PREVIEW_SCRIPT_PATH;
  } catch {
    return false;
  }
}
