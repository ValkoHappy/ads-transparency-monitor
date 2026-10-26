import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma, withAdvertiserQueueLock } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { rejectCrossOriginMutation } from "@/lib/request-guard";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const advertiser = await prisma.advertiser.findFirst({
    where: {
      OR: [
        { id },
        { googleAdvertiserId: id }
      ]
    },
    select: {
      id: true,
      scanJobs: {
        where: { status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true },
        take: 1
      }
    }
  });

  if (!advertiser) {
    return NextResponse.json({ error: "Advertiser not found." }, { status: 404 });
  }

  if (advertiser.scanJobs.length) {
    return NextResponse.json(
      { error: "Сначала отмените или дождитесь завершения активного сканирования." },
      { status: 409 }
    );
  }

  try {
    await withAdvertiserQueueLock(advertiser.id, async (tx) => {
      const activeJob = await tx.scanJob.findFirst({
        where: {
          advertiserId: advertiser.id,
          status: { in: ["QUEUED", "RUNNING"] }
        },
        select: { id: true }
      });
      if (activeJob) throw new Error("active-scan-exists");
      await tx.advertiser.delete({ where: { id: advertiser.id } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "active-scan-exists") {
      return NextResponse.json(
        { error: "Сначала отмените или дождитесь завершения активного сканирования." },
        { status: 409 }
      );
    }
    throw error;
  }
  revalidatePath("/");
  revalidatePath("/advertisers");
  revalidatePath("/creatives");
  revalidatePath("/scans");
  revalidatePath("/export");

  return NextResponse.json({ ok: true });
}
