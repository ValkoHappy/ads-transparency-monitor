import {
  BrowserNativeDomCreative,
  BrowserNativeFramePayload,
  BrowserNativeFrameOwner,
} from "./model.js";
import { decodeBase64UrlText, normalizeStoreAppId } from "./normalization.js";

export function extractDomCreatives(
  advertiserId?: string,
): BrowserNativeDomCreative[] {
  type DomAsset = NonNullable<
    BrowserNativeDomCreative["raw"]["assets"]
  >[number];

  const decode = (value: string) => {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    const htmlDecoded = textarea.value
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/");
    try {
      return decodeURIComponent(htmlDecoded);
    } catch {
      return htmlDecoded;
    }
  };

  const absoluteUrl = (value?: string | null) => {
    if (!value) return undefined;
    const cleaned = decode(value.trim());
    if (!cleaned || cleaned.startsWith("data:")) return undefined;
    try {
      const url = new URL(cleaned, location.origin);
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.href
        : undefined;
    } catch {
      return undefined;
    }
  };

  const blockedDomText = (value?: string) => {
    const text = value?.replace(/\s+/g, " ").trim() ?? "";
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
  };

  const cleanDomText = (value?: string) => {
    const text = value?.replace(/\s+/g, " ").trim();
    return text && !blockedDomText(text) ? text : undefined;
  };

  const text = (root: Element, selectors: string[]) => {
    for (const selector of selectors) {
      const value = cleanDomText(
        root.querySelector(selector)?.textContent ?? undefined,
      );
      if (value) return value;
    }
    return undefined;
  };

  const extractCreativeId = (source: string) => source.match(/CR\d{10,}/)?.[0];

  const extractStoreUrl = (source: string) => {
    const decoded = decode(source);
    const direct = decoded.match(
      /https?:\/\/(?:play\.google\.com\/store\/apps\/details\?id=[^"'<>\s\\]+|apps\.apple\.com\/[^"'<>\s\\]+|itunes\.apple\.com\/[^"'<>\s\\]+)/i,
    )?.[0];
    if (direct) return direct;
    const market = decoded.match(
      /market:\/\/details\?id=([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+)/i,
    )?.[0];
    return market
      ? `https://play.google.com/store/apps/details?id=${market.match(/id=([^&]+)/)?.[1]}`
      : undefined;
  };

  const storeFromUrl = (storeUrl?: string) => {
    const lower = storeUrl?.toLowerCase() ?? "";
    if (lower.includes("play.google.com") || lower.startsWith("market://"))
      return "GOOGLE_PLAY" as const;
    if (lower.includes("apps.apple.com") || lower.includes("itunes.apple.com"))
      return "APP_STORE" as const;
    return "UNKNOWN" as const;
  };
  const storeFromSource = (source: string, storeUrl?: string) => {
    const byUrl = storeFromUrl(storeUrl);
    if (byUrl !== "UNKNOWN") return byUrl;
    const lower = source.toLowerCase();
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
  };

  const appIdFromUrl = (storeUrl?: string) => {
    if (!storeUrl) return undefined;
    try {
      const url = new URL(storeUrl);
      if (url.hostname.includes("play.google.com"))
        return url.searchParams.get("id") ?? undefined;
      return url.pathname.match(/\/id(\d+)/)?.[1];
    } catch {
      return (
        storeUrl.match(/[?&]id=([^&\s]+)/)?.[1] ??
        storeUrl.match(/\/id(\d+)/)?.[1]
      );
    }
  };
  const normalizeAppId = (appId?: string, store?: string) => {
    const value = appId?.trim() ?? "";
    const lower = value.toLowerCase();
    if (
      !value ||
      /^(window|document|globalthis|google|wiz|json|object|this|self)\./i.test(
        value,
      ) ||
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
    )
      return undefined;
    if (store === "APP_STORE")
      return /^\d{5,}$/.test(value) ? value : undefined;
    if (store === "GOOGLE_PLAY")
      return /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_-]*)+$/i.test(value)
        ? value
        : undefined;
    return /^\d{5,}$/.test(value) ||
      /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_-]*)+$/i.test(value)
      ? value
      : undefined;
  };
  const appIdFromSource = (source: string, store?: string) => {
    const decoded = decode(source);
    if (store === "APP_STORE" || store === "UNKNOWN") {
      const apple =
        decoded.match(
          /(?:App Store|itunes|apps\.apple|adamId|App Store TDI)[^\d]{0,80}(\d{6,})/i,
        ) ?? decoded.match(/\bid(\d{6,})\b/i);
      const value = normalizeAppId(apple?.[1], "APP_STORE");
      if (value) return value;
    }
    if (store === "GOOGLE_PLAY" || store === "UNKNOWN") {
      const play =
        decoded.match(
          /(?:Google Play|play\.google|market:\/\/details|package_name|docid|appId)[^a-zA-Z0-9_]{0,80}([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+)/i,
        ) ?? decoded.match(/\b([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+){2,})\b/i);
      const value = normalizeAppId(play?.[1], "GOOGLE_PLAY");
      if (value) return value;
    }
    return undefined;
  };

  const pushAsset = (
    assets: DomAsset[],
    kind: DomAsset["kind"],
    rawUrl?: string | null,
  ) => {
    const url = absoluteUrl(rawUrl);
    if (url) assets.push({ kind, url });
  };

  const extractAssets = (root: Element, source: string) => {
    const assets: DomAsset[] = [];
    root
      .querySelectorAll("img[src]")
      .forEach((item) =>
        pushAsset(assets, "LANDSCAPE_IMAGE", item.getAttribute("src")),
      );
    root
      .querySelectorAll("video[src], source[src]")
      .forEach((item) => pushAsset(assets, "VIDEO", item.getAttribute("src")));
    root.querySelectorAll("[style*='url(']").forEach((item) => {
      const match = item.getAttribute("style")?.match(/url\((['"]?)(.*?)\1\)/i);
      pushAsset(assets, "LANDSCAPE_IMAGE", match?.[2]);
    });
    for (const match of decode(source).matchAll(
      /https?:\/\/[^"'<>\s\\]+(?:googleusercontent\.com|ytimg\.com|ggpht\.com|googlevideo\.com)[^"'<>\s\\]*/gi,
    )) {
      pushAsset(
        assets,
        /googlevideo|youtube|ytimg/i.test(match[0])
          ? "VIDEO"
          : "LANDSCAPE_IMAGE",
        match[0],
      );
    }
    const storeUrl = extractStoreUrl(source);
    pushAsset(assets, "LANDING_URL", storeUrl);
    const seen = new Set<string>();
    return assets.filter((asset) => {
      const key = `${asset.kind}:${asset.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const roots = [
    ...document.querySelectorAll(
      "creative-preview, [class*='creative-preview'], .creative-bounding-box, .mys-wrapper, c-wiz[data-p], material-card",
    ),
    ...[...document.querySelectorAll("a[href*='/creative/']")].map(
      (item) =>
        item.closest(
          "creative-preview, material-card, c-wiz, .creative-bounding-box, .mys-wrapper",
        ) ?? item,
    ),
  ];

  const output = new Map<string, BrowserNativeDomCreative>();
  for (const root of roots) {
    const html = (root as HTMLElement).outerHTML ?? "";
    const bodyText = root.textContent ?? "";
    const creativeUrl =
      absoluteUrl(
        root.querySelector("a[href*='/creative/']")?.getAttribute("href"),
      ) ?? absoluteUrl((root as HTMLAnchorElement).href);
    const creativeId = extractCreativeId(
      `${creativeUrl ?? ""} ${bodyText} ${html}`,
    );
    if (!creativeId) continue;

    const storeIndicator = root.querySelector(
      ".app-store-container svg, [data-asoch-targets*='ochAppStore']",
    );
    const storeUrl =
      extractStoreUrl(html) ??
      absoluteUrl(storeIndicator?.closest("a")?.getAttribute("href")) ??
      absoluteUrl(
        root
          .querySelector(
            "a[href*='play.google.com'], a[href*='apps.apple.com'], a[href*='itunes.apple.com'], a[href^='market://']",
          )
          ?.getAttribute("href"),
      );
    const store = storeFromSource(`${bodyText} ${html}`, storeUrl);
    const appId = normalizeAppId(
      appIdFromUrl(storeUrl) ?? appIdFromSource(`${bodyText} ${html}`, store),
      store,
    );
    const appName = text(root, [
      ".short-app-name a",
      ".end-frame-app-name span",
      ".end-frame-app-name-v0 span",
      "[data-asoch-targets*='ochAppName']",
      "[data-asoch-targets*='ochEndCardAppName']",
      ".app-name",
      "[aria-label*='Google Play']",
    ]);
    const description = text(root, [
      ".headline [dir='auto']",
      ".headline",
      "[data-asoch-targets*='ochBody']",
      "[data-asoch-targets*='ochDescription']",
      ".description",
      ".app-description",
    ]);
    const assets = extractAssets(root, html);
    const previewUrl = absoluteUrl(
      root
        .querySelector(
          "iframe[src*='googleusercontent'], iframe[src*='preview']",
        )
        ?.getAttribute("src"),
    );
    const hasVideo =
      assets.some((asset) => asset.kind === "VIDEO") ||
      Boolean(
        root.querySelector(
          "video, iframe[src*='youtube'], [aria-label*='video' i]",
        ),
      );

    output.set(creativeId, {
      advertiserId: advertiserId ?? "",
      creativeId,
      previewUrl,
      format: hasVideo
        ? "VIDEO"
        : assets.some((asset) => asset.kind !== "LANDING_URL")
          ? "IMAGE"
          : "UNKNOWN",
      raw: {
        browserNativeDom: true,
        source: "dom_card",
        creativeUrl,
        appId,
        appName,
        store,
        storeUrl,
        title: appName,
        description,
        assets,
      },
    });
  }

  return [...output.values()];
}

export function extractFrameOwner(element: Element): BrowserNativeFrameOwner {
  const extractCreativeId = (source: string) =>
    (String(source || "").match(/CR\d{10,}/) || [])[0];
  const decode = (value: string) => {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    const htmlDecoded = textarea.value
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/");
    try {
      return decodeURIComponent(htmlDecoded);
    } catch {
      return htmlDecoded;
    }
  };
  const absoluteUrl = (value?: string | null) => {
    if (!value) return undefined;
    const cleaned = decode(value.trim());
    if (!cleaned || cleaned.startsWith("data:")) return undefined;
    try {
      const url = new URL(cleaned, location.origin);
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.href
        : undefined;
    } catch {
      return undefined;
    }
  };
  const owner =
    element.closest(
      "creative-preview, [class*='creative-preview'], .creative-bounding-box, .mys-wrapper, c-wiz[data-p], material-card, a[href*='/creative/']",
    ) ?? element;
  const html = (owner as HTMLElement).outerHTML ?? "";
  const bodyText = owner.textContent ?? "";
  const creativeUrl =
    absoluteUrl(
      owner.querySelector("a[href*='/creative/']")?.getAttribute("href"),
    ) ?? absoluteUrl((owner as HTMLAnchorElement).href);
  const creativeId = extractCreativeId(
    `${creativeUrl ?? ""} ${bodyText} ${html}`,
  );
  const previewUrl =
    absoluteUrl((element as HTMLIFrameElement).src) ??
    absoluteUrl(element.getAttribute("src"));
  return { creativeId, creativeUrl, previewUrl };
}

export function extractFrameTemplateDataSources(): unknown[] {
  const sources: unknown[] = [];
  const push = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    sources.push(JSON.parse(JSON.stringify(value)));
  };

  const frameWindow = window as unknown as {
    adData?: unknown;
    google_ad_data?: unknown;
    google_template_data?: unknown;
  };
  push(frameWindow.adData);
  push(frameWindow.google_ad_data);
  if (frameWindow.google_template_data)
    push({ google_template_data: frameWindow.google_template_data });

  return sources;
}

export function extractFramePreviewPayloads(): BrowserNativeFramePayload[] {
  type DomAsset = NonNullable<
    BrowserNativeDomCreative["raw"]["assets"]
  >[number];

  const decode = (value: string) => {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    const htmlDecoded = textarea.value
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
  };
  const absoluteUrl = (value?: string | null) => {
    if (!value) return undefined;
    const cleaned = decode(value.trim());
    if (!cleaned || cleaned.startsWith("data:")) return undefined;
    try {
      const url = new URL(cleaned, location.origin);
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.href
        : undefined;
    } catch {
      return undefined;
    }
  };
  const isBlockedText = (value?: string) => {
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
  };
  const normalizeText = (value?: string | null) => {
    const normalized = value
      ?.replace(/\\x26|\\u0026/g, "&")
      .replace(/[\u2066\u2069]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return normalized && !isBlockedText(normalized) ? normalized : undefined;
  };
  const storeFromLabel = (label?: string) => {
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
  };
  const storeUrlFromSource = (source: string) => {
    const decoded = decode(source);
    const direct = decoded.match(
      /https?:\/\/(?:play\.google\.com\/store\/apps\/details\?id=[^"'<>\s\\]+|apps\.apple\.com\/[^"'<>\s\\]+|itunes\.apple\.com\/[^"'<>\s\\]+)/i,
    )?.[0];
    if (direct) return direct;
    const encoded = decoded.match(
      /https?%3A%2F%2F(?:play\.google\.com%2Fstore%2Fapps%2Fdetails%3Fid%3D[^"'<>\s\\]+|apps\.apple\.com%2F[^"'<>\s\\]+|itunes\.apple\.com%2F[^"'<>\s\\]+)/i,
    )?.[0];
    return encoded ? decodeURIComponent(encoded) : undefined;
  };
  const appIdFromStoreUrl = (storeUrl?: string) => {
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
  };
  const isBlockedAppId = (appId?: string) => {
    const value = appId?.trim() ?? "";
    const lower = value.toLowerCase();
    return (
      /^(window|document|globalthis|google|wiz|json|object|this|self)\./i.test(
        value,
      ) ||
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
  };
  const normalizeStoreAppId = (
    appId?: string,
    store?: "GOOGLE_PLAY" | "APP_STORE" | "UNKNOWN",
  ) => {
    const value = appId?.trim() ?? "";
    if (!value || isBlockedAppId(value)) return undefined;
    const googlePlay = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_-]*)+$/i.test(value);
    const appStore = /^\d{5,}$/.test(value);
    if (store === "APP_STORE") return appStore ? value : undefined;
    if (store === "GOOGLE_PLAY") return googlePlay ? value : undefined;
    return appStore || googlePlay ? value : undefined;
  };
  const pushAsset = (
    assets: DomAsset[],
    kind: DomAsset["kind"],
    rawUrl?: string | null,
  ) => {
    const url = absoluteUrl(rawUrl);
    if (url) assets.push({ kind, url });
  };
  const dedupeAssets = (assets: DomAsset[]) => {
    const seen = new Set<string>();
    return assets.filter((asset) => {
      const key = `${asset.kind}:${asset.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const decodeBase64UrlText = (value: string) => {
    try {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return "";
    }
  };
  const decodeAdChunks = (source: string) => {
    const chunks: string[] = [];
    const decoded = decode(source);
    for (const match of decoded.matchAll(/[?&]ad=([^&"'<>\s\\]{30,})/g)) {
      const chunk = decodeBase64UrlText(match[1]);
      if (chunk) chunks.push(chunk);
    }
    return chunks;
  };
  const scoreAppIdCandidate = (
    source: string,
    index: number,
    value: string,
    preferredTexts: string[],
  ) => {
    let score = 1;
    if (!isBlockedAppId(value)) score += 5;
    if (value.startsWith("com.google.") || value.includes("google."))
      score -= 5;
    if (
      !/googleusercontent|googlesyndication|doubleclick|gstatic|prod\.corp\.google/i.test(
        value,
      )
    )
      score += 2;
    const nearby = source
      .slice(Math.max(0, index - 500), Math.min(source.length, index + 500))
      .toLowerCase();
    for (const text of preferredTexts) {
      const key = text.toLowerCase().slice(0, 80);
      if (key && nearby.includes(key)) score += 12;
    }
    return score;
  };
  const likelyAppIdFromSource = (
    source: string,
    store: "GOOGLE_PLAY" | "APP_STORE" | "UNKNOWN",
    preferredTexts: Array<string | undefined> = [],
  ) => {
    const decoded = decode(source);
    const chunks = [decoded, ...decodeAdChunks(decoded)];
    const preferred = preferredTexts
      .map((item) => normalizeText(item))
      .filter((item): item is string => Boolean(item));
    const candidates: Array<{ value: string; score: number }> = [];
    for (const chunk of chunks) {
      const candidateStore =
        store === "UNKNOWN" ? storeFromLabel(chunk) : store;
      if (candidateStore !== "APP_STORE") {
        for (const match of chunk.matchAll(
          /[A-Z]?([a-z][a-z0-9_]{1,50}(?:\.[a-z][a-z0-9_-]{1,80}){2,})/g,
        )) {
          const value = normalizeStoreAppId(match[1], "GOOGLE_PLAY");
          if (!value) continue;
          candidates.push({
            value,
            score: scoreAppIdCandidate(
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
            score: scoreAppIdCandidate(
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
  };
  const text = (root: ParentNode, selectors: string[]) => {
    for (const selector of selectors) {
      const value = normalizeText(root.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return undefined;
  };
  const assetsFromRoot = (root: ParentNode, source: string) => {
    const assets: DomAsset[] = [];
    root
      .querySelectorAll("img[src]")
      .forEach((item) =>
        pushAsset(assets, "LANDSCAPE_IMAGE", item.getAttribute("src")),
      );
    root
      .querySelectorAll("video[src], source[src]")
      .forEach((item) => pushAsset(assets, "VIDEO", item.getAttribute("src")));
    root.querySelectorAll("[style*='url(']").forEach((item) => {
      const match = item
        .getAttribute("style")
        ?.match(/url\s*\(\s*["']?(https?:[^"')]+|\/\/[^"')]+)["']?\s*\)/i);
      const url = match?.[1];
      pushAsset(
        assets,
        /ytimg\.com\/vi\//i.test(url ?? "") ? "VIDEO" : "LANDSCAPE_IMAGE",
        url,
      );
    });
    for (const match of decode(source).matchAll(
      /https?:\/\/[^"'<>\s\\]+(?:googleusercontent\.com|ytimg\.com|ggpht\.com|googlevideo\.com)[^"'<>\s\\]*/gi,
    )) {
      pushAsset(
        assets,
        /googlevideo|youtube|ytimg/i.test(match[0])
          ? "VIDEO"
          : "LANDSCAPE_IMAGE",
        match[0],
      );
    }
    const storeUrl = storeUrlFromSource(source);
    pushAsset(assets, "LANDING_URL", storeUrl);
    return dedupeAssets(assets);
  };
  const buildInterstitialPayload = (
    root: ParentNode,
    sourceName: string,
  ): BrowserNativeFramePayload | undefined => {
    const html =
      (root as Element).outerHTML ?? document.documentElement.outerHTML ?? "";
    const appName = text(root, [
      "[data-asoch-targets*='ochAppName']",
      "[data-asoch-targets*='ochEndCardAppName']",
      ".short-app-name a",
      ".end-frame-app-name span",
      ".end-frame-app-name-v0 span",
      ".app-name",
    ]);
    if (!appName) return undefined;

    const storeIndicator = root.querySelector(
      ".app-store-container svg, [data-asoch-targets*='ochAppStore']",
    );
    const parentLink = storeIndicator?.closest("a");
    const storeUrl =
      absoluteUrl(parentLink?.getAttribute("href")) ?? storeUrlFromSource(html);
    const store = storeFromLabel(`${storeUrl ?? ""} ${html}`);
    if (store === "UNKNOWN") return undefined;

    const assets = assetsFromRoot(root, html);
    const description = text(root, [
      ".headline [dir='auto']",
      ".headline",
      "[data-asoch-targets*='ochBody']",
      "[data-asoch-targets*='ochDescription']",
      ".description",
      ".app-description",
    ]);
    return {
      source: sourceName,
      appId: normalizeStoreAppId(
        appIdFromStoreUrl(storeUrl) ??
          likelyAppIdFromSource(html, store, [appName, description]),
        store,
      ),
      appName,
      title: appName,
      description,
      store,
      storeUrl,
      assets,
    };
  };
  const bodyTextPayload = (
    root: ParentNode,
    sourceName: string,
  ): BrowserNativeFramePayload | undefined => {
    const html =
      (root as Element).outerHTML ?? document.documentElement.outerHTML ?? "";
    const lines = String(
      (root as HTMLElement).innerText ?? root.textContent ?? "",
    )
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .filter((line): line is string => Boolean(line));
    const storeIndex = lines.findIndex((line) =>
      /^(Google Play|App Store)$/i.test(line),
    );
    if (storeIndex < 0) return undefined;
    const store = storeFromLabel(lines[storeIndex]);
    const title = normalizeText(lines[storeIndex + 1]);
    const description = normalizeText(lines[storeIndex + 2]);
    const previousName = normalizeText(lines[storeIndex - 1]);
    const titleName = title?.split("|")[0]?.split(":")[0]?.trim();
    const appName =
      previousName && !/^(Google Play|App Store)$/i.test(previousName)
        ? previousName
        : normalizeText(titleName);
    if (store === "UNKNOWN" || !appName) return undefined;
    const storeUrl = storeUrlFromSource(html);
    const appId = normalizeStoreAppId(
      appIdFromStoreUrl(storeUrl) ??
        likelyAppIdFromSource(html, store, [appName, title, description]),
      store,
    );
    const finalStoreUrl =
      storeUrl ??
      (store === "GOOGLE_PLAY" && appId
        ? `https://play.google.com/store/apps/details?id=${appId}`
        : undefined) ??
      (store === "APP_STORE" && appId
        ? `https://apps.apple.com/app/id${appId}`
        : undefined);
    return {
      source: sourceName,
      appId,
      appName,
      title,
      description,
      store,
      storeUrl: finalStoreUrl,
      assets: assetsFromRoot(root, html),
    };
  };
  const inferStoreFromAppId = (appId?: string, appStore?: unknown) => {
    if (appStore === "1" || appStore === 1) return "APP_STORE" as const;
    if (appStore === "2" || appStore === 2) return "GOOGLE_PLAY" as const;
    if (!appId || isBlockedAppId(appId)) return "UNKNOWN" as const;
    if (/^\d{5,}$/.test(appId)) return "APP_STORE" as const;
    return normalizeStoreAppId(appId, "GOOGLE_PLAY")
      ? ("GOOGLE_PLAY" as const)
      : ("UNKNOWN" as const);
  };
  const pickTextFromSource = (source: string, patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      const value = normalizeText(match?.[1]);
      if (value && !/^https?:\/\//i.test(value) && !value.includes("www."))
        return decode(value);
    }
    return undefined;
  };
  const fieldsFromObject = (
    value: unknown,
  ): BrowserNativeFramePayload | undefined => {
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
    const storeUrl = storeUrlFromSource(`${destination} ${source}`);
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
          appIdFromStoreUrl(storeUrl) ??
          "",
      ) || undefined;
    const storeByLabel = storeFromLabel(
      `${platformName} ${storeUrl ?? ""} ${destination} ${source}`,
    );
    const templateStore = template.appStore ?? googleTemplate?.appStore;
    const store =
      storeByLabel === "UNKNOWN"
        ? inferStoreFromAppId(appId, templateStore)
        : storeByLabel;
    const appName =
      normalizeText(
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
      pickTextFromSource(source, [
        /"(?:appName|app_name|headline)"\s*:\s*"([^"]{3,100})"/i,
        /"title"\s*:\s*"([^"]{3,100})"/i,
      ]);
    const description =
      normalizeText(
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
      pickTextFromSource(source, [
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
        ? inferStoreFromAppId(appId ?? regexAppId, templateStore)
        : store;
    const sourceAppId = likelyAppIdFromSource(source, inferredStore, [
      appName,
      description,
    ]);
    const finalStoreFromSource =
      inferredStore === "UNKNOWN"
        ? inferStoreFromAppId(sourceAppId, templateStore)
        : inferredStore;
    const finalAppId = normalizeStoreAppId(
      appId ?? regexAppId ?? sourceAppId,
      finalStoreFromSource,
    );
    const inferredStoreFromFinal =
      finalStoreFromSource === "UNKNOWN"
        ? inferStoreFromAppId(finalAppId, templateStore)
        : finalStoreFromSource;
    const finalStore = finalAppId ? inferredStoreFromFinal : "UNKNOWN";
    if (finalStore === "UNKNOWN" && !finalAppId) return undefined;
    const assets: DomAsset[] = [];
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
        pushAsset(
          assets,
          key.toLowerCase().includes("icon") ? "APP_ICON" : "LANDSCAPE_IMAGE",
          raw,
        );
    }
    const video =
      ad?.video_url ??
      ad?.youtube_video_id ??
      template.video_videoId ??
      googleTemplate?.video_videoId ??
      template.video ??
      googleTemplate?.video;
    if (typeof video === "string")
      pushAsset(
        assets,
        "VIDEO",
        video.includes("http")
          ? video
          : `https://www.youtube.com/watch?v=${video}`,
      );
    pushAsset(assets, "LANDING_URL", storeUrl);
    return {
      source: "adData_template",
      appId: finalAppId,
      appName,
      title: appName,
      description,
      store: finalStore,
      storeUrl,
      assets: dedupeAssets(assets),
    };
  };

  const output: BrowserNativeFramePayload[] = [];
  const push = (payload?: BrowserNativeFramePayload) => {
    if (!payload) return;
    if (
      !payload.appName &&
      !payload.appId &&
      !payload.storeUrl &&
      !payload.assets?.length
    )
      return;
    output.push(payload);
  };

  push(bodyTextPayload(document.body, "iframe_text"));
  push(buildInterstitialPayload(document.body, "iframe_interstitial"));
  push(fieldsFromObject((window as unknown as { adData?: unknown }).adData));
  push(
    fieldsFromObject(
      (window as unknown as { google_ad_data?: unknown }).google_ad_data,
    ),
  );
  push(
    fieldsFromObject(
      (window as unknown as { google_template_data?: unknown })
        .google_template_data,
    ),
  );

  document
    .querySelectorAll(
      "script:not([src]), [data-p], [data-asoch-meta], fletch-renderer",
    )
    .forEach((node) => {
      const source =
        node instanceof HTMLScriptElement
          ? (node.textContent ?? "")
          : (node.getAttribute("data-p") ??
            node.getAttribute("data-asoch-meta") ??
            (node as HTMLElement).innerHTML ??
            "");
      if (!source || source.length > 500_000) return;
      const storeUrl = storeUrlFromSource(source);
      const store = storeFromLabel(`${storeUrl ?? ""} ${source}`);
      const explicitAppId =
        source.match(
          /(?:package_name|package|docid|appId|app_id)["']?\s*[:=]\s*["']?([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+|\d{5,})/i,
        )?.[1] ??
        source.match(
          /(?:id=|id%3D|id\\u003d)([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+|\d{5,})/i,
        )?.[1] ??
        source.match(/(?:adamId)["']?\s*:\s*["']?(\d{5,})/i)?.[1];
      const title = pickTextFromSource(source, [
        /(?:appName|app_name|headline)["']?\s*[:=]\s*["']([^"']{3,100})["']/i,
        /title["']?\s*[:=]\s*["']([^"']{3,100})["']/i,
      ]);
      const description = pickTextFromSource(source, [
        /(?:description1?|body)["']?\s*[:=]\s*["']([^"']{10,500})["']/i,
        /text["']?\s*[:=]\s*["']([^"']{10,500})["']/i,
      ]);
      const inferredStore =
        store === "UNKNOWN" ? inferStoreFromAppId(explicitAppId) : store;
      const appId = normalizeStoreAppId(
        appIdFromStoreUrl(storeUrl) ??
          explicitAppId ??
          likelyAppIdFromSource(source, inferredStore, [title, description]),
        inferredStore,
      );
      if (!appId && !storeUrl) return;
      push({
        source: "iframe_string",
        appId,
        appName: title,
        title,
        description,
        store: store === "UNKNOWN" ? inferStoreFromAppId(appId) : store,
        storeUrl,
        assets: assetsFromRoot(document.body, source),
      });
    });

  return output;
}
