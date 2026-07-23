import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * ForgeRP runs on PostgreSQL (Supabase in production, any Postgres locally).
 * A single pooled client is cached on the global so serverless invocations and
 * dev HMR reuse one connection pool instead of opening a new one per request.
 *
 * The SQLite "test-drive" sandbox (per-visitor copies of the database file)
 * cannot exist on Postgres/serverless — there is no local file to clone and the
 * filesystem is read-only. Those entry points are kept as no-ops/guards below so
 * the rest of the app compiles unchanged; enabling a live demo means running the
 * SQLite/self-host build instead (see docs/SELF-HOST-AND-DESKTOP.md).
 */

// Bump when the Prisma schema changes so dev HMR drops a stale client.
const PRISMA_CLIENT_EPOCH = "quality-programs-v40";

/** Cookie name kept for compatibility with the demo/test-drive routes. */
export const SANDBOX_COOKIE = "forge-sandbox";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaEpoch?: string;
};

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — ForgeRP needs a PostgreSQL connection string"
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

function getClient() {
  if (
    globalForPrisma.prisma &&
    globalForPrisma.prismaEpoch === PRISMA_CLIENT_EPOCH
  ) {
    return globalForPrisma.prisma;
  }
  if (globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  }
  const client = createClient();
  globalForPrisma.prisma = client;
  globalForPrisma.prismaEpoch = PRISMA_CLIENT_EPOCH;
  return client;
}

/** The single shared Prisma client. */
export const prisma: PrismaClient = getClient();

// ─── Test-drive sandbox: no-ops on Postgres ─────────────────────
// Preserved exports so demo/test-drive routes still type-check. On Postgres
// there is no per-visitor sandbox; entering one is refused (fail-safe) rather
// than silently writing to the real database.

export function sandboxDir(): string {
  return "";
}

export function sandboxDbPath(_id?: string): string {
  return "";
}

export async function materializeSandbox(_id?: string): Promise<string> {
  throw new Error(
    "The test-drive sandbox is not available on PostgreSQL. Run the SQLite/self-host build for a live demo."
  );
}

export function destroySandbox(_id?: string): void {
  /* no-op on Postgres */
}
