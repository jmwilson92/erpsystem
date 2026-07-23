import { NextRequest } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only demo diagnostic. Reproduces exactly what "Take the demo" does and
 * reports why it fails, plus the relevant connection/config state — so a broken
 * demo can be diagnosed from the deployed app without digging through logs.
 *
 * Access: the public/dogfood ADMIN only (no forge-tenant cookie + ADMIN role).
 */
export async function GET(_req: NextRequest) {
  const jar = await cookies();
  if (jar.get("forge-tenant")?.value) {
    return Response.json({ error: "tenant accounts cannot run this" }, { status: 403 });
  }
  const { getCurrentUser } = await import("@/lib/auth");
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return Response.json({ error: "admin only — sign in as the owner" }, { status: 403 });
  }

  const conn = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  let host = "unknown";
  let port = "";
  try {
    const u = new URL(conn);
    host = u.hostname;
    port = u.port;
  } catch {}

  const out: Record<string, unknown> = {
    directUrlSet: !!process.env.DIRECT_URL,
    databaseUrlSet: !!process.env.DATABASE_URL,
    ddlHost: host,
    ddlPort: port,
    poolerMode: port === "6543" ? "transaction (6543) — risky for DDL" : port === "5432" ? "session (5432) — ok" : "unknown",
  };

  // 1. Does the demo template exist + is it seeded?
  try {
    const { demoTemplateExists } = await import("@/lib/services/tenancy");
    out.templateExists = await demoTemplateExists();
  } catch (e) {
    out.templateExistsError = e instanceof Error ? e.message : String(e);
  }
  if (out.templateExists) {
    try {
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: conn, max: 1 });
      try {
        const r = await pool.query(`SELECT count(*)::int AS n FROM "demo_template"."User"`);
        out.templateUserRows = r.rows[0]?.n ?? null;
      } finally {
        await pool.end();
      }
    } catch (e) {
      out.templateRowsError = e instanceof Error ? e.message : String(e);
    }
  }

  // 2. Actually try to provision a demo (then tear it down) — the real test.
  try {
    const { provisionDemo, destroyTenant } = await import("@/lib/services/tenancy");
    const t = await provisionDemo();
    out.provision = "ok";
    out.provisionedSchema = t.schemaName;
    await destroyTenant(t.schemaName).catch(() => undefined);
  } catch (e) {
    out.provision = "FAILED";
    out.provisionError = e instanceof Error ? e.message : String(e);
    if (e && typeof e === "object" && "code" in e) {
      out.provisionErrorCode = (e as { code?: string }).code;
    }
  }

  return Response.json(out);
}
