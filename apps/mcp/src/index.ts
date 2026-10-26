import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { authenticateMcpAccessToken } from "@ad-monitor/db";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createAppMcpServer, type McpRequestAccess } from "./server.js";
import { readMcpEnv, validateMcpEnv } from "./env.js";

const env = validateMcpEnv();
const app = createMcpExpressApp({
  host: env.host,
  allowedHosts: env.allowedHosts
});
const sessions: Record<string, {
  server: ReturnType<typeof createAppMcpServer>;
  transport: StreamableHTTPServerTransport;
  access: McpRequestAccess;
}> = {};

app.disable("x-powered-by");

app.get("/", (_req: any, res: any) => {
  res.json({
    ok: true,
    service: "ads-transparency-monitor-mcp",
    transport: "streamable-http",
    endpoint: "/mcp"
  });
});

app.get("/healthz", (_req: any, res: any) => {
  res.json({ ok: true });
});

app.use("/mcp", requireMcpAccess(env.bearerToken));

app.post("/mcp", async (req: any, res: any) => {
  try {
    const sessionId = req.header("mcp-session-id");
    if (sessionId) {
      const current = sessions[sessionId];
      if (!current) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided"
          },
          id: null
        });
        return;
      }
      if (!sameAccess(current.access, req.mcpAccess)) {
        res.status(401).json(unauthorizedResponse());
        return;
      }
      await current.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided"
        },
        id: null
      });
      return;
    }

    const server = createAppMcpServer(req.mcpAccess);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (initializedSessionId) => {
        sessions[initializedSessionId] = { server, transport, access: req.mcpAccess };
      }
    });

    transport.onclose = () => {
      const currentSessionId = transport.sessionId;
      if (currentSessionId) delete sessions[currentSessionId];
      // Avoid recursive close(): server.close() closes the transport, which would
      // otherwise re-enter this handler and crash the process.
      transport.onclose = undefined;
      server.close().catch(() => undefined);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      });
    }
  }
});

app.get("/mcp", async (req: any, res: any) => {
  const sessionId = req.header("mcp-session-id");
  if (!sessionId || !sessions[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  try {
    if (!sameAccess(sessions[sessionId].access, req.mcpAccess)) {
      res.status(401).json(unauthorizedResponse());
      return;
    }
    await sessions[sessionId].transport.handleRequest(req, res);
  } catch (error) {
    console.error("MCP GET request failed", error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
});

app.delete("/mcp", async (req: any, res: any) => {
  const sessionId = req.header("mcp-session-id");
  if (!sessionId || !sessions[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  try {
    if (!sameAccess(sessions[sessionId].access, req.mcpAccess)) {
      res.status(401).json(unauthorizedResponse());
      return;
    }
    await sessions[sessionId].transport.handleRequest(req, res);
  } catch (error) {
    console.error("MCP DELETE request failed", error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
});

const httpServer = createServer(app);
httpServer.listen(env.port, env.host, () => {
  const publicEnv = readMcpEnv();
  console.log(`MCP server listening on http://${publicEnv.host}:${publicEnv.port}/mcp`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
  });
}

function requireMcpAccess(expectedToken?: string) {
  return async (req: any, res: any, next: any) => {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) {
      res.status(401).json(unauthorizedResponse());
      return;
    }

    if (expectedToken && token === expectedToken) {
      req.mcpAccess = {
        source: "env",
        accessLevel: "READ_WRITE",
        isAdmin: true
      } satisfies McpRequestAccess;
      next();
      return;
    }

    const dbAccess = await authenticateMcpAccessToken(token).catch(() => null);
    if (!dbAccess) {
      res.status(401).json(unauthorizedResponse());
      return;
    }

    req.mcpAccess = dbAccess;
    next();
  };
}

function unauthorizedResponse() {
  return {
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Unauthorized"
    },
    id: null
  };
}

function sameAccess(left?: McpRequestAccess, right?: McpRequestAccess) {
  return left?.source === right?.source
    && left?.accessLevel === right?.accessLevel
    && left?.isAdmin === right?.isAdmin
    && left?.tokenId === right?.tokenId
    && left?.tokenPrefix === right?.tokenPrefix;
}
