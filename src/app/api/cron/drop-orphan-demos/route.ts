import { NextRequest } from "next/server";
import { Pool } from "pg";
import { DEMO_TEMPLATE_SCHEMA, destroyTenant } from "@/lib/services/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function ddlUrl(): string | undefined {
  const direct = process.env.DIRECT_URL;
  const isUnreachable =
    !!direct && /(?:@|\/\/)db\.[a-z0-9-]+\.supabase\.co[:/]/.test(direct);
  if (isUnreachable) return process.env.DATABASE_URL || direct;
  return direct || process.env.DATABASE_URL;
}

/**
 * Drops ONE leftover demo_* schema per request (not demo_template).
 * Browser can loop this. One DROP SCHEMA CASCADE per connection so we do not
 * exhaust max_locks_per_transaction.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const key = req.nextUrl.searchParams.get("key");
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const url = ddlUrl();
  if (!url) {
    return Response.json({ ok: false, error: "no database url" }, { status: 500 });
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const listed = await pool.query<{ nspname: string }>(
      `SELECT nspname
         FROM pg_namespace
        WHERE nspname LIKE 'demo_%'
          AND nspname <> $1
        ORDER BY nspname
        LIMIT 1`,
      [DEMO_TEMPLATE_SCHEMA]
    );
    const name = listed.rows[0]?.nspname;
    if (!name) {
      const left = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_namespace WHERE nspname LIKE 'demo_%'`
      );
      return Response.json({
        ok: true,
        done: true,
        dropped: null,
        left: Number(left.rows[0]?.n ?? 0),
      });
    }

    await destroyTenant(name).catch(async () => {
      await pool.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    });

    const left = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_namespace WHERE nspname LIKE 'demo_%'`
    );
    return Response.json({
      ok: true,
      done: false,
      dropped: name,
      left: Number(left.rows[0]?.n ?? 0),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await pool.end();
  }
}
