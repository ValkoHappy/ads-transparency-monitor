document.addEventListener('DOMContentLoaded', () => {
    const listContainer = document.getElementById('ads-list');
    const totalCountSpan = document.getElementById('count-total');
    const searchInput = document.getElementById('search-input');
    const btnScroll = document.getElementById('btn-scroll');
    const btnStopScroll = document.getElementById('btn-stop-scroll');
    const clearBtn = document.getElementById('clear-btn');
    let ads = [];
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTabId = tabs[0].id;
        const currentTabUrl = tabs[0].url;
        const storageKey = `ads_${currentTabId}`;
        const activeKey = `active_ad_${currentTabId}`;
        const apiStorageKey = `api_calls_${currentTabId}`;

        clearBtn.addEventListener('click', () => {
            chrome.storage.local.remove([storageKey, activeKey, apiStorageKey], () => {
                ads = [];
                renderList();
            });
        });

        const headers = ['App ID', 'Store', 'Creative Url', 'Store Url', 'Title', 'Description', 'Main Image Url', 'Video Url'];
        const headersWithImageFile = ['App ID', 'Store', 'Creative Url', 'Store Url', 'Title', 'Description', 'Main Image Url', 'Image File', 'Video Url'];
        const exportProgress = document.getElementById('export-progress');
        const exportProgressBar = document.getElementById('export-progress-bar');
        function storeLabel(ad) {
            if (ad.type) return ad.type;
            const u = (ad.storeUrl || '').toLowerCase();
            if (u.includes('play.google') || u.includes('market://')) return 'Google Play';
            if (u.includes('apple.com') || u.includes('itunes')) return 'App Store';
            return '';
        }
        function getExportableAds() {
            const filterText = (searchInput && searchInput.value || '').trim().toLowerCase();
            const showGoogle = filterGoogle && filterGoogle.checked !== false;
            const showApple = filterApple && filterApple.checked !== false;
            return ads.filter(ad => {
                if (!ad.creativeUrl) return false;
                const isGoogle = ad.type === 'Google Play';
                const isApple = ad.type === 'App Store';
                if (isGoogle && !showGoogle) return false;
                if (isApple && !showApple) return false;
                const matchesText = !filterText || (ad.appId && ad.appId.toLowerCase().includes(filterText)) ||
                    (ad.type && ad.type.toLowerCase().includes(filterText));
                return matchesText;
            });
        }
        function getExportRows() {
            return getExportableAds().map(ad => [
                ad.appId || '',
                storeLabel(ad),
                ad.creativeUrl || '',
                ad.storeUrl || '',
                ad.title || ad.appName || '',
                ad.description || '',
                ad.mainImageUrl || '',
                ad.mainVideoUrl || ''
            ]);
        }
        function getExportRowsWithImageFiles(imageFileMap) {
            return getExportableAds().map(ad => {
                const imgFile = imageFileMap.get((ad.mainImageUrl || '').trim()) || '';
                return [
                    ad.appId || '',
                    storeLabel(ad),
                    ad.creativeUrl || '',
                    ad.storeUrl || '',
                    ad.title || ad.appName || '',
                    ad.description || '',
                    ad.mainImageUrl || '',
                    imgFile,
                    ad.mainVideoUrl || ''
                ];
            });
        }
        function timestamp() {
            return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        }

        const exportCsvBtn = document.getElementById('export-csv-btn');
        if (exportCsvBtn) {
            exportCsvBtn.addEventListener('click', () => {
                if (getExportableAds().length === 0) return;
                const escapeCsv = (v) => {
                    const s = String(v == null ? '' : v);
                    return '"' + s.replace(/"/g, '""') + '"';
                };
                const csvContent = [headers.map(escapeCsv).join(',')];
                getExportRows().forEach(row => csvContent.push(row.map(escapeCsv).join(',')));
                const BOM = '\uFEFF';
                const blob = new Blob([BOM + csvContent.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
                downloadBlob(blob, `ad_export_${timestamp()}.csv`);
            });
        }

        const exportExcelBtn = document.getElementById('export-excel-btn');
        if (exportExcelBtn) {
            exportExcelBtn.addEventListener('click', () => {
                if (getExportableAds().length === 0) return;
                if (typeof XLSX === 'undefined') {
                    alert('Библиотека XLSX не загружена. Перезагрузите расширение.');
                    return;
                }
                const rows = getExportRows();
                const aoa = [headers].concat(rows);
                const newSheet = XLSX.utils.aoa_to_sheet(aoa);
                if (aoa.length > 0) {
                    const colWidths = headers.map((_, cIndex) => {
                        let maxLen = headers[cIndex].length;
                        aoa.forEach((row, r) => {
                            if (r === 0) return;
                            const val = row[cIndex] != null ? String(row[cIndex]) : '';
                            if (val.length > maxLen) maxLen = val.length;
                        });
                        return { wch: Math.min(maxLen + 2, 80) };
                    });
                    newSheet['!cols'] = colWidths;
                }
                const newWb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(newWb, newSheet, 'Ads');
                XLSX.writeFile(newWb, `ad_export_${timestamp()}.xlsx`);
            });
        }

        const exportFullBtn = document.getElementById('export-full-btn');
        if (exportFullBtn) {
            exportFullBtn.addEventListener('click', () => {
                if (getExportableAds().length === 0) return;
                exportZipWithImages('both');
            });
        }

        const exportApiBtn = document.getElementById('export-api-btn');
        if (exportApiBtn) {
            exportApiBtn.addEventListener('click', () => {
                exportApiBtn.disabled = true;
                try {
                    chrome.tabs.sendMessage(currentTabId, { action: 'FLUSH_API_RECORDS' }, () => {
                        setTimeout(() => {
                            chrome.storage.local.get([apiStorageKey], (result) => {
                                const calls = Array.isArray(result[apiStorageKey]) ? result[apiStorageKey] : [];
                                const payload = {
                                    exportedAt: new Date().toISOString(),
                                    tabId: currentTabId,
                                    tabUrl: currentTabUrl,
                                    count: calls.length,
                                    calls: calls
                                };
                                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
                                downloadBlob(blob, `api_calls_${timestamp()}.json`);
                                exportApiBtn.disabled = false;
                            });
                        }, 500);
                    });
                } catch (e) {
                    chrome.storage.local.get([apiStorageKey], (result) => {
                        const calls = Array.isArray(result[apiStorageKey]) ? result[apiStorageKey] : [];
                        const payload = {
                            exportedAt: new Date().toISOString(),
                            tabId: currentTabId,
                            tabUrl: currentTabUrl,
                            count: calls.length,
                            calls: calls
                        };
                        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
                        downloadBlob(blob, `api_calls_${timestamp()}.json`);
                        exportApiBtn.disabled = false;
                    });
                }
            });
        }

        function downloadBlob(blob, filename) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }

        function getImageExtension(url) {
            if (!url) return 'jpg';
            const path = url.split('?')[0];
            const m = path.match(/\.(jpe?g|png|gif|webp)(\?|$)/i);
            return m ? m[1].toLowerCase() : 'jpg';
        }

        function safeHttpUrl(value) {
            if (!value || typeof value !== 'string') return null;
            try {
                const url = new URL(value);
                return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
            } catch (e) {
                return null;
            }
        }

        function safeCreativeUrl(value) {
            const url = safeHttpUrl(value);
            if (!url) return null;
            try {
                const parsed = new URL(url);
                return parsed.hostname === 'adstransparency.google.com' && parsed.pathname.includes('/creative/') ? url : null;
            } catch (e) {
                return null;
            }
        }

        async function fetchImageAsBlob(url) {
            try {
                const resp = await fetch(url, { mode: 'cors' });
                if (!resp.ok) return null;
                return await resp.blob();
            } catch (e) {
                return null;
            }
        }

        async function exportZipWithImages(format) {
            const exportable = getExportableAds();
            if (exportable.length === 0) return;
            if (typeof JSZip === 'undefined') {
                alert('JSZip не загружен. Перезагрузите расширение.');
                return;
            }
            if ((format === 'excel' || format === 'both') && typeof XLSX === 'undefined') {
                alert('Библиотека XLSX не загружена. Перезагрузите расширение.');
                return;
            }

            const setExporting = (v) => {
                [exportCsvBtn, exportExcelBtn, exportFullBtn].forEach(b => { if (b) b.disabled = v; });
                if (exportProgress) {
                    exportProgress.style.display = v ? 'block' : 'none';
                }
                if (!v && exportProgressBar) {
                    exportProgressBar.style.width = '0%';
                }
            };

            const updateProgress = (current, total) => {
                if (!exportProgressBar || total === 0) return;
                const pct = Math.max(5, Math.min(100, Math.round((current / total) * 100)));
                exportProgressBar.style.width = pct + '%';
            };
            setExporting(true);
            try {
            const zip = new JSZip();
            const imageFileMap = new Map();
            const seenUrls = new Map();
            let imgIdx = 0;

            for (let i = 0; i < exportable.length; i++) {
                const ad = exportable[i];
                const imgUrl = (ad.mainImageUrl || '').trim();
                if (!imgUrl) continue;

                let imgPath = seenUrls.get(imgUrl);
                if (!imgPath) {
                    const blob = await fetchImageAsBlob(imgUrl);
                    if (blob) {
                        const ext = getImageExtension(imgUrl);
                        imgIdx++;
                        imgPath = `images/img_${String(imgIdx).padStart(3, '0')}.${ext}`;
                        zip.file(imgPath, blob);
                        seenUrls.set(imgUrl, imgPath);
                    }
                }
                if (imgPath) {
                    imageFileMap.set(imgUrl, imgPath);
                }

                updateProgress(i + 1, exportable.length);
            }

            const rows = getExportRowsWithImageFiles(imageFileMap);
            const ts = timestamp();

            const addCsv = () => {
                const escapeCsv = (v) => {
                    const s = String(v == null ? '' : v);
                    return '"' + s.replace(/"/g, '""') + '"';
                };
                const csvContent = [headersWithImageFile.map(escapeCsv).join(',')];
                rows.forEach(row => csvContent.push(row.map(escapeCsv).join(',')));
                const BOM = '\uFEFF';
                zip.file(`ads_${ts}.csv`, BOM + csvContent.join('\r\n'));
            };
            const addExcel = () => {
                const aoa = [headersWithImageFile].concat(rows);
                const newSheet = XLSX.utils.aoa_to_sheet(aoa);
                if (aoa.length > 0) {
                    const colWidths = headersWithImageFile.map((_, cIndex) => {
                        let maxLen = headersWithImageFile[cIndex].length;
                        aoa.forEach((row, r) => {
                            if (r === 0) return;
                            const val = row[cIndex] != null ? String(row[cIndex]) : '';
                            if (val.length > maxLen) maxLen = val.length;
                        });
                        return { wch: Math.min(maxLen + 2, 80) };
                    });
                    newSheet['!cols'] = colWidths;
                }
                const newWb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(newWb, newSheet, 'Ads');
                const xlsxBlob = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
                zip.file(`ads_${ts}.xlsx`, xlsxBlob);
            };

            if (format === 'csv') addCsv();
            else if (format === 'excel') addExcel();
            else if (format === 'both') { addCsv(); addExcel(); }

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            if (chrome.downloads && chrome.downloads.download) {
                const url = URL.createObjectURL(zipBlob);
                chrome.downloads.download({ url, filename: `ad_export_${ts}.zip`, saveAs: true }, () => {
                    URL.revokeObjectURL(url);
                });
            } else {
                downloadBlob(zipBlob, `ad_export_${ts}.zip`);
            }
            } finally {
                setExporting(false);
            }
        }

        function getRelevancePriority(source) {
            if (!source) return 0;
            if (source === 'dom_data_p') return 20;
            if (source.includes('dom_asoch_meta')) return 18;
            if (source.includes('href')) return 15;
            if (source.includes('redirect')) return 15;
            if (source === 'adData_structure') return 5;
            return 1;
        }

        function getActiveAd(result, storageKey, activeKey, currentTabUrl) {
            let allAds = result[storageKey] || [];

            const badgedAds = allAds.filter(a => a.isBadge);
            if (badgedAds.length > 0) {
                allAds = badgedAds;
            }

            allAds.sort((a, b) => getSourcePriority(b.source) - getSourcePriority(a.source));

            let activeAd = result[activeKey];

            if (activeAd && !allAds.some(a => a.appId === activeAd.appId)) {
                activeAd = null;
            }

            if (!activeAd) {
                if (allAds.length > 0) {
                    activeAd = allAds.find(a => currentTabUrl.includes(a.creativeUrl) || a.creativeUrl === currentTabUrl);
                    if (!activeAd) activeAd = allAds[0];
                }
            }

            const isValid = (u) => {
                if (!u || typeof u !== 'string') return false;
                const lower = u.toLowerCase();
                if (lower.includes('googlesyndication') || lower.includes('safeframe') || lower.includes('container.html')) return false;
                return (lower.startsWith('http') || lower.startsWith('market://') || lower.startsWith('itms')) &&
                    (lower.includes('/creative/') || lower.includes('adstransparency.google.com'));
            };

            const isCreativePage = currentTabUrl.includes('/creative/');

            if (isCreativePage) {
                let targetAppId = null;

                const exactMatch = allAds.find(a => currentTabUrl.includes(a.creativeUrl));
                if (exactMatch) {
                    targetAppId = exactMatch.appId;
                }
                else if (activeAd && activeAd.isBadge) {
                    targetAppId = activeAd.appId;
                }
                else if (allAds.length > 0) {
                    // Fallback: just pick the first/best ad we have
                    const candidates = [...allAds];
                    candidates.sort((a, b) => getRelevancePriority(b.source) - getRelevancePriority(a.source));
                    targetAppId = candidates[0].appId;
                }

                if (targetAppId) {
                    let sameAppAds = allAds.filter(a => a.appId === targetAppId);

                    if (sameAppAds.length > 0) {
                        sameAppAds.sort((a, b) => getSourcePriority(b.source) - getSourcePriority(a.source));

                        const mainAd = sameAppAds[0];
                        mainAd.creativeUrl = currentTabUrl;

                        if (!isValid(mainAd.storeUrl)) {
                            const donor = sameAppAds.find(a => isValid(a.storeUrl));
                            if (donor) mainAd.storeUrl = donor.storeUrl;
                        }
                        if (!isValid(mainAd.creativeUrl)) {
                            mainAd.creativeUrl = null;
                            const donor = sameAppAds.find(a => isValid(a.creativeUrl));
                            if (donor) mainAd.creativeUrl = donor.creativeUrl;
                        }

                        return [mainAd];
                    }
                }
                return [];
            } else {
                // Show ALL detected ads, even duplicates (user requirement: "if two creatives are identical, let be duplication")
                const result = [];
                // ... logic
                allAds.forEach(ad => {
                    // Don't skip ads with invalid creativeUrl, just null it out
                    if (ad.creativeUrl && !isValid(ad.creativeUrl)) {
                        ad.creativeUrl = null;
                    }
                    result.push(ad);
                });

                result.sort((a, b) => {
                    return getSourcePriority(b.source) - getSourcePriority(a.source);
                });
                return result;
            }
        }

        chrome.storage.local.get([storageKey, 'scrollSettings', activeKey, 'popup_search_state'], (result) => {
            let allAds = result[storageKey] || [];
            
            const isCreativePage = currentTabUrl.includes('/creative/');

            if (isCreativePage) {
                ads = getActiveAd(result, storageKey, activeKey, currentTabUrl);

                const filterRow = document.querySelector('.filter-row');
                if (filterRow) filterRow.style.display = 'none';

                const footer = document.querySelector('footer');
                if (footer) footer.style.display = 'none';

                btnScroll.classList.add('hidden');
                btnStopScroll.classList.add('hidden');
            } else {
                ads = allAds;

                ads.sort((a, b) => getSourcePriority(b.source) - getSourcePriority(a.source));

                if (result.popup_search_state) {
                    searchInput.value = result.popup_search_state;
                }

                const filterRow = document.querySelector('.filter-row');
                if (filterRow) filterRow.style.display = 'flex';

                const footer = document.querySelector('footer');
                if (footer) footer.style.display = 'flex';

                chrome.storage.local.remove(activeKey);
            }

            renderList();
        });

        let renderTimeout;
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                if (changes[storageKey] || changes[activeKey]) {
                    if (renderTimeout) clearTimeout(renderTimeout);
                    renderTimeout = setTimeout(() => {
                        chrome.storage.local.get([storageKey, activeKey], (res) => {
                            const isCreativePage = currentTabUrl.includes('/creative/');
                            if (isCreativePage) {
                                ads = getActiveAd(res, storageKey, activeKey, currentTabUrl);
                            } else {
                                ads = res[storageKey] || [];
                                ads.sort((a, b) => getSourcePriority(b.source) - getSourcePriority(a.source));
                            }
                            renderList();
                        });
                    }, 200);
                }
                if (changes.is_scrolling) {
                    updateScrollButtonUI(changes.is_scrolling.newValue);
                }
            }
        });
    });
    const icons = {
        android: `<svg class="platform-icon" width="20" height="20" viewBox="0 0 24 24" fill="#3ddc84"><path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.68-.06-.86.22l-1.92 3.32c-1.22-.54-2.58-.85-4.04-.85-1.46 0-2.82.31-4.04.85L6.4 5.67c-.18-.28-.57-.37-.86-.22-.31.15-.42.54-.26.85l1.84 3.18C4.76 10.95 3.5 12.9 3.5 15.1h17c0-2.2-1.26-4.15-3.62-5.62zM9 13c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/></svg>`,
        ios: `<svg class="platform-icon" width="20" height="20" viewBox="0 0 24 24" fill="#007aff"><path d="M17.2,13.2c0-2.9,2.4-4.3,2.5-4.3c-1.4-2-3.6-2.2-4.3-2.3c-1.8-0.2-3.5,1.1-4.4,1.1 c-0.9,0-2.3-1-3.8-1c-2,0-3.8,1.1-4.8,2.8c-2,3.5-0.5,8.8,1.4,11.7c1,1.4,2.1,3,3.6,3c1.4,0,2-0.9,3.8-0.9s2.5,0.9,3.7,0.9 c1.5,0,2.5-1.4,3.4-2.8c1.1-1.6,1.5-3.1,1.5-3.2C19.7,18,17.2,17.1,17.2,13.2z M12.9,5c0.8-1,1.3-2.3,1.2-3.6 c-1.2,0.1-2.6,0.8-3.4,1.8C10,4.1,9.4,5.4,9.5,6.7C10.8,6.8,12.1,6,12.9,5z"/></svg>`,
        unknown: `<svg class="platform-icon" width="20" height="20" viewBox="0 0 24 24" fill="#888"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01" stroke="white" stroke-width="2"/></svg>`
    };
    const filterGoogle = document.getElementById('filter-google');
    const filterApple = document.getElementById('filter-apple');
    function renderList() {
        listContainer.innerHTML = '';
        const filterText = searchInput.value.trim().toLowerCase();
        const showGoogle = filterGoogle.checked;
        const showApple = filterApple.checked;
        const filtered = ads.filter(ad => {
            const matchesText = (ad.appId && ad.appId.toLowerCase().includes(filterText)) ||
                (ad.type && ad.type.toLowerCase().includes(filterText));
            const isGoogle = ad.type === 'Google Play';
            const isApple = ad.type === 'App Store';
            if (isGoogle && !showGoogle) return false;
            if (isApple && !showApple) return false;

            // Hide only ads that have no creative URL at all; show ads with invalid URL (from iframe) so T/D/I/V are visible
            if (!ad.creativeUrl) return false;
            // Do NOT filter out invalid creativeUrl here — show them so title/description/image/video appear; createAdElement will disable the Creative button

            return matchesText;
        });
        totalCountSpan.innerText = filtered.length;
        if (filtered.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1">
                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                    </svg>
                    <p>No results found</p>
                </div>`;
            return;
        }

        // --- PERFORMANCE: Infinite Scroll Logic ---
        const BATCH_SIZE = 50;
        let renderedCount = 0;
        let currentFiltered = filtered; // Keep reference for scroll handler

        // Remove old listener if exists (to avoid duplicates on re-render)
        if (listContainer._scrollHandler) {
            listContainer.removeEventListener('scroll', listContainer._scrollHandler);
        }

        function renderBatch() {
            const fragment = document.createDocumentFragment();
            const end = Math.min(renderedCount + BATCH_SIZE, currentFiltered.length);

            for (let i = renderedCount; i < end; i++) {
                const ad = currentFiltered[i];
                const el = createAdElement(ad); // Helper function
                fragment.appendChild(el);
            }
            listContainer.appendChild(fragment);
            renderedCount = end;
        }

        // Initial Batch
        renderBatch();

        // Scroll Handler
        listContainer._scrollHandler = () => {
            if (listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - 300) {
                if (renderedCount < currentFiltered.length) {
                    renderBatch();
                }
            }
        };
        listContainer.addEventListener('scroll', listContainer._scrollHandler);
    }

    // Helper to create ad element (Extracting existing logic)
    function createAdElement(ad) {
        const el = document.createElement('div');
        el.className = 'ad-item';
        const icon = ad.type === 'Google Play' ? icons.android : (ad.type === 'App Store' ? icons.ios : icons.unknown);

        // Validate URL before showing
        let creativeUrl = safeCreativeUrl(ad.creativeUrl);
        if (creativeUrl) {
            const lower = creativeUrl.toLowerCase();
            if (lower.includes('googlesyndication') || lower.includes('safeframe') || lower.includes('container.html')) {
                creativeUrl = null;
            }
        }

        const hasCreative = !!creativeUrl;
        const displayId = (ad.appName && (ad.appId.startsWith('icon_') || ad.appId.startsWith('name_')))
            ? ad.appName
            : ad.appId;
        const displayTitle = ad.title || ad.appName || '';
        const hasDesc = !!(ad.description && ad.description.trim());
        const safeStoreUrl = safeHttpUrl(ad.storeUrl);
        const safeImageUrl = safeHttpUrl(ad.mainImageUrl);
        const safeVideoUrl = safeHttpUrl(ad.mainVideoUrl);
        const hasImage = !!safeImageUrl;
        const hasVideo = !!safeVideoUrl;
        const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        el.innerHTML = `
            <div class="app-header">
                ${icon}
                <div class="app-info">
                    <div class="app-type">
                        ${esc(ad.type)}
                        <span class="field-indicators">
                            ${displayTitle ? '<span class="field-indicator" title="Title found">T</span>' : ''}
                            ${hasDesc ? '<span class="field-indicator" title="Description found">D</span>' : ''}
                            ${hasImage ? '<span class="field-indicator" title="Image found">I</span>' : ''}
                            ${hasVideo ? '<span class="field-indicator" title="Video found">V</span>' : ''}
                        </span>
                    </div>
                    ${displayTitle ? `<div class="app-title" title="${esc(displayTitle)}">${esc(displayTitle)}</div>` : ''}
                    <div class="app-id" title="Click to copy">${esc(displayId)}</div>
                    ${hasDesc ? `<div class="app-desc" title="${esc(ad.description)}">${esc(ad.description.substring(0, 80))}${ad.description.length > 80 ? '…' : ''}</div>` : ''}
                </div>
            </div>
            <div class="ad-actions">
                <button class="icon-btn btn-store" title="Store: ${esc(safeStoreUrl || '')}" ${!safeStoreUrl ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <path d="M16 10a4 4 0 0 1-8 0"></path>
                    </svg>
                </button>
                <button class="icon-btn btn-creative ${!hasCreative ? 'disabled' : ''}" title="${hasCreative ? 'Creative' : 'No creative URL'}" ${!hasCreative ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                </button>
                ${hasImage ? `<button class="icon-btn btn-image" title="Image"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></button>` : ''}
                ${hasVideo ? `<button class="icon-btn btn-video" title="Video"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>` : ''}
            </div>
        `;
        const idEl = el.querySelector('.app-id');
        idEl.addEventListener('click', () => {
            navigator.clipboard.writeText(ad.appId);
            const originalColor = idEl.style.color;
            const originalText = idEl.innerText;
            idEl.style.color = '#3ddc84';
            idEl.innerText = 'Copied!';
            setTimeout(() => {
                idEl.style.color = originalColor;
                idEl.innerText = originalText;
            }, 1000);
        });
        el.querySelector('.btn-creative').addEventListener('click', (e) => {
            e.stopPropagation();
            if (creativeUrl) {
                chrome.tabs.create({ url: creativeUrl, active: false });
            }
        });

        el.querySelector('.btn-store').addEventListener('click', (e) => {
            e.stopPropagation();
            if (safeStoreUrl) {
                chrome.tabs.create({ url: safeStoreUrl, active: false });
            }
        });
        const btnImage = el.querySelector('.btn-image');
        if (btnImage && safeImageUrl) {
            btnImage.addEventListener('click', (e) => {
                e.stopPropagation();
                chrome.tabs.create({ url: safeImageUrl, active: false });
            });
        }
        const btnVideo = el.querySelector('.btn-video');
        if (btnVideo && safeVideoUrl) {
            btnVideo.addEventListener('click', (e) => {
                e.stopPropagation();
                chrome.tabs.create({ url: safeVideoUrl, active: false });
            });
        }
        return el;
    }

    // --- SETTINGS LOGIC START ---
    const settingsBtn = document.getElementById('settings-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const closeSettings = document.getElementById('close-settings');
    const radioModes = document.getElementsByName('scroll_mode');
    const speedGroup = document.getElementById('speed-group');
    const speedSlider = document.getElementById('smooth-speed');
    const speedVal = document.getElementById('speed-val');
    const economyToggle = document.getElementById('economy-mode-toggle');
    const economyScrollToggle = document.getElementById('economy-scroll-toggle');
    const economyScrollGroup = document.getElementById('economy-scroll-group');
    const collectionEnabledToggle = document.getElementById('collection-enabled-toggle');

    function toggleSettings() {
        if (settingsPanel.classList.contains('hidden')) {
            settingsPanel.classList.remove('hidden');
        } else {
            settingsPanel.classList.add('hidden');
        }
    }

    if (settingsBtn) settingsBtn.addEventListener('click', toggleSettings);
    if (closeSettings) closeSettings.addEventListener('click', toggleSettings);

    function updateSettingsUI() {
        const mode = Array.from(radioModes).find(r => r.checked)?.value;
        if (mode === 'smooth') {
            speedGroup.style.display = 'flex';
        } else {
            speedGroup.style.display = 'none';
        }

        const isEconomy = economyToggle ? economyToggle.checked : true;
        const isScrollOnly = economyScrollToggle ? economyScrollToggle.checked : false;

        // Show/hide sub-toggle based on economy mode state
        if (economyScrollGroup) {
            economyScrollGroup.style.display = isEconomy ? 'block' : 'none';
        }

        // Auto-save changes
        const speed = parseInt(speedSlider.value, 10);

        chrome.storage.local.set({
            scroll_mode: mode,
            smooth_speed: speed,
            economy_mode: isEconomy,
            economy_scroll_only: isScrollOnly
        });

        // Broadcast economy mode to tabs
        chrome.tabs.query({ url: ["*://adstransparency.google.com/*"] }, function (tabs) {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    type: "UPDATE_ECONOMY_MODE",
                    payload: isEconomy
                }).catch(() => { });
                chrome.tabs.sendMessage(tab.id, {
                    type: "UPDATE_ECONOMY_SCROLL_ONLY",
                    payload: isScrollOnly
                }).catch(() => { });
            });
        });
    }

    // Load initial settings
    chrome.storage.local.get(['scroll_mode', 'smooth_speed', 'economy_mode', 'economy_scroll_only', 'collection_enabled'], (res) => {
        const savedMode = res.scroll_mode || 'fast';
        const savedSpeed = res.smooth_speed || 50;
        const savedEconomy = res.economy_mode !== undefined ? res.economy_mode : true;
        const savedScrollOnly = res.economy_scroll_only !== undefined ? res.economy_scroll_only : false;
        const savedCollectionEnabled = res.collection_enabled !== undefined ? res.collection_enabled : true;

        radioModes.forEach(r => {
            if (r.value === savedMode) r.checked = true;
            r.addEventListener('change', updateSettingsUI);
        });

        if (speedSlider) {
            speedSlider.value = savedSpeed;
            if (speedVal) speedVal.innerText = savedSpeed;

            speedSlider.addEventListener('input', () => {
                if (speedVal) speedVal.innerText = speedSlider.value;
                updateSettingsUI();
            });
        }

        if (economyToggle) {
            economyToggle.checked = savedEconomy;
            economyToggle.addEventListener('change', updateSettingsUI);
        }

        if (economyScrollToggle) {
            economyScrollToggle.checked = savedScrollOnly;
            economyScrollToggle.addEventListener('change', updateSettingsUI);
        }

        if (collectionEnabledToggle) {
            collectionEnabledToggle.checked = savedCollectionEnabled;
            collectionEnabledToggle.addEventListener('change', () => {
                const enabled = collectionEnabledToggle.checked;
                chrome.storage.local.set({ collection_enabled: enabled });
            });
        }

        updateSettingsUI(); // Set initial visibility state
    });
    // --- SETTINGS LOGIC END ---

    // --- STATE PERSISTENCE & ACTIONS ---
    function saveState() {
        chrome.storage.local.set({
            popup_search_state: searchInput.value,
            filter_google_state: filterGoogle.checked,
            filter_apple_state: filterApple.checked
        });
    }

    filterGoogle.addEventListener('change', () => {
        saveState();
        renderList();
    });
    filterApple.addEventListener('change', () => {
        saveState();
        renderList();
    });
    searchInput.addEventListener('input', () => {
        saveState();
        renderList();
    });

    // Restore State
    chrome.storage.local.get(['popup_search_state', 'filter_google_state', 'filter_apple_state'], (res) => {
        if (typeof res.popup_search_state === 'string') searchInput.value = res.popup_search_state;
        if (typeof res.filter_google_state === 'boolean') filterGoogle.checked = res.filter_google_state;
        if (typeof res.filter_apple_state === 'boolean') filterApple.checked = res.filter_apple_state;

        // Initial Render after state restore
        // (We might have rendered empty before, so this refresh is crucial)
        // renderList(); // Called in main flow anyway, but let's ensure it uses these values
    });

    chrome.storage.local.get(['is_scrolling'], (res) => {
        updateScrollButtonUI(res.is_scrolling);
    });
    function updateScrollButtonUI(isScrolling) {
        if (isScrolling) {
            btnScroll.classList.add('hidden');
            btnStopScroll.classList.remove('hidden');
        } else {
            btnScroll.classList.remove('hidden');
            btnStopScroll.classList.add('hidden');
        }
    }
    btnScroll.addEventListener('click', () => {
        chrome.storage.local.set({ is_scrolling: true });
    });
    btnStopScroll.addEventListener('click', () => {
        chrome.storage.local.set({ is_scrolling: false });
    });
});
