export function normalizeProxyUrl(value: string) {
  const text = value.trim();
  if (!text) return "";
  const compactWithScheme = normalizeSchemeCompactProxyUrl(text);
  if (compactWithScheme) return compactWithScheme;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return normalizeExplicitProxyUrl(text);

  const parts = text.split(":");
  if (parts.length >= 4) {
    const [host, port, username, ...passwordParts] = parts;
    return normalizeExplicitProxyUrl(`socks5://${encodeURIComponent(username)}:${encodeURIComponent(passwordParts.join(":"))}@${host}:${port}`);
  }

  return normalizeExplicitProxyUrl(`http://${text}`);
}

export function normalizeProxyList(values: string[]) {
  return [...new Set(values.map(normalizeProxyUrl).filter(Boolean))];
}

function normalizeSchemeCompactProxyUrl(value: string) {
  const match = value.match(/^(socks5h?|https?):\/\/([^/:@]+):(\d+):([^:]+):(.+)$/i);
  if (!match) return "";
  const [, protocol, host, port, username, password] = match;
  return normalizeExplicitProxyUrl(`${protocol.toLowerCase()}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`);
}

function normalizeExplicitProxyUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:", "socks5:", "socks5h:"].includes(url.protocol)) return "";
    if (!url.hostname) return "";
    if (url.port) {
      const port = Number(url.port);
      if (!Number.isInteger(port) || port <= 0 || port > 65_535) return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}
