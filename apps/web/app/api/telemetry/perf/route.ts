import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { logPerf, requestMeta, sanitizeClientPerf } from "@/lib/perf";

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return new NextResponse(null, { status: 204 });

  try {
    const body = await request.json();
    logPerf("client", {
      ...requestMeta(request),
      ...sanitizeClientPerf(body)
    });
  } catch (error) {
    logPerf("client", {
      ...requestMeta(request),
      event: "telemetry-parse-error",
      error: error instanceof Error ? error.message : "unknown"
    });
  }

  return new NextResponse(null, { status: 204 });
}
