(function () {
  "use strict";

  window.AdExplorer = window.AdExplorer || {};

  const foundCache = new Set();

  function scanString(str, source, url, element = null) {
    if (!str || str.length > 1000000) return; // Reduced limit

    // Fast Check: Skip if no relevant keywords
    const lower = str.toLowerCase();

    // FIX: Always allow 'dom_data_p' (Google Ads data) as it may contain IDs without standard keywords
    const isDataP = source === "dom_data_p";

    if (
      !isDataP &&
      !lower.includes("play.google") &&
      !lower.includes("apps.apple") &&
      !lower.includes("itunes.apple") && // FIX: was missing, caused 8.html skip
      !lower.includes("id=") &&
      !lower.includes("adurl") &&
      !lower.includes("market://") &&
      !lower.includes("itms-apps")
    ) {
      return;
    }

    const Messenger = window.AdExplorer.Messenger;
    if (!Messenger) return;

    const report = (data) => {
      // FIX: Persist UUID on the element itself to prevent duplicates when re-scanning widgets
      if (element) {
        // 1. Check if any PARENT has a UUID (e.g. the card wrapper)
        let parentUuid = null;
        try {
          const parentWithUuid = element.closest("[data-ad-uuid]");
          if (parentWithUuid) {
            parentUuid = parentWithUuid.dataset.adUuid;
          }
        } catch (e) {}

        // 2. Use existing UUID on element, or Parent UUID, or Generate New
        const finalUuid =
          element.dataset.adUuid ||
          parentUuid ||
          (Utils && Utils.generateUUID ? Utils.generateUUID() : null);

        if (finalUuid) {
          element.dataset.adUuid = finalUuid;
          data.uuid = finalUuid;
        }

        // FIX: Verify if we can find a creative URL in the parent container context
        if (!data.creativeUrl && (element.dataset.adUuid || parentUuid)) {
          try {
            // 1. Check UPWARDS: Use closest to find if the element itself or a parent is the link (User's case)
            // This handles cases where the whole card is wrapped in <a href="...">
            const directParentLink = element.closest(
              'a[href*="/creative/"], a[href*="/advertiser/"], a[href*="adstransparency.google.com"]',
            );

            if (directParentLink && directParentLink.href) {
              data.creativeUrl = directParentLink.href;
            } else {
              // 2. Check DOWNWARDS: Fallback to searching inside the container (Original logic)
              const container = element.closest("[data-ad-uuid]") || element;
              if (container) {
                const childLink = container.querySelector(
                  'a[href*="/creative/"], a[href*="adstransparency.google.com"], a[href*="/advertiser/"]',
                );
                if (childLink && childLink.href) {
                  data.creativeUrl = childLink.href;
                }
              }
            }
          } catch (e) {}
        }

        // 3. Fallback for "Creative Details" page:
        if (!data.creativeUrl && window.location.href.includes("/creative/")) {
          data.creativeUrl = window.location.href;
        }

        // Store URL: when element is the store link itself, use it (appId already from same href string)
        if (
          !data.storeUrl &&
          element &&
          element.tagName === "A" &&
          element.href
        ) {
          const h = element.href;
          if (
            h.includes("play.google.com") ||
            h.includes("apps.apple.com") ||
            h.includes("itunes.apple.com")
          ) {
            data.storeUrl = h;
          }
        }

        // TEXT ADS (creative6/creative7): extract title/description from JSON blob in data-p / script
        // creative6: "TITLE","play.google.com/store","DESCRIPTION"
        // creative7: "TITLE","","DESCRIPTION" (empty store URL)
        if (
          (!data.title || !data.description) &&
          typeof str === "string" &&
          str.length < 200000
        ) {
          try {
            let m =
              /"([^"]{5,120})"\s*,\s*"play\.google\.com\/store"\s*,\s*"([^"]{10,400})"/.exec(
                str,
              );
            if (!m)
              m = /"([^"]{5,120})"\s*,\s*""\s*,\s*"([^"]{10,400})"/.exec(str);
            if (m) {
              let rawTitle = m[1];
              let rawDesc = m[2];
              rawTitle = rawTitle.replace(/\x26|\u0026/g, "&");
              rawDesc = rawDesc.replace(/\x26|\u0026/g, "&");
              if (!data.title) data.title = rawTitle;
              if (!data.description) data.description = rawDesc;
            }
          } catch (e) {}
        }

        // EXTRACT ADDITIONAL FIELDS: one container, optimized selector order (faster first)
        try {
          // FIX: For SCRIPT elements, search for .mys-wrapper in the document, not via closest
          let container = null;
          if (element.tagName === "SCRIPT") {
            // Script tags are siblings of .mys-wrapper, not children, so use document.querySelector
            container =
              document.querySelector(".mys-wrapper") ||
              document.querySelector("#mys-wrapper");

            // If still not found, try to use buildInterstitialPayload on document.body
            if (
              !container &&
              typeof window !== "undefined" &&
              window.AdExplorer &&
              window.AdExplorer.Detector
            ) {
              const payload =
                window.AdExplorer.Detector.buildInterstitialPayload(
                  document.body || document.documentElement,
                );
              if (payload) {
                // Merge payload data into current data
                if (payload.title && !data.title) data.title = payload.title;
                if (payload.description && !data.description)
                  data.description = payload.description;
                if (payload.mainImageUrl && !data.mainImageUrl)
                  data.mainImageUrl = payload.mainImageUrl;
                if (payload.mainVideoUrl && !data.mainVideoUrl)
                  data.mainVideoUrl = payload.mainVideoUrl;
              }
            }
          } else {
            container =
              element.closest(".mys-wrapper") ||
              element.closest("[data-ad-uuid]") ||
              element.closest("creative-preview") ||
              element;
          }

          if (container) {
            // Title: .short-app-name a is most common in creative*.html
            if (!data.title) {
              const titleEl =
                container.querySelector(".short-app-name a") ||
                container.querySelector(".end-frame-app-name-v0 span") ||
                container.querySelector('[data-asoch-targets*="ochAppName"]') ||
                container.querySelector(
                  '[data-asoch-targets*="ochEndCardAppName"]',
                ) ||
                container.querySelector(".end-frame-app-name span") ||
                container.querySelector(".app-name");
              if (titleEl) {
                const t = titleEl.textContent?.trim();
                if (t && t.length > 1) {
                  data.title = t.replace(/\s+/g, " ").trim();
                }
              } else {
              }
            }

            // Description: prefer short app description (.headline/ochBody), then .description, then long ochDescription
            if (!data.description) {
              const descEl =
                container.querySelector('.headline [dir="auto"], .headline') ||
                container.querySelector('[data-asoch-targets*="ochBody"]') ||
                container.querySelector(".description") ||
                container.querySelector(
                  '[data-asoch-targets*="ochDescription"]',
                ) ||
                container.querySelector(".app-description");
              if (descEl) {
                const d = descEl.textContent?.trim();
                if (d && d.length > 2) {
                  data.description = d.replace(/\s+/g, " ").trim();
                }
              }
            }

            // Image + Video: single .start-image lookup, then parse URL for both
            const startImage = container.querySelector(".start-image");
            if (startImage) {
              const style =
                startImage.getAttribute("style") ||
                (startImage.style && startImage.style.backgroundImage) ||
                "";
              const urlMatch = style.match(
                /url\s*\(\s*["']?(https?:[^"')]+|\/\/[^"')]+)["']?\s*\)/,
              );
              const imgUrl = urlMatch
                ? urlMatch[1].replace(/&quot;/g, "")
                : null;
              if (imgUrl) {
                if (!data.mainImageUrl)
                  data.mainImageUrl =
                    imgUrl.indexOf("//") === 0 ? "https:" + imgUrl : imgUrl;
                if (!data.mainVideoUrl) {
                  const ytMatch = imgUrl.match(/ytimg\.com\/vi\/([^/]+)\//);
                  if (ytMatch)
                    data.mainVideoUrl =
                      "https://www.youtube.com/watch?v=" + ytMatch[1];
                }
              }
            }
            if (!data.mainImageUrl) {
              const iconEl =
                container.querySelector(".app-icon") ||
                container.querySelector('[class*="app-icon"]');
              if (iconEl) {
                const bgImage =
                  window.getComputedStyle(iconEl).backgroundImage ||
                  iconEl.style.backgroundImage;
                if (bgImage) {
                  const urlMatch = bgImage.match(
                    /url\s*\(\s*["']?(https?:[^"')]+|\/\/[^"')]+)["']?\s*\)/,
                  );
                  if (urlMatch) {
                    const u = urlMatch[1].replace(/&quot;/g, "");
                    data.mainImageUrl =
                      u.indexOf("//") === 0 ? "https:" + u : u;
                  }
                }
              }
            }
            if (!data.mainVideoUrl) {
              const metaEl =
                container.querySelector(
                  '[data-asoch-meta][content*="ytimg.com/vi/"]',
                ) || container.querySelector('[content*="ytimg.com/vi/"]');
              if (metaEl) {
                const content =
                  metaEl.getAttribute("content") ||
                  metaEl.getAttribute("data-asoch-meta") ||
                  "";
                const ytMatch = content.match(/ytimg\.com\/vi\/([^/"]+)/);
                if (ytMatch)
                  data.mainVideoUrl =
                    "https://www.youtube.com/watch?v=" + ytMatch[1];
              }
            }
          }
        } catch (e) {}
      }

      // On list page: skip incomplete reports (no title/description/image/video); iframe will send full data once
      const isListPage =
        typeof window !== "undefined" &&
        window.location &&
        window.location.href &&
        window.location.href.includes("adstransparency.google.com") &&
        !window.location.href.includes("/creative/");
      const hasNoMeta =
        !data.title &&
        !data.description &&
        !data.mainImageUrl &&
        !data.mainVideoUrl;
      if (window === window.top && isListPage && hasNoMeta) {
        return;
      }

      if (Messenger.reportLocalAd && element) {
        Messenger.reportLocalAd(data, element);
      } else {
        Messenger.reportAd(data);
      }
    };

    const playPatterns = [
      /play\.google\.com\/store\/apps\/details\?[^"']*id=([a-zA-Z][a-zA-Z0-9_.]+)/gi,
      /market:\/\/details\?id=([a-zA-Z][a-zA-Z0-9_.]+)/gi,
      /["'\[,]\s*([a-z][a-z0-9_]+\.[a-z0-9_.]{3,})\s*["'\],]/gi,
    ];

    const Utils = window.AdExplorer.Utils;

    // FIX: Check data-p for Android patterns too
    if (
      isDataP ||
      lower.includes("google") ||
      lower.includes("market") ||
      lower.includes("android")
    ) {
      for (const regex of playPatterns) {
        let match;
        while ((match = regex.exec(str)) !== null) {
          const id = match[1];
          if (id && Utils && Utils.isValidPackageId(id)) {
            // Global cache check REMOVED
            // const key = `gp_${id}_${source}`;
            // if (!foundCache.has(key)) {
            //    foundCache.add(key);
            report({
              type: "Google Play",
              appId: id,
              source: source,
            });
            // }
          }
        }
        regex.lastIndex = 0;
      }
    }

    const iosPatterns = [
      /(?:apps|itunes)\.apple\.com\/.*?(?:\/id|id)(\d{5,})/gi,
      /itms-apps:\/\/.*?id(\d{5,})/gi,
      /"adamId"\s*:\s*"?(\d{5,})"?/gi,
      /"appId"\s*:\s*"?(\d{5,})"?/gi,
      /[\[,]\s*1\s*,\s*["'](\d{9,})["']/gi,
    ];

    // FIX: Deep scan for Base64 encoded ad data (common in Google Ads 'ad' parameter)
    // Look for ad=... or related params that might contain base64 blobs
    // Handles: ?ad=, &ad=, \u0026ad\u003d, %26ad%3D, u=
    const adParamMatch = str.match(
      /(?:[?&]|\\u0026|%26)(?:ad|u)(?:=|%3D|\\u003d)([^&"'\\]+)/,
    );
    if (adParamMatch && adParamMatch[1]) {
      try {
        let decodedURI = adParamMatch[1];
        try {
          decodedURI = decodeURIComponent(adParamMatch[1]);
        } catch (e) {}

        // 1. Scan for plain package name in the decoded URI
        const packageMatchURI = decodedURI.match(
          /([a-z][a-z0-9_]*\.(?:[a-z][a-z0-9_]*\.)+[a-z0-9_]+)/i,
        );
        if (
          packageMatchURI &&
          (packageMatchURI[1].includes("com.") ||
            packageMatchURI[1].includes("net."))
        ) {
          report({
            type: "Google Play",
            appId: packageMatchURI[1],
            source: source + "_ad_param_decoded",
          });
        }

        // 2. Try to decode Base64 chunks if possible
        // Use broad URL-safe regex from verification test
        const base64Pattern = /[a-zA-Z0-9+\/=_ -]{20,}/g;
        const potentialBase64 = decodedURI.match(base64Pattern) || [];
        potentialBase64.forEach((chunk) => {
          try {
            // Fix URL-safe Base64 chars for standard decoder
            const fixedChunk = chunk
              .replace(/-/g, "+")
              .replace(/_/g, "/")
              .replace(/ /g, "+");
            const decodedChunk = atob(fixedChunk);

            // DEBUG: Check for package ID patterns
            const pkgMatch = decodedChunk.match(
              /([a-z][a-z0-9_]*\.(?:[a-z][a-z0-9_]*\.)+[a-z0-9_]+)/i,
            );

            if (pkgMatch) {
              let potentialId = pkgMatch[1];
              // Clean up trailing garbage
              potentialId = potentialId
                .replace(/[A-Z]+$/, "")
                .replace(/\.$/, "");

              if (window.AdExplorer.Utils.isValidPackageId(potentialId)) {
                report({
                  type: "Google Play",
                  appId: potentialId,
                  source: source + "_ad_base64_decoded",
                });
              }
            }
          } catch (e) {}
        });
      } catch (e) {}
    }

    // FIX: Check data-p for iOS patterns too
    if (
      isDataP ||
      lower.includes("apple") ||
      lower.includes("itunes") ||
      lower.includes("ios") ||
      lower.includes("id")
    ) {
      for (const regex of iosPatterns) {
        let match;
        while ((match = regex.exec(str)) !== null) {
          const id = match[1];
          if (id && id.length >= 5) {
            // Global cache check REMOVED
            // const key = `ios_${id}_${source}`;
            // if (!foundCache.has(key)) {
            //    foundCache.add(key);
            report({
              type: "App Store",
              appId: id,
              source: source,
            });
            // }
          }
        }
        regex.lastIndex = 0;
      }
    }

    const redirectPatterns = [/[?&](?:adurl|dst|u|click|redir)=([^"'\s&]+)/gi];

    if (
      lower.includes("adurl") ||
      lower.includes("dst") ||
      lower.includes("redir") ||
      lower.includes("click")
    ) {
      for (const regex of redirectPatterns) {
        let match;
        while ((match = regex.exec(str)) !== null) {
          let encoded = match[1];
          for (let i = 0; i < 3; i++) {
            try {
              encoded = decodeURIComponent(encoded);
            } catch (e) {
              break;
            }
          }
          scanString(encoded, source + "_redirect", url, element);
        }
        regex.lastIndex = 0;
      }
    }

    // --- LOOSE ID DETECTION (Fix for 7.html, 8.html) ---
    // If we found a store URL keyword but NO specific ID via standard regex,
    // try to find "floating" IDs in the same string block.
    const hasItunesDot = lower.includes("itunes.apple.com");
    const hasAppsDot = lower.includes("apps.apple.com");
    // Also trigger if we see Google Ads specific keys indicating an App content
    const hasOchKeys =
      lower.includes("ochappstore") || lower.includes("ochappname");

    if (hasItunesDot || hasAppsDot || hasOchKeys) {
      // Look for 9-10 digit numbers that might be IDs
      const looseIos = /\b(\d{9,10})\b/g;
      let match;
      const candidates = [];

      while ((match = looseIos.exec(str)) !== null) {
        const id = match[1];
        // Skip: starts with 0, ends with 000x, or is a JSON key
        if (id.startsWith("0")) continue;
        if (/0{3,}\d?$/.test(id)) continue;
        // Skip common false positives: timestamps/sizes often start with 16 or 17 (e.g. 1.6bn, 1700...) for 9 digits
        if (id.length === 9 && (id.startsWith("16") || id.startsWith("17")))
          continue;

        const keyPattern = new RegExp(`"${id}"\\s*:`);
        if (keyPattern.test(str)) continue;
        candidates.push(id);
      }

      // Prefer 10-digit IDs starting with "1" or "6" (typical Apple App ID format)
      let bestId = candidates.find(
        (id) => id.length === 10 && (id.startsWith("1") || id.startsWith("6")),
      );
      if (!bestId) bestId = candidates.find((id) => id.length === 10);

      // Only fall back to 9-digits if no 10-digit found
      if (!bestId) bestId = candidates[0];

      if (bestId) {
        const data = {
          type: "App Store",
          appId: bestId,
          source: source + "_loose",
        };

        // SPECIAL CASE: rich data inside data-p blobs (creative10-style list cards)
        // We try to prefill title / description / image so that list pages are not dropped by hasNoMeta.
        if (source === "dom_data_p") {
          try {
            // 1) TITLE + DESCRIPTION around itunes.apple.com
            // Pattern: "Title","itunes.apple.com/","Description"
            const metaMatch =
              /"([^"]{5,120})"\s*,\s*"itunes\.apple\.com\/?[^"]*"\s*,\s*"([^"]{10,400})"/.exec(
                str,
              );
            if (metaMatch) {
              const rawTitle = metaMatch[1].replace(/\x26|\u0026/g, "&");
              const rawDesc = metaMatch[2].replace(/\x26|\u0026/g, "&");
              if (!data.title) data.title = rawTitle;
              if (!data.description) data.description = rawDesc;
            }

            // 2) MAIN IMAGE: first googleusercontent.com image in the blob
            // Works for structures like ["//lh3.googleusercontent.com/...."]
            const imgMatch =
              /"(https?:\/\/[^"]*googleusercontent\.com\/[^"]+|\/\/lh\d\.googleusercontent\.com[^"]+)"/.exec(
                str,
              );
            if (imgMatch) {
              let u = imgMatch[1];
              if (u.indexOf("//") === 0) u = "https:" + u;
              data.mainImageUrl = u;
            }
          } catch (e) {}
        }

        report(data);
      }
    }

    if (lower.includes("play.google.com")) {
      // Look for package names com.xyz.abc
      const looseAndroid = /\b(com\.[a-z0-9_]+\.[a-z0-9_.]+)\b/gi;
      let match;
      while ((match = looseAndroid.exec(str)) !== null) {
        const id = match[1];
        if (
          Utils &&
          Utils.isValidPackageId(id) &&
          !id.includes("google") &&
          !id.includes("android")
        ) {
          report({
            type: "Google Play",
            appId: id,
            source: source + "_loose",
          });
        }
      }
    }
  }

  function scanLink(link) {
    return;
  }

  function isElementVisible(el) {
    if (!el) return false;
    // 1. Check dimensions (must be > 10x10 to be a real ad card/link)
    if (el.offsetWidth < 10 || el.offsetHeight < 10) {
      // Check client rects as fallback (sometimes offset is 0 but rect is not)
      const rects = el.getClientRects();
      if (rects.length === 0) return false;
      // Assuming if rect exists, check its size
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return false;
    }

    // 2. Check styles (expensive, so done after size check)
    const style = window.getComputedStyle(el);
    if (
      style.visibility === "hidden" ||
      style.display === "none" ||
      style.opacity === "0"
    ) {
      return false;
    }

    return true;
  }

  /**
   * Build interstitial payload from a root element (document or container).
   * System MUST collect: title (app name), appId, description (if present), mainImageUrl (poster/thumbnail), mainVideoUrl (YouTube).
   * Used for creative1/creative2-style interstitials (video + panel; creative2 has .description / ochDescription).
   * Returns payload object or null. Does not report or set processed flags.
   */
  function buildInterstitialPayload(root) {
    if (!root || !root.querySelector) return null;

    const appNameEl =
      root.querySelector('[data-asoch-targets*="ochAppName"]') ||
      root.querySelector('[data-asoch-targets*="ochEndCardAppName"]') ||
      root.querySelector(".short-app-name a") ||
      root.querySelector(".end-frame-app-name span") ||
      root.querySelector(".end-frame-app-name-v0 span");

    if (!appNameEl) return null;

    let appName = appNameEl.textContent?.trim();
    if (appName) appName = appName.replace(/\s+/g, " ").trim();
    if (!appName || appName.length < 2) return null;

    let appId = null;
    let storeUrl = null;
    let type = "Unknown";

    const iconEl =
      root.querySelector(".app-icon") ||
      root.querySelector('[class*="app-icon"]');
    if (iconEl) {
      const style = window.getComputedStyle(iconEl);
      const bgImage = style.backgroundImage || iconEl.style.backgroundImage;
      if (bgImage && bgImage.includes("lh3.googleusercontent.com")) {
        const match = bgImage.match(
          /lh3\.googleusercontent\.com\/([^/=\s"')]+)/,
        );
        if (match) {
          appId = "icon_" + match[1].substring(0, 20);
        }
      }
    }

    const storeIndicator = root.querySelector(
      '.app-store-container svg, [data-asoch-targets*="ochAppStore"]',
    );
    if (storeIndicator) {
      const parentLink = storeIndicator.closest("a");
      if (parentLink && parentLink.href) {
        storeUrl = parentLink.href;
      }
    }

    const iconBgEl = root.querySelector('[style*="lh3.googleusercontent.com"]');
    if (iconBgEl) {
      const styleAttr = iconBgEl.getAttribute("style") || "";
      if (
        styleAttr.includes("apple") ||
        root.innerHTML.includes("App Store") ||
        root.innerHTML.includes("itunes.apple.com")
      ) {
        type = "App Store";
      } else {
        type = "Google Play";
      }
    }

    // Infer type from storeUrl if unknown
    if (type === "Unknown" && storeUrl) {
      if (storeUrl.includes("apple.com") || storeUrl.includes("itunes"))
        type = "App Store";
      else if (
        storeUrl.includes("play.google") ||
        storeUrl.includes("market://")
      )
        type = "Google Play";
    }

    // Try to extract REAL ID from storeUrl (even if it's a redirect)
    if (storeUrl) {
      let tempUrl = storeUrl;
      // Decode up to 3 times to unwrap adurls
      for (let i = 0; i < 3; i++) {
        try {
          tempUrl = decodeURIComponent(tempUrl);
        } catch (e) {
          break;
        }
      }

      let idMatch = null;
      // Google Play ID
      const gpMatch = tempUrl.match(/id=([a-zA-Z][a-zA-Z0-9_.]+)/);
      if (gpMatch && window.AdExplorer.Utils.isValidPackageId(gpMatch[1])) {
        idMatch = gpMatch[1];
        if (type === "Unknown") type = "Google Play";
      }

      // iOS ID
      if (!idMatch) {
        const iosMatch = tempUrl.match(/id(\d{5,})/);
        if (iosMatch) {
          idMatch = iosMatch[1];
          if (type === "Unknown") type = "App Store";
        }
      }

      if (idMatch) {
        appId = idMatch;
      }
    }

    if (!appId) {
      appId = "name_" + appName.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30);
    }

    // Scan storeUrl as it might contain the ID via redirects (e.g. 6.html case)
    if (storeUrl) {
      scanString(storeUrl, "dom_interstitial_link", "a", root);
    }

    if (type === "Unknown") return null;

    // Interstitial Cache Removed
    // const key = `interstitial_${appId}`;
    // if (foundCache.has(key)) return;
    // foundCache.add(key);

    // Extract main image / video URL from .start-image (YouTube thumbnail) or data-asoch-meta content
    let mainImageUrl = null;
    let mainVideoUrl = null;
    try {
      const startImage = root.querySelector(".start-image");
      if (startImage) {
        const style =
          startImage.getAttribute("style") ||
          (startImage.style && startImage.style.backgroundImage) ||
          "";
        const urlMatch = style.match(
          /url\s*\(\s*["']?(https?:[^"')]+|\/\/[^"')]+)["']?\s*\)/,
        );
        const imgUrl = urlMatch ? urlMatch[1].replace(/&quot;/g, "") : null;
        if (imgUrl) {
          const ytMatch = imgUrl.match(/ytimg\.com\/vi\/([^/]+)\//);
          if (ytMatch) {
            mainVideoUrl = "https://www.youtube.com/watch?v=" + ytMatch[1];
            mainImageUrl =
              imgUrl.indexOf("//") === 0 ? "https:" + imgUrl : imgUrl;
          } else {
            mainImageUrl =
              imgUrl.indexOf("//") === 0 ? "https:" + imgUrl : imgUrl;
          }
        }
      }
      if (!mainVideoUrl) {
        const metaEl =
          root.querySelector('[data-asoch-meta][content*="ytimg.com/vi/"]') ||
          root.querySelector('[content*="ytimg.com/vi/"]') ||
          root.querySelector("[data-asoch-meta]");
        const content =
          metaEl &&
          (metaEl.getAttribute("content") ||
            metaEl.getAttribute("data-asoch-meta") ||
            "");
        if (content) {
          const ytMatch = content.match(/ytimg\.com\/vi\/([^/"]+)/);
          if (ytMatch) {
            mainVideoUrl = "https://www.youtube.com/watch?v=" + ytMatch[1];
            if (!mainImageUrl)
              mainImageUrl =
                "https://i1.ytimg.com/vi/" + ytMatch[1] + "/hqdefault.jpg";
          }
        }
      }
    } catch (e) {}

    // Description: prefer short (.headline/ochBody) over long (ochDescription) for creative8-style
    let description = null;
    try {
      const descEl =
        root.querySelector('.headline [dir="auto"], .headline') ||
        root.querySelector('[data-asoch-targets*="ochBody"]') ||
        root.querySelector('[data-asoch-targets*="ochDescription"]') ||
        root.querySelector(".description");
      if (descEl) {
        const t = descEl.textContent?.trim();
        if (t && t.length > 2) description = t.replace(/\s+/g, " ").trim();
      }
    } catch (e) {}

    const payload = {
      type: type,
      appId: appId,
      appName: appName,
      storeUrl: storeUrl,
      source: "dom_interstitial",
    };
    if (mainImageUrl) payload.mainImageUrl = mainImageUrl;
    if (mainVideoUrl) payload.mainVideoUrl = mainVideoUrl;
    if (appName) payload.title = appName;
    if (description) payload.description = description;
    if (
      typeof window !== "undefined" &&
      window.location &&
      window.location.href
    )
      payload.creativeUrl = window.location.href;
    return payload;
  }

  function extractInterstitialAppData(root) {
    if (
      root.nodeType === 1 &&
      !isElementVisible(root) &&
      root !== root.ownerDocument
    )
      return;
    if (root.nodeType === 1 && root.dataset.adExplorerInterstitialProcessed)
      return;

    const Messenger = window.AdExplorer.Messenger;
    if (!Messenger) return;

    const payload = buildInterstitialPayload(root);
    if (!payload) return;

    if (root.nodeType === 1) {
      try {
        root.dataset.adExplorerInterstitialProcessed = "true";
      } catch (e) {}
    }
    Messenger.reportAd(payload);
  }

  /**
   * On the main list page (adstransparency, not /creative/), scan all creative cards and
   * extract title/description/image/video from same-origin iframes.
   */
  let listPageObserver = null; // Store observer to avoid creating multiple instances

  function scanListPageIframes() {
    if (window !== window.top) return;
    const href = window.location.href || "";
    if (
      !href.includes("adstransparency.google.com") ||
      href.includes("/creative/")
    )
      return;

    const Messenger = window.AdExplorer.Messenger;
    if (!Messenger) return;

    function processCard(card) {
      if (card.dataset.adExplorerListExtracted === "true") return;

      let creativeUrl = null;
      const link =
        card.closest('a[href*="/creative/"]') ||
        card.querySelector('a[href*="/creative/"]') ||
        (card.href ? card : null);
      if (link && link.href) {
        creativeUrl = link.href;
        if (creativeUrl.startsWith("/"))
          creativeUrl = "https://adstransparency.google.com" + creativeUrl;
      }

      // FALLBACK: Even without creativeUrl, try to extract data from card DOM
      const iframe = card.querySelector("iframe");

      let retryCount = 0;
      const maxRetries = 3;
      let dataExtracted = false;

      function tryExtractFromIframe() {
        if (dataExtracted) return; // Already extracted

        try {
          const doc = iframe.contentDocument;
          if (!doc || !doc.body) {
            // Retry if iframe not ready yet
            if (retryCount < maxRetries) {
              retryCount++;
              setTimeout(tryExtractFromIframe, 500 * retryCount);
            } else {
              // Max retries reached - try fallback
              tryExtractFromCardDOM();
            }
            return;
          }
          const payload = buildInterstitialPayload(doc.body);
          if (payload) {
            if (creativeUrl) payload.creativeUrl = creativeUrl;
            payload.source = payload.source || "dom_interstitial_list";
            payload.isBadge = true; // Mark as badge so popup shows it
            Messenger.reportAd(payload);
            dataExtracted = true;
            try {
              card.dataset.adExplorerListExtracted = "true";
            } catch (e) {}
          } else if (retryCount < maxRetries) {
            // Payload empty, maybe content not loaded yet
            retryCount++;
            setTimeout(tryExtractFromIframe, 500 * retryCount);
          } else {
            // Max retries reached - try fallback
            tryExtractFromCardDOM();
          }
        } catch (e) {
          // Cross-origin or other error - try fallback
          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(tryExtractFromIframe, 500 * retryCount);
          } else {
            tryExtractFromCardDOM();
          }
        }
      }

      function tryExtractFromCardDOM() {
        if (dataExtracted) return; // Already extracted

        // Try to extract from card DOM itself (fallback for cross-origin iframes)
        try {
          const payload = buildInterstitialPayload(card);
          if (payload) {
            if (creativeUrl) payload.creativeUrl = creativeUrl;
            payload.source = payload.source || "dom_card_fallback";
            payload.isBadge = true;
            Messenger.reportAd(payload);
            dataExtracted = true;
            try {
              card.dataset.adExplorerListExtracted = "true";
            } catch (e) {}
          }
        } catch (e) {}
      }

      if (iframe) {
        tryExtractFromIframe();
        if (iframe.contentWindow) {
          try {
            iframe.addEventListener("load", function onLoad() {
              iframe.removeEventListener("load", onLoad);
              retryCount = 0; // Reset retry count on load event
              tryExtractFromIframe();
            });
          } catch (e) {}
        }
      } else {
        // No iframe - try to extract from card DOM directly
        tryExtractFromCardDOM();
      }
    }

    // Process existing cards
    const cards = document.querySelectorAll(
      'creative-preview, [class*="creative-preview"], .creative-bounding-box, a[href*="/creative/"]',
    );
    for (let i = 0; i < cards.length; i++) {
      processCard(cards[i]);
    }

    // Create observer only once
    if (!listPageObserver) {
      listPageObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue; // Element nodes only

            // Check if the node itself is a card
            if (
              node.matches &&
              node.matches(
                'creative-preview, [class*="creative-preview"], .creative-bounding-box, a[href*="/creative/"]',
              )
            ) {
              processCard(node);
            }

            // Check for cards inside the added node
            if (node.querySelectorAll) {
              const innerCards = node.querySelectorAll(
                'creative-preview, [class*="creative-preview"], .creative-bounding-box, a[href*="/creative/"]',
              );
              for (let i = 0; i < innerCards.length; i++) {
                processCard(innerCards[i]);
              }
            }
          }
        }
      });

      listPageObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  function checkElement(el) {
    try {
      // IGNORE: visual/grid containers that cause duplication or contain bad data
      if (el.closest("priority-creative-grid") || el.closest("creative-grid"))
        return;

      // IGNORE: Specific UI classes causing duplication/false positives
      if (el.closest(".header")) return;

      // IGNORE: Elements inside an already processed interstitial card
      if (el.closest('[data-ad-explorer-interstitial-processed="true"]'))
        return;

      // IGNORE: Elements already processed by AdExplorer
      if (el.dataset.adExplorerProcessed === "true") return;

      const tag = el.tagName.toUpperCase();

      if (el.hasAttribute("data-asoch-meta")) {
        const rawMeta = el.getAttribute("data-asoch-meta");
        if (rawMeta) scanString(rawMeta, "dom_asoch_meta", "meta", el);

        // Removed redundant extraction call to avoid conflict with mys-wrapper scanner
        // extractInterstitialAppData(el.closest('#mys-content') || el.ownerDocument);
      }

      if (el.hasAttribute("data-p")) {
        // Only process VISIBLE data-p elements to filter out hidden/background ads,
        // BUT always allow critical containers like C-WIZ or BODY (fixes 7.html issue)
        const isContainer = tag === "C-WIZ" || tag === "BODY";
        if (isContainer || isElementVisible(el)) {
          const rawDataP = el.getAttribute("data-p");
          if (rawDataP) scanString(rawDataP, "dom_data_p", "data-p", el);
        }
      }

      if (tag === "A" && el.href) {
        // Check strict visibility for links
        if (isElementVisible(el)) {
          scanString(el.href, "dom_link", "a", el);
        }
      }

      if (tag === "IFRAME") {
        if (isElementVisible(el)) {
          if (el.src) scanString(el.src, "dom_iframe_src", "iframe", el);
          if (el.srcdoc && el.srcdoc.length < 5000000) {
            scanString(el.srcdoc, "dom_iframe_srcdoc", "iframe_srcdoc", el);
          }
        }
      }

      if (tag === "SCRIPT") {
        if (el.src) {
          scanString(el.src, "dom_script_src", "script", el);
        } else if (el.innerHTML && el.innerHTML.length < 50000) {
          // Also scan inline scripts (e.g. var adData = {...})
          scanString(el.innerHTML, "dom_script_inline", "script", el);
        }
      }

      if (tag === "FLETCH-RENDERER") {
        // Relaxed visibility for fletch-renderer
        const content = el.innerHTML;
        if (content.length < 500000) {
          scanString(content, "dom_fletch", "renderer", el);
        }
      }

      if (el.classList && el.classList.contains("mys-wrapper")) {
        extractInterstitialAppData(el);
      }

      // Mark element as processed so we don't scan it again
      // FIX: Always lock to prevent infinite loops. MutationObserver will handle new additions.
      el.dataset.adExplorerProcessed = "true";
    } catch (e) {}
  }

  window.AdExplorer.Detector = {
    scanString: scanString,
    scanLink: scanLink, // Kept for API compat but unused internally now
    checkElement: checkElement,
    getFoundCache: () => foundCache,
    clearCache: () => foundCache.clear(),
    scanListPageIframes: scanListPageIframes,
    buildInterstitialPayload: buildInterstitialPayload,
  };
})();
