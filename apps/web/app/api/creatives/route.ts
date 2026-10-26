import { NextResponse } from "next/server";
import { findCreatives, parseCreativeFilters } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { filterMeta, requestMeta, timeAsync } from "@/lib/perf";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit"));
  const take = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 500)
    : 200;
  const filters = parseCreativeFilters(url.searchParams);
  const creatives = await timeAsync(
    "api.creatives.find",
    () => findCreatives(filters, undefined, take),
    { ...requestMeta(request), ...filterMeta(Object.fromEntries(url.searchParams.entries())), take },
    { always: true }
  );

  return NextResponse.json({ creatives });
}
