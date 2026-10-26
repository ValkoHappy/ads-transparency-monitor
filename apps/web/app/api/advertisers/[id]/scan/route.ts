import { NextResponse } from "next/server";
import { getSystemSettings, prisma, queueAdvertiserScan } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { normalizeCountryCodes } from "@/lib/countries";
import { isRequestBodyTooLargeError, readJsonObject } from "@/lib/request-body";
import { rejectCrossOriginMutation } from "@/lib/request-guard";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await readJsonObject(request).catch((error) => {
    if (isRequestBodyTooLargeError(error)) return error;
    throw error;
  });
  if (isRequestBodyTooLargeError(body)) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }
  const advertiser = await prisma.advertiser.findUnique({ where: { id } });
  if (!advertiser) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const settings = await getSystemSettings();

  const countries = normalizeCountryCodes(body.countries);
  const scanMode = body.scanMode === "FAST" || body.scanMode === "FULL" || body.scanMode === "CAUTIOUS"
    ? body.scanMode
    : advertiser.scanMode ?? settings.scanMode;
  const fullScan = scanMode === "FULL";
  const job = await queueAdvertiserScan(id, countries, {
    scanMode,
    requestDelayMs: advertiser.requestDelayMs ?? settings.requestDelayMs,
    maxPagesPerRun: advertiser.maxPagesPerRun ?? settings.maxPagesPerRun ?? undefined,
    maxCreativesPerRun: advertiser.maxCreativesPerRun ?? settings.maxCreativesPerRun ?? undefined,
    scanStartDate: advertiser.scanStartDate,
    scanEndDate: advertiser.scanEndDate,
    refreshDetails: fullScan
  });
  return NextResponse.json({ job }, { status: 201 });
}
