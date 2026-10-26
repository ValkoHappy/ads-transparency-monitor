const DEFAULT_JSON_BODY_LIMIT_BYTES = 1_000_000;

export class RequestBodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readJsonObject(request: Request, limitBytes = DEFAULT_JSON_BODY_LIMIT_BYTES) {
  const body = await readJsonValue(request, limitBytes).catch((error) => {
    if (error instanceof RequestBodyTooLargeError) throw error;
    return {};
  });
  return isRecord(body) ? body : {};
}

export function isRequestBodyTooLargeError(error: unknown): error is RequestBodyTooLargeError {
  return error instanceof RequestBodyTooLargeError;
}

async function readJsonValue(request: Request, limitBytes: number) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw new RequestBodyTooLargeError(limitBytes);
  }

  const text = await readTextWithLimit(request, limitBytes);
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function readTextWithLimit(request: Request, limitBytes: number) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let output = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > limitBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyTooLargeError(limitBytes);
    }
    output += decoder.decode(value, { stream: true });
  }

  return output + decoder.decode();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
