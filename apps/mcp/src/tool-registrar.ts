import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export type ToolRegistrar = (
  server: McpServer,
  name: string,
  config: any,
  handler: (args: any, extra: any) => Promise<any>,
) => void;
