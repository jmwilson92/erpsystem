/** Targeted, additive billing rollout. No Stripe calls and no business data rewrites. */
const quote = value => `"${value.replaceAll('"', '""')}"`;
const validSchema = schema => schema === "public" || /^(tenant|demo)_[a-z0-9_]+$/.test(schema);

export async function backfillFoundingMembers(pool, { apply = false, includeDemos = false, columns, hardening, cutoffExclusive, now = new Date(), log = console.log }) {
  const beforeCutoff = now.getTime() < Date.parse(cutoffExclusive);
  const stats = { missingColumns: 0, missingGuards: 0, pendingGrants: 0, granted: 0, manualReview: 0 };
  const schemas = (await pool.query("SELECT nspname FROM pg_namespace ORDER BY nspname")).rows.map(r => r.nspname)
    .filter(s => validSchema(s) && (includeDemos || !s.startsWith("demo_")));
  const tableColumns = async (schema, table) => new Set((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2", [schema, table])).rows.map(r => r.column_name));
  async function addColumns(schema, table) {
    const present = await tableColumns(schema, table);
    if (!present.size) return present;
    for (const definition of columns[table]) {
      const name = definition.match(/^"([^"]+)"/)?.[1];
      if (!name || !["foundingMember", "foundingQualifiedAt"].includes(name)) throw new Error("Invalid generated founding column");
      if (present.has(name)) continue;
      stats.missingColumns++;
      log(`MISSING ${schema}.${table}.${name}`);
      if (apply) {
        await pool.query(`ALTER TABLE ${quote(schema)}.${quote(table)} ADD COLUMN IF NOT EXISTS ${definition}`);
        present.add(name);
      }
    }
    const guard = await pool.query("SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND t.tgname='founding_fields_guard'", [schema, table]);
    if (!guard.rows.length) { stats.missingGuards++; log(`MISSING ${schema}.${table} entitlement guard`); }
    if (apply) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL search_path TO ${quote(schema)}`);
        await client.query(hardening[table]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    return present;
  }
  const tenantColumns = await addColumns("public", "Tenant");
  const projection = present => `${present.has("foundingMember") ? '"foundingMember"' : 'false AS "foundingMember"'}, ${present.has("foundingQualifiedAt") ? `"foundingQualifiedAt" AT TIME ZONE 'UTC' AS "foundingQualifiedAt"` : 'NULL::timestamptz AS "foundingQualifiedAt"'}`;
  const registry = tenantColumns.size ? (await pool.query(`SELECT "id", "schemaName", "isDemo", ${projection(tenantColumns)} FROM "public"."Tenant"`)).rows : [];
  const bySchema = new Map(registry.map(t => [t.schemaName, t]));
  for (const schema of schemas) {
    const present = await addColumns(schema, "CompanySettings");
    if (!present.size || schema.startsWith("demo_") || bySchema.get(schema)?.isDemo) continue;
    const row = (await pool.query(`SELECT "id", "plan", "seats", "subscriptionStatus", "trialEndsAt", "stripeSubscriptionId", ${projection(present)} FROM ${quote(schema)}."CompanySettings" WHERE "id"='default'`)).rows[0];
    if (!row) continue;
    const tenant = bySchema.get(schema);
    const freeShop = row.plan === "SHOP" && row.seats != null && row.seats <= 5 && !row.stripeSubscriptionId;
    const evidence = !freeShop && (!!row.stripeSubscriptionId || (row.subscriptionStatus === "ACTIVE" && row.plan !== "TRIAL") || !!row.trialEndsAt);
    const priorDate = row.foundingQualifiedAt ?? tenant?.foundingQualifiedAt;
    const date = priorDate ? new Date(priorDate) : undefined;
    const verifiedDate = date && Number.isFinite(date.getTime()) && date.getTime() > 0 && date.getTime() < Date.parse(cutoffExclusive) ? date : undefined;
    const alreadyFounder = row.foundingMember || tenant?.foundingMember || !!verifiedDate;
    // While the offer is live, observing an existing paid/trial account proves
    // eligibility. After it closes, do NOT guess from account/user creation dates:
    // a free account might have subscribed later. Require authoritative evidence.
    const eligible = alreadyFounder || (beforeCutoff && evidence);
    if (!eligible) {
      if (evidence && !beforeCutoff) { stats.manualReview++; log(`REVIEW ${schema}: legacy start evidence required; no entitlement guessed`); }
      continue;
    }
    if (row.foundingMember && (!tenant || tenant.foundingMember)) continue;
    const qualifiedAt = verifiedDate ?? (beforeCutoff ? now : null);
    stats.pendingGrants++;
    log(`${apply ? "GRANT" : "WOULD GRANT"} ${schema}: lifetime first-year prices`);
    if (apply) {
      await pool.query(`UPDATE ${quote(schema)}."CompanySettings" SET "foundingMember"=true, "foundingQualifiedAt"=COALESCE("foundingQualifiedAt", $1) WHERE "id"=$2`, [qualifiedAt?.toISOString() ?? null, row.id]);
      if (tenant) await pool.query('UPDATE "public"."Tenant" SET "foundingMember"=true, "foundingQualifiedAt"=COALESCE("foundingQualifiedAt", $1) WHERE "id"=$2', [qualifiedAt?.toISOString() ?? null, tenant.id]);
      stats.granted++;
    }
  }
  log(`Founding billing ${apply ? "applied" : "report"}: ${JSON.stringify(stats)}. Stripe objects were not read or changed.`);
  return stats;
}
