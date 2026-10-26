importScripts("shared.js");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "AD_FOUND") {
    const tabId = sender.tab ? sender.tab.id : null;
    const tabUrl = sender.tab ? sender.tab.url : null;
    if (tabId) {
      saveAd(tabId, request.payload, tabUrl);
    }
  } else if (request.type === "API_CALL_FOUND") {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
      saveApiCall(tabId, request.payload);
    }
  } else if (request.type === "API_CALLS_DUMP") {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId && Array.isArray(request.payload)) {
      saveApiCalls(tabId, request.payload);
    }
  } else if (request.action === "PAGE_LOADED") {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
      chrome.storage.local.remove([
        `active_ad_${tabId}`,
        `ads_${tabId}`,
        `api_calls_${tabId}`,
      ]);
    }
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove([
    `active_ad_${tabId}`,
    `ads_${tabId}`,
    `api_calls_${tabId}`,
  ]);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["scrollSettings", "collection_enabled"], (res) => {
    if (!res.scrollSettings) {
      chrome.storage.local.set({
        scrollSettings: { step: 70, wait: 3.5 },
        is_scrolling: false,
        scroll_mode: "fast",
        smooth_speed: 50,
      });
    }
    if (res.collection_enabled === undefined) {
      chrome.storage.local.set({ collection_enabled: true });
    }
  });
});

const tabUrls = {};

function getAdvertiserId(url) {
  const match = url.match(/\/advertiser\/([^/?#]+)/);
  return match ? match[1] : null;
}

function getCreativeId(url) {
  const match = url.match(/\/creative\/([^/?#]+)/);
  return match ? match[1] : null;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.url) {
    tabUrls[tabId] = tab.url;
    chrome.tabs
      .sendMessage(tabId, { action: "PAGE_NAVIGATED" })
      .catch(() => {});
  }
});

const adBuffers = {};
const bufferTimers = {};
const apiCallBuffers = {};
const apiCallTimers = {};

function saveAd(tabId, adData, tabUrl) {
  chrome.storage.local.get(["collection_enabled"], (res) => {
    if (res.collection_enabled === false) return;
    saveAdInner(tabId, adData, tabUrl);
  });
}

function saveAdInner(tabId, adData, tabUrl) {
  // FIX: Fallback for Creative Page context (where iframe location is invalid but Tab URL is valid)
  // If the ad comes from an iframe (invalid/missing link) but the USER is on the Creative Page, use the Page URL.
  if (
    !adData.creativeUrl ||
    (adData.creativeUrl &&
      (adData.creativeUrl.includes("googlesyndication") ||
        adData.creativeUrl.includes("container.html")))
  ) {
    if (tabUrl && tabUrl.includes("/creative/")) {
      adData.creativeUrl = tabUrl;
    }
  }

  // 1. Handle Active Ad immediately (for badge consistency)
  const activeKey = `active_ad_${tabId}`;
  if (tabUrl && adData.creativeUrl && tabUrl.includes(adData.creativeUrl)) {
    chrome.storage.local.get([activeKey], (res) => {
      const currentActive = res[activeKey];
      if (adData.isBadge) {
        chrome.storage.local.set({ [activeKey]: adData });
        return;
      }

      if (
        !currentActive ||
        getSourcePriority(adData.source) >=
          getSourcePriority(currentActive.source)
      ) {
        if (currentActive && currentActive.isBadge && !adData.isBadge) return;
        chrome.storage.local.set({ [activeKey]: adData });
      }
    });
  } else if (adData.isBadge) {
    chrome.storage.local.set({ [activeKey]: adData });
  }

  // 2. Buffer List Ads
  if (!adBuffers[tabId]) {
    adBuffers[tabId] = [];
  }
  adBuffers[tabId].push(adData);

  // 3. Schedule Flush
  if (bufferTimers[tabId]) clearTimeout(bufferTimers[tabId]);

  bufferTimers[tabId] = setTimeout(() => {
    flushBuffer(tabId);
  }, 300);
}

function flushBuffer(tabId) {
  const key = `ads_${tabId}`;
  const buffer = adBuffers[tabId];

  adBuffers[tabId] = []; // clear buffer immediately
  delete bufferTimers[tabId];

  if (!buffer || buffer.length === 0) return;

  chrome.storage.local.get([key], (result) => {
    let ads = result[key] || [];

    // --- OPTIMIZATION: Use Map for O(1) Lookup ---
    const adMap = new Map();

    // Helper to generate composite key
    const getCompositeKey = (ad) => {
      // DEDUPLICATION: User requested stricter deduplication.
      // If we have a Creative URL, that defines the ad's identity.
      if (ad.creativeUrl) return `creative:${ad.creativeUrl}`;

      // Fallback: AppID + StoreURL
      return `comp:${ad.appId}|${ad.storeUrl || ""}`;
    };

    // 1. Populate Map from existing storage
    if (Array.isArray(ads)) {
      ads.forEach((ad) => {
        const k = getCompositeKey(ad);
        if (k) adMap.set(k, ad);
      });
    }

    // 2. Process Buffer
    for (const newAd of buffer) {
      const compositeKey = getCompositeKey(newAd);

      if (adMap.has(compositeKey)) {
        // UPDATE / MERGE
        const existing = adMap.get(compositeKey);
        let hasChanges = false;

        // Update URLs if new data has them AND (they are different OR existing is empty)
        if (
          newAd.creativeUrl &&
          (!existing.creativeUrl || existing.creativeUrl !== newAd.creativeUrl)
        ) {
          existing.creativeUrl = newAd.creativeUrl;
          hasChanges = true;
        }
        if (
          newAd.storeUrl &&
          (!existing.storeUrl || existing.storeUrl !== newAd.storeUrl)
        ) {
          existing.storeUrl = newAd.storeUrl;
          hasChanges = true;
        }

        // Update metadata fields: if new data has them AND (existing is empty OR they are different)
        if (
          newAd.appName &&
          (!existing.appName || existing.appName !== newAd.appName)
        ) {
          existing.appName = newAd.appName;
          hasChanges = true;
        }
        if (
          newAd.title &&
          (!existing.title || existing.title !== newAd.title)
        ) {
          existing.title = newAd.title;
          hasChanges = true;
        }
        if (
          newAd.description &&
          (!existing.description || existing.description !== newAd.description)
        ) {
          existing.description = newAd.description;
          hasChanges = true;
        }
        if (
          newAd.mainImageUrl &&
          (!existing.mainImageUrl ||
            existing.mainImageUrl !== newAd.mainImageUrl)
        ) {
          existing.mainImageUrl = newAd.mainImageUrl;
          hasChanges = true;
        }
        if (
          newAd.mainVideoUrl &&
          (!existing.mainVideoUrl ||
            existing.mainVideoUrl !== newAd.mainVideoUrl)
        ) {
          existing.mainVideoUrl = newAd.mainVideoUrl;
          hasChanges = true;
        }

        // Update source only if new source has higher priority
        if (newAd.source) {
          const newPriority = getSourcePriority(newAd.source);
          const existingPriority = getSourcePriority(existing.source);
          if (
            newPriority >= existingPriority &&
            existing.source !== newAd.source
          ) {
            existing.source = newAd.source;
            hasChanges = true;
          }
        }

        // CRITICAL: Always update map to ensure changes are saved
        // Even if hasChanges is false, we need to keep the reference updated
        adMap.set(compositeKey, existing);
      } else {
        // INSERT NEW
        // CRITICAL FIX: Accept ads even without creativeUrl initially
        // They will get creativeUrl added later via merge when content.js resolves it
        let isValid = false;
        if (newAd.creativeUrl) {
          const low = newAd.creativeUrl.toLowerCase();
          if (
            !low.includes("googlesyndication") &&
            !low.includes("safeframe") &&
            !low.includes("container.html")
          ) {
            isValid = true;
          }
        }

        // ALWAYS insert if we have isBadge flag (data from visual scan)
        // OR if creativeUrl is valid
        if (isValid || newAd.isBadge) {
          adMap.set(compositeKey, newAd);
        }
      }
    }

    // 3. Convert back to array
    let updatedAds = Array.from(adMap.values());

    // Safety Cap: Keep only last 10000
    if (updatedAds.length > 10000) {
      updatedAds = updatedAds.slice(updatedAds.length - 10000);
    }

    chrome.storage.local.set({ [key]: updatedAds });
  });
}

function saveApiCall(tabId, apiCall) {
  saveApiCalls(tabId, [apiCall]);
}

function saveApiCalls(tabId, apiCalls) {
  if (!apiCalls || apiCalls.length === 0) return;

  if (!apiCallBuffers[tabId]) {
    apiCallBuffers[tabId] = [];
  }

  apiCallBuffers[tabId].push(...apiCalls);

  if (apiCallTimers[tabId]) clearTimeout(apiCallTimers[tabId]);

  apiCallTimers[tabId] = setTimeout(() => {
    flushApiCallBuffer(tabId);
  }, 250);
}

function flushApiCallBuffer(tabId) {
  const key = `api_calls_${tabId}`;
  const buffer = apiCallBuffers[tabId] || [];
  apiCallBuffers[tabId] = [];
  delete apiCallTimers[tabId];

  if (buffer.length === 0) return;

  chrome.storage.local.get([key], (result) => {
    const existing = Array.isArray(result[key]) ? result[key] : [];
    const byId = new Map();

    existing.forEach((item) => {
      if (item && item.id) byId.set(item.id, item);
    });

    buffer.forEach((item) => {
      if (!item) return;
      const id =
        item.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      byId.set(id, { ...item, id });
    });

    let updated = Array.from(byId.values());
    updated.sort((a, b) =>
      String(a.capturedAt || "").localeCompare(String(b.capturedAt || "")),
    );

    if (updated.length > 1000) {
      updated = updated.slice(updated.length - 1000);
    }

    chrome.storage.local.set({ [key]: updated });
  });
}
