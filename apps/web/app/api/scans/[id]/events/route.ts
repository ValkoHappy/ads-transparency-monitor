import { NextResponse } from "next/server";
import { prisma } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { requestMeta, timeAsync } from "@/lib/perf";
import { sanitizeScanEvent } from "@/lib/sanitize";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const take = Number.isFinite(limitParam) ? Math.max(20, Math.min(500, Math.floor(limitParam))) : 220;
  const job = await timeAsync("api.scans.events", () => prisma.scanJob.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      cancelRequested: true,
      scanMode: true,
      createdAt: true,
      pagesFetched: true,
      creativesFound: true,
      detailsFetched: true,
      previewsFetched: true,
      events: {
        orderBy: { createdAt: "desc" },
        take,
        select: {
          id: true,
          level: true,
          message: true,
          createdAt: true,
          data: true
        }
      }
    }
  }), { ...requestMeta(request), jobId: id, take }, { always: true });

  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    job: {
      ...job,
      events: job.events.map(sanitizeScanEvent)
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
