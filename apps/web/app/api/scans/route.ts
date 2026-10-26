import { NextResponse } from "next/server";
import { prisma, sanitizeOperationalMessage } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { requestMeta, timeAsync } from "@/lib/perf";
import { sanitizeScanEvent } from "@/lib/sanitize";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jobs = await timeAsync("api.scans.list", () => prisma.scanJob.findMany({
    orderBy: { createdAt: "desc" },
    include: { advertiser: true, scans: { orderBy: { startedAt: "desc" }, take: 1 }, events: { orderBy: { createdAt: "desc" }, take: 5 } },
    take: 100
  }), { ...requestMeta(request), take: 100 }, { always: true });
  return NextResponse.json({
    jobs: jobs.map((job) => ({
      ...job,
      errorMessage: job.errorMessage ? sanitizeOperationalMessage(job.errorMessage) : job.errorMessage,
      blockedReason: job.blockedReason ? sanitizeOperationalMessage(job.blockedReason) : job.blockedReason,
      scans: job.scans.map((scan) => ({
        ...scan,
        errorMessage: scan.errorMessage ? sanitizeOperationalMessage(scan.errorMessage) : scan.errorMessage,
        blockedReason: scan.blockedReason ? sanitizeOperationalMessage(scan.blockedReason) : scan.blockedReason
      })),
      events: job.events.map(sanitizeScanEvent)
    }))
  });
}
