import { Prisma } from "@prisma/client";
import { prisma, currentRequestSchema, isValidSchemaName } from "@/lib/db";
/** Internal bounded tenant-qualified row serialization, including first child insertion. */
export async function withMutationLock<T>(tableName: "Product" | "VehicleMaintenance" | "EquipmentMaintenance" | "User" | "Asset", id: string, work: (db: Prisma.TransactionClient) => Promise<T>) {
  const schema = await currentRequestSchema();
  if (!isValidSchemaName(schema)) throw new Error("Invalid mutation schema");
  const table = Prisma.raw(`"${schema}"."${tableName}"`);
  // Staffing changes no user key; avoid blocking actor/assignee FK key-share reads.
  const lock = Prisma.raw(tableName === "User" ? "FOR NO KEY UPDATE" : "FOR UPDATE");
  return prisma.$transaction(async db => {
    await db.$queryRaw(Prisma.sql`SELECT id FROM ${table} WHERE id = ${id} ${lock}`);
    return work(db);
  });
}
