import { NextResponse } from "next/server";

export function rejectCrossOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  const host = request.headers.get("host");
  if (!host) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });

  const requestProtocol = new URL(request.url).protocol.replace(":", "");
  const allowedOrigins = allowedOriginsForHeaders(request.headers, host, requestProtocol);

  return allowedOrigins.has(origin) ? null : NextResponse.json({ error: "Invalid origin" }, { status: 403 });
}

export function isSameOriginMutation(headers: Headers) {
  const origin = headers.get("origin");
  if (!origin) return true;
  const host = headers.get("host");
  if (!host) return false;
  return allowedOriginsForHeaders(headers, host).has(origin);
}

function allowedOriginsForHeaders(headers: Headers, host: string, requestProtocol?: string) {
  const allowedOrigins = new Set<string>();
  if (requestProtocol) {
    allowedOrigins.add(`${requestProtocol}://${host}`);
  } else {
    allowedOrigins.add(`http://${host}`);
    allowedOrigins.add(`https://${host}`);
  }

  const forwardedHost = headers.get("x-forwarded-host");
  const forwardedProto = headers.get("x-forwarded-proto");
  if (forwardedHost && isTrustedProxyHost(host)) {
    if (forwardedProto) {
      allowedOrigins.add(`${forwardedProto}://${forwardedHost}`);
    } else {
      allowedOrigins.add(`http://${forwardedHost}`);
      allowedOrigins.add(`https://${forwardedHost}`);
    }
  }
  return allowedOrigins;
}

function isTrustedProxyHost(host: string) {
  const hostname = hostNameOnly(host).toLowerCase();
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "web" ||
    hostname?.endsWith(".internal");
}

function hostNameOnly(host: string) {
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.split(":")[0] ?? host;
}
