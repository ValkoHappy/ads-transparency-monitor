(function () {
  "use strict";

  window.AdExplorer = window.AdExplorer || {};

  const iconAndroid = `<svg width="20" height="20" viewBox="0 0 24 24" fill="white" style="display:block; width:20px; height:20px;"><path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.68-.06-.86.22l-1.92 3.32c-1.22-.54-2.58-.85-4.04-.85-1.46 0-2.82.31-4.04.85L6.4 5.67c-.18-.28-.57-.37-.86-.22-.31.15-.42.54-.26.85l1.84 3.18C4.76 10.95 3.5 12.9 3.5 15.1h17c0-2.2-1.26-4.15-3.62-5.62zM9 13c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/></svg>`;

  const iconApple = `<svg width="20" height="20" viewBox="0 0 24 24" fill="white" style="display:block; width:20px; height:20px;"><path d="M17.2,13.2c0-2.9,2.4-4.3,2.5-4.3c-1.4-2-3.6-2.2-4.3-2.3c-1.8-0.2-3.5,1.1-4.4,1.1 c-0.9,0-2.3-1-3.8-1c-2,0-3.8,1.1-4.8,2.8c-2,3.5-0.5,8.8,1.4,11.7c1,1.4,2.1,3,3.6,3c1.4,0,2-0.9,3.8-0.9s2.5,0.9,3.7,0.9 c1.5,0,2.5-1.4,3.4-2.8c1.1-1.6,1.5-3.1,1.5-3.2C19.7,18,17.2,17.1,17.2,13.2z M12.9,5c0.8-1,1.3-2.3,1.2-3.6 c-1.2,0.1-2.6,0.8-3.4,1.8C10,4.1,9.4,5.4,9.5,6.7C10.8,6.8,12.1,6,12.9,5z"/></svg>`;

  const iconUnknown = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" style="display:block; width:20px; height:20px;"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`;

  function getSourcePriority(source) {
    return window.AdExplorer && window.AdExplorer.getSourcePriority
      ? window.AdExplorer.getSourcePriority(source)
      : 5;
  }

  // Registry and Cleanup removed (User Request)

  // Render Queue State
  const renderQueue = [];
  let isRendering = false;
  const BADGES_PER_FRAME = 10; // Process max 10 badges per frame

  function scheduleRender() {
    if (isRendering) return;
    isRendering = true;
    requestAnimationFrame(processQueue);
  }

  function processQueue() {
    if (renderQueue.length === 0) {
      isRendering = false;
      return;
    }

    const batch = renderQueue.splice(0, BADGES_PER_FRAME);

    for (const item of batch) {
      createBadgeDOM(item.data, item.container);
    }

    if (renderQueue.length > 0) {
      requestAnimationFrame(processQueue);
    } else {
      isRendering = false;
    }
  }

  function addBadge(data, container = null) {
    // Dedup logic before queueing (optional but good)
    // For now, just push to queue
    renderQueue.push({ data, container });
    scheduleRender();
  }

  function createBadgeDOM(data, container) {
    // Init vars
    const cleanAppId = (data.appId || "").trim();
    if (!cleanAppId) return;
    data.appId = cleanAppId; // Update ref

    const currentSource = data.source || "unknown";
    const currentPriority = getSourcePriority(currentSource);

    const isMainPage = !!container;
    let targetContainer =
      container || document.body || document.documentElement;

    // CANONICAL CONTAINER SEARCH (Strict: Creative Only)
    // Normalize detections to the main creative wrapper
    const strictSelectors = [
      ".creative.creative-si",
      "creative", // Custom element tag support
      ".creative-si",
      ".creative",
      "c-wiz[data-p]", // Google Ads Standard
      ".ad-container", // Common Wrapper
      ".ad-details", // Common Wrapper
    ];

    let canonical = null;
    // 1. Local Upgrade: If we have a container, look up
    if (targetContainer && targetContainer.closest) {
      for (const selector of strictSelectors) {
        const found = targetContainer.closest(selector);
        if (found) {
          canonical = found;
          break;
        }
      }
    }

    // 2. Global Fallback: If no local context (or body), look for FIRST creative
    // Required for 10.html support (global detection)
    if (!canonical) {
      const tag = targetContainer
        ? targetContainer.tagName
          ? targetContainer.tagName.toUpperCase()
          : ""
        : "";
      if (!targetContainer || ["BODY", "HTML"].includes(tag)) {
        for (const selector of strictSelectors) {
          const found = document.querySelector(selector);
          if (found) {
            canonical = found;
            break;
          }
        }
      }
    }

    if (canonical) targetContainer = canonical;

    // REFINEMENT: User prefers .creative-container if available inside the creative
    // This moves the badge from <creative> -> <div class="creative-container">
    if (targetContainer) {
      const innerContainer = targetContainer.querySelector(
        ".creative-container",
      );
      if (innerContainer) {
        targetContainer = innerContainer;
        // Ensure relative position for the new inner container
        const style = window.getComputedStyle(targetContainer);
        if (style.position === "static") {
          targetContainer.style.position = "relative";
        }
      }
    }

    // VISIBILITY CHECK: Prevent ghost badges
    try {
      if (targetContainer) {
        const style = window.getComputedStyle(targetContainer);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          return; // Skip hidden
        }
        const rect = targetContainer.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) {
          return; // Skip too small
        }
      }
    } catch (e) {}

    // Final Guard: If still BODY/HTML, abort
    if (targetContainer) {
      const tag = targetContainer.tagName
        ? targetContainer.tagName.toUpperCase()
        : "";
      if (
        [
          "SCRIPT",
          "META",
          "HEAD",
          "STYLE",
          "LINK",
          "TITLE",
          "NOSCRIPT",
          "BODY",
          "HTML",
        ].includes(tag)
      ) {
        return;
      }
    }

    const badgeId =
      "ad-badge-" +
      data.appId.replace(/[^a-zA-Z0-9]/g, "-") +
      "-" +
      (data.source || "unknown").replace(/[^a-zA-Z0-9]/g, "-");

    // Fast measuring - ideally should be separated from writing, but inside this function it's ok if batch is small
    // const currentPriority = getSourcePriority(data.source); // ALREADY DECLARED AT TOP
    // HIERARCHICAL DEDUPLICATION (Standard DOM-based)
    // Check if any PARENT or CHILD of the targetContainer already has a badge for this App ID
    const allBadgesForApp = document.querySelectorAll(
      `.ad-badge-overlay[data-app-id="${data.appId}"]`,
    );
    for (const otherBadge of allBadgesForApp) {
      const otherContainer = otherBadge.parentElement;
      if (!otherContainer) continue;

      const isParent = otherContainer.contains(targetContainer);
      const isChild = targetContainer.contains(otherContainer);
      const isSame = otherContainer === targetContainer;

      if (isParent || isChild || isSame) {
        // Collision found in hierarchy!
        const otherSource = otherBadge.dataset.source || "unknown";
        const otherPriority = getSourcePriority(otherSource);

        if (otherPriority > currentPriority) {
          // Existing one is better, abort new
          return;
        } else if (otherPriority === currentPriority) {
          // Same priority. Prefer existing if parent, or if same.
          if (isParent || isSame) return;
          otherBadge.remove();
        } else {
          // New one is higher priority, remove old
          otherBadge.remove();
        }
      }
    }

    if (targetContainer.querySelector("#" + badgeId)) return;

    let badge = document.createElement("div");
    badge.id = badgeId;
    badge.dataset.appId = data.appId;
    badge.dataset.source = data.source || "unknown";

    if (isMainPage) {
      const style = window.getComputedStyle(targetContainer);
      if (style.position === "static") {
        targetContainer.style.position = "relative";
      }
    }

    let offsetTop = 0;
    const currentBadges = targetContainer.querySelectorAll(".ad-badge-overlay");
    offsetTop = currentBadges.length * 40;

    let scale = 1.0;
    // Optimization: Cache this if possible, or assume 1.0 mostly
    try {
      const rect = document.documentElement.getBoundingClientRect();
      if (rect.width > 0 && window.innerWidth > 0) {
        const calculatedScale = window.innerWidth / rect.width;
        if (calculatedScale > 0.1 && calculatedScale < 1.0) {
          scale = 1 / calculatedScale;
        }
      }
    } catch (e) {}

    const bgColor =
      data.type === "Google Play"
        ? "#34a853"
        : data.type === "App Store"
          ? "#007aff"
          : "#636e72";

    badge.className = "ad-badge-overlay";
    badge.style.cssText = `
            all: initial;
            box-sizing: border-box;
            position: absolute;
            top: ${offsetTop}px;
            left: 0;
            z-index: 100;
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            background-color: ${bgColor} !important;
            color: white !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
            border-radius: 0 0 10px 0 !important;
            box-shadow: 0 3px 6px rgba(0,0,0,0.3) !important;
            padding: 6px 12px !important;
            cursor: default !important;
            transition: opacity 0.3s ease !important;
            white-space: nowrap !important;
            transform-origin: top left !important;
            transform: scale(${scale.toFixed(2)}) !important;
            pointer-events: auto !important;
            visibility: visible !important;
            opacity: 1 !important;
        `;

    const iconSrc =
      data.type === "Google Play"
        ? iconAndroid
        : data.type === "App Store"
          ? iconApple
          : iconUnknown;

    const rawDisplayId =
      data.appName &&
      (data.appId.startsWith("icon_") || data.appId.startsWith("name_"))
        ? data.appName
        : data.appId;
    const displayId =
      rawDisplayId.length > 35
        ? rawDisplayId.substring(0, 32) + "..."
        : rawDisplayId;

    const iconWrapper = document.createElement("div");
    iconWrapper.style.cssText =
      "display:flex !important; align-items:center !important; justify-content:center !important; margin-right: 8px !important; width: 20px !important; height: 20px !important; min-width: 20px !important; overflow: visible !important;";
    iconWrapper.innerHTML = iconSrc;

    const textWrapper = document.createElement("div");
    textWrapper.style.cssText =
      "all: initial; line-height: 1.2 !important; text-align: left !important; display: flex !important; flex-direction: column !important; justify-content: center !important; color: white !important; font-family: inherit !important;";

    const typeDiv = document.createElement("div");
    typeDiv.style.cssText =
      "all: initial; font-weight: bold !important; font-size: 9px !important; opacity: 0.9 !important; white-space: nowrap !important; margin-bottom: 1px !important; color: white !important; font-family: inherit !important; display: block !important;";

    // Add indicators for found fields (T=Title, D=Description, I=Image, V=Video)
    let indicators = "";
    if (data.title) indicators += "T";
    if (data.description) indicators += "D";
    if (data.mainImageUrl) indicators += "I";
    if (data.mainVideoUrl) indicators += "V";

    typeDiv.textContent = data.type + (indicators ? " " + indicators : "");

    const idDiv = document.createElement("div");
    idDiv.style.cssText =
      "all: initial; font-size: 13px !important; font-weight: 700 !important; white-space: nowrap !important; color: white !important; font-family: inherit !important; display: block !important; cursor: copy !important;";
    idDiv.textContent = displayId;
    idDiv.title = "Click to copy App ID";

    idDiv.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      navigator.clipboard.writeText(data.appId).then(() => {
        const originalText = idDiv.textContent;
        idDiv.textContent = "Copied!";
        idDiv.style.color = "#afffaf";
        setTimeout(() => {
          idDiv.textContent = originalText;
          idDiv.style.color = "white";
        }, 1000);
      });
    });

    textWrapper.appendChild(typeDiv);
    textWrapper.appendChild(idDiv);

    if (data.source) {
      const sourceDiv = document.createElement("div");
      sourceDiv.style.cssText = "display: none !important;";
      sourceDiv.textContent = `src: ${data.source}`;
      textWrapper.appendChild(sourceDiv);
    }

    badge.appendChild(iconWrapper);
    badge.appendChild(textWrapper);

    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });

    (targetContainer || document.body || document.documentElement).appendChild(
      badge,
    );

    // Register in Spatial Memory REMOVED
  }

  window.AdExplorer.Badge = {
    addBadge: addBadge,
  };
})();
