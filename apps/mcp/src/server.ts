import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_MCP_ACCESS, type McpRequestAccess } from "./tool-schemas.js";
import { registerScopedTool } from "./tool-support.js";
export type { McpRequestAccess } from "./tool-schemas.js";
import { registerAdvertisersTools } from "./tools/advertisers.js";
import { registerCreativesTools } from "./tools/creatives.js";
import { registerReferencesTools } from "./tools/references.js";
import { registerCreativeRepairTools } from "./tools/creative-repair.js";
import { registerAppsTools } from "./tools/apps.js";
import { registerAdvertiserAnalysisTools } from "./tools/advertiser-analysis.js";
import { registerScansTools } from "./tools/scans.js";
import { registerSettingsTools } from "./tools/settings.js";
import { registerSystemTools } from "./tools/system.js";
import { registerDashboardTools } from "./tools/dashboard.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerProxiesTools } from "./tools/proxies.js";
import { registerMaintenanceTools } from "./tools/maintenance.js";

export function createAppMcpServer(
  access: McpRequestAccess = DEFAULT_MCP_ACCESS,
) {
  const server = new McpServer(
    {
      name: "ads-transparency-monitor-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );
  const registerTool = (
    currentServer: McpServer,
    name: string,
    config: any,
    handler: (args: any, extra: any) => Promise<any>,
  ) => registerScopedTool(currentServer, access, name, config, handler);
  registerAdvertisersTools(server, registerTool, access);
  registerCreativesTools(server, registerTool, access);
  registerReferencesTools(server, registerTool, access);
  registerCreativeRepairTools(server, registerTool, access);
  registerAppsTools(server, registerTool, access);
  registerAdvertiserAnalysisTools(server, registerTool, access);
  registerScansTools(server, registerTool, access);
  registerSettingsTools(server, registerTool, access);
  registerSystemTools(server, registerTool, access);
  registerDashboardTools(server, registerTool, access);
  registerAnalyticsTools(server, registerTool, access);
  registerProxiesTools(server, registerTool, access);
  registerMaintenanceTools(server, registerTool, access);
  return server;
}
