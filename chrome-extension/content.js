const isMainPage = window === window.top;
let pendingApiDumpResponse = null;

function isTrustedMessageOrigin(event) {
  if (event.source === window && event.origin === window.location.origin)
    return true;
  try {
    const host = new URL(event.origin).hostname;
    return (
      host === "adstransparency.google.com" ||
      host.endsWith(".googlesyndication.com")
    );
  } catch (e) {
    return false;
  }
}

function pageMessageTargetOrigin() {
  return window.location.origin && window.location.origin !== "null"
    ? window.location.origin
    : "https://adstransparency.google.com";
}

function parentMessageTargetOrigin() {
  return "https://adstransparency.google.com";
}

function postToPage(message) {
  window.postMessage(message, pageMessageTargetOrigin());
}

window.addEventListener("message", (event) => {
  if (!isTrustedMessageOrigin(event)) return;
  if (!event.data || event.data.source !== "AD_EXPLORER_API_RECORDER") return;

  if (event.data.type === "API_CALL_CAPTURED" && event.data.payload) {
    try {
      chrome.runtime.sendMessage({
        type: "API_CALL_FOUND",
        payload: event.data.payload,
      });
    } catch (e) {}
  } else if (
    event.data.type === "API_RECORDS_DUMP" &&
    Array.isArray(event.data.payload)
  ) {
    try {
      chrome.runtime.sendMessage({
        type: "API_CALLS_DUMP",
        payload: event.data.payload,
      });
    } catch (e) {}

    if (pendingApiDumpResponse) {
      pendingApiDumpResponse({
        status: "ok",
        count: event.data.payload.length,
      });
      pendingApiDumpResponse = null;
    }
  }
});

function requestApiRecordsDump(sendResponse) {
  pendingApiDumpResponse = sendResponse;
  postToPage({
    source: "AD_EXPLORER_CONTENT",
    type: "REQUEST_API_RECORDS",
  });

  setTimeout(() => {
    if (pendingApiDumpResponse === sendResponse) {
      pendingApiDumpResponse({
        status: "timeout",
        count: 0,
      });
      pendingApiDumpResponse = null;
    }
  }, 1200);
}

if (isMainPage) {
  // Signal to background that a FRESH page load occurred (clears storage)
  chrome.runtime.sendMessage({ action: "PAGE_LOADED" });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.is_scrolling) {
        postToPage({
          source: "AD_EXPLORER_CONTENT",
          type: "SCROLL_STATE_CHANGE",
          isScrolling: changes.is_scrolling.newValue,
        });
      }
      if (
        changes.scrollSettings ||
        changes.scroll_mode ||
        changes.smooth_speed
      ) {
        postToPage({
          source: "AD_EXPLORER_CONTENT",
          type: "UPDATE_SETTINGS",
          payload: {
            scrollSettings: changes.scrollSettings?.newValue,
            scroll_mode: changes.scroll_mode?.newValue,
            smooth_speed: changes.smooth_speed?.newValue,
          },
        });
      }
    }
  });
  function pushInitialState() {
    chrome.storage.local.get(
      [
        "is_scrolling",
        "scroll_mode",
        "smooth_speed",
        "scrollSettings",
        "economy_mode",
        "economy_scroll_only",
      ],
      (res) => {
        postToPage({
          source: "AD_EXPLORER_CONTENT",
          type: "SCROLL_STATE_CHANGE",
          isScrolling: res.is_scrolling || false,
        });

        if (res.scrollSettings || res.scroll_mode || res.smooth_speed) {
          postToPage({
            source: "AD_EXPLORER_CONTENT",
            type: "UPDATE_SETTINGS",
            payload: {
              scrollSettings: res.scrollSettings,
              scroll_mode: res.scroll_mode,
              smooth_speed: res.smooth_speed,
            },
          });
        }

        // Push economy mode settings
        if (res.economy_mode !== undefined) {
          postToPage({
            source: "AD_EXPLORER_CONTENT",
            type: "UPDATE_ECONOMY_MODE",
            payload: res.economy_mode,
          });
        }

        if (res.economy_scroll_only !== undefined) {
          postToPage({
            source: "AD_EXPLORER_CONTENT",
            type: "UPDATE_ECONOMY_SCROLL_ONLY",
            payload: res.economy_scroll_only,
          });
        }
      },
    );
  }
  window.addEventListener("message", (event) => {
    if (!isTrustedMessageOrigin(event)) return;
    if (event.data && event.data.source === "AD_EXPLORER_INJECT") {
      if (event.data.type === "TOGGLE_SCROLL_REQUEST") {
        chrome.storage.local.get(["is_scrolling"], (res) => {
          let newState = !res.is_scrolling;
          if (event.data.forceStop) newState = false;
          if (event.data.forceStart) newState = true;

          // Prevent redundant writes if state matches
          if (res.is_scrolling !== newState) {
            chrome.storage.local.set({ is_scrolling: newState });
          }
        });
      } else if (event.data.type === "READY_FOR_STATE") {
        pushInitialState();
      } else if (event.data.type === "AD_DATA_FOUND") {
        resolveAdUrlWithRetry(event.source, event.data.payload);
      } else if (event.data.type === "AD_BATCH_FOUND") {
        const batch = event.data.payload;
        if (Array.isArray(batch)) {
          batch.forEach((item) => {
            // Pass null if event.source is same window (postMessage quirk)
            resolveAdUrlWithRetry(event.source || window, item);
          });
        }
      }
    }
    // Ads from iframe: resolve creativeUrl from main page DOM and send to background
    if (
      event.data &&
      event.data.source === "AD_EXPLORER_CONTENT" &&
      event.data.type === "AD_FROM_IFRAME"
    ) {
      const payloads = Array.isArray(event.data.payload)
        ? event.data.payload
        : [event.data.payload];
      const iframeWindow = event.source;
      let matchedFrame = null;
      try {
        const frames = document.getElementsByTagName("iframe");
        for (let i = 0; i < frames.length; i++) {
          if (frames[i].contentWindow === iframeWindow) {
            matchedFrame = frames[i];
            break;
          }
        }
      } catch (e) {}
      let creativeUrl = null;
      if (matchedFrame) {
        const box = matchedFrame.closest(".creative-bounding-box");
        const preview = matchedFrame.closest("creative-preview");
        if (box && box.getAttribute("href"))
          creativeUrl = box.getAttribute("href");
        if (!creativeUrl && matchedFrame.closest('a[href*="/creative/"]'))
          creativeUrl = matchedFrame.closest('a[href*="/creative/"]').href;
        if (!creativeUrl && preview) {
          const link = preview.querySelector('a[href*="/creative/"]');
          if (link) creativeUrl = link.href;
        }
        if (creativeUrl && creativeUrl.startsWith("/"))
          creativeUrl = "https://adstransparency.google.com" + creativeUrl;
      }
      payloads.forEach((item) => {
        const finalPayload = creativeUrl ? { ...item, creativeUrl } : item;
        chrome.runtime.sendMessage({ type: "AD_FOUND", payload: finalPayload });
      });
    }
  });
  pushInitialState();
  const MAX_RETRIES = 20;
  const RETRY_DELAY_MS = 100;

  const pendingResolves = new Set();

  function sendAck(uuid) {
    if (!uuid) return;
    postToPage({
      source: "AD_EXPLORER_CONTENT",
      type: "AD_PROCESSED",
      uuid: uuid,
    });
  }

  function resolveAdUrlWithRetry(sourceWindow, payload, attempt = 0) {
    // Use UUID to prevent dropping identical ads in the same batch
    const resolveKey = `${payload.uuid}_${attempt}`;

    if (pendingResolves.has(resolveKey)) {
      return;
    }

    if (payload.creativeUrl) {
      chrome.runtime.sendMessage({ type: "AD_FOUND", payload: payload });
      sendAck(payload.uuid);
      return;
    }

    if (sourceWindow === window) {
      chrome.runtime.sendMessage({ type: "AD_FOUND", payload: payload });
      sendAck(payload.uuid);
      return;
    }

    pendingResolves.add(resolveKey);

    const frames = document.getElementsByTagName("iframe");
    let matchedFrame = null;
    for (let i = 0; i < frames.length; i++) {
      try {
        if (frames[i].contentWindow === sourceWindow) {
          matchedFrame = frames[i];
          break;
        }
      } catch (e) {}
    }

    let finalUrl = null;
    if (matchedFrame) {
      const boundingBox = matchedFrame.closest(".creative-bounding-box");
      const previewContainer = matchedFrame.closest("creative-preview");
      if (boundingBox || previewContainer) {
        if (boundingBox && boundingBox.getAttribute("href")) {
          finalUrl = boundingBox.getAttribute("href");
        }
        if (!finalUrl) {
          const creativeLinkEl = matchedFrame.closest('a[href*="/creative/"]');
          if (creativeLinkEl) {
            finalUrl = creativeLinkEl.href;
          } else if (previewContainer) {
            const link = previewContainer.querySelector(
              'a[href*="/creative/"]',
            );
            if (link) finalUrl = link.href;
          }
        }
        if (finalUrl && finalUrl.startsWith("/")) {
          finalUrl = "https://adstransparency.google.com" + finalUrl;
        }
      }
    } else if (isMainPage) {
      if (window.location.href.includes("/creative/")) {
        finalUrl = window.location.href;
      } else {
        chrome.runtime.sendMessage({ type: "AD_FOUND", payload: payload });
        pendingResolves.delete(resolveKey);
        sendAck(payload.uuid);
        return;
      }
    }

    if (finalUrl) {
      const finalPayload = { ...payload, creativeUrl: finalUrl };
      chrome.runtime.sendMessage({ type: "AD_FOUND", payload: finalPayload });
      pendingResolves.delete(resolveKey);
      sendAck(payload.uuid);
    } else {
      if (attempt < MAX_RETRIES) {
        setTimeout(() => {
          pendingResolves.delete(resolveKey);
          resolveAdUrlWithRetry(sourceWindow, payload, attempt + 1);
        }, RETRY_DELAY_MS);
      } else {
        chrome.runtime.sendMessage({ type: "AD_FOUND", payload: payload });
        pendingResolves.delete(resolveKey);
        sendAck(payload.uuid);
      }
    }
  }
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scroll_bottom") {
      chrome.storage.local.set({ is_scrolling: true });
      sendResponse({ status: "scrolling_started" });
    } else if (request.action === "stop_scroll") {
      chrome.storage.local.set({ is_scrolling: false });
      sendResponse({ status: "scrolling_stopped" });
    } else if (request.action === "PAGE_NAVIGATED") {
      postToPage({
        source: "AD_EXPLORER_CONTENT",
        type: "PAGE_NAVIGATED",
      });
    } else if (request.type === "UPDATE_ECONOMY_MODE") {
      postToPage({
        source: "AD_EXPLORER_CONTENT",
        type: "UPDATE_ECONOMY_MODE",
        payload: request.payload,
      });
      sendResponse({ status: "economy_mode_updated" });
    } else if (request.type === "UPDATE_ECONOMY_SCROLL_ONLY") {
      postToPage({
        source: "AD_EXPLORER_CONTENT",
        type: "UPDATE_ECONOMY_SCROLL_ONLY",
        payload: request.payload,
      });
      sendResponse({ status: "economy_scroll_only_updated" });
    } else if (request.action === "FLUSH_API_RECORDS") {
      requestApiRecordsDump(sendResponse);
      return true;
    }
    return true;
  });
} else {
  // In iframe: forward ad reports to parent so main page can resolve creativeUrl and send to background
  window.addEventListener("message", (event) => {
    if (!isTrustedMessageOrigin(event)) return;
    if (event.data && event.data.source === "AD_EXPLORER_INJECT") {
      if (
        event.data.type === "AD_BATCH_FOUND" &&
        Array.isArray(event.data.payload)
      ) {
        try {
          window.parent.postMessage(
            {
              source: "AD_EXPLORER_CONTENT",
              type: "AD_FROM_IFRAME",
              payload: event.data.payload,
            },
            parentMessageTargetOrigin(),
          );
        } catch (e) {}
      } else if (event.data.type === "AD_DATA_FOUND" && event.data.payload) {
        try {
          window.parent.postMessage(
            {
              source: "AD_EXPLORER_CONTENT",
              type: "AD_FROM_IFRAME",
              payload: [event.data.payload],
            },
            parentMessageTargetOrigin(),
          );
        } catch (e) {}
      }
    }
  });
}
