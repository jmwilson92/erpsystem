import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import fs from "fs";

// Bump when Prisma schema fields change so HMR does not keep a stale client.
// The epoch also stamps the sandbox directory (see sandboxDir), so demo/
// test-drive sandbox copies re-materialize from the migrated master whenever
// the schema changes — otherwise a sandbox created before a new column would
// keep failing with "column does not exist" even after `prisma db push`.
const PRISMA_CLIENT_EPOCH = "recruiting-onboarding-v39";

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

function sandboxRoot() {
  return path.join(path.dirname(masterDbPath()), "sandboxes");
}

export function sandboxDir() {
  // Stamp with the schema epoch so a schema change gives fresh sandbox copies
  // (old-epoch copies would otherwise keep a stale, pre-migration schema).
  return path.join(sandboxRoot(), PRISMA_CLIENT_EPOCH);
}

export function sandboxDbPath(id: string) {
  return path.join(sandboxDir(), `${id}.db`);
}

/** Remove sandbox copies from previous schema epochs (stale schema). */
function pruneStaleSandboxEpochs() {
  try {
    const root = sandboxRoot();
    if (!fs.existsSync(root)) return;
    for (const entry of fs.readdirSync(root)) {
      if (entry === PRISMA_CLIENT_EPOCH) continue;
      try {
        fs.rmSync(path.join(root, entry), { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  } catch {
    // best-effort cleanup
  }
}

/**
 * Self-heal SQLite files that lag the Prisma schema (common when sandboxes
 * were copied before a column landed, or db push wasn't run). Safe to re-run.
 */
function ensureSqliteSchema(file: string) {
  if (!fs.existsSync(file)) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(file);
    try {
      const cols = db
        .prepare("PRAGMA table_info(ApprovalPolicyStep)")
        .all() as { name: string }[];
      const names = new Set(cols.map((c) => c.name));
      if (names.size > 0 && !names.has("routingKey")) {
        db.exec(
          "ALTER TABLE ApprovalPolicyStep ADD COLUMN routingKey TEXT NOT NULL DEFAULT 'ROLE'"
        );
      }
      const prCols = db
        .prepare("PRAGMA table_info(PurchaseRequest)")
        .all() as { name: string }[];
      const prNames = new Set(prCols.map((c) => c.name));
      if (prNames.size > 0 && !prNames.has("wbsElementId")) {
        db.exec("ALTER TABLE PurchaseRequest ADD COLUMN wbsElementId TEXT");
      }
      // Buyer workbench fields (idempotent ALTERs)
      const prAdds: [string, string][] = [
        ["soleSource", "INTEGER NOT NULL DEFAULT 0"],
        ["soleSourceJustification", "TEXT"],
        ["chargeType", "TEXT"],
        ["glAccountId", "TEXT"],
        ["assignedBuyerId", "TEXT"],
        ["assignedById", "TEXT"],
        ["assignedAt", "DATETIME"],
        ["buyerWorkStartedAt", "DATETIME"],
        ["buyerWorkStartedById", "TEXT"],
      ];
      for (const [col, def] of prAdds) {
        if (prNames.size > 0 && !prNames.has(col)) {
          db.exec(`ALTER TABLE PurchaseRequest ADD COLUMN ${col} ${def}`);
        }
      }
      try {
        const teCols = db
          .prepare("PRAGMA table_info(TimeEntry)")
          .all() as { name: string }[];
        const teNames = new Set(teCols.map((c) => c.name));
        if (teNames.size > 0 && !teNames.has("purchaseRequestId")) {
          db.exec("ALTER TABLE TimeEntry ADD COLUMN purchaseRequestId TEXT");
        }
        if (teNames.size > 0 && !teNames.has("receivingTravelerId")) {
          db.exec("ALTER TABLE TimeEntry ADD COLUMN receivingTravelerId TEXT");
        }
      } catch {
        /* ignore */
      }
      try {
        const rtCols = db
          .prepare("PRAGMA table_info(ReceivingTraveler)")
          .all() as { name: string }[];
        const rtNames = new Set(rtCols.map((c) => c.name));
        const rtAdds: [string, string][] = [
          ["currentWorkCenter", "TEXT"],
          ["atStationSince", "DATETIME"],
          ["activeScanUserId", "TEXT"],
          ["activeScanAt", "DATETIME"],
        ];
        for (const [col, def] of rtAdds) {
          if (rtNames.size > 0 && !rtNames.has(col)) {
            db.exec(`ALTER TABLE ReceivingTraveler ADD COLUMN ${col} ${def}`);
          }
        }
      } catch {
        /* ignore */
      }
      try {
        const blCols = db
          .prepare("PRAGMA table_info(BomLine)")
          .all() as { name: string }[];
        const blNames = new Set(blCols.map((c) => c.name));
        if (blNames.size > 0 && !blNames.has("uom")) {
          db.exec(
            "ALTER TABLE BomLine ADD COLUMN uom TEXT NOT NULL DEFAULT 'EA'"
          );
        }
      } catch {
        /* ignore */
      }
    } finally {
      db.close();
    }
  } catch {
    // best-effort — prisma db push remains the source of truth
  }
}

function createClientForFile(file: string) {
  ensureSqliteSchema(file);
  // busy_timeout / WAL reduce P1008 under concurrent page loads (HTTP smoke)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(file);
    try {
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 15000");
      db.pragma("synchronous = NORMAL");
    } finally {
      db.close();
    }
  } catch {
    /* best-effort */
  }
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
  const master = masterDbPath();
  ensureSqliteSchema(master);
  const client = createClientForFile(master);
  // Cache in every environment. Without this, production builds a new
  // client (and SQLite connection) per query — connections accumulate
  // and writes start timing out (P1008) under the file lock.
  globalForPrisma.prisma = client;
  globalForPrisma.prismaEpoch = PRISMA_CLIENT_EPOCH;
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
  // Clear any sandbox copies left over from an earlier schema epoch so we
  // never serve a stale-schema database.
  pruneStaleSandboxEpochs();
  const dir = sandboxDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = sandboxDbPath(id);
  if (fs.existsSync(target)) {
    // Heal in place — don't keep serving a pre-migration sandbox forever
    ensureSqliteSchema(target);
    return target;
  }
  // Flush the master WAL so the copy contains the latest writes.
  try {
    await getMasterClient().$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // checkpoint is best-effort
  }
  ensureSqliteSchema(masterDbPath());
  fs.copyFileSync(masterDbPath(), target);
  ensureSqliteSchema(target);
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
