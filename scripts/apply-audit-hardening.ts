/**
 * Make AuditLog append-only in every schema that has one.
 *
 * Needed because the provisioning paths only cover schemas they create. Two
 * cases they miss:
 *
 *  - `public`. An on-premise install is usually single-tenant and lives entirely
 *    in public, whose tables come from `prisma db push` — which knows nothing
 *    about triggers. Without this, the deployment that most needs protected
 *    audit records is the one without them.
 *  - schemas provisioned before this existed, and any schema whose AuditLog was
 *    recreated by a later `db push` (recreating a table drops its triggers).
 *
 * Idempotent, so run it after every migration. The Docker entrypoint does.
 *
 * Usage:
 *   npx tsx scripts/apply-audit-hardening.ts            # public + all tenants
 *   npx tsx scripts/apply-audit-hardening.ts --check    # report, change nothing
 */
import "dotenv/config";
import { Pool } from "pg";
import { TENANT_HARDENING_SQL } from "../src/lib/tenant-template";

const CHECK_ONLY = process.argv.includes("--check");

function connectionString(): string {
  const direct = process.env.DIRECT_URL || "";
  const pooled = process.env.DATABASE_URL || "";
  // Supabase's direct host is IPv6-only and unreachable from many runners.
  const ipv6Only = /(?:@|\/\/)db\.[a-z0-9-]+\.supabase\.co[:/]/.test(direct);
  const conn = ipv6Only ? pooled || direct : direct || pooled;
  if (!conn) throw new Error("Set DATABASE_URL or DIRECT_URL.");
  return conn;
}

async function main() {
  const pool = new Pool({ connectionString: connectionString(), max: 1 });
  try {
    // Only schemas that actually have the table — a half-provisioned schema
    // should be reported, not crashed on.
    const { rows } = await pool.query<{ schemaname: string }>(
      `SELECT schemaname FROM pg_tables
        WHERE tablename = 'AuditLog'
          AND (schemaname = 'public' OR schemaname LIKE 'tenant\\_%' OR schemaname LIKE 'demo\\_%')
        ORDER BY schemaname`
    );

    if (rows.length === 0) {
      console.log("No schemas with an AuditLog table found — nothing to do.");
      return;
    }

    let hardened = 0;
    let already = 0;
    let applied = 0;

    for (const { schemaname } of rows) {
      const { rows: trg } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = 'AuditLog'
            AND t.tgname IN ('audit_log_no_update', 'audit_log_no_delete')`,
        [schemaname]
      );
      const has = Number(trg[0].n) === 2;
      if (has) {
        already += 1;
        hardened += 1;
        continue;
      }
      if (CHECK_ONLY) {
        console.log(`  MISSING  ${schemaname}`);
        continue;
      }
      // One query: the plpgsql body contains semicolons, so it must not be
      // split into statements.
      await pool.query(`SET search_path TO "${schemaname}";\n${TENANT_HARDENING_SQL}`);
      applied += 1;
      hardened += 1;
      console.log(`  applied  ${schemaname}`);
    }

    console.log("");
    console.log(`schemas with AuditLog: ${rows.length}`);
    console.log(`  already append-only: ${already}`);
    if (CHECK_ONLY) {
      const missing = rows.length - already;
      console.log(`  missing:             ${missing}`);
      if (missing > 0) {
        console.error(
          "\n--check found unprotected audit logs. Re-run without --check to fix."
        );
        process.exit(1);
      }
    } else {
      console.log(`  newly hardened:      ${applied}`);
      console.log(`  total protected:     ${hardened}/${rows.length}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
