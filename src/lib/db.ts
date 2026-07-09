import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

// Bump when Prisma schema fields change so HMR does not keep a stale client.
const PRISMA_CLIENT_EPOCH = "wi-cm-ship-kit-v1";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaEpoch?: string;
};

function createPrismaClient() {
  // Prefer DATABASE_URL; default matches prisma seed / .env
  const envUrl = process.env.DATABASE_URL;
  let url: string;
  if (envUrl?.startsWith("file:")) {
    const rel = envUrl.replace(/^file:/, "");
    url = path.isAbsolute(rel) ? envUrl : `file:${path.join(process.cwd(), rel)}`;
  } else if (envUrl) {
    url = envUrl;
  } else {
    url = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
  }
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

function getPrisma() {
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
  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
    globalForPrisma.prismaEpoch = PRISMA_CLIENT_EPOCH;
  }
  return client;
}

export const prisma = getPrisma();
