(function () {
    'use strict';

    window.AdExplorer = window.AdExplorer || {};

    let observer = null;
    let observerTimeout = null;
    let bufferedNodes = new Set();

    const heartbeatParams = {
        startTime: Date.now(),
        scanCount: 0
    };

    const TARGET_SELECTOR = 'a:not([data-economy-cleared="true"]), iframe:not([data-economy-cleared="true"]), script:not([data-economy-cleared="true"]), [data-asoch-meta]:not([data-economy-cleared="true"]), [data-p]:not([data-economy-cleared="true"]), fletch-renderer:not([data-economy-cleared="true"]), .mys-wrapper:not([data-economy-cleared="true"])';

    // Remove priority-creative-grid elements ONLY if we are on a Creative Detail page (or test file).
    // On Advertiser List pages, this grid contains the actual ads we want to scan!
    function cleanupPriorityGrids(root) {
        if (!root || !root.querySelectorAll) return 0;

        const url = window.location.href.toLowerCase();
        // Check if we are on a Creative Detail page (Live) or Local File (Test)
        const isCreativePage = url.includes('/creative/') || url.includes('creative=');
        const isLocalFile = window.location.protocol === 'file:';

        // If it's an Advertiser List page (and NOT a creative view), DO NOT delete the grid.
        if (!isCreativePage && !isLocalFile) {
            return 0;
        }

        // The user explicitly requested to remove these blocks first as they contain "left" creatives
        const grids = root.querySelectorAll('priority-creative-grid, creative-grid');
        grids.forEach(grid => {
            grid.remove();
        });
        return grids.length;
    }

    function deepScan(root) {
        if (!root) return;

        // Remove priority-creative-grid elements BEFORE scanning
        cleanupPriorityGrids(root);

        const Detector = window.AdExplorer.Detector;
        if (!Detector) return;

        // Check root itself
        if (root.nodeType === 1 && !root.dataset.adExplorerScanned) {
            if (root.matches && root.matches(TARGET_SELECTOR)) {
                Detector.checkElement(root);
            }
            // Also check for interstitial container specifics if needed, but usually TARGET_SELECTOR covers it
            if (root.classList.contains('mys-wrapper')) Detector.checkElement(root);

            try { root.dataset.adExplorerScanned = "true"; } catch (e) { }
            if (root.shadowRoot) deepScan(root.shadowRoot);
        }

        try {
            const all = root.querySelectorAll(TARGET_SELECTOR);
            for (let i = 0, len = all.length; i < len; i++) {
                const el = all[i];
                if (el.dataset.adExplorerScanned) continue;
                Detector.checkElement(el);
                el.dataset.adExplorerScanned = "true";
                if (el.shadowRoot) {
                    deepScan(el.shadowRoot);
                }
            }
        } catch (e) { }
    }

    let scanQueue = [];
    let isScanningQueue = false;

    function processScanChunk() {
        if (scanQueue.length === 0) {
            isScanningQueue = false;
            return;
        }

        isScanningQueue = true;
        const Detector = window.AdExplorer.Detector;

        // Use IdleCallback to do work only when browser has free time, else fallback to timeout
        const schedule = window.requestIdleCallback || window.setTimeout;

        schedule((deadline) => {
            let processed = 0;
            const MAX_PER_CHUNK = 5; // Process max 5 nodes per frame to guarantee 60fps

            while (scanQueue.length > 0 && processed < MAX_PER_CHUNK) {
                // If using requestIdleCallback and we are out of time, stop and yield
                if (deadline && deadline.timeRemaining && deadline.timeRemaining() < 2 && processed > 0) {
                    break;
                }

                const node = scanQueue.shift();
                processed++;

                try {
                    // 1. Check the node itself
                    if (!node.dataset.adExplorerScanned) {
                        if (node.matches && node.matches(TARGET_SELECTOR)) {
                            Detector.checkElement(node);
                        }
                        node.dataset.adExplorerScanned = "true";
                    }

                    // 2. Only query children if the node actually has children
                    if (node.children && node.children.length > 0) {
                        const children = node.querySelectorAll(TARGET_SELECTOR);
                        for (let i = 0, len = children.length; i < len; i++) {
                            const ch = children[i];
                            if (!ch.dataset.adExplorerScanned) {
                                Detector.checkElement(ch);
                                ch.dataset.adExplorerScanned = "true";
                            }
                        }
                    }
                } catch (e) { }
            }

            // If there's still work, schedule next chunk
            if (scanQueue.length > 0) {
                processScanChunk();
            } else {
                isScanningQueue = false;
            }
        });
    }

    function startObserver() {
        if (observer) return;

        observer = new MutationObserver((mutations) => {
            let hasAddedNodes = false;

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            scanQueue.push(node);
                            hasAddedNodes = true;
                        }
                    }
                }
            }

            if (hasAddedNodes && !isScanningQueue) {
                processScanChunk();
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    function getScanRoot() {
        return document.documentElement;
    }

    function startHeartbeat() {
        // Less frequent full scan (safety net), mostly rely on observer
        setInterval(() => {
            const root = getScanRoot();
            if (root) {
                const schedule = window.requestIdleCallback || window.setTimeout;
                schedule(() => {
                    deepScan(root);
                    heartbeatParams.scanCount++;
                    // On main list page, also extract from same-origin iframes (title, description, image, video)
                    if (window === window.top && window.AdExplorer && window.AdExplorer.Detector && window.AdExplorer.Detector.scanListPageIframes) {
                        try { window.AdExplorer.Detector.scanListPageIframes(); } catch (e) { }
                    }
                });
            }
        }, 5000); // Increased from 3000ms
    }

    function handleNavigation() {
        const Detector = window.AdExplorer.Detector;
        if (Detector && Detector.clearCache) {
            Detector.clearCache();
        }

        const scanned = document.querySelectorAll('[data-ad-explorer-scanned], [data-ad-explorer-processed], [data-ad-explorer-interstitial-processed]');
        for (let i = 0; i < scanned.length; i++) {
            delete scanned[i].dataset.adExplorerScanned;
            delete scanned[i].dataset.adExplorerProcessed;
            delete scanned[i].dataset.adExplorerInterstitialProcessed;
        }

        const root = getScanRoot();
        if (root) deepScan(root);
    }

    function init() {
        const doInit = () => {
            deepScan(getScanRoot());
            startObserver();
            // List page: extract from iframes once after load
            if (window === window.top && window.AdExplorer && window.AdExplorer.Detector && window.AdExplorer.Detector.scanListPageIframes) {
                setTimeout(() => { try { window.AdExplorer.Detector.scanListPageIframes(); } catch (e) { } }, 1500);
            }
        };
        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', doInit);
        } else {
            doInit();
        }

        startHeartbeat();

        window.addEventListener('message', (event) => {
            if (event.data && event.data.source === 'AD_EXPLORER_CONTENT' && event.data.type === 'PAGE_NAVIGATED') {
                handleNavigation();
            }
        });
    }

    window.AdExplorer.Scanner = {
        init: init,
        deepScan: deepScan,
        startObserver: startObserver,
        getStats: () => heartbeatParams
    };

})();
