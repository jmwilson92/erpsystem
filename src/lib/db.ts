import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

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

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
