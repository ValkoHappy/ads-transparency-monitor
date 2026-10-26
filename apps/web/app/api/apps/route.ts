import { NextResponse } from "next/server";
import { prisma } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit"));
  const take = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 1000)
    : 500;
  const apps = await prisma.app.findMany({
    orderBy: { lastSeenAt: "desc" },
    include: { _count: { select: { creatives: true } } },
    take
  });
  return NextResponse.json({ apps });
}
