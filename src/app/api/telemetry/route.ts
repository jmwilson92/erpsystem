import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DEMO_COOKIE, TENANT_COOKIE } from "@/lib/db";
import { recordEvent, type TelemetryKind } from "@/lib/services/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client beacon for page views and client-side errors.
 *
 * Untrusted input: the browser picks the path/label, so the session and source
 * are derived from cookies here rather than trusted from the body, and only a
 * small whitelist of event kinds is accepted. Always answers 204 — telemetry
 * must never make a visitor's page look broken.
 */
const ALLOWED: TelemetryKind[] = ["PAGE", "ERROR", "ACTION", "CONVERT"];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      kind?: string;
      path?: string;
      label?: string;
      detail?: Record<string, unknown>;
      severity?: "error" | "warn";
    };

    const kind = ALLOWED.find((k) => k === body.kind);
    if (!kind) return new Response(null, { status: 204 });

    // Session + source come from cookies, never the payload.
    const jar = await cookies();
    const demo = jar.get(DEMO_COOKIE)?.value || null;
    const tenant = jar.get(TENANT_COOKIE)?.value || null;
    const source = demo ? "DEMO" : tenant ? "TENANT" : "MARKETING";

    await recordEvent({
      kind,
      source,
      sessionId: demo || tenant || null,
      schemaName: demo || tenant || null,
      path: body.path ?? null,
      label: body.label ?? null,
      detail: body.detail ?? null,
      severity: kind === "ERROR" ? (body.severity ?? "error") : null,
    });
  } catch {
    // fall through — never surface telemetry failures
  }
  return new Response(null, { status: 204 });
}
