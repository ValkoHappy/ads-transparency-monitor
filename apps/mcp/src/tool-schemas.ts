import { type McpAccessLevel } from "@ad-monitor/db";
import * as z from "zod/v4";

export const creativeStatusEnum = z.enum(["ACTIVE", "STOPPED", "UNKNOWN"]);

export const creativeFormatEnum = z.enum(["TEXT", "IMAGE", "VIDEO", "UNKNOWN"]);

export const storeEnum = z.enum(["GOOGLE_PLAY", "APP_STORE", "UNKNOWN"]);

export const scanModeEnum = z.enum(["FAST", "FULL", "CAUTIOUS"]);

export const scanStatusEnum = z.enum([
  "QUEUED",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "BLOCKED",
  "CANCELED",
]);

export const sortDirectionEnum = z.enum(["asc", "desc"]);

export const activityEnum = z.enum(["NEW_TODAY", "DISAPPEARED"]);

export const dateFieldEnum = z.enum([
  "firstShownAt",
  "lastShownAt",
  "firstFoundAt",
  "lastFoundAt",
  "updatedAt",
  "createdAt",
]);

export const scheduleTypeEnum = z.enum(["DAILY", "MULTIPLE", "INTERVAL"]);

export const proxyStatusEnum = z.enum([
  "OK",
  "BLOCKED",
  "FAILED",
  "CHALLENGE_REQUIRED",
  "TIMEOUT",
]);

export const rawSnapshotKindEnum = z.enum([
  "SEARCH_CREATIVES",
  "CREATIVE_DETAIL",
  "PREVIEW_SCRIPT",
  "API_EXPORT",
]);

export const repairModeEnum = z.enum([
  "FULL",
  "DETAIL_ONLY",
  "PREVIEW_ONLY",
  "APP_LINK_ONLY",
  "STATUS_ONLY",
]);

export interface McpRequestAccess {
  source: "env" | "db";
  accessLevel: McpAccessLevel;
  isAdmin: boolean;
  tokenId?: string;
  tokenPrefix?: string;
}

export const DEFAULT_MCP_ACCESS: McpRequestAccess = {
  source: "env",
  accessLevel: "READ_WRITE",
  isAdmin: true,
};
