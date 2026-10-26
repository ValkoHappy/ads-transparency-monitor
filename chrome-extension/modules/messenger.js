/**
 * AdExplorer Messenger Module
 * Message passing and ad reporting queue
 */
(function () {
    'use strict';

    window.AdExplorer = window.AdExplorer || {};

    const Utils = window.AdExplorer.Utils;

    // State
    let adReportQueue = [];
    let adReportTimer = null;
    let isScrolling = false;  // Track whether auto-scroll is currently running
    let bestConfidence = 0;
    let lastReportedId = 0;

    function pageMessageTargetOrigin() {
        return window.location.origin && window.location.origin !== 'null'
            ? window.location.origin
            : 'https://adstransparency.google.com';
    }

    function topMessageTargetOrigin() {
        return 'https://adstransparency.google.com';
    }

    function postToContent(payload) {
        window.postMessage(payload, pageMessageTargetOrigin());
    }

    function postToTop(payload) {
        window.top.postMessage(payload, topMessageTargetOrigin());
    }

    function isSameWindowContentMessage(event) {
        return event.source === window && (!event.origin || event.origin === window.location.origin);
    }

    function isTrustedIframeMessage(event) {
        if (event.source === window) return false;
        try {
            const hostname = new URL(event.origin).hostname.toLowerCase();
            return hostname === 'adstransparency.google.com' || hostname.endsWith('.googlesyndication.com');
        } catch (e) {
            return false;
        }
    }

    /**
     * Initializes the messenger 
     */
    /**
     * Flush queued ads to content script
     */
    function flushAdReportQueue() {
        if (adReportQueue.length === 0) return;

        const payload = {
            source: 'AD_EXPLORER_INJECT',
            type: 'AD_BATCH_FOUND',
            payload: adReportQueue
        };

        postToContent(payload);

        if (window.top !== window) {
            try {
                postToTop(payload);
            } catch (e) { }
        }

        adReportQueue = [];
        adReportTimer = null;
    }

    /**
     * Report found ad (main entry point)
     */
    /**
     * Enrich ad data with derived fields
     */
    function enrichData(data) {
        // Validate Google Play package
        if (data.type === 'Google Play') {
            if (!Utils.isValidPackageId(data.appId)) return null;
        }

        // Enrich with creative URL
        if (!data.creativeUrl) {
            if (window.location.href.includes('/creative/')) {
                data.creativeUrl = window.location.href;
            }
        }

        // Generate store URL
        if (!data.storeUrl) {
            if (data.type === 'Google Play') {
                data.storeUrl = `https://play.google.com/store/apps/details?id=${data.appId}`;
            } else if (data.type === 'App Store') {
                data.storeUrl = `https://apps.apple.com/app/id${data.appId}`;
            } else {
                data.storeUrl = `https://www.google.com/search?q=${data.appId}`;
            }
        }

        // Calculate confidence
        if (!data.confidence) {
            if (data.source.includes('adData')) data.confidence = 3;
            else if (data.source.includes('structure') || data.source.includes('dest_url') ||
                data.source.includes('dom_link_href') || data.source.includes('dom_asoch_meta')) data.confidence = 3;
            else if (data.source.includes('redirect')) data.confidence = 2;
            else data.confidence = 1;
        }

        // Generate UUID
        if (!data.uuid) data.uuid = Utils.generateUUID();

        // Use appName as title when title not set (e.g. from DOM interstitial)
        if (!data.title && data.appName) data.title = data.appName;

        return data;
    }

    // Session-level cache to prevent re-reporting the same ad ID indefinitely
    const sentAdsCache = new Set();

    /**
     * Report found ad (main entry point)
     */
    /**
     * Report found ad (main entry point)
     */
    function reportAd(data) {
        if (!data) return;

        data = enrichData(data);
        if (!data) return;

        // 1. Check strict session duplicate
        const safeStore = data.storeUrl || '';
        const safeCreative = data.creativeUrl || '';
        const cacheKey = `${data.appId}|${safeStore}|${safeCreative}`;

        // If we already sent this EXACT combination, ignore.
        // sentAdsCache.has(cacheKey) check REMOVED to support multiple ad cards for same app
        // if (sentAdsCache.has(cacheKey)) return;

        // 2. Check duplicates in current batch - MERGE data instead of replacing
        const existingIndex = adReportQueue.findIndex(ad =>
            ad.appId === data.appId &&
            (ad.storeUrl || '') === safeStore &&
            (ad.creativeUrl || '') === safeCreative
        );
        
        if (existingIndex !== -1) {
            // Found duplicate in queue - MERGE new data into existing
            const existing = adReportQueue[existingIndex];
            
            // Merge: fill empty fields from new data
            if (data.title && !existing.title) existing.title = data.title;
            if (data.description && !existing.description) existing.description = data.description;
            if (data.mainImageUrl && !existing.mainImageUrl) existing.mainImageUrl = data.mainImageUrl;
            if (data.mainVideoUrl && !existing.mainVideoUrl) existing.mainVideoUrl = data.mainVideoUrl;
            if (data.appName && !existing.appName) existing.appName = data.appName;
            if (data.creativeUrl && !existing.creativeUrl) existing.creativeUrl = data.creativeUrl;
            if (data.storeUrl && !existing.storeUrl) existing.storeUrl = data.storeUrl;
            
            // Update source if new one has higher priority
            if (data.source && data.confidence && (!existing.confidence || data.confidence > existing.confidence)) {
                existing.source = data.source;
                existing.confidence = data.confidence;
            }
            
            return; // Don't add duplicate
        }

        // Track
        lastReportedId = data.appId;
        bestConfidence = data.confidence;
        sentAdsCache.add(cacheKey);

        // Queue and schedule flush
        adReportQueue.push(data);

        if (!adReportTimer) {
            // Wait 200ms to collect all data from multiple sources before sending
            // This allows time for:
            // 1. appId detection
            // 2. title/description extraction from DOM
            // 3. image/video URL extraction
            // All data will be merged in the queue before sending
            // Increased from 100ms to 200ms to ensure all DOM extraction completes
            adReportTimer = setTimeout(flushAdReportQueue, 200);
        }
    }

    /**
     * Simple reportAd for iframe usage (no enrichment)
     */
    function reportAdSimple(data) {
        if (!data) return;
        const payload = {
            source: 'AD_EXPLORER_INJECT',
            type: 'AD_DATA_FOUND',
            payload: data
        };
        postToContent(payload);
        if (window.top !== window) {
            try {
                postToTop(payload);
            } catch (e) { }
        }
    }

    /**
     * True if we have collected at least one of title/description/image/video (full data from iframe).
     * Economy clear should run only after that, so we don't remove DOM before the full report is sent.
     */
    function hasCollectedMeta(data) {
        return !!(data && (data.title || data.description || data.mainImageUrl || data.mainVideoUrl));
    }

    /**
     * Queue a card for economy clearing (batched, non-blocking)
     */
    function scheduleEconomyClear(rootCard) {
        if (!rootCard) return;
        if (rootCard.dataset.economyCleared === 'true') return;
        
        // CRITICAL: Delay clearing to ensure data is sent first
        // Data is sent after 10ms, so we wait 100ms to be safe
        setTimeout(() => {
            if (rootCard.dataset.economyCleared === 'true') return; // Already cleared
            pendingClearQueue.add(rootCard);
            if (!isClearQueueRunning) {
                processClearQueue();
            }
        }, 100); // Wait 100ms before clearing to ensure data is sent
    }

    // Throttled clearing queue for economy mode (max 5 per frame)
    const pendingClearQueue = new Set();
    let isClearQueueRunning = false;

    function processClearQueue() {
        if (pendingClearQueue.size === 0) {
            isClearQueueRunning = false;
            return;
        }

        isClearQueueRunning = true;
        window.requestAnimationFrame(() => {
            let processed = 0;
            const itemsToClear = [];

            // Extract up to 5 items to clear in this frame
            for (const item of pendingClearQueue) {
                if (processed >= 5) break;
                itemsToClear.push(item);
                processed++;
            }

            // Execute the DOM wipe
            for (const rootCard of itemsToClear) {
                try {
                    rootCard.innerHTML = '';
                    rootCard.style.minHeight = '350px';
                    rootCard.style.backgroundColor = 'transparent';
                    rootCard.dataset.economyCleared = 'true';
                } catch (e) { }
                pendingClearQueue.delete(rootCard);
            }

            // If there's more pending, schedule the next batch
            if (pendingClearQueue.size > 0) {
                setTimeout(processClearQueue, 30); // 30ms wait guarantees a smooth scroll paint
            } else {
                isClearQueueRunning = false;
            }
        });
    }

    /**
     * Initialize top-level message handler
     */
    function init() {
        if (window !== window.top) return;

        window.addEventListener('message', (event) => {
            if (event.data && event.data.source === 'AD_EXPLORER_CONTENT') {
                if (!isSameWindowContentMessage(event)) return;
                if (event.data.type === 'UPDATE_ECONOMY_MODE') {
                    if (window.AdExplorer.CONFIG) {
                        window.AdExplorer.CONFIG.ECONOMY_MODE = event.data.payload;
                    }
                } else if (event.data.type === 'UPDATE_ECONOMY_SCROLL_ONLY') {
                    if (window.AdExplorer.CONFIG) {
                        window.AdExplorer.CONFIG.ECONOMY_SCROLL_ONLY = event.data.payload;
                    }
                } else if (event.data.type === 'SCROLL_STATE_CHANGE') {
                    const wasScrolling = isScrolling;
                    isScrolling = !!event.data.isScrolling;

                    if (!wasScrolling && isScrolling) {
                        const cfg = window.AdExplorer.CONFIG;
                        // Retroactive sweep: If we just started auto-scroll, and "Only On Scroll" is active,
                        // clear any cards that were previously parsed while scrolling was off.
                        if (cfg && cfg.ECONOMY_MODE && cfg.ECONOMY_SCROLL_ONLY) {
                            // Find ALL creative cards on page
                            const allCreatives = document.querySelectorAll(
                                'creative-preview, creative, c-wiz[data-p], .creative.creative-si, .mys-wrapper'
                            );
                            allCreatives.forEach(rootCard => {
                                // Skip if already cleared
                                if (rootCard.dataset.economyCleared === 'true') return;
                                
                                // CRITICAL: Only remove if this card has been processed (data collected)
                                // Check if any child element has processing markers
                                const hasBeenProcessed = rootCard.querySelector(
                                    '[data-ad-explorer-processed="true"], [data-ad-explorer-scanned="true"], [data-ad-explorer-interstitial-processed="true"], [data-ad-uuid]'
                                ) || rootCard.dataset.adExplorerProcessed === 'true' || rootCard.dataset.adExplorerScanned === 'true';
                                
                                if (hasBeenProcessed) {
                                    scheduleEconomyClear(rootCard);
                                }
                            });
                        }
                    }
                }
            } else if (event.data && event.data.source === 'AD_EXPLORER_INJECT') {
                // FIX: Prevent loopback! If the message comes from the same window, ignore it inside this global listener.
                // Local ads are handled by reportLocalAd -> Badge.addBadge directly.
                // This listener is ONLY for iframes reporting up.
                if (!isTrustedIframeMessage(event)) return;

                if (event.data.type === 'AD_DATA_FOUND') {
                    handleTopLevelAd(event.source, event.data.payload);
                } else if (event.data.type === 'AD_BATCH_FOUND' && Array.isArray(event.data.payload)) {
                    event.data.payload.forEach(ad => handleTopLevelAd(event.source, ad));
                }
            }
        });
    }

    /**
     * Handle ad from iframe
     */
    function handleTopLevelAd(sourceWindow, adData) {
        const iframes = document.querySelectorAll('iframe');
        let sourceIframe = null;

        for (let i = 0; i < iframes.length; i++) {
            try {
                if (iframes[i].contentWindow === sourceWindow) {
                    sourceIframe = iframes[i];
                    break;
                }
            } catch (e) { }
        }

        if (!sourceIframe) return;

        const container = Utils.findStableParent(sourceIframe);

        // CRITICAL: Always report data to popup FIRST, before any economy mode logic
        // This ensures data is not lost even when elements are removed
        if (adData) {
            adData.isBadge = true;
            const enrichedData = enrichData(adData);
            if (enrichedData) {
                reportAd(enrichedData);
            }
        }

        // ECONOMY MODE LOGIC
        const isCreativePage = window.location.href.includes('/creative/');
        const cfg = window.AdExplorer.CONFIG;
        const isEconomyMode = cfg && cfg.ECONOMY_MODE && (!cfg.ECONOMY_SCROLL_ONLY || isScrolling);

        // DISABLE ECONOMY MODE on /creative/ page
        if (isEconomyMode && !isCreativePage) {
            if (container && hasCollectedMeta(adData)) {
                try {
                    // Try to find the absolute root card to remove to save memory (only after full data collected)
                    const rootCard = container.closest('creative-preview') || container.closest('c-wiz[data-p]') || container.closest('.creative.creative-si') || container.closest('creative') || container;
                    scheduleEconomyClear(rootCard);
                } catch (e) { }
            }
            return; // Skip drawing badge entirely in economy mode
        }

        // Draw badge only if: economy mode OFF OR we're on creative page
        if (container && window.AdExplorer.Badge) {
            // ENABLED: Top-level drawing for iframe ads.
            window.AdExplorer.Badge.addBadge(adData, container);
        }
    }

    /**
     * Report ad found in the current frame (no postMessage needed for DOM attachment)
     */
    function reportLocalAd(data, element) {
        if (!data) return;

        // Mark as coming effectively from a badge/visual scan
        data.isBadge = true;

        data = enrichData(data);
        if (!data) return;

        // ECONOMY MODE LOGIC
        const cfg = window.AdExplorer.CONFIG;
        let isEconomyMode = cfg && cfg.ECONOMY_MODE && (!cfg.ECONOMY_SCROLL_ONLY || isScrolling);

        // DISABLE ECONOMY MODE COMPLETELY ON SINGLE CREATIVE PAGE
        if (window.location.href.includes('/creative/')) {
            isEconomyMode = false;
        }

        // Also report upstream for stats/storage FIRST to ensure it's not lost
        reportAd(data);

        // NEVER clear DOM when we're inside an iframe: that iframe may be the creative (video/image) on the creative page
        if (window !== window.top) return;

        if (isEconomyMode) {
            // we already know it's not a creative page here (top window only)
            if (element) {
                try {
                    // User requirement: find <creative-preview> specifically inside <priority-creative-grid> inside <creative-grid>
                    let rootCard = null;
                    if (element.closest) {
                        rootCard = element.closest('creative-preview');
                    }

                    if (rootCard && hasCollectedMeta(data)) {
                        // verify the strict hierarchy
                        const priorityGrid = rootCard.closest('priority-creative-grid');
                        if (priorityGrid) {
                            const mainGrid = priorityGrid.closest('creative-grid');
                            if (mainGrid) {
                                // Empty the contents only after full data collected (title/description/image/video)
                                scheduleEconomyClear(rootCard);
                                return; // Exit early, NO BADGES in economy mode.
                            }
                        }
                    }

                    // Fallback for non-grid (like single items or different layouts) 
                    // only if it really has no preview wrapper — and only when we have collected meta
                    if (!rootCard && element.closest && hasCollectedMeta(data)) {
                        rootCard = element.closest('c-wiz[data-p]') ||
                            element.closest('.creative.creative-si') ||
                            element.closest('creative');
                        if (rootCard) {
                            scheduleEconomyClear(rootCard);
                        }
                    }

                } catch (e) { }
            }
            return; // Exit early, NO BADGES in economy mode (whether removed or kept)
        }

        // Direct badge attachment if Badge module is available
        if (window.AdExplorer.Badge && element) {
            // SWAP: Only draw locally if we are Top Level. If we are in iframe, let Top Level draw it.
            if (window === window.top) {
                // Find a suitable container (the card) rather than the tiny element itself
                const container = window.AdExplorer.Utils.findStableParent(element) || element;
                window.AdExplorer.Badge.addBadge(data, container);
            }
        }
    }

    // Export
    window.AdExplorer.Messenger = {
        init: init,
        reportAd: reportAd,
        reportAdSimple: reportAdSimple,
        reportLocalAd: reportLocalAd,
        flushQueue: flushAdReportQueue,
        getLastReportedId: () => lastReportedId,
        getBestConfidence: () => bestConfidence
    };


})();
