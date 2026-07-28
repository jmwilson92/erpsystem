/**
 * Bring existing tenant / demo schemas up to the current table set.
 *
 * Schema-per-tenant means `prisma db push` only ever fixes ONE schema. Every
 * tenant and every live demo sandbox got its tables from a snapshot of
 * src/lib/tenant-template.ts taken when it was provisioned, so any schema
 * created before a model was added is permanently missing that table until
 * something backfills it. That is what this does.
 *
 * Handles two kinds of drift:
 *   - missing TABLES  (a model added since the schema was provisioned)
 *   - missing COLUMNS (a field added to a model that already existed)
 *
 * The second matters more than it sounds. Prisma names every column it knows
 * about in the SQL it generates, so ONE missing column on a widely-referenced
 * table like Part breaks every query that touches it — not just the feature
 * that added it.
 *
 * Safe by construction: only CREATE TABLE for tables that are absent and
 * ALTER TABLE ADD COLUMN for columns that are absent. Never drops, never
 * retypes, never writes data. A column the template declares NOT NULL with no
 * default cannot be added to a table that already has rows; those are reported
 * rather than forced.
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

/**
 * Column name -> its definition, per table, straight out of the template.
 * Constraint lines (PRIMARY KEY, CONSTRAINT ...) are skipped — only real
 * columns can be added with ALTER TABLE ADD COLUMN.
 */
function templateColumns(): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const re = /CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(TENANT_TABLES_SQL))) {
    const cols = new Map<string, string>();
    for (const raw of m[2].split("\n")) {
      const line = raw.trim().replace(/,$/, "");
      const name = line.match(/^"([^"]+)"\s/)?.[1];
      if (!name) continue; // CONSTRAINT / PRIMARY KEY lines
      cols.set(name, line);
    }
    out.set(m[1], cols);
  }
  return out;
}

/** NOT NULL with no DEFAULT can't be added to a table that already has rows. */
function needsBackfillValue(def: string): boolean {
  return /NOT NULL/i.test(def) && !/DEFAULT/i.test(def);
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
  const wantedCols = templateColumns();
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
    let columnsAdded = 0;

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

      // Column drift on tables that DO exist. One missing column on a common
      // table breaks every query that touches it, so this matters as much as
      // a missing table.
      const { rows: cols } = await pool.query<{
        table_name: string;
        column_name: string;
      }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = $1`,
        [schema]
      );
      const haveCols = new Map<string, Set<string>>();
      for (const c of cols) {
        let set = haveCols.get(c.table_name);
        if (!set) haveCols.set(c.table_name, (set = new Set()));
        set.add(c.column_name);
      }

      const missingCols: { table: string; column: string; def: string }[] = [];
      for (const [table, wantCols] of wantedCols) {
        if (!have.has(table)) continue; // covered by the CREATE TABLE above
        const present = haveCols.get(table) ?? new Set<string>();
        for (const [name, def] of wantCols) {
          if (!present.has(name)) missingCols.push({ table, column: name, def });
        }
      }

      if (missing.length === 0 && missingCols.length === 0) {
        console.log(`  ok      ${schema} (${have.size} tables)`);
        continue;
      }

      if (missing.length > 0) {
        console.log(
          `  MISSING ${schema}: ${missing.length} table(s) — ${missing.join(", ")}`
        );
      }
      if (missingCols.length > 0) {
        console.log(
          `  MISSING ${schema}: ${missingCols.length} column(s) — ` +
            missingCols.map((c) => `${c.table}.${c.column}`).join(", ")
        );
        const risky = missingCols.filter((c) => needsBackfillValue(c.def));
        if (risky.length > 0) {
          console.log(
            `          ${risky.length} are NOT NULL with no default and may fail on a non-empty table: ` +
              risky.map((c) => `${c.table}.${c.column}`).join(", ")
          );
        }
      }
      if (!APPLY) continue;

      const client = await pool.connect();
      try {
        if (missing.length > 0) {
          await client.query("BEGIN");
          const ddl: string[] = [];
          for (const t of missing) {
            ddl.push(wanted.get(t)!);
            ddl.push(...templateIndexes(t));
          }
          ddl.push(...templateForeignKeys(new Set(missing)));
          await client.query(`SET search_path TO "${schema}";\n${ddl.join("\n")}`);
          await client.query("COMMIT");
        }

        // One statement per column, each independent: a single column that
        // can't be added shouldn't stop the other twenty that can.
        let added = 0;
        for (const c of missingCols) {
          try {
            await client.query(
              `ALTER TABLE "${schema}"."${c.table}" ADD COLUMN IF NOT EXISTS ${c.def}`
            );
            added++;
          } catch (e) {
            console.error(
              `  FAILED  ${schema}.${c.table}.${c.column}: ${
                e instanceof Error ? e.message : String(e)
              }`
            );
          }
        }
        columnsAdded += added;
        patched++;
        console.log(
          `  patched ${schema}` +
            (missing.length ? ` — ${missing.length} tables` : "") +
            (added ? ` — ${added} columns` : "")
        );
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
        (APPLY
          ? ` Patched ${patched} schema(s), ${columnsAdded} column(s) added.`
          : " Nothing written.")
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
