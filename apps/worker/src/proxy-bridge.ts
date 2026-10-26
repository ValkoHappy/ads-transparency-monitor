import http from "node:http";
import net from "node:net";
import { once } from "node:events";

type PlaywrightProxySettings = {
  server: string;
  username?: string;
  password?: string;
};

type SocksProxy = {
  host: string;
  port: number;
  username?: string;
  password?: string;
};

type Bridge = {
  server: http.Server;
  url: string;
};

const bridges = new Map<string, Promise<Bridge>>();

export async function resolvePlaywrightProxy(proxyUrl: string): Promise<PlaywrightProxySettings> {
  const normalizedProxyUrl = normalizeRuntimeProxyUrl(proxyUrl);
  const url = new URL(normalizedProxyUrl);
  const hasAuth = Boolean(url.username || url.password);

  if ((url.protocol === "socks5:" || url.protocol === "socks5h:") && hasAuth) {
    const bridge = await getSocks5AuthBridge(normalizedProxyUrl);
    return { server: bridge.url };
  }

  return {
    server: `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined
  };
}

export function normalizeRuntimeProxyUrl(value: string) {
  const text = value.trim();
  const compactWithScheme = normalizeSchemeCompactProxyUrl(text);
  if (compactWithScheme) return compactWithScheme;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;

  const parts = text.split(":");
  if (parts.length >= 4) {
    const [host, port, username, ...passwordParts] = parts;
    return `socks5://${encodeURIComponent(username)}:${encodeURIComponent(passwordParts.join(":"))}@${host}:${port}`;
  }

  return `http://${text}`;
}

function normalizeSchemeCompactProxyUrl(value: string) {
  const match = value.match(/^(socks5h?|https?):\/\/([^/:@]+):(\d+):([^:]+):(.+)$/i);
  if (!match) return "";
  const [, protocol, host, port, username, password] = match;
  return `${protocol.toLowerCase()}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
}

async function getSocks5AuthBridge(proxyUrl: string) {
  const existing = bridges.get(proxyUrl);
  if (existing) return existing;

  const promise = startBridge(parseSocksProxy(proxyUrl));
  bridges.set(proxyUrl, promise);
  return promise;
}

function parseSocksProxy(proxyUrl: string): SocksProxy {
  const url = new URL(proxyUrl);
  if (url.protocol !== "socks5:" && url.protocol !== "socks5h:") {
    throw new Error(`Unsupported bridge proxy protocol: ${url.protocol}`);
  }
  const port = Number(url.port || 1080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid SOCKS5 proxy port: ${url.port}`);
  }
  return {
    host: url.hostname,
    port,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined
  };
}

async function startBridge(proxy: SocksProxy): Promise<Bridge> {
  const server = http.createServer(async (req, res) => {
    try {
      await handleHttpRequest(proxy, req, res);
    } catch (error) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  server.on("connect", (req, clientSocket, head) => {
    void handleConnect(proxy, req, clientSocket as net.Socket, head);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("SOCKS5 bridge did not bind to a local TCP port");
  }
  server.unref();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function handleConnect(proxy: SocksProxy, req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) {
  try {
    const [host, portText] = String(req.url ?? "").split(":");
    const port = Number(portText || 443);
    if (!host || !Number.isInteger(port)) throw new Error(`Invalid CONNECT target: ${req.url}`);

    const upstream = await connectViaSocks5(proxy, host, port);
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  } catch (error) {
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.destroy();
  }
}

async function handleHttpRequest(proxy: SocksProxy, req: http.IncomingMessage, res: http.ServerResponse) {
  const target = new URL(req.url ?? "");
  const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  const upstream = await connectViaSocks5(proxy, target.hostname, port);
  const path = `${target.pathname}${target.search}`;
  const headers = { ...req.headers };
  delete headers["proxy-connection"];
  delete headers["proxy-authorization"];

  upstream.write(`${req.method ?? "GET"} ${path || "/"} HTTP/${req.httpVersion}\r\n`);
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) upstream.write(`${name}: ${item}\r\n`);
    } else if (value !== undefined) {
      upstream.write(`${name}: ${value}\r\n`);
    }
  }
  upstream.write("\r\n");
  const clientSocket = res.socket as net.Socket | null;
  if (!clientSocket) throw new Error("HTTP client socket is not available");
  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
  upstream.pipe(clientSocket, { end: false });
  req.pipe(upstream);
}

async function connectViaSocks5(proxy: SocksProxy, targetHost: string, targetPort: number): Promise<net.Socket> {
  const socket = net.connect(proxy.port, proxy.host);
  await once(socket, "connect");

  const authRequired = Boolean(proxy.username || proxy.password);
  socket.write(Buffer.from(authRequired ? [0x05, 0x01, 0x02] : [0x05, 0x01, 0x00]));
  const greeting = await readExact(socket, 2);
  if (greeting[0] !== 0x05) throw new Error("Invalid SOCKS5 greeting response");
  if (greeting[1] === 0xff) throw new Error("SOCKS5 proxy rejected authentication methods");

  if (greeting[1] === 0x02) {
    const username = Buffer.from(proxy.username ?? "");
    const password = Buffer.from(proxy.password ?? "");
    if (username.length > 255 || password.length > 255) throw new Error("SOCKS5 credentials are too long");
    socket.write(Buffer.concat([Buffer.from([0x01, username.length]), username, Buffer.from([password.length]), password]));
    const auth = await readExact(socket, 2);
    if (auth[1] !== 0x00) throw new Error("SOCKS5 authentication failed");
  }

  const host = Buffer.from(targetHost);
  if (host.length > 255) throw new Error(`SOCKS5 target host is too long: ${targetHost}`);
  socket.write(Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
    host,
    Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff])
  ]));

  const header = await readExact(socket, 4);
  if (header[1] !== 0x00) throw new Error(`SOCKS5 connect failed with code ${header[1]}`);
  const addressLength = header[3] === 0x01 ? 4 : header[3] === 0x04 ? 16 : (await readExact(socket, 1))[0];
  await readExact(socket, addressLength + 2);
  return socket;
}

async function readExact(socket: net.Socket, length: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  while (total < length) {
    const chunk = socket.read(length - total) as Buffer | null;
    if (chunk) {
      chunks.push(chunk);
      total += chunk.length;
      continue;
    }
    await Promise.race([
      once(socket, "readable"),
      once(socket, "end").then(() => {
        throw new Error("SOCKS5 socket ended early");
      }),
      once(socket, "error").then(([error]) => {
        throw error;
      })
    ]);
  }

  return Buffer.concat(chunks, total);
}
