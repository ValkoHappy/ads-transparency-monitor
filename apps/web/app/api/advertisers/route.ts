import { NextResponse } from "next/server";
import { prisma, upsertAdvertiser } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { normalizeCountryCodes } from "@/lib/countries";
import { isRequestBodyTooLargeError, readJsonObject } from "@/lib/request-body";
import { rejectCrossOriginMutation } from "@/lib/request-guard";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit"));
  const take = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 1000)
    : 500;
  const advertisers = await prisma.advertiser.findMany({ orderBy: { updatedAt: "desc" }, take });
  return NextResponse.json({ advertisers });
}

export async function POST(request: Request) {
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
  try {
    const advertiser = await upsertAdvertiser({
      input: String(body.input ?? ""),
      name: body.name ? String(body.name) : undefined,
      selectedCountries: normalizeCountryCodes(body.selectedCountries)
    });
    return NextResponse.json({ advertiser }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid advertiser input" }, { status: 400 });
  }
}
