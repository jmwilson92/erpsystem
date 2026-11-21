import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  classifyError,
  formatApiError,
  getErrorByCorrelation,
  latestErrorForUser,
  newCorrelationId,
  persistCapturedError,
} from "@/lib/services/carina-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function refererPath(req: NextRequest): string | null {
  const raw = req.headers.get("referer");
  if (!raw) return null;
  try {
    return new URL(raw).pathname;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized", errorCode: "PERM_DENIED" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const message = String(body.message || body.error || "Unknown error");
  const classified = classifyError({
    message,
    httpStatus: body.httpStatus != null ? Number(body.httpStatus) : null,
    errorCode: body.errorCode ? String(body.errorCode) : null,
    prismaCode: body.prismaCode ? String(body.prismaCode) : null,
    route: body.route ? String(body.route) : null,
    entityType: body.entityType ? String(body.entityType) : null,
    entityId: body.entityId ? String(body.entityId) : null,
    actionAttempted: body.actionAttempted ? String(body.actionAttempted) : null,
    field: body.field ? String(body.field) : null,
  });
  const saved = await persistCapturedError({
    correlationId: String(body.correlationId || newCorrelationId()),
    classification: classified.classification,
    errorCode: classified.errorCode,
    httpStatus: body.httpStatus != null ? Number(body.httpStatus) : null,
    message,
    route: body.route ? String(body.route) : refererPath(req),
    entityType: body.entityType ? String(body.entityType) : null,
    entityId: body.entityId ? String(body.entityId) : null,
    actionAttempted: body.actionAttempted ? String(body.actionAttempted) : null,
    userId: user.id,
    userRole: user.role,
    source: String(body.source || "client-api"),
    payload: body.payload && typeof body.payload === "object" ? (body.payload as Record<string, unknown>) : { field: body.field },
    sessionId: body.sessionId ? String(body.sessionId) : null,
    field: classified.field || (body.field ? String(body.field) : null),
  });
  return NextResponse.json({
    ok: true,
    id: saved.id,
    correlationId: saved.correlationId,
    classification: saved.classification,
    errorCode: saved.errorCode,
  });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized", errorCode: "PERM_DENIED" }, { status: 401 });
  const url = new URL(req.url);
  const ref = url.searchParams.get("correlationId") || url.searchParams.get("ref");
  if (ref) {
    const row = await getErrorByCorrelation(ref);
    if (!row || (row.userId && row.userId !== user.id && user.role !== "ADMIN")) {
      return NextResponse.json(
        formatApiError({ message: "Error not found", errorCode: "NOT_FOUND", correlationId: newCorrelationId(), httpStatus: 404 }),
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, error: row });
  }
  const row = await latestErrorForUser(user.id);
  return NextResponse.json({ ok: true, error: row });
}
