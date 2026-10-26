import { NextResponse } from "next/server";
import { cancelScanJob, prisma } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { rejectCrossOriginMutation } from "@/lib/request-guard";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const job = await prisma.scanJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["QUEUED", "RUNNING"].includes(job.status)) {
    return NextResponse.json({ job });
  }

  const updated = await cancelScanJob(id);

  return NextResponse.json({ job: updated });
}
