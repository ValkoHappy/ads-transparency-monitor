/**
 * AdExplorer Processor Module
 * Process window.adData and extract app IDs
 */
(function() {
    'use strict';
    
    window.AdExplorer = window.AdExplorer || {};
    
    /**
     * Process adData object and extract app info
     */
    function processAdData(data) {
        if (!data) return null;
        let candidate = null;
        let priority = 0;

        // When there is no video, the system MUST collect: title ← appName, description ← description1, mainImageUrl ← landscapeImage (SafeFrame).
        let templateMeta = {};
        try {
            const ad0 = data.google_template_data && data.google_template_data.adData && data.google_template_data.adData[0];
            if (ad0) {
                if (ad0.appName) templateMeta.title = String(ad0.appName).replace(/\x26/g, '&');
                if (ad0.description1) templateMeta.description = String(ad0.description1).replace(/\x26/g, '&');
                if (!templateMeta.description && ad0.shortDescription) templateMeta.description = String(ad0.shortDescription).replace(/\x26/g, '&');
                const imgFields = ['landscapeImage', 'coverImage', 'screenshot1', 'appIconHighRes', 'appIconStandard'];
                for (const f of imgFields) {
                    if (ad0[f]) {
                        const u = ad0[f];
                        templateMeta.mainImageUrl = (u.indexOf('//') === 0 ? 'https:' + u : u);
                        break;
                    }
                }
                if (ad0.video_videoId) {
                    templateMeta.mainVideoUrl = 'https://www.youtube.com/watch?v=' + ad0.video_videoId;
                } else if (ad0.video) {
                    const u = ad0.video;
                    templateMeta.mainVideoUrl = (u.indexOf('//') === 0 ? 'https:' + u : u);
                }
            }
            
            // Also check google_template_data root level for additional fields
            const gtd = data.google_template_data;
            if (gtd) {
                if (!templateMeta.title && gtd.appName) templateMeta.title = String(gtd.appName).replace(/\x26/g, '&');
                if (!templateMeta.title && gtd.headline) templateMeta.title = String(gtd.headline).replace(/\x26/g, '&');
                if (!templateMeta.title && gtd.title) templateMeta.title = String(gtd.title).replace(/\x26/g, '&');
                
                if (!templateMeta.description && gtd.description) templateMeta.description = String(gtd.description).replace(/\x26/g, '&');
                if (!templateMeta.description && gtd.description1) templateMeta.description = String(gtd.description1).replace(/\x26/g, '&');
                if (!templateMeta.description && gtd.body) templateMeta.description = String(gtd.body).replace(/\x26/g, '&');
                
                if (!templateMeta.mainImageUrl && gtd.image) {
                    const u = gtd.image;
                    templateMeta.mainImageUrl = (u.indexOf('//') === 0 ? 'https:' + u : u);
                }
                if (!templateMeta.mainImageUrl && gtd.landscapeImage) {
                    const u = gtd.landscapeImage;
                    templateMeta.mainImageUrl = (u.indexOf('//') === 0 ? 'https:' + u : u);
                }
                if (!templateMeta.mainImageUrl && gtd.coverImage) {
                    const u = gtd.coverImage;
                    templateMeta.mainImageUrl = (u.indexOf('//') === 0 ? 'https:' + u : u);
                }
                if (!templateMeta.mainVideoUrl && gtd.video_videoId) {
                    templateMeta.mainVideoUrl = 'https://www.youtube.com/watch?v=' + gtd.video_videoId;
                }
                if (!templateMeta.mainVideoUrl && gtd.video) {
                    const u = gtd.video;
                    templateMeta.mainVideoUrl = (u.indexOf('//') === 0 ? 'https:' + u : u);
                }
            }
        } catch (e) {}

        function applyTemplateMeta(match) {
            if (!match || typeof match !== 'object') return match;
            if (templateMeta.title) match.title = templateMeta.title;
            if (templateMeta.description) match.description = templateMeta.description;
            if (templateMeta.mainImageUrl) match.mainImageUrl = templateMeta.mainImageUrl;
            if (templateMeta.mainVideoUrl) match.mainVideoUrl = templateMeta.mainVideoUrl;
            return match;
        }
        
        try {
            // Check structured data
            if (data.ads && Array.isArray(data.ads) && data.ads.length > 0) {
                for (const ad of data.ads) {
                    const isRelated = !!(ad.related_ad_info);
                    let appId = null;
                    let type = null;
                    let adTitle = null;
                    let adDescription = null;
                    let adImage = null;
                    let adVideo = null;
                    
                    // Extract title from various fields
                    if (ad.app_name) adTitle = String(ad.app_name).trim();
                    else if (ad.title) adTitle = String(ad.title).trim();
                    else if (ad.headline) adTitle = String(ad.headline).trim();
                    else if (ad.name) adTitle = String(ad.name).trim();
                    
                    // Extract description from various fields
                    if (ad.description) adDescription = String(ad.description).trim();
                    else if (ad.description1) adDescription = String(ad.description1).trim();
                    else if (ad.body) adDescription = String(ad.body).trim();
                    else if (ad.text) adDescription = String(ad.text).trim();
                    
                    // Extract image URL
                    if (ad.image_url) adImage = String(ad.image_url);
                    else if (ad.landscapeImage) adImage = String(ad.landscapeImage);
                    else if (ad.thumbnail_url) adImage = String(ad.thumbnail_url);
                    else if (ad.icon_url) adImage = String(ad.icon_url);
                    
                    // Extract video URL
                    if (ad.video_url) adVideo = String(ad.video_url);
                    else if (ad.youtube_video_id) adVideo = 'https://www.youtube.com/watch?v=' + ad.youtube_video_id;
                    
                    if (ad && ad.platform) {
                        if (ad.platform.name === 'GOOGLE_PLAY' || ad.platform.id === 2) {
                            type = 'Google Play';
                            appId = ad.platform.id_value || ad.package_name || ad.app_id;
                        } else if (ad.platform.name === 'ITUNES' || ad.platform.id === 1) {
                            type = 'App Store';
                            appId = ad.platform.id_value || ad.app_id;
                        }
                    }
                    
                    if (!appId && ad.destination_url) {
                        const url = ad.destination_url;
                        if (url.includes('play.google.com')) {
                            type = 'Google Play';
                            try {
                                const urlObj = new URL(url);
                                appId = urlObj.searchParams.get('id');
                            } catch (e) {}
                        } else if (url.includes('apps.apple.com') || url.includes('itunes.apple.com')) {
                            type = 'App Store';
                            const match = url.match(/id(\d{5,})/);
                            if (match) appId = match[1];
                        }
                    }
                    
                    if (!type && !appId) {
                        const jsonStr = JSON.stringify(ad);
                        const playMatch = jsonStr.match(/play\.google\.com.*?id=([a-zA-Z0-9_.]+)/);
                        if (playMatch) { type = 'Google Play'; appId = playMatch[1]; }
                        const iosMatch = jsonStr.match(/(?:apps\.apple\.com|itunes\.apple\.com).*?id(\d{5,})/);
                        if (iosMatch && !appId) { type = 'App Store'; appId = iosMatch[1]; }
                    }
                    
                    if (!type && appId) {
                        if (appId && appId.includes('.')) type = 'Google Play';
                        else if (appId && /^\d+$/.test(appId)) type = 'App Store';
                        else type = 'Unknown';
                    }
                    
                    if (appId) {
                        const conf = isRelated ? 1 : 3;
                        const match = {
                            type: type,
                            appId: appId,
                            source: 'adData_structure',
                            creativeUrl: window.location.href,
                            confidence: conf
                        };
                        
                        // Add extracted fields
                        if (adTitle) match.title = adTitle;
                        if (adDescription) match.description = adDescription;
                        if (adImage) match.mainImageUrl = adImage.indexOf('//') === 0 ? 'https:' + adImage : adImage;
                        if (adVideo) match.mainVideoUrl = adVideo;
                        
                        // Apply template meta as fallback
                        const finalMatch = applyTemplateMeta(match);
                        
                        if (!isRelated) {
                            return finalMatch;
                        } else {
                            candidate = finalMatch;
                            priority = 1;
                        }
                    }
                }
            }
        } catch (e) {}
        
        // Check URL fields
        const urlFields = ['google_click_url', 'destination_url', 'clickUrl', 'click_url'];
        for (const field of urlFields) {
            if (data[field]) {
                const val = data[field];
                if (val.includes('play.google.com')) {
                    try {
                        const urlObj = new URL(val);
                        const id = urlObj.searchParams.get('id');
                        if (id) return applyTemplateMeta({
                            type: 'Google Play',
                            appId: id,
                            source: `adData_${field}`,
                            creativeUrl: window.location.href,
                            confidence: 3
                        });
                    } catch (e) {}
                } else if (val.includes('apple.com')) {
                    const match = val.match(/id(\d{5,})/);
                    if (match && match[1]) return applyTemplateMeta({
                        type: 'App Store',
                        appId: match[1],
                        source: `adData_${field}`,
                        creativeUrl: window.location.href,
                        confidence: 3
                    });
                }
                
                // Check redirects
                if (val.includes('adurl=') || val.includes('u=') || val.includes('dst=')) {
                    const redirectMatch = val.match(/[?&](?:adurl|click|u|dst)=([^"'\s&]+)/);
                    if (redirectMatch && redirectMatch[1]) {
                        let destUrl = decodeURIComponent(redirectMatch[1]);
                        while (destUrl.includes('%3A') || destUrl.includes('%3a') || destUrl.includes('%2F')) {
                            destUrl = decodeURIComponent(destUrl);
                        }
                        if (destUrl.includes('play.google.com')) {
                            const id = (new URL(destUrl)).searchParams.get('id');
                            if (id) return applyTemplateMeta({
                                type: 'Google Play',
                                appId: id,
                                source: `adData_${field}_redirect`,
                                confidence: 2
                            });
                        } else if (destUrl.includes('apple.com')) {
                            const m = destUrl.match(/id(\d{5,})/);
                            if (m && m[1]) return applyTemplateMeta({
                                type: 'App Store',
                                appId: m[1],
                                source: `adData_${field}_redirect`,
                                confidence: 2
                            });
                        }
                    }
                }
            }
        }
        
        // Regex fallback
        let jsonStr = '';
        try {
            jsonStr = JSON.stringify(data);
        } catch (e) {
            return candidate;
        }
        
        // Extract title and description from JSON using regex (ONLY if not found by main system)
        let regexTitle = null;
        let regexDescription = null;
        
        // Only use regex if templateMeta didn't find these fields
        if (!templateMeta.title || !templateMeta.description) {
            try {
                // Title patterns: appName, app_name, headline, title
                if (!templateMeta.title) {
                    const titlePatterns = [
                        /"(?:appName|app_name|headline)["']?\s*:\s*["']([^"']{3,100})["']/i,
                        /"title["']?\s*:\s*["']([^"']{3,100})["']/i
                    ];
                    for (const pattern of titlePatterns) {
                        const m = jsonStr.match(pattern);
                        if (m && m[1] && !m[1].includes('http') && !m[1].includes('www.')) {
                            regexTitle = m[1].replace(/\\x26/g, '&').replace(/\\u0026/g, '&').trim();
                            break;
                        }
                    }
                }
                
                // Description patterns: description, description1, body, text
                if (!templateMeta.description) {
                    const descPatterns = [
                        /"(?:description1?|body)["']?\s*:\s*["']([^"']{10,500})["']/i,
                        /"text["']?\s*:\s*["']([^"']{10,500})["']/i
                    ];
                    for (const pattern of descPatterns) {
                        const m = jsonStr.match(pattern);
                        if (m && m[1] && !m[1].includes('http') && !m[1].includes('www.')) {
                            regexDescription = m[1].replace(/\\x26/g, '&').replace(/\\u0026/g, '&').trim();
                            break;
                        }
                    }
                }
            } catch (e) {}
        }
        
        const androidMatch = jsonStr.match(/(?:id=|id%3D|id\\u003d|package["']?[:=]\s*["']?|docid["']?[:=]\s*["']?|appId["']?[:=]\s*["']?)([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+)/);
        if (androidMatch && androidMatch[1]) {
            const rawId = androidMatch[1];
            if (rawId !== 'class' && rawId !== 'd.value' && !rawId.includes('toString') && rawId.length > 5 && rawId.includes('.')) {
                const match = {
                    type: 'Google Play',
                    appId: rawId,
                    source: 'adData_regex',
                    creativeUrl: window.location.href,
                    confidence: 1
                };
                if (regexTitle) match.title = regexTitle;
                if (regexDescription) match.description = regexDescription;
                return applyTemplateMeta(match);
            }
        }
        
        if (!candidate || candidate.type !== 'App Store') {
            const iosMatch = jsonStr.match(/(?:id|id%3D|id\\u003d|adamId["']?[:=]\s*["']?|appId["']?[:=]\s*["']?)(\d{5,})/);
            if (iosMatch && iosMatch[1]) {
                const match = {
                    type: 'App Store',
                    appId: iosMatch[1],
                    source: 'adData_regex',
                    creativeUrl: window.location.href,
                    confidence: 1
                };
                if (regexTitle) match.title = regexTitle;
                if (regexDescription) match.description = regexDescription;
                const newCandidate = applyTemplateMeta(match);
                if (priority < 1) return newCandidate;
            }
        }

        // SafeFrame-only: when the only structure is google_template_data.adData[0] (no data.ads, no URL match),
        // still report so we never miss title, description, mainImageUrl, mainVideoUrl (e.g. creative9, "Collage de Fotos").
        const ad0 = data.google_template_data && data.google_template_data.adData && data.google_template_data.adData[0];
        if (!candidate && ad0 && (templateMeta.title || templateMeta.description || templateMeta.mainImageUrl || templateMeta.mainVideoUrl)) {
            const tid = ad0.appId && String(ad0.appId).trim();
            if (tid) {
                const ttype = (ad0.appStore === '1' || ad0.appStore === 1) ? 'App Store'
                    : (tid.includes('.') ? 'Google Play' : 'App Store');
                return applyTemplateMeta({
                    type: ttype,
                    appId: tid,
                    source: 'adData_template',
                    creativeUrl: window.location.href,
                    confidence: 3
                });
            }
        }
        
        return candidate ? applyTemplateMeta(candidate) : candidate;
    }
    
    /**
     * Check window.adData and report
     */
    function checkAdData() {
        try {
            if (window.adData) {
                const processed = processAdData(window.adData);
                if (processed && window.AdExplorer.Messenger) {
                    window.AdExplorer.Messenger.reportAd(processed);
                }
            } else if (window.google_ad_data) {
                const processed = processAdData(window.google_ad_data);
                if (processed && window.AdExplorer.Messenger) {
                    window.AdExplorer.Messenger.reportAd(processed);
                }
            }
        } catch (e) {}
    }
    
    /**
     * Start periodic check
     */
    function init() {
        checkAdData();
        setInterval(checkAdData, 1000);
    }
    
    // Export
    window.AdExplorer.Processor = {
        init: init,
        processAdData: processAdData,
        checkAdData: checkAdData
    };
    

})();
