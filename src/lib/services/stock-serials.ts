import { prisma } from "@/lib/db";

/** On-hand / issued serials a tech may pick — never quarantine or scrap. */
export async function listStockSerialsForParts(partIds: string[]) {
  const ids = [...new Set(partIds.filter(Boolean))];
  if (ids.length === 0) return [];
  return prisma.serialNumber.findMany({
    where: {
      partId: { in: ids },
      status: { in: ["IN_STOCK", "ISSUED"] },
    },
    orderBy: { serial: "asc" },
    include: {
      part: { select: { partNumber: true, description: true } },
    },
    take: 400,
  });
}
