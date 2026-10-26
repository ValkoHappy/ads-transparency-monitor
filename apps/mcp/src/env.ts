import { readRuntimeEnv } from "@ad-monitor/db";

export interface McpRuntimeEnv {
  databaseUrl: string;
  port: number;
  host: string;
  bearerToken?: string;
  allowedHosts?: string[];
  logLevel: "debug" | "info" | "warn" | "error";
}

export function readMcpEnv(source: NodeJS.ProcessEnv = process.env): McpRuntimeEnv {
  const base = readRuntimeEnv(source);
  return {
    databaseUrl: base.databaseUrl,
    port: positiveInteger(source.MCP_PORT, 3101),
    host: source.MCP_HOST?.trim() || "127.0.0.1",
    bearerToken: clean(source.MCP_BEARER_TOKEN),
    allowedHosts: parseCsv(source.MCP_ALLOWED_HOSTS),
    logLevel: parseLogLevel(source.MCP_LOG_LEVEL)
  };
}

export function validateMcpEnv(source: NodeJS.ProcessEnv = process.env) {
  const env = readMcpEnv(source);
  if (source.NODE_ENV === "production" && !env.bearerToken) {
    throw new Error("MCP_BEARER_TOKEN is required in production.");
  }
  return env;
}

function clean(value: string | undefined) {
  const text = value?.trim();
  return text ? text : undefined;
}

function parseCsv(value: string | undefined) {
  const items = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : undefined;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLogLevel(value: string | undefined): McpRuntimeEnv["logLevel"] {
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}
