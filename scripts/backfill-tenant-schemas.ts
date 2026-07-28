/**
 * Bring existing tenant / demo schemas up to the current table set.
 *
 * Schema-per-tenant means `prisma db push` only ever fixes ONE schema. Every
 * tenant and every live demo sandbox got its tables from a snapshot of
 * src/lib/tenant-template.ts taken when it was provisioned, so any schema
 * created before a model was added is permanently missing that table until
 * something backfills it. That is what this does.
 *
 * Safe by construction: it only runs `CREATE TABLE IF NOT EXISTS`-equivalent
 * DDL for tables that are ABSENT, and never touches a table that already
 * exists — no column changes, no drops, no data written.
 *
 * Usage:
 *   npx tsx scripts/backfill-tenant-schemas.ts            # report only
 *   npx tsx scripts/backfill-tenant-schemas.ts --apply    # actually create
 *   npx tsx scripts/backfill-tenant-schemas.ts --apply --include-demos
 *
 * Demo sandboxes are skipped unless --include-demos: they are disposable and
 * normally recycle themselves, so it is usually cheaper to let the pool roll
 * over than to patch each one.
 *
 * Requires DIRECT_URL or DATABASE_URL (use the direct, non-pooled URL — this
 * is DDL).
 */
import "dotenv/config";
import { Pool } from "pg";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";

const APPLY = process.argv.includes("--apply");
const INCLUDE_DEMOS = process.argv.includes("--include-demos");

/** Schemas that aren't tenants and must never be touched by this script. */
const SYSTEM_SCHEMAS = new Set([
  "public",
  "information_schema",
  "pg_catalog",
  "pg_toast",
  "extensions",
  "graphql",
  "graphql_public",
  "auth",
  "storage",
  "realtime",
  "supabase_functions",
  "supabase_migrations",
  "vault",
  "pgsodium",
  "pgsodium_masks",
  "net",
  "cron",
]);

/** Every `CREATE TABLE "X"` in the generated template, in dependency-free order. */
function templateTables(): Map<string, string> {
  const out = new Map<string, string>();
  // Statements are separated by the "-- CreateTable" / "-- CreateIndex" comments
  // prisma migrate diff emits; split on CREATE TABLE and keep each block.
  const re = /CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(TENANT_TABLES_SQL))) {
    out.set(m[1], m[0]);
  }
  return out;
}

/** Indexes belonging to a table, so a backfilled table isn't left unindexed. */
function templateIndexes(table: string): string[] {
  const re = new RegExp(
    `CREATE (?:UNIQUE )?INDEX "[^"]*" ON "${table}"[^;]*;`,
    "g"
  );
  return TENANT_TABLES_SQL.match(re) ?? [];
}

/** Foreign keys whose owning table is one we just created. */
function templateForeignKeys(tables: Set<string>): string[] {
  const re = /ALTER TABLE "([^"]+)" ADD CONSTRAINT [^;]*;/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(TENANT_FKS_SQL))) {
    if (tables.has(m[1])) out.push(m[0]);
  }
  return out;
}

async function main() {
  const connectionString =
    process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  if (!connectionString) {
    console.error("No DIRECT_URL or DATABASE_URL set.");
    process.exit(1);
  }

  const wanted = templateTables();
  console.log(
    `Template has ${wanted.size} tables. Mode: ${APPLY ? "APPLY" : "report only (pass --apply to write)"}\n`
  );

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const { rows: schemas } = await pool.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
        WHERE nspname NOT LIKE 'pg\\_%'
        ORDER BY nspname`
    );

    let patched = 0;
    let scanned = 0;

    for (const { nspname: schema } of schemas) {
      if (SYSTEM_SCHEMAS.has(schema)) continue;
      const isDemo = schema.startsWith("demo_");
      if (isDemo && !INCLUDE_DEMOS) continue;
      scanned++;

      const { rows: existing } = await pool.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
        [schema]
      );
      // A schema with no tables at all isn't a half-migrated tenant, it's
      // something else entirely — leave it alone.
      if (existing.length === 0) continue;

      const have = new Set(existing.map((r) => r.tablename));
      const missing = [...wanted.keys()].filter((t) => !have.has(t));
      if (missing.length === 0) {
        console.log(`  ok      ${schema} (${have.size} tables)`);
        continue;
      }

      console.log(
        `  MISSING ${schema}: ${missing.length} table(s) — ${missing.join(", ")}`
      );
      if (!APPLY) continue;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const ddl: string[] = [];
        for (const t of missing) {
          ddl.push(wanted.get(t)!);
          ddl.push(...templateIndexes(t));
        }
        ddl.push(...templateForeignKeys(new Set(missing)));
        await client.query(`SET search_path TO "${schema}";\n${ddl.join("\n")}`);
        await client.query("COMMIT");
        patched++;
        console.log(`  patched ${schema}`);
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        console.error(
          `  FAILED  ${schema}: ${e instanceof Error ? e.message : String(e)}`
        );
      } finally {
        client.release();
      }
    }

    console.log(
      `\nScanned ${scanned} schema(s)${INCLUDE_DEMOS ? "" : " (demos skipped — pass --include-demos)"}.` +
        (APPLY ? ` Patched ${patched}.` : " Nothing written.")
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
