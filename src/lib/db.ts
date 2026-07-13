import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import fs from "fs";

// Bump when Prisma schema fields change so HMR does not keep a stale client.
const PRISMA_CLIENT_EPOCH = "wi-cm-ship-kit-v2";

/** Cookie that puts a request into a private test-drive sandbox. */
export const SANDBOX_COOKIE = "forge-sandbox";
const SANDBOX_ID_RE = /^[a-z0-9][a-z0-9-]{7,63}$/;
/** Sandboxes idle longer than this are deleted on the next sweep. */
const SANDBOX_TTL_MS = 4 * 60 * 60 * 1000;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaEpoch?: string;
  sandboxClients?: Map<string, { client: PrismaClient; lastUsed: number }>;
  sandboxSweepAt?: number;
};

function masterDbPath() {
  const envUrl = process.env.DATABASE_URL;
  if (envUrl?.startsWith("file:")) {
    const rel = envUrl.replace(/^file:/, "");
    return path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
  }
  return path.join(process.cwd(), "prisma", "dev.db");
}

export function sandboxDir() {
  return path.join(path.dirname(masterDbPath()), "sandboxes");
}

export function sandboxDbPath(id: string) {
  return path.join(sandboxDir(), `${id}.db`);
}

function createClientForFile(file: string) {
  const adapter = new PrismaBetterSqlite3({ url: `file:${file}` });
  return new PrismaClient({ adapter });
}

function getMasterClient() {
  if (
    globalForPrisma.prisma &&
    globalForPrisma.prismaEpoch === PRISMA_CLIENT_EPOCH
  ) {
    return globalForPrisma.prisma;
  }
  // Drop stale client after schema regenerate (dev HMR / Turbopack)
  if (globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  }
  const client = createClientForFile(masterDbPath());
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
    globalForPrisma.prismaEpoch = PRISMA_CLIENT_EPOCH;
  }
  return client;
}

function sandboxMap() {
  if (!globalForPrisma.sandboxClients) {
    globalForPrisma.sandboxClients = new Map();
  }
  return globalForPrisma.sandboxClients;
}

/** Copy the master database into a fresh sandbox file. */
export async function materializeSandbox(id: string) {
  if (!SANDBOX_ID_RE.test(id)) throw new Error("Bad sandbox id");
  const dir = sandboxDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = sandboxDbPath(id);
  if (fs.existsSync(target)) return target;
  // Flush the master WAL so the copy contains the latest writes.
  try {
    await getMasterClient().$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // checkpoint is best-effort
  }
  fs.copyFileSync(masterDbPath(), target);
  return target;
}

/** Delete a sandbox's database and evict its client. */
export function destroySandbox(id: string) {
  if (!SANDBOX_ID_RE.test(id)) return;
  const map = sandboxMap();
  const entry = map.get(id);
  if (entry) {
    void entry.client.$disconnect().catch(() => undefined);
    map.delete(id);
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(sandboxDbPath(id) + suffix, { force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

/** Sweep sandboxes idle past the TTL (runs at most once a minute). */
function sweepSandboxes() {
  const now = Date.now();
  if ((globalForPrisma.sandboxSweepAt || 0) > now - 60_000) return;
  globalForPrisma.sandboxSweepAt = now;
  try {
    const dir = sandboxDir();
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".db")) continue;
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > SANDBOX_TTL_MS) {
        destroySandbox(f.replace(/\.db$/, ""));
      }
    }
  } catch {
    // sweep is best-effort
  }
}

async function getSandboxClient(id: string): Promise<PrismaClient | null> {
  if (!SANDBOX_ID_RE.test(id)) return null;
  const map = sandboxMap();
  const existing = map.get(id);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.client;
  }
  // Recreate expired/missing sandboxes from the master template so a
  // visitor with a sandbox cookie can never write to the master data.
  const file = await materializeSandbox(id);
  // Touch so the TTL sweep sees activity even without new writes.
  try {
    const now = new Date();
    fs.utimesSync(file, now, now);
  } catch {
    // touch is best-effort
  }
  const client = createClientForFile(file);
  map.set(id, { client, lastUsed: Date.now() });
  sweepSandboxes();
  return client;
}

/**
 * Resolve the Prisma client for the current request: a visitor with a
 * test-drive cookie gets their private sandbox copy; everyone else
 * (including all scripts) gets the master database.
 */
async function currentClient(): Promise<PrismaClient> {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const sandboxId = jar.get(SANDBOX_COOKIE)?.value;
    if (sandboxId) {
      const client = await getSandboxClient(sandboxId);
      if (client) return client;
    }
  } catch {
    // outside a request scope (seed scripts, CLIs) — use master
  }
  return getMasterClient();
}

type AnyFn = (...args: unknown[]) => unknown;

/**
 * The exported `prisma` is a proxy that picks the master or sandbox
 * client per call. Property chains (prisma.user.findMany) resolve
 * lazily; the client choice happens when the method is invoked, inside
 * the request scope, so `cookies()` is available.
 */
function makeDelegateProxy(chain: string[]): unknown {
  const fn = () => undefined;
  return new Proxy(fn, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      return makeDelegateProxy([...chain, prop]);
    },
    apply(_target, _thisArg, args) {
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

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (typeof prop === "symbol" || prop === "then") return undefined;
    return makeDelegateProxy([prop as string]);
  },
}) as PrismaClient;
