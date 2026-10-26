import { NextResponse } from "next/server";
import { prisma } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { sanitizePublicValue } from "@/lib/sanitize";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const creative = await prisma.creative.findUnique({
    where: { creativeId: id },
    select: {
      id: true,
      creativeId: true,
      advertiserId: true,
      appDbId: true,
      format: true,
      status: true,
      previewUrl: true,
      firstShownAt: true,
      lastShownAt: true,
      publicDays: true,
      impressionsMin: true,
      impressionsMax: true,
      firstFoundAt: true,
      lastFoundAt: true,
      detailFetchedAt: true,
      createdAt: true,
      updatedAt: true,
      advertiser: true,
      app: true,
      countries: true,
      assets: true,
      rawSnapshots: { orderBy: { createdAt: "desc" }, take: 20 }
    }
  });
  if (!creative) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    creative: {
      ...creative,
      rawSnapshots: creative.rawSnapshots.map((snapshot) => ({
        ...snapshot,
        url: snapshot.url ? sanitizePublicValue(snapshot.url) : snapshot.url,
        payload: sanitizePublicValue(snapshot.payload)
      }))
    }
  });
}
