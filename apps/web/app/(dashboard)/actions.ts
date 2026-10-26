"use server";

import { cancelScanJob, getSystemSettings, queueAdvertiserScan, updateSystemSettings, upsertAdvertiser, prisma } from "@ad-monitor/db";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { normalizeCountryCodes } from "@/lib/countries";
import { normalizeProxyList, normalizeProxyUrl } from "@/lib/proxy";
import { isSameOriginMutation } from "@/lib/request-guard";

export async function addAdvertiserAction(formData: FormData) {
  await requireAuth();
  await requireSameOriginAction();
  const input = String(formData.get("input") ?? "");
  const name = String(formData.get("name") ?? "") || undefined;
  const countries = parseCountries(String(formData.get("countries") ?? ""));
  const scanMode = scanModeValue(formData.get("scanMode"));

  await upsertAdvertiser({ input, name, selectedCountries: countries, scanMode });
  revalidatePath("/advertisers");
  revalidatePath("/");
}

export async function updateAdvertiserAction(formData: FormData) {
  await requireAuth();
  await requireSameOriginAction();
  const advertiserId = String(formData.get("advertiserId") ?? "");
  if (!advertiserId) return;

  const name = String(formData.get("name") ?? "").trim();
  const countries = parseCountries(String(formData.get("countries") ?? ""));
  const scanMode = scanModeValue(formData.get("scanMode"));
  const requestDelayMs = boundedNumberValue(formData.get("requestDelayMs"), 0, 3_600_000);
  const scanStartDate = dateValue(formData.get("scanStartDate"));
  const scanEndDate = dateValue(formData.get("scanEndDate"));
  const notes = String(formData.get("notes") ?? "").trim();

  await prisma.advertiser.update({
    where: { id: advertiserId },
    data: {
      name: name || null,
      selectedCountries: countries,
      scanMode,
      dailyScanEnabled: formData.get("dailyScanEnabled") === "on",
      requestDelayMs,
      scanStartDate,
      scanEndDate,
      notes: notes || null
    }
  });

  revalidatePath("/");
  revalidatePath("/advertisers");
  revalidatePath(`/advertisers/${advertiserId}`);
  revalidatePath("/scans");
}

export async function queueScanAction(formData: FormData) {
  await requireAuth();
  await requireSameOriginAction();
  const advertiserId = String(formData.get("advertiserId") ?? "");
  const returnTo = safeReturnPath(formData.get("returnTo"));

  if (!advertiserId) return;
  const advertiser = await prisma.advertiser.findUnique({ where: { id: advertiserId } });
  if (!advertiser) return;
  const settings = await getSystemSettings(prisma);

  await queueAdvertiserScan(advertiserId, [], {
    scanMode: advertiser.scanMode ?? settings.scanMode,
    requestDelayMs: advertiser.requestDelayMs ?? settings.requestDelayMs,
    maxPagesPerRun: advertiser.maxPagesPerRun ?? settings.maxPagesPerRun ?? undefined,
    maxCreativesPerRun: advertiser.maxCreativesPerRun ?? settings.maxCreativesPerRun ?? undefined,
    scanStartDate: advertiser.scanStartDate,
    scanEndDate: advertiser.scanEndDate,
    refreshDetails: false
  });
  revalidatePath("/advertisers");
  revalidatePath("/scans");
  if (returnTo) redirect(returnTo);
}

export async function runFullScanAction(formData: FormData) {
  await requireAuth();
  await requireSameOriginAction();
  const advertiserId = String(formData.get("advertiserId") ?? "");
  const returnTo = safeReturnPath(formData.get("returnTo"));
  if (!advertiserId) return;

  const advertiser = await prisma.advertiser.findUnique({ where: { id: advertiserId } });
  if (!advertiser) return;
  const settings = await getSystemSettings(prisma);

  await queueAdvertiserScan(advertiserId, [], {
    scanMode: "FULL",
    requestDelayMs: advertiser.requestDelayMs ?? settings.requestDelayMs,
    maxPagesPerRun: advertiser.maxPagesPerRun ?? settings.maxPagesPerRun ?? undefined,
    maxCreativesPerRun: advertiser.maxCreativesPerRun ?? settings.maxCreativesPerRun ?? undefined,
    scanStartDate: advertiser.scanStartDate,
    scanEndDate: advertiser.scanEndDate,
    refreshDetails: true
  });
  revalidatePath("/");
  revalidatePath("/advertisers");
  revalidatePath(`/advertisers/${advertiser.id}`);
  revalidatePath("/scans");
  if (returnTo) redirect(returnTo);
}

export async function updateSettingsAction(formData: FormData) {
  await requireAuth();
  await requireSameOriginAction();
  await updateSystemSettings({
    scanMode: scanModeValue(formData.get("scanMode")),
    dailyScanHour: parseScheduleHours(String(formData.get("dailyScanHours") ?? ""))[0] ?? 3,
    scheduleType: scheduleTypeValue(formData.get("scheduleType")),
    dailyScanHours: parseScheduleHours(String(formData.get("dailyScanHours") ?? "")),
    scanIntervalHours: boundedNumberValue(formData.get("scanIntervalHours"), 1, 24),
    requestDelayMs: boundedNumberValue(formData.get("requestDelayMs"), 0, 3_600_000),
    maxPagesPerRun: nullableBoundedNumberValue(formData.get("maxPagesPerRun"), 1, 1000),
    maxCreativesPerRun: nullableBoundedNumberValue(formData.get("maxCreativesPerRun"), 1, 100000),
    workerConcurrency: boundedNumberValue(formData.get("workerConcurrency"), 1, 6),
    advertiserDelayMs: boundedNumberValue(formData.get("advertiserDelayMs"), 0, 3_600_000),
    probeIntervalMs: boundedNumberValue(formData.get("probeIntervalMs"), 60_000, 86_400_000),
    rawSnapshotRetentionDays: boundedNumberValue(formData.get("rawSnapshotRetentionDays"), 1, 365),
    scanEventRetentionDays: boundedNumberValue(formData.get("scanEventRetentionDays"), 1, 365),
    exportDefaultFields: formData.getAll("exportDefaultFields").map(String).filter(Boolean),
    proxyEnabled: formData.get("proxyEnabled") === "on",
    proxyUrl: proxyUrlValue(formData.get("proxyUrl"))
  });
  await syncProxyPool(String(formData.get("proxyPool") ?? ""));
  revalidatePath("/settings");
  revalidatePath("/export");
}

export async function retryScanAction(formData: FormData) {
  await requireAuth();
  await requireSameOriginAction();
  const scanJobId = String(formData.get("scanJobId") ?? "");
  if (!scanJobId) return;
  const job = await prisma.scanJob.findUnique({ where: { id: scanJobId } });
  if (!job) return;
  await queueAdvertiserScan(job.advertiserId, job.countries, {
    retryOfJobId: job.id,
    scanMode: job.scanMode,
    requestDelayMs: job.requestDelayMs ?? undefined,
    maxPagesPerRun: job.maxPagesPerRun ?? undefined,
    maxCreativesPerRun: job.maxCreativesPerRun ?? undefined,
    scanStartDate: job.scanStartDate,
    scanEndDate: job.scanEndDate,
    refreshDetails: job.refreshDetails
  });
  revalidatePath("/scans");
  revalidatePath(`/advertisers/${job.advertiserId}`);
}

export async function cancelScanAction(formData: FormData) {
  await requireAuth();
  await requireSameOriginAction();
  const scanJobId = String(formData.get("scanJobId") ?? "");
  if (!scanJobId) return;
  const job = await prisma.scanJob.findUnique({ where: { id: scanJobId } });
  if (!job) return;
  if (!["QUEUED", "RUNNING"].includes(job.status)) return;
  await cancelScanJob(scanJobId, prisma);
  revalidatePath("/scans");
  revalidatePath(`/advertisers/${job.advertiserId}`);
}

export async function goToCreativeAction(formData: FormData) {
  await requireAuth();
  await requireSameOriginAction();
  const creativeId = String(formData.get("creativeId") ?? "").trim();
  if (creativeId) redirect(`/creatives/${encodeURIComponent(creativeId)}`);
}

async function requireSameOriginAction() {
  if (!isSameOriginMutation(await headers())) {
    throw new Error("Invalid origin");
  }
}

function parseCountries(value: string) {
  return normalizeCountryCodes(value);
}

function scanModeValue(value: FormDataEntryValue | null) {
  return value === "FAST" || value === "FULL" || value === "CAUTIOUS" ? value : undefined;
}

function safeReturnPath(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value.trim() : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : null;
}

function scheduleTypeValue(value: FormDataEntryValue | null) {
  return value === "DAILY" || value === "MULTIPLE" || value === "INTERVAL" ? value : "DAILY";
}

function parseScheduleHours(value: string) {
  const hours = value
    .split(/[,\s]+/)
    .map((item) => Number(item))
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  return [...new Set(hours)].sort((a, b) => a - b);
}

function boundedNumberValue(value: FormDataEntryValue | null, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function nullableBoundedNumberValue(value: FormDataEntryValue | null, min: number, max: number) {
  if (value === null || String(value).trim() === "") return null;
  return boundedNumberValue(value, min, max);
}

function proxyUrlValue(value: FormDataEntryValue | null) {
  const text = String(value ?? "");
  if (text.includes("***")) return undefined;
  return normalizeProxyUrl(text) || null;
}

function dateValue(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : null;
}

async function syncProxyPool(value: string) {
  const urls = normalizeProxyList(value.split(/[\r\n,]+/));
  const existing = await prisma.proxyEndpoint.findMany({ select: { id: true, url: true } });
  await Promise.all([
    ...urls.map((url) => prisma.proxyEndpoint.upsert({
      where: { url },
      create: { url, status: "OK" },
      update: {}
    })),
    ...existing.filter((proxy) => !urls.includes(proxy.url)).map((proxy) => prisma.proxyEndpoint.delete({ where: { id: proxy.id } }))
  ]);
}
