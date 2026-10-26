/**
 * AdExplorer Scroller Module
 * Auto-scroll functionality
 */
(function () {
    'use strict';

    window.AdExplorer = window.AdExplorer || {};

    function pageMessageTargetOrigin() {
        return window.location.origin && window.location.origin !== 'null'
            ? window.location.origin
            : 'https://adstransparency.google.com';
    }

    function postToContent(message) {
        window.postMessage(message, pageMessageTargetOrigin());
    }

    function isSameWindowContentMessage(event) {
        return event.source === window && (!event.origin || event.origin === window.location.origin);
    }

    /**
     * Initialize auto-scroll UI and logic
     */
    /**
     * Initialize auto-scroll UI and logic
     */
    function init() {
        if (window.top !== window) return;

        let isScrolling = false;
        let observer = null;

        const iconArrowFn = (color) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>`;
        const iconStopFn = (color) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="${color}" stroke="none" style="margin-right:8px"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
        const iconLoadFn = (color) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" style="margin-right:8px"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;

        const btn = document.createElement('div');
        btn.id = 'ad-scroll-btn';
        btn.innerHTML = `${iconArrowFn('white')} Smart Scroll`;
        btn.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 2147483647;
            background: #0078d4;
            color: white;
            padding: 14px 24px;
            border-radius: 30px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 6px 16px rgba(0,0,0,0.25);
            font-size: 16px;
            display: flex;
            align-items: center;
            transition: all 0.2s ease;
            user-select: none;
        `;

        if (window.location.href.includes('/creative/')) {
            btn.style.display = 'none';
        }

        btn.addEventListener('mouseover', () => btn.style.transform = 'translateY(-2px)');
        btn.addEventListener('mouseout', () => btn.style.transform = 'translateY(0)');

        // Local state for settings
        let currentMode = 'fast';
        let currentSpeed = 50; // Default pixels per second-ish (scaled)
        let animationFrameId = null;

        function updateUI(active, statusText = null) {
            // isScrolling = active; 
            if (active) {
                if (statusText && statusText.includes('waiting')) {
                    btn.innerHTML = `${iconLoadFn('white')} ${statusText}`;
                    btn.style.background = '#005a9e';
                } else {
                    btn.innerHTML = `${iconStopFn('white')} Stop Scroll`;
                    btn.style.background = '#d13438';
                }
            } else {
                btn.innerHTML = `${iconArrowFn('white')} Smart Scroll`;
                btn.style.background = '#0078d4';
            }
        }

        function stopScroll(notifyExtension = true) {
            if (!isScrolling) return;
            isScrolling = false;
            // Stop any smooth scroll loop
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            if (notifyExtension) {
                postToContent({ source: 'AD_EXPLORER_INJECT', type: 'TOGGLE_SCROLL_REQUEST', forceStop: true });
            }
            updateUI(false);
        }

        async function startSmartScroll() {
            if (isScrolling) return;

            isScrolling = true;
            updateUI(true);

            if (currentMode === 'smooth') {
                runSmoothScroll();
            } else {
                runFastScroll();
            }
        }

        function runSmoothScroll() {
            let lastTime = performance.now();
            function step(currentTime) {
                if (!isScrolling) return;
                const pixels = Math.max(1, currentSpeed / 5);
                window.scrollBy(0, pixels);
                animationFrameId = requestAnimationFrame(step);
            }
            animationFrameId = requestAnimationFrame(step);
        }

        async function runFastScroll() {
            let noChangeCount = 0;
            const MAX_NO_CHANGE = 20;
            const CHECK_INTERVAL = 200;
            const MAX_WAIT_FOR_CONTENT = 4000;

            while (isScrolling) {
                const getScrollHeight = () => Math.max(
                    document.body.scrollHeight,
                    document.documentElement.scrollHeight,
                    document.body.offsetHeight,
                    document.documentElement.offsetHeight,
                    document.body.clientHeight,
                    document.documentElement.clientHeight
                );

                const previousHeight = getScrollHeight();
                window.scrollTo(0, 9999999);

                let hasExpanded = false;
                let waited = 0;

                while (waited < MAX_WAIT_FOR_CONTENT) {
                    await new Promise(r => setTimeout(r, CHECK_INTERVAL));
                    if (!isScrolling) break;

                    const newHeight = getScrollHeight();
                    if (newHeight > previousHeight + 50) {
                        hasExpanded = true;
                        break;
                    }
                    waited += CHECK_INTERVAL;
                }

                if (!isScrolling) break;

                if (hasExpanded) {
                    noChangeCount = 0;
                    updateUI(true, 'scrolling');
                } else {
                    noChangeCount++;
                    updateUI(true, `waiting (${noChangeCount}/${MAX_NO_CHANGE})`);

                    if (noChangeCount >= MAX_NO_CHANGE) {
                        stopScroll(true);
                        break;
                    }
                }

                // CRITICAL: Yield to the main thread so the browser can paint the new scroll position 
                // and the scanner can process the newly injected nodes before we jump again.
                await new Promise(r => setTimeout(r, 100));
            }
        }

        window.addEventListener('message', (event) => {
            if (event.data && event.data.source === 'AD_EXPLORER_CONTENT') {
                if (!isSameWindowContentMessage(event)) return;
                if (event.data.type === 'SCROLL_STATE_CHANGE') {
                    if (event.data.isScrolling && !isScrolling) {
                        startSmartScroll();
                    } else if (!event.data.isScrolling && isScrolling) {
                        stopScroll(false);
                    }
                }
                else if (event.data.type === 'UPDATE_SETTINGS') {
                    const pl = event.data.payload || {};
                    const oldMode = currentMode;

                    if (pl.scroll_mode) currentMode = pl.scroll_mode;
                    if (pl.smooth_speed !== undefined) currentSpeed = parseInt(pl.smooth_speed, 10);

                    if (isScrolling && pl.scroll_mode && pl.scroll_mode !== oldMode) {
                        if (animationFrameId) {
                            cancelAnimationFrame(animationFrameId);
                            animationFrameId = null;
                        }
                        if (currentMode === 'smooth') {
                            runSmoothScroll();
                        } else {
                            runFastScroll();
                        }
                    }
                    updateUI(isScrolling);
                }
            }
        });

        btn.addEventListener('click', () => {
            if (isScrolling) {
                postToContent({ source: 'AD_EXPLORER_INJECT', type: 'TOGGLE_SCROLL_REQUEST', forceStop: true });
            } else {
                postToContent({ source: 'AD_EXPLORER_INJECT', type: 'TOGGLE_SCROLL_REQUEST', forceStart: true });
            }
        });

        document.body.appendChild(btn);

        setInterval(() => {
            const isCreative = window.location.href.includes('/creative/');
            if (isCreative) {
                if (btn.style.display !== 'none') {
                    btn.style.display = 'none';
                    if (isScrolling) stopScroll(true);
                }
            } else {
                if (btn.style.display === 'none') {
                    btn.style.display = 'flex';
                }
            }
        }, 1000);

        // Handshake: Request state from content script
        postToContent({ source: 'AD_EXPLORER_INJECT', type: 'READY_FOR_STATE' });
    }

    // Export
    window.AdExplorer.Scroller = {
        init: init
    };


})();
