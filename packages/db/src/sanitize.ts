const URL_WITH_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;
const COMPACT_PROXY_WITH_CREDENTIALS = /\b((?:\d{1,3}\.){3}\d{1,3}:\d{2,5}):([^:\s]+):([^\s]+)/g;
const SENSITIVE_HEADER_LINE = /^((?:set-cookie|cookie|authorization|proxy-authorization|x-client-data)\s*:\s*).+$/gim;
const SENSITIVE_PARAM = /\b((?:access_token|refresh_token|id_token|api_key|password|passwd|secret)=)[^&\s]+/gi;

export function errorMessage(error: unknown) {
  return sanitizeOperationalMessage(error instanceof Error ? error.message : String(error));
}

export function sanitizeOperationalMessage(message: string) {
  return message
    .replace(URL_WITH_CREDENTIALS, "$1***:***@")
    .replace(COMPACT_PROXY_WITH_CREDENTIALS, "$1:***:***")
    .replace(SENSITIVE_HEADER_LINE, "$1[redacted]")
    .replace(SENSITIVE_PARAM, "$1[redacted]");
}
