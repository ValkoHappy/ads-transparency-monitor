import { NextResponse } from "next/server";
import { EXPORT_FIELDS, getSystemSettings, updateSystemSettings } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { normalizeProxyList, normalizeProxyUrl } from "@/lib/proxy";
import { isRequestBodyTooLargeError, readJsonObject } from "@/lib/request-body";
import { rejectCrossOriginMutation } from "@/lib/request-guard";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await getSystemSettings();
  return NextResponse.json({ settings: publicSettings(settings) });
}

export async function PATCH(request: Request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await readJsonObject(request).catch((error) => {
    if (isRequestBodyTooLargeError(error)) return error;
    throw error;
  });
  if (isRequestBodyTooLargeError(body)) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }
  const settings = await updateSystemSettings({
    scanMode: normalizeScanMode(body.scanMode),
    dailyScanHour: normalizeBoundedNumber(body.dailyScanHour, 0, 23),
    scheduleType: normalizeScheduleType(body.scheduleType),
    dailyScanHours: normalizeHours(body.dailyScanHours),
    scanIntervalHours: normalizeBoundedNumber(body.scanIntervalHours, 1, 24),
    requestDelayMs: normalizeBoundedNumber(body.requestDelayMs, 0, 3_600_000),
    maxPagesPerRun: normalizeNullableBoundedNumber(body.maxPagesPerRun, 1, 1000),
    maxCreativesPerRun: normalizeNullableBoundedNumber(body.maxCreativesPerRun, 1, 100000),
    workerConcurrency: normalizeBoundedNumber(body.workerConcurrency, 1, 6),
    advertiserDelayMs: normalizeBoundedNumber(body.advertiserDelayMs, 0, 3_600_000),
    probeIntervalMs: normalizeBoundedNumber(body.probeIntervalMs, 60_000, 86_400_000),
    rawSnapshotRetentionDays: normalizeBoundedNumber(body.rawSnapshotRetentionDays, 1, 365),
    scanEventRetentionDays: normalizeBoundedNumber(body.scanEventRetentionDays, 1, 365),
    exportDefaultFields: normalizeExportDefaultFields(body.exportDefaultFields),
    proxyEnabled: typeof body.proxyEnabled === "boolean" ? body.proxyEnabled : undefined,
    proxyUrl: normalizeProxyPatchValue(body.proxyUrl)
  });
  if (Array.isArray(body.proxyPool)) {
    await syncProxyPool(normalizeProxyList(body.proxyPool.map(String)));
  }
  return NextResponse.json({ settings: publicSettings(settings) });
}

function normalizeScanMode(value: unknown) {
  return value === "FAST" || value === "FULL" || value === "CAUTIOUS" ? value : undefined;
}

function normalizeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeBoundedNumber(value: unknown, min: number, max: number) {
  const number = normalizeNumber(value);
  return number === undefined ? undefined : Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeNullableBoundedNumber(value: unknown, min: number, max: number) {
  if (value === null || value === "") return null;
  return normalizeBoundedNumber(value, min, max);
}

function normalizeScheduleType(value: unknown) {
  return value === "DAILY" || value === "MULTIPLE" || value === "INTERVAL" ? value : undefined;
}

function normalizeHours(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const hours = value.map(Number).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  return [...new Set(hours)].sort((a, b) => a - b);
}

function normalizeExportDefaultFields(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const requested = value.map(String);
  const fields = EXPORT_FIELDS.filter((field) => requested.includes(field));
  return fields.length ? fields : undefined;
}

function normalizeProxyPatchValue(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  if (value.includes("***")) return undefined;
  const normalized = normalizeProxyUrl(value);
  return normalized || null;
}

async function syncProxyPool(urlsInput: string[]) {
  const { prisma } = await import("@ad-monitor/db");
  const urls = normalizeProxyList(urlsInput);
  const existing = await prisma.proxyEndpoint.findMany({ select: { id: true, url: true } });
  await Promise.all([
    ...urls.map((url) => prisma.proxyEndpoint.upsert({ where: { url }, create: { url, status: "OK" }, update: {} })),
    ...existing.filter((proxy) => !urls.includes(proxy.url)).map((proxy) => prisma.proxyEndpoint.delete({ where: { id: proxy.id } }))
  ]);
}

function publicSettings<T extends { proxyUrl?: string | null }>(settings: T) {
  return {
    ...settings,
    proxyUrl: settings.proxyUrl ? maskProxyUrl(settings.proxyUrl) : settings.proxyUrl
  };
}

function maskProxyUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = url.username ? "***" : "";
      url.password = url.password ? "***" : "";
    }
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:@]+):([^@]+)@/, "://***:***@");
  }
}
