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

/** Legacy cookie name kept for compatibility with old demo/test-drive routes. */
export const SANDBOX_COOKIE = "forge-sandbox";

/** Cookie holding an anonymous demo visitor's throwaway tenant schema. */
export const DEMO_COOKIE = "forge-demo";
const DEMO_SCHEMA_RE = /^demo_[a-z0-9]{6,40}$/;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaEpoch?: string;
  schemaClients?: Map<string, PrismaClient>;
};

/** Postgres schema name: lowercase, starts with a letter, no injection surface. */
const SCHEMA_RE = /^[a-z][a-z0-9_]{0,62}$/;

function createClient(schema?: string) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Don't hard-fail here: `next build` imports this module with no database
    // configured. The pg pool connects lazily, so a genuine misconfiguration
    // surfaces as a clear connection error on the first query at runtime.
    console.warn(
      "[db] DATABASE_URL is not set — ForgeRP needs a PostgreSQL connection string at runtime"
    );
  }
  // The `schema` option makes Prisma qualify every query to that schema, so one
  // connection string serves every tenant. Omitted → the default (public).
  const adapter = new PrismaPg(
    { connectionString: connectionString ?? "" },
    schema ? { schema } : undefined
  );
  return new PrismaClient({ adapter });
}

/**
 * A Prisma client scoped to a specific tenant schema. Cached per schema so we
 * reuse one pool each. Used by tenant/demo request routing and by provisioning
 * to read/write a freshly created schema. The default `prisma` export below is
 * unaffected and keeps using `public`.
 */
export function clientForSchema(schema: string): PrismaClient {
  if (!SCHEMA_RE.test(schema)) {
    throw new Error(`Invalid tenant schema name: ${schema}`);
  }
  const map = (globalForPrisma.schemaClients ??= new Map());
  let client = map.get(schema);
  if (!client) {
    client = createClient(schema);
    map.set(schema, client);
  }
  return client;
}

export function isValidSchemaName(schema: string): boolean {
  return SCHEMA_RE.test(schema);
}

/**
 * The control-plane client — always bound to `public`, regardless of request
 * context. The `Tenant` registry lives in `public`; provisioning code often runs
 * inside a demo request (cookie present), where the `prisma` proxy would route
 * to the demo schema. Control-plane reads/writes must use this so they can never
 * be mis-routed to a tenant/demo schema's (empty) copy of the registry table.
 */
export function controlPlaneClient(): PrismaClient {
  return getDefaultClient();
}

/** The default client — bound to `public` (the dogfood instance + control plane). */
function getDefaultClient() {
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

/**
 * The active demo schema for this request, or null. An anonymous visitor with a
 * valid demo cookie is routed to their throwaway schema; a real signed-in user
 * (session cookie present) always uses `public`, so a stray demo cookie can
 * never redirect a logged-in customer's queries. `demo_template` is never
 * routable (it's the pristine clone source).
 */
async function currentDemoSchema(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    if (jar.get("forge-session")?.value) return null; // real user → public
    const demo = jar.get(DEMO_COOKIE)?.value;
    if (demo && demo !== "demo_template" && DEMO_SCHEMA_RE.test(demo)) return demo;
  } catch {
    // Outside a request scope (build, seed scripts, CLIs) → default client.
  }
  return null;
}

/** Resolve the Prisma client for the current request (demo schema or public). */
async function currentClient(): Promise<PrismaClient> {
  const schema = await currentDemoSchema();
  return schema ? clientForSchema(schema) : getDefaultClient();
}

type AnyFn = (...args: unknown[]) => unknown;

/**
 * `prisma` is a proxy that picks the right client (public or the request's demo
 * schema) at call time — inside the request scope, where cookies() is available.
 * Property chains (prisma.user.findMany) resolve lazily; the client choice
 * happens when the method is finally invoked.
 */
function makeDelegateProxy(chain: string[]): unknown {
  const fn = () => undefined;
  return new Proxy(fn, {
    get(_t, prop) {
      if (typeof prop === "symbol") return undefined;
      return makeDelegateProxy([...chain, prop]);
    },
    apply(_t, _thisArg, args) {
      return currentClient().then((client) => {
        let obj: unknown = client;
        for (const key of chain.slice(0, -1)) {
          obj = (obj as Record<string, unknown>)[key];
        }
        const method = chain[chain.length - 1];
        const bound = (obj as Record<string, AnyFn>)[method];
        return bound.apply(obj, args);
      });
    },
  });
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    if (typeof prop === "symbol" || prop === "then") return undefined;
    return makeDelegateProxy([prop as string]);
  },
}) as PrismaClient;

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
