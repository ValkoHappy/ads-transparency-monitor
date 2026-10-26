import { NextResponse } from "next/server";
import { findCreatives, parseCreativeFilters, resolveExportFields, sanitizeSpreadsheetCell, type ExportField } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const creatives = await findCreatives(parseCreativeFilters(url.searchParams), undefined, exportLimit(url));
  const selectedFields = url.searchParams.getAll("fields");
  const fields = resolveExportFields(selectedFields.length ? selectedFields : url.searchParams.get("fields"));

  const rows = [
    fields.map(headerForField),
    ...creatives.map((creative) => fields.map((field) => valueForField(field, creative)))
  ];

  return new NextResponse(`\uFEFF${rows.map(toCsvRow).join("\n")}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=creatives.csv",
      "cache-control": "no-store"
    }
  });
}

function exportLimit(url: URL) {
  const requested = Number(url.searchParams.get("limit"));
  return Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 50_000) : 5_000;
}

function toCsvRow(row: string[]) {
  return row.map((cell) => `"${sanitizeSpreadsheetCell(cell).replace(/"/g, "\"\"")}"`).join(",");
}

function headerForField(field: ExportField) {
  return ({
    creativeId: "creative_id",
    advertiserId: "advertiser_id",
    advertiserName: "advertiser_name",
    appId: "app_id",
    appName: "app_name",
    store: "store",
    format: "format",
    status: "status",
    countries: "countries",
    firstShownAt: "first_shown",
    lastShownAt: "last_shown",
    publicDays: "public_days",
    impressions: "impressions",
    previewUrl: "preview_url"
  })[field];
}

function valueForField(field: ExportField, creative: Awaited<ReturnType<typeof findCreatives>>[number]) {
  const values: Record<ExportField, string> = {
    creativeId: creative.creativeId,
    advertiserId: creative.advertiser.googleAdvertiserId,
    advertiserName: creative.advertiser.name ?? "",
    appId: creative.app?.appId ?? "",
    appName: creative.app?.name ?? "",
    store: creative.app?.store ?? "",
    format: creative.format,
    status: creative.status,
    countries: creative.countries.map((country) => country.countryCode ?? country.googleGeoId).join("|"),
    firstShownAt: creative.firstShownAt?.toISOString() ?? "",
    lastShownAt: creative.lastShownAt?.toISOString() ?? "",
    publicDays: String(creative.publicDays ?? ""),
    impressions: [creative.impressionsMin, creative.impressionsMax].filter((value) => value !== null && value !== undefined).join("-"),
    previewUrl: creative.previewUrl ?? ""
  };
  return values[field];
}
