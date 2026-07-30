#!/usr/bin/env node
/**
 * Generate src/lib/tenant-template.ts — the full Protessera table DDL (unqualified,
 * no schema prefix) as an importable string, used to provision a fresh Postgres
 * schema per tenant.
 *
 * The provisioner sets `search_path` to the new schema and runs this, so every
 * CREATE TABLE lands in that tenant's schema. Emitting a TS module (rather than
 * a .sql read at runtime) guarantees the DDL is bundled into serverless
 * functions on Vercel.
 *
 * Re-run after any change to prisma/schema.prisma:
 *   node scripts/gen-tenant-ddl.mjs
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const raw = execSync(
  "npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script",
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);

// Drop the leading `CREATE SCHEMA "public"` — the provisioner creates the
// tenant's own schema and sets search_path before running this.
let cleaned = raw
  .split("\n")
  .filter((l) => !/^CREATE SCHEMA IF NOT EXISTS "public";/.test(l.trim()))
  .filter((l) => l.trim() !== "-- CreateSchema")
  .join("\n")
  .trim();

/**
 * Models that live ONLY in the control plane (the `public` schema).
 *
 * The staff portal's telemetry and the tenant registry are ours, not a
 * customer's: nothing in a tenant schema ever reads them, and every one is
 * reached through controlPlaneClient() rather than the request-scoped proxy.
 * Provisioning them into every tenant and demo schema created hundreds of dead
 * tables that could only mislead someone reading a customer's database.
 *
 * Verified safe to drop: no foreign key from a table we keep points at any of
 * these, so removing them cannot leave a dangling reference. TelemetryIssueEvent
 * references TelemetryIssue, and both leave together.
 *
 * This only affects NEWLY provisioned schemas. Schemas created before this keep
 * the empty tables — harmless, and the backfill only ever adds, never drops.
 */
const CONTROL_PLANE_ONLY = new Set([
  "TelemetryEvent",
  "TelemetryIssue",
  "TelemetryIssueEvent",
  "Tenant",
  "TenantLogin",
]);

/** The table a generated statement acts on, or null if it names none. */
function tableOf(stmt) {
  const m =
    stmt.match(/CREATE TABLE\s+"([^"]+)"/) ||
    stmt.match(/CREATE(?:\s+UNIQUE)?\s+INDEX\s+"[^"]+"\s+ON\s+"([^"]+)"/) ||
    stmt.match(/ALTER TABLE\s+"([^"]+)"/);
  return m ? m[1] : null;
}

const kept = cleaned
  .split(/;\s*(?:\r?\n|$)/)
  .map((x) => x.trim())
  .filter(Boolean)
  .filter((stmt) => {
    const t = tableOf(stmt);
    return !(t && CONTROL_PLANE_ONLY.has(t));
  });

const dropped =
  cleaned.split(/;\s*(?:\r?\n|$)/).filter((x) => x.trim()).length - kept.length;
cleaned = kept.join(";\n\n") + ";";

const tables = (cleaned.match(/CREATE TABLE/g) || []).length;

// migrate diff emits all CREATE TABLE/INDEX first, then every AddForeignKey.
// Split so a clone can: create tables (no FKs) → copy data → add FKs, which
// avoids needing FK-disabling superuser tricks.
const fkMarker = cleaned.indexOf("-- AddForeignKey");
const tablesSql = fkMarker >= 0 ? cleaned.slice(0, fkMarker).trim() : cleaned;
const fksSql = fkMarker >= 0 ? cleaned.slice(fkMarker).trim() : "";
const fkCount = (fksSql.match(/ADD CONSTRAINT/g) || []).length;

/**
 * Post-provision hardening: make AuditLog append-only.
 *
 * NIST SP 800-171 3.3.8 wants audit records protected from modification and
 * deletion. A trigger that raises is the enforcement — the application never
 * updates or deletes audit rows, so anything that tries is either a bug or
 * someone covering tracks, and both should fail loudly.
 *
 * FOR EACH STATEMENT rather than FOR EACH ROW: cheaper, and it still fires on a
 * statement that would have matched no rows, so `DELETE FROM "AuditLog"` is
 * refused rather than quietly succeeding against an empty match.
 *
 * Kept OUT of TENANT_TEMPLATE_SQL and shipped as its own constant because the
 * plpgsql body contains semicolons and newlines — the statement splitter that
 * batches the template DDL would cut it in half. It must be executed as one
 * query. See runBatchedDdl / applyHardening in services/tenancy.ts.
 *
 * Idempotent so the backfill can re-apply it to schemas that already exist, and
 * after any schema change that recreates the table.
 *
 * Scope, honestly: this stops the application and casual database access. A
 * superuser or the table owner can still ALTER TABLE ... DISABLE TRIGGER, so it
 * is not tamper-proof against a determined DBA — that needs shipping audit
 * records off-box to append-only storage.
 */
const hardeningSql = `CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only: % is not permitted (NIST SP 800-171 3.3.8)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON "AuditLog";
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

DROP TRIGGER IF EXISTS audit_log_no_delete ON "AuditLog";
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();`;

const out = `// GENERATED by scripts/gen-tenant-ddl.mjs — do not edit by hand.
// Full Protessera table DDL (unqualified) for provisioning a per-tenant schema.
// Regenerate after schema changes:  node scripts/gen-tenant-ddl.mjs
// Tables: ${tables} · Foreign keys: ${fkCount}
//
// TENANT_TEMPLATE_SQL  — everything (used to provision + seed a real tenant).
// TENANT_TABLES_SQL    — tables + indexes only (no FKs), for the clone path.
// TENANT_FKS_SQL       — the foreign keys, applied after data is copied.
// TENANT_HARDENING_SQL — append-only AuditLog triggers. MUST be executed as a
//   single query: the plpgsql body contains semicolons, so the statement
//   splitter that batches the other constants would cut it in half.
export const TENANT_TEMPLATE_SQL = ${JSON.stringify(cleaned)};
export const TENANT_TABLES_SQL = ${JSON.stringify(tablesSql)};
export const TENANT_FKS_SQL = ${JSON.stringify(fksSql)};
export const TENANT_HARDENING_SQL = ${JSON.stringify(hardeningSql)};
`;

writeFileSync("src/lib/tenant-template.ts", out);
console.log(
  `wrote src/lib/tenant-template.ts (${tables} tables, ${fkCount} FKs, ` +
    `${dropped} control-plane-only statements excluded)`
);
