import "dotenv/config";
import { Pool } from "pg";
import { execSync } from "node:child_process";
import {
  TENANT_TEMPLATE_SQL,
  TENANT_HARDENING_SQL,
} from "../src/lib/tenant-template";

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
    // Batched, and SET search_path rides along in every batch so transaction
    // poolers still apply the DDL in this schema. Sending the whole template as
    // one query takes a lock on all 1,123 objects at once and can exhaust the
    // server-wide lock table ("out of shared memory") — see DDL_BATCH_SIZE in
    // services/tenancy.ts, which this mirrors.
    const statements = TENANT_TEMPLATE_SQL.split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (let i = 0; i < statements.length; i += 50) {
      await c.query(
        `SET search_path TO "${SCHEMA}";\n${statements.slice(i, i + 50).join(";\n")};`
      );
    }
  } finally {
    c.release();
    await pool.end();
  }
  console.log(`✓ provisioned ${SCHEMA} — seeding demo data...`);

  const seedEnv = {
    ...process.env,
    SEED_SCHEMA: SCHEMA,
    // Prefer reachable pooler for seed as well
    DATABASE_URL: conn,
    DIRECT_URL: conn,
  };

  execSync(`npx tsx prisma/seed.ts`, { stdio: "inherit", env: seedEnv });

  // Module seeds. Without these the demo has a full sidebar but Fleet, Service,
  // CRM, Maintenance, and Logistics open to empty pages — the worst possible
  // impression for a prospect who clicks the module they came to evaluate.
  //
  // These take --schema rather than SEED_SCHEMA, and they depend on the base
  // seed having already created users, customers, and parts to hang records off.
  for (const script of [
    "scripts/seed-field-service.ts",
    "scripts/seed-crm-cmms-logistics.ts",
  ]) {
    console.log(`\n→ ${script}`);
    execSync(`npx tsx ${script} --schema ${SCHEMA}`, {
      stdio: "inherit",
      env: seedEnv,
    });
  }

  // Append-only audit triggers LAST, after seeding. The seeds wipe and reload
  // tables, so installing a DELETE-blocking trigger first would risk failing the
  // build on a seed that clears audit rows. Sent as ONE query — the plpgsql body
  // contains semicolons and must not be split. Every demo cloned from this
  // template inherits the protection.
  const hardenPool = new Pool({ connectionString: conn, max: 1 });
  try {
    await hardenPool.query(
      `SET search_path TO "${SCHEMA}";\n${TENANT_HARDENING_SQL}`
    );
    console.log("✓ audit log is append-only");
  } finally {
    await hardenPool.end();
  }

  console.log(`\n✅ demo template ready (${SCHEMA})`);
}

main().catch((e) => {
  console.error("build-demo-template failed:", e);
  process.exit(1);
});
