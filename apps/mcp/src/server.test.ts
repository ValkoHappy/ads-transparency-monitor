import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAppMcpServer, type McpRequestAccess } from "./server.js";

async function toolNames(access: McpRequestAccess) {
  const server = createAppMcpServer(access);
  const client = new Client({ name: "registration-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.listTools();
    return result.tools.map((tool) => tool.name);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("MCP tool registration and access boundaries", () => {
  it("exposes read tools without write or administrative tools", async () => {
    const names = await toolNames({ source: "db", accessLevel: "READ", isAdmin: false });
    expect(names).toContain("advertisers.list");
    expect(names).toContain("system.status");
    expect(names).not.toContain("advertisers.delete");
    expect(names).not.toContain("maintenance.recompute_creative_statuses");
  });

  it("registers write tools separately from administrative tools", async () => {
    const names = await toolNames({ source: "db", accessLevel: "READ_WRITE", isAdmin: false });
    expect(names).toContain("advertisers.create_or_update");
    expect(names).not.toContain("maintenance.recompute_creative_statuses");
  });

  it("registers administrative tools for an administrator", async () => {
    const names = await toolNames({ source: "env", accessLevel: "READ_WRITE", isAdmin: true });
    expect(names).toContain("maintenance.recompute_creative_statuses");
    expect(new Set(names).size).toBe(names.length);
  });
});
