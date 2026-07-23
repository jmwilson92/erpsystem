import { Pool } from "pg";
import { randomBytes, createHash } from "node:crypto";
import { controlPlaneClient, clientForSchema, isValidSchemaName } from "@/lib/db";
import {
  TENANT_TEMPLATE_SQL,
  TENANT_TABLES_SQL,
  TENANT_FKS_SQL,
} from "@/lib/tenant-template";

/** The pre-seeded schema that every throwaway demo is cloned from. */
export const DEMO_TEMPLATE_SCHEMA = "demo_template";

/**
 * Schema-per-tenant provisioning. Each tenant (real customer or throwaway demo)
 * gets its own Postgres schema holding the full ForgeRP table set; the control
 * plane (the `Tenant` registry + this code) lives in `public`.
 *
 * Provisioning uses a raw pg connection so `CREATE SCHEMA` + the table DDL run
 * on one session with a set `search_path`. Everything else uses a Prisma client
 * scoped to the schema (see clientForSchema).
 */

/**
 * Connection used for schema DDL (provision/clone/drop).
 *
 * Prefer DIRECT_URL (a real session connection is ideal for DDL) — but Supabase's
 * direct host `db.<ref>.supabase.co` is IPv6-only and unreachable from serverless
 * (getaddrinfo ENOTFOUND on Vercel). When DIRECT_URL is that direct host, fall
 * back to DATABASE_URL (the pooler the app already reaches); the DDL is written
 * to survive a transaction pooler (SET search_path folded into each DDL query).
 * From a Codespace/local, DIRECT_URL is a reachable session pooler and is used.
 */
function ddlConnectionString(): string | undefined {
  const direct = process.env.DIRECT_URL;
  const isUnreachableDirectHost =
    !!direct && /(?:@|\/\/)db\.[a-z0-9-]+\.supabase\.co[:/]/.test(direct);
  if (isUnreachableDirectHost) {
    return process.env.DATABASE_URL || direct;
  }
  return direct || process.env.DATABASE_URL;
}

function ddlPool(): Pool {
  return new Pool({ connectionString: ddlConnectionString(), max: 1 });
}

function randToken(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Create the schema and all ForgeRP tables inside it. Idempotent per schema. */
export async function provisionSchema(schema: string): Promise<void> {
  if (!isValidSchemaName(schema)) throw new Error(`Invalid schema name: ${schema}`);
  if (schema === "public") throw new Error("Refusing to provision over the public schema");
  const pool = ddlPool();
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    // Keep SET search_path in the SAME query as the DDL: on a transaction pooler
    // (Supabase 6543) each client.query() may land on a different backend, so a
    // standalone SET wouldn't carry over. One query = one transaction = one
    // backend, so the unqualified template DDL lands in this schema.
    await client.query(`SET search_path TO "${schema}";\n${TENANT_TEMPLATE_SQL}`);
  } finally {
    client.release();
    await pool.end();
  }
}

/** Permanently drop a tenant's schema and all its data. */
export async function dropSchema(schema: string): Promise<void> {
  if (!isValidSchemaName(schema)) throw new Error(`Invalid schema name: ${schema}`);
  if (schema === "public") throw new Error("Refusing to drop the public schema");
  const pool = ddlPool();
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await pool.end();
  }
}

/**
 * Register a tenant and provision its schema. Returns the registry row. Seeding
 * the schema's data (config essentials or demo mock data) is a separate step.
 */
export async function createTenant(params: {
  isDemo?: boolean;
  plan?: string | null;
  name?: string | null;
  billingEmail?: string | null;
  trialEndsAt?: Date | null;
}) {
  const isDemo = !!params.isDemo;
  const schemaName = `${isDemo ? "demo" : "tenant"}_${randToken()}`;

  const tenant = await controlPlaneClient().tenant.create({
    data: {
      slug: schemaName,
      schemaName,
      name: params.name ?? null,
      isDemo,
      plan: params.plan ?? null,
      billingEmail: params.billingEmail ?? null,
      trialEndsAt: params.trialEndsAt ?? null,
      status: "PROVISIONING",
    },
  });

  try {
    await provisionSchema(schemaName);
  } catch (err) {
    await controlPlaneClient().tenant.update({ where: { id: tenant.id }, data: { status: "DESTROYED" } });
    await dropSchema(schemaName).catch(() => undefined);
    throw err;
  }

  return controlPlaneClient().tenant.update({
    where: { id: tenant.id },
    data: { status: "ACTIVE" },
  });
}

/** Look a tenant up by its schema (the routing key). */
export async function getTenantBySchema(schema: string) {
  if (!isValidSchemaName(schema)) return null;
  return controlPlaneClient().tenant.findUnique({ where: { schemaName: schema } });
}

/** Bump a demo's activity timestamp so the idle sweep doesn't reap it mid-use. */
export async function touchTenant(schema: string): Promise<void> {
  if (!isValidSchemaName(schema)) return;
  await controlPlaneClient().tenant
    .updateMany({ where: { schemaName: schema }, data: { lastActiveAt: new Date() } })
    .catch(() => undefined);
}

/** Destroy a tenant: drop its schema and mark the registry row destroyed. */
export async function destroyTenant(schema: string): Promise<void> {
  await dropSchema(schema);
  await controlPlaneClient().tenant
    .updateMany({ where: { schemaName: schema }, data: { status: "DESTROYED" } })
    .catch(() => undefined);
}

/** Reap demo tenants idle longer than maxIdleMinutes. Returns how many were destroyed. */
export async function sweepIdleDemos(maxIdleMinutes = 60): Promise<number> {
  const cutoff = new Date(Date.now() - maxIdleMinutes * 60_000);
  const stale = await controlPlaneClient().tenant.findMany({
    where: { isDemo: true, status: "ACTIVE", lastActiveAt: { lt: cutoff } },
    select: { schemaName: true },
    take: 50,
  });
  let n = 0;
  for (const t of stale) {
    try {
      await destroyTenant(t.schemaName);
      n += 1;
    } catch {
      // best-effort; try the rest
    }
  }
  return n;
}

/** A Prisma client bound to a tenant's schema (thin re-export for callers). */
export function tenantClient(schema: string) {
  return clientForSchema(schema);
}

// ─── Demo cloning ───────────────────────────────────────────────
// Throwaway demos are cloned from a pre-seeded template schema, which is fast
// (server-side data copy) vs. re-running the seed per visitor. The clone builds
// tables without FKs, copies data, then adds FKs — no FK-disabling superuser
// tricks needed, and the structure comes from the same proven DDL template.

/** True if the seeded demo template schema exists. */
export async function demoTemplateExists(): Promise<boolean> {
  const pool = ddlPool();
  try {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [DEMO_TEMPLATE_SCHEMA]
    );
    return (r.rowCount ?? 0) > 0;
  } finally {
    await pool.end();
  }
}

/** Clone a schema (structure + data) into a new one. */
export async function cloneSchema(source: string, dest: string): Promise<void> {
  if (!isValidSchemaName(source) || !isValidSchemaName(dest)) {
    throw new Error("Invalid schema name");
  }
  if (dest === "public") throw new Error("Refusing to clone over public");
  const pool = ddlPool();
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA "${dest}"`);
    // 1. Tables + indexes (no FKs yet) into the new schema. SET search_path is
    //    folded into the same query as the DDL so it survives a transaction
    //    pooler (see provisionSchema for why).
    await client.query(`SET search_path TO "${dest}";\n${TENANT_TABLES_SQL}`);
    // 2. Copy every table's rows from the source (FK order irrelevant — no FKs
    //    exist yet). Batched into one multi-statement query so it's a single
    //    round trip (matters on a remote DB), fully qualified so search_path is
    //    irrelevant.
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
      [source]
    );
    if (rows.length > 0) {
      const copySql = rows
        .map(
          ({ tablename }) =>
            `INSERT INTO "${dest}"."${tablename}" SELECT * FROM "${source}"."${tablename}";`
        )
        .join("\n");
      await client.query(copySql);
    }
    // 3. Now add the foreign keys (data is already consistent).
    await client.query(`SET search_path TO "${dest}";\n${TENANT_FKS_SQL}`);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Provision a throwaway demo by cloning the seeded template. Registers the
 * tenant and returns its schema. Fast enough to run at request time.
 */
export async function provisionDemo() {
  if (!(await demoTemplateExists())) {
    throw new Error(
      `Demo template schema "${DEMO_TEMPLATE_SCHEMA}" is missing — run scripts/build-demo-template.mjs`
    );
  }
  // Opportunistic cleanup: each new demo reaps any idle ones, so stale schemas
  // get collected from organic traffic even if scheduled cron runs infrequently.
  const maxIdle = Number(process.env.DEMO_IDLE_MINUTES) || 60;
  void sweepIdleDemos(maxIdle).catch(() => undefined);

  const schemaName = `demo_${randToken()}`;
  const tenant = await controlPlaneClient().tenant.create({
    data: { slug: schemaName, schemaName, isDemo: true, status: "PROVISIONING" },
  });
  try {
    await cloneSchema(DEMO_TEMPLATE_SCHEMA, schemaName);
  } catch (err) {
    await controlPlaneClient().tenant
      .update({ where: { id: tenant.id }, data: { status: "DESTROYED" } })
      .catch(() => undefined);
    await dropSchema(schemaName).catch(() => undefined);
    throw err;
  }
  return controlPlaneClient().tenant.update({
    where: { id: tenant.id },
    data: { status: "ACTIVE" },
  });
}

// ─── Real customer tenants (Stripe signup) ──────────────────────

/**
 * Provision a paying customer's tenant after a successful Stripe checkout:
 * create the schema, seed just the essentials (a CompanySettings row + an admin
 * user), record billing on the registry, and stamp the tenant's own schema with
 * its trialing subscription state. Idempotent by Stripe subscription id, so a
 * retried webhook returns the existing tenant instead of provisioning twice.
 *
 * Note: the customer's self-serve login routing (session → their schema) is a
 * separate onboarding step; this establishes the tenant + billing record.
 */
export async function provisionCustomerTenant(params: {
  plan: string;
  billingEmail: string;
  companyName?: string | null;
  trialDays: number;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}) {
  const cp = controlPlaneClient();

  // Idempotency: a retried webhook must not create a second schema.
  if (params.stripeSubscriptionId) {
    const existing = await cp.tenant.findFirst({
      where: { stripeSubscriptionId: params.stripeSubscriptionId },
    });
    if (existing) return existing;
  }

  const trialEndsAt = new Date(Date.now() + params.trialDays * 86_400_000);
  const schemaName = `tenant_${randToken()}`;
  const tenant = await cp.tenant.create({
    data: {
      slug: schemaName,
      schemaName,
      name: params.companyName ?? null,
      isDemo: false,
      status: "PROVISIONING",
      plan: params.plan,
      billingEmail: params.billingEmail,
      trialEndsAt,
      stripeCustomerId: params.stripeCustomerId ?? null,
      stripeSubscriptionId: params.stripeSubscriptionId ?? null,
    },
  });

  try {
    await provisionSchema(schemaName);
    const db = clientForSchema(schemaName);
    // Essentials: a settings row carrying the trialing subscription state, and a
    // first admin user (no password yet — set during onboarding).
    await db.companySettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        name: params.companyName ?? "My Company",
        plan: params.plan,
        subscriptionStatus: "TRIALING",
        trialEndsAt,
        seats: null,
        billingEmail: params.billingEmail,
        billingProvider: "stripe",
        stripeCustomerId: params.stripeCustomerId ?? undefined,
        stripeSubscriptionId: params.stripeSubscriptionId ?? undefined,
      },
      update: {
        plan: params.plan,
        subscriptionStatus: "TRIALING",
        trialEndsAt,
        billingProvider: "stripe",
        billingEmail: params.billingEmail,
        stripeCustomerId: params.stripeCustomerId ?? undefined,
        stripeSubscriptionId: params.stripeSubscriptionId ?? undefined,
      },
    });
    await db.user.create({
      data: {
        email: params.billingEmail,
        name: params.billingEmail.split("@")[0] || "Admin",
        role: "ADMIN",
        isActive: true,
      },
    });
  } catch (err) {
    await cp.tenant
      .update({ where: { id: tenant.id }, data: { status: "DESTROYED" } })
      .catch(() => undefined);
    await dropSchema(schemaName).catch(() => undefined);
    throw err;
  }

  const active = await cp.tenant.update({
    where: { id: tenant.id },
    data: { status: "ACTIVE" },
  });

  // Onboarding: register the admin's login and mint a claim link. Emails are on
  // hold (Phase 4), so log the URL for the owner to relay from the tenants page.
  await registerTenantLogin(params.billingEmail, schemaName, tenant.id);
  try {
    const { url } = await issueOnboardingLink(tenant.id);
    console.log(
      `[onboarding] tenant ${schemaName} (${params.billingEmail}) — claim link: ${url}`
    );
  } catch {
    /* the owner can re-issue from the tenants page */
  }

  return active;
}

// ─── Customer onboarding (claim + first password) ───────────────

const SETUP_TOKEN_DAYS = 14;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Register (or update) an email → tenant-schema login directory entry. */
export async function registerTenantLogin(
  email: string,
  schemaName: string,
  tenantId: string
) {
  const e = email.trim().toLowerCase();
  await controlPlaneClient()
    .tenantLogin.upsert({
      where: { email: e },
      create: { email: e, schemaName, tenantId },
      update: { schemaName, tenantId },
    })
    .catch(() => undefined);
}

/**
 * Issue a one-time onboarding token for a tenant and return the claim URL. The
 * raw token is only returned here (we store just its hash), so surface it now.
 */
export async function issueOnboardingLink(
  tenantId: string,
  appUrl?: string
): Promise<{ token: string; url: string }> {
  const token = randomBytes(24).toString("hex");
  await controlPlaneClient().tenant.update({
    where: { id: tenantId },
    data: {
      setupTokenHash: sha256(token),
      setupTokenExpiresAt: new Date(Date.now() + SETUP_TOKEN_DAYS * 86_400_000),
    },
  });
  const base = appUrl || process.env.APP_URL || "";
  return { token, url: `${base}/onboard/${token}` };
}

/** Resolve a tenant by a live (unexpired) onboarding token. */
export async function tenantBySetupToken(token: string) {
  if (!token || !/^[a-f0-9]{48}$/.test(token)) return null;
  const t = await controlPlaneClient().tenant.findFirst({
    where: { setupTokenHash: sha256(token) },
  });
  if (!t || !t.setupTokenExpiresAt || t.setupTokenExpiresAt < new Date()) {
    return null;
  }
  return t;
}

/** Consume the onboarding token so a claim link can't be reused. */
export async function clearSetupToken(tenantId: string) {
  await controlPlaneClient()
    .tenant.update({
      where: { id: tenantId },
      data: { setupTokenHash: null, setupTokenExpiresAt: null },
    })
    .catch(() => undefined);
}

/** Resolve a tenant by its Stripe subscription or customer id (for webhooks). */
export async function tenantByStripe(ids: {
  subscriptionId?: string | null;
  customerId?: string | null;
}) {
  const cp = controlPlaneClient();
  if (ids.subscriptionId) {
    const t = await cp.tenant.findFirst({
      where: { stripeSubscriptionId: ids.subscriptionId },
    });
    if (t) return t;
  }
  if (ids.customerId) {
    return cp.tenant.findFirst({ where: { stripeCustomerId: ids.customerId } });
  }
  return null;
}

// Keep TENANT_TEMPLATE_SQL referenced (used by provisionSchema for real tenants).
void TENANT_TEMPLATE_SQL;
