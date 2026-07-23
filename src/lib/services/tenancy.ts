import { Pool } from "pg";
import { prisma, clientForSchema, isValidSchemaName } from "@/lib/db";
import { TENANT_TEMPLATE_SQL } from "@/lib/tenant-template";

/**
 * Schema-per-tenant provisioning. Each tenant (real customer or throwaway demo)
 * gets its own Postgres schema holding the full ForgeRP table set; the control
 * plane (the `Tenant` registry + this code) lives in `public`.
 *
 * Provisioning uses a raw pg connection so `CREATE SCHEMA` + the table DDL run
 * on one session with a set `search_path`. Everything else uses a Prisma client
 * scoped to the schema (see clientForSchema).
 */

/** DDL runs over the direct (session) connection, never a transaction pooler. */
function ddlPool(): Pool {
  return new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    max: 1,
  });
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
    await client.query(`SET search_path TO "${schema}"`);
    // The template is unqualified DDL, so it lands in the search_path schema.
    await client.query(TENANT_TEMPLATE_SQL);
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

  const tenant = await prisma.tenant.create({
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
    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: "DESTROYED" } });
    await dropSchema(schemaName).catch(() => undefined);
    throw err;
  }

  return prisma.tenant.update({
    where: { id: tenant.id },
    data: { status: "ACTIVE" },
  });
}

/** Look a tenant up by its schema (the routing key). */
export async function getTenantBySchema(schema: string) {
  if (!isValidSchemaName(schema)) return null;
  return prisma.tenant.findUnique({ where: { schemaName: schema } });
}

/** Bump a demo's activity timestamp so the idle sweep doesn't reap it mid-use. */
export async function touchTenant(schema: string): Promise<void> {
  if (!isValidSchemaName(schema)) return;
  await prisma.tenant
    .updateMany({ where: { schemaName: schema }, data: { lastActiveAt: new Date() } })
    .catch(() => undefined);
}

/** Destroy a tenant: drop its schema and mark the registry row destroyed. */
export async function destroyTenant(schema: string): Promise<void> {
  await dropSchema(schema);
  await prisma.tenant
    .updateMany({ where: { schemaName: schema }, data: { status: "DESTROYED" } })
    .catch(() => undefined);
}

/** Reap demo tenants idle longer than maxIdleMinutes. Returns how many were destroyed. */
export async function sweepIdleDemos(maxIdleMinutes = 60): Promise<number> {
  const cutoff = new Date(Date.now() - maxIdleMinutes * 60_000);
  const stale = await prisma.tenant.findMany({
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
