/**
 * Remove staff-portal tables from tenant and demo schemas.
 *
 * The support portal's telemetry and the tenant registry live in the control
 * plane (`public`). They were being provisioned into every tenant and demo
 * schema because the tenant template is generated from the whole
 * schema.prisma. scripts/gen-tenant-ddl.mjs now excludes them, but that only
 * affects NEWLY provisioned schemas — this clears the ones that already exist.
 *
 * Safe by default:
 *   - `public` is refused outright, twice. Dropping the real telemetry tables
 *     would destroy the staff portal's entire history.
 *   - Only schemas matching tenant_* / demo_* are considered.
 *   - A table holding rows is REPORTED, not dropped, unless --force. Nothing
 *     should have written to these, but "should" is not a reason to delete
 *     someone's data without showing it to them first.
 *
 * Usage:
 *   npx tsx scripts/drop-control-plane-tables.ts            # report only
 *   npx tsx scripts/drop-control-plane-tables.ts --apply    # drop empty ones
 *   npx tsx scripts/drop-control-plane-tables.ts --apply --force   # drop regardless
 */
import "dotenv/config";
import { Pool } from "pg";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

/**
 * Child before parent: TelemetryIssueEvent references TelemetryIssue, so
 * dropping in this order needs no CASCADE — and not using CASCADE means an
 * unexpected dependency raises instead of being silently swept away.
 */
const CONTROL_PLANE_ONLY = [
  "TelemetryIssueEvent",
  "TelemetryIssue",
  "TelemetryEvent",
  "TenantLogin",
  "Tenant",
] as const;

function connectionString(): string {
  const direct = process.env.DIRECT_URL || "";
  const pooled = process.env.DATABASE_URL || "";
  const ipv6Only = /(?:@|\/\/)db\.[a-z0-9-]+\.supabase\.co[:/]/.test(direct);
  const conn = ipv6Only ? pooled || direct : direct || pooled;
  if (!conn) throw new Error("Set DATABASE_URL or DIRECT_URL.");
  return conn;
}

async function main() {
  const pool = new Pool({ connectionString: connectionString(), max: 1 });
  try {
    const { rows: schemas } = await pool.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
        WHERE nspname LIKE 'tenant\\_%' OR nspname LIKE 'demo\\_%'
        ORDER BY nspname`
    );
    if (schemas.length === 0) {
      console.log("No tenant_* or demo_* schemas found.");
      return;
    }

    let present = 0;
    let dropped = 0;
    let skippedNonEmpty = 0;

    for (const { nspname: schema } of schemas) {
      // Belt and braces. The query above cannot return 'public', but this is
      // the one mistake in this script that would be unrecoverable.
      if (schema === "public") continue;

      const found: string[] = [];
      for (const table of CONTROL_PLANE_ONLY) {
        const { rows } = await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_tables
            WHERE schemaname = $1 AND tablename = $2`,
          [schema, table]
        );
        if (Number(rows[0].n) === 0) continue;
        present += 1;

        const { rows: cnt } = await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM "${schema}"."${table}"`
        );
        const n = Number(cnt[0].n);

        if (!APPLY) {
          found.push(n > 0 ? `${table} (${n} rows!)` : table);
          continue;
        }
        if (n > 0 && !FORCE) {
          console.log(`  SKIP  ${schema}.${table} — holds ${n} rows, re-run with --force`);
          skippedNonEmpty += 1;
          continue;
        }
        await pool.query(`DROP TABLE IF EXISTS "${schema}"."${table}"`);
        dropped += 1;
        found.push(table);
      }
      if (found.length > 0) {
        console.log(`  ${APPLY ? "dropped" : "would drop"}  ${schema}: ${found.join(", ")}`);
      }
    }

    console.log("");
    console.log(`schemas scanned:      ${schemas.length}`);
    console.log(`stray tables found:   ${present}`);
    if (APPLY) {
      console.log(`dropped:              ${dropped}`);
      if (skippedNonEmpty > 0) {
        console.log(`skipped (had rows):   ${skippedNonEmpty}  — inspect, then --force`);
      }
    } else if (present > 0) {
      console.log("\nReport only. Re-run with --apply to drop them.");
    } else {
      console.log("\nNothing to do — no tenant schema carries a staff-portal table.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
