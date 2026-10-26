import { NextResponse } from "next/server";
import { buildCreativeWhere, parseCreativeFilters, prisma } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { sanitizePublicValue } from "@/lib/sanitize";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const where = buildCreativeWhere(parseCreativeFilters(url.searchParams));
  const requestedLimit = Number(url.searchParams.get("limit"));
  const take = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 1000)
    : 1000;
  const snapshots = await prisma.rawApiSnapshot.findMany({
    where: Object.keys(where).length ? { creative: { is: where } } : undefined,
    orderBy: { createdAt: "desc" },
    take,
    include: {
      creative: {
        select: {
          creativeId: true,
          advertiserId: true,
          appDbId: true,
          format: true,
          status: true,
          previewUrl: true,
          firstFoundAt: true,
          lastFoundAt: true,
          updatedAt: true
        }
      }
    }
  });

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    count: snapshots.length,
    snapshots: snapshots.map((snapshot) => ({
      ...snapshot,
      url: snapshot.url ? sanitizePublicValue(snapshot.url) : snapshot.url,
      payload: sanitizePublicValue(snapshot.payload)
    }))
  }, { headers: { "cache-control": "no-store" } });
}
