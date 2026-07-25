import "dotenv/config";
import { Pool } from "pg";
import { execSync } from "node:child_process";
import { TENANT_TEMPLATE_SQL } from "../src/lib/tenant-template";

/**
 * Build (or rebuild) the `demo_template` schema: the pre-seeded schema every
 * throwaway demo is cloned from. Run once after deploy and again whenever the
 * schema or demo seed changes:
 *
 *   npx tsx scripts/build-demo-template.ts
 *
 * Connection notes (Supabase + Codespaces):
 *   - Do NOT use the "Direct" host `db.<ref>.supabase.co` — it is IPv6-only
 *     and often ENETUNREACH from Codespaces/Vercel.
 *   - Prefer DATABASE_URL (pooler, port 6543) or the Session pooler URL
 *     (aws-0-….pooler.supabase.com:5432). Same values as Vercel env vars.
 */
const SCHEMA = "demo_template";

/**
 * Pick a reachable URL. Skip Supabase's IPv6-only direct host.
 */
function connectionString(): string {
  const direct = process.env.DIRECT_URL || "";
  const pooled = process.env.DATABASE_URL || "";
  const isIpv6OnlyDirect =
    /(?:@|\/\/)db\.[a-z0-9-]+\.supabase\.co[:/]/.test(direct);

  if (isIpv6OnlyDirect) {
    if (!pooled) {
      throw new Error(
        "DIRECT_URL points at db.*.supabase.co (IPv6-only, unreachable from Codespaces).\n" +
          "Set DATABASE_URL to the Supabase *pooler* URL (port 6543), e.g.\n" +
          "  postgresql://postgres.PROJECT:PASS@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true\n" +
          "Copy it from Vercel env or Supabase → Connect → Transaction pooler."
      );
    }
    console.log(
      "⚠ DIRECT_URL is db.*.supabase.co (IPv6-only) — using DATABASE_URL (pooler) instead"
    );
    return pooled;
  }
  const conn = direct || pooled;
  if (!conn) {
    throw new Error(
      "No DATABASE_URL or DIRECT_URL set. Add them to .env (from Vercel / Supabase Connect)."
    );
  }
  return conn;
}

function hostHint(url: string) {
  try {
    return new URL(url.replace(/^postgresql:/, "http:")).host;
  } catch {
    return "(unparsed)";
  }
}

async function main() {
  const conn = connectionString();
  console.log(`Connecting via ${hostHint(conn)} …`);

  const pool = new Pool({ connectionString: conn, max: 1 });
  const c = await pool.connect();
  try {
    await c.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await c.query(`CREATE SCHEMA "${SCHEMA}"`);
    // Same-query SET search_path so transaction poolers still apply DDL in this schema
    await c.query(`SET search_path TO "${SCHEMA}";\n${TENANT_TEMPLATE_SQL}`);
  } finally {
    c.release();
    await pool.end();
  }
  console.log(`✓ provisioned ${SCHEMA} — seeding demo data...`);

  execSync(`npx tsx prisma/seed.ts`, {
    stdio: "inherit",
    env: {
      ...process.env,
      SEED_SCHEMA: SCHEMA,
      // Prefer reachable pooler for seed as well
      DATABASE_URL: conn,
      DIRECT_URL: conn,
    },
  });

  console.log(`\n✅ demo template ready (${SCHEMA})`);
}

main().catch((e) => {
  console.error("build-demo-template failed:", e);
  process.exit(1);
});
