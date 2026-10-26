import { NextResponse } from "next/server";
import { prisma } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { requestMeta, timeAsync } from "@/lib/perf";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const meta = requestMeta(request);
  const [advertisers, creatives, activeCreatives, apps, scans] = await timeAsync("api.dashboard.stats", () => Promise.all([
    prisma.advertiser.count(),
    prisma.creative.count(),
    prisma.creative.count({ where: { status: "ACTIVE" } }),
    prisma.app.count(),
    prisma.scan.count()
  ]), meta, { always: true });
  return NextResponse.json({ advertisers, creatives, activeCreatives, apps, scans });
}
