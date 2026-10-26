import { NextResponse } from "next/server";
import { prisma, queueAdvertiserScan } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { rejectCrossOriginMutation } from "@/lib/request-guard";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const job = await prisma.scanJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const retry = await queueAdvertiserScan(job.advertiserId, job.countries, {
    retryOfJobId: job.id,
    scanMode: job.scanMode,
    requestDelayMs: job.requestDelayMs ?? undefined,
    maxPagesPerRun: job.maxPagesPerRun ?? undefined,
    maxCreativesPerRun: job.maxCreativesPerRun ?? undefined,
    scanStartDate: job.scanStartDate,
    scanEndDate: job.scanEndDate,
    refreshDetails: job.refreshDetails
  });

  return NextResponse.json({ job: retry }, { status: 201 });
}
