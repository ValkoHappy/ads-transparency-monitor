import { NextResponse } from "next/server";
import { createMcpAccessToken, deleteMcpAccessToken, listMcpAccessTokens, revokeMcpAccessToken } from "@ad-monitor/db";
import { isAuthenticated } from "@/lib/auth";
import { isRequestBodyTooLargeError, readJsonObject } from "@/lib/request-body";
import { rejectCrossOriginMutation } from "@/lib/request-guard";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tokens = await listMcpAccessTokens();
  return NextResponse.json({ tokens: tokens.map(serializeToken) });
}

export async function POST(request: Request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJsonObject(request).catch((error) => {
    if (isRequestBodyTooLargeError(error)) return error;
    throw error;
  });
  if (isRequestBodyTooLargeError(body)) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  try {
    const created = await createMcpAccessToken({
      name: String(body.name ?? ""),
      accessLevel: body.accessLevel === "READ_WRITE" ? "READ_WRITE" : "READ",
      isAdmin: body.isAdmin === true
    });
    return NextResponse.json({
      token: created.token,
      record: serializeToken(created.record)
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create token" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJsonObject(request).catch((error) => {
    if (isRequestBodyTooLargeError(error)) return error;
    throw error;
  });
  if (isRequestBodyTooLargeError(body)) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Token id is required" }, { status: 400 });
  const mode = body.mode === "delete" ? "delete" : "revoke";

  try {
    if (mode === "delete") {
      await deleteMcpAccessToken(id);
      return NextResponse.json({ ok: true, id, deleted: true });
    }
    const revoked = await revokeMcpAccessToken(id);
    return NextResponse.json({ ok: true, record: serializeToken(revoked) });
  } catch {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }
}

function serializeToken(token: {
  id: string;
  name: string;
  tokenPrefix: string;
  accessLevel: string;
  isAdmin: boolean;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...token,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
    updatedAt: token.updatedAt.toISOString()
  };
}
