(function () {
    'use strict';

    window.AdExplorer = window.AdExplorer || {};

    const MAX_BODY_LENGTH = 200000;
    const MAX_RECORDS_IN_PAGE = 1000;
    const SENSITIVE_KEYS = [
        'authorization',
        'cookie',
        'setcookie',
        'token',
        'secret',
        'password',
        'passwd',
        'proxyauthorization',
        'xgoogauthuser',
        'xclientdata',
        'apikey'
    ];
    const records = [];
    let seq = 0;

    function nowIso() {
        return new Date().toISOString();
    }

    function truncateText(value) {
        if (value == null) return null;
        const text = typeof value === 'string' ? value : String(value);
        if (text.length <= MAX_BODY_LENGTH) return text;
        return text.slice(0, MAX_BODY_LENGTH) + `\n...[truncated ${text.length - MAX_BODY_LENGTH} chars]`;
    }

    function isSensitiveKey(key) {
        const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return SENSITIVE_KEYS.some(sensitive => normalized.includes(sensitive));
    }

    function sanitizeText(value) {
        return String(value)
            .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, '$1***:***@')
            .replace(/\b((?:\d{1,3}\.){3}\d{1,3}:\d{2,5}):([^:\s]+):([^\s]+)/g, '$1:***:***')
            .replace(/^((?:set-cookie|cookie|authorization|proxy-authorization|x-client-data)\s*:\s*).+$/gim, '$1[redacted]')
            .replace(/\b((?:access_token|refresh_token|id_token|api_key|password|passwd|secret)=)[^&\s]+/gi, '$1[redacted]');
    }

    function sanitizeValue(value, key) {
        if (isSensitiveKey(key)) return '[redacted]';
        if (typeof value === 'string') return sanitizeText(value);
        if (Array.isArray(value)) return value.map(item => sanitizeValue(item));
        if (!value || typeof value !== 'object') return value;
        const out = {};
        Object.keys(value).forEach(entryKey => {
            out[entryKey] = sanitizeValue(value[entryKey], entryKey);
        });
        return out;
    }

    function headersToObject(headers) {
        const out = {};
        if (!headers) return out;
        try {
            if (headers instanceof Headers) {
                headers.forEach((value, key) => {
                    out[key] = value;
                });
            } else if (Array.isArray(headers)) {
                headers.forEach(([key, value]) => {
                    out[String(key)] = String(value);
                });
            } else if (typeof headers === 'object') {
                Object.keys(headers).forEach(key => {
                    out[key] = String(headers[key]);
                });
            }
        } catch (e) { }
        return out;
    }

    function bodyToText(body) {
        if (body == null) return null;
        if (typeof body === 'string') return truncateText(body);
        if (body instanceof URLSearchParams) return truncateText(body.toString());
        if (body instanceof FormData) {
            const pairs = [];
            try {
                body.forEach((value, key) => {
                    pairs.push([key, value instanceof File ? `[File ${value.name}]` : String(value)]);
                });
            } catch (e) { }
            return truncateText(JSON.stringify(pairs));
        }
        if (body instanceof Blob) return `[Blob ${body.type || 'unknown'} ${body.size} bytes]`;
        if (body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength} bytes]`;
        if (ArrayBuffer.isView(body)) return `[${body.constructor.name} ${body.byteLength} bytes]`;
        return truncateText(String(body));
    }

    function classifyUrl(url) {
        const value = String(url || '');
        const lower = value.toLowerCase();
        return {
            isAdsTransparency: lower.includes('adstransparency.google.com') || lower.includes('/anji/_/rpc/'),
            isGoogleRpc: lower.includes('/_/rpc/') || lower.includes('/anji/_/rpc/'),
            service: (value.match(/\/(?:anji\/)?_\/rpc\/([^/?#]+)/) || [])[1] || null
        };
    }

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

    function pushRecord(record) {
        const classification = classifyUrl(record.url);
        const finalRecord = {
            id: `${Date.now()}_${++seq}`,
            capturedAt: nowIso(),
            pageUrl: window.location.href,
            frameUrl: window.location.href,
            topFrame: window.top === window,
            ...classification,
            ...record
        };

        const sanitizedRecord = sanitizeValue(finalRecord);
        records.push(sanitizedRecord);
        if (records.length > MAX_RECORDS_IN_PAGE) records.shift();

        postToContent({
            source: 'AD_EXPLORER_API_RECORDER',
            type: 'API_CALL_CAPTURED',
            payload: sanitizedRecord
        });
    }

    function getFetchUrl(input) {
        if (typeof input === 'string') return input;
        if (input && typeof input.url === 'string') return input.url;
        try { return String(input); } catch (e) { return ''; }
    }

    function getFetchMethod(input, init) {
        return (init && init.method) || (input && input.method) || 'GET';
    }

    function getFetchHeaders(input, init) {
        return headersToObject((init && init.headers) || (input && input.headers));
    }

    function installFetchRecorder() {
        if (!window.fetch || window.fetch.__adExplorerRecorded) return;
        const originalFetch = window.fetch;

        function recordedFetch(input, init) {
            const startedAt = Date.now();
            const baseRecord = {
                transport: 'fetch',
                url: getFetchUrl(input),
                method: getFetchMethod(input, init),
                requestHeaders: getFetchHeaders(input, init),
                requestBody: bodyToText(init && init.body)
            };

            return originalFetch.apply(this, arguments).then(response => {
                const record = {
                    ...baseRecord,
                    durationMs: Date.now() - startedAt,
                    status: response.status,
                    statusText: response.statusText,
                    ok: response.ok,
                    responseHeaders: headersToObject(response.headers),
                    responseBody: null,
                    responseBodyError: null
                };

                try {
                    const contentType = response.headers && response.headers.get('content-type') || '';
                    if (!contentType || /json|text|javascript|x-protobuf|octet-stream|form/i.test(contentType)) {
                        response.clone().text()
                            .then(text => {
                                record.responseBody = truncateText(text);
                                pushRecord(record);
                            })
                            .catch(err => {
                                record.responseBodyError = err && err.message ? err.message : String(err);
                                pushRecord(record);
                            });
                    } else {
                        record.responseBody = `[Skipped non-text response: ${contentType}]`;
                        pushRecord(record);
                    }
                } catch (err) {
                    record.responseBodyError = err && err.message ? err.message : String(err);
                    pushRecord(record);
                }

                return response;
            }).catch(error => {
                pushRecord({
                    ...baseRecord,
                    durationMs: Date.now() - startedAt,
                    error: error && error.message ? error.message : String(error)
                });
                throw error;
            });
        }

        recordedFetch.__adExplorerRecorded = true;
        recordedFetch.__adExplorerOriginal = originalFetch;
        window.fetch = recordedFetch;
    }

    function installXhrRecorder() {
        if (!window.XMLHttpRequest || window.XMLHttpRequest.__adExplorerRecorded) return;

        const OriginalXHR = window.XMLHttpRequest;
        const originalOpen = OriginalXHR.prototype.open;
        const originalSend = OriginalXHR.prototype.send;
        const originalSetRequestHeader = OriginalXHR.prototype.setRequestHeader;

        OriginalXHR.prototype.open = function (method, url) {
            this.__adExplorerRecord = {
                transport: 'xhr',
                method: method || 'GET',
                url: String(url || ''),
                requestHeaders: {},
                startedAt: 0
            };
            return originalOpen.apply(this, arguments);
        };

        OriginalXHR.prototype.setRequestHeader = function (name, value) {
            if (this.__adExplorerRecord) {
                this.__adExplorerRecord.requestHeaders[String(name)] = String(value);
            }
            return originalSetRequestHeader.apply(this, arguments);
        };

        OriginalXHR.prototype.send = function (body) {
            const meta = this.__adExplorerRecord || {
                transport: 'xhr',
                method: 'GET',
                url: '',
                requestHeaders: {}
            };
            meta.startedAt = Date.now();
            meta.requestBody = bodyToText(body);

            this.addEventListener('loadend', () => {
                let responseBody = null;
                let responseBodyError = null;
                try {
                    if (!this.responseType || this.responseType === 'text' || this.responseType === 'json') {
                        responseBody = typeof this.responseText === 'string'
                            ? truncateText(this.responseText)
                            : truncateText(JSON.stringify(this.response));
                    } else {
                        responseBody = `[Skipped responseType: ${this.responseType}]`;
                    }
                } catch (err) {
                    responseBodyError = err && err.message ? err.message : String(err);
                }

                pushRecord({
                    transport: 'xhr',
                    url: meta.url,
                    method: meta.method,
                    requestHeaders: meta.requestHeaders,
                    requestBody: meta.requestBody,
                    durationMs: Date.now() - meta.startedAt,
                    status: this.status,
                    statusText: this.statusText,
                    responseHeadersRaw: this.getAllResponseHeaders ? this.getAllResponseHeaders() : '',
                    responseBody: responseBody,
                    responseBodyError: responseBodyError
                });
            });

            return originalSend.apply(this, arguments);
        };

        window.XMLHttpRequest.__adExplorerRecorded = true;
    }

    function init() {
        installFetchRecorder();
        installXhrRecorder();
        window.addEventListener('message', (event) => {
            if (event.data && event.data.source === 'AD_EXPLORER_CONTENT' && event.data.type === 'REQUEST_API_RECORDS') {
                if (!isSameWindowContentMessage(event)) return;
                postToContent({
                    source: 'AD_EXPLORER_API_RECORDER',
                    type: 'API_RECORDS_DUMP',
                    payload: records.slice()
                });
            }
        });
    }

    window.AdExplorer.NetworkRecorder = {
        init: init,
        getRecords: () => records.slice()
    };

    init();
})();
