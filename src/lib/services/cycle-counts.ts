import { prisma } from "@/lib/db";

/**
 * Cycle counts: snapshot on-hand by part+location, let the counter enter
 * counted quantities, then post variances as inventory adjustments.
 */

export async function createCycleCount(params: {
  scope?: string;
  notes?: string;
  userId?: string;
}) {
  const scope = params.scope?.trim() || "";

  const items = await prisma.inventoryItem.findMany({
    where: {
      quantityOnHand: { gt: 0 },
      ...(scope
        ? {
            OR: [
              { location: { code: { contains: scope } } },
              { location: { warehouse: { code: { contains: scope } } } },
              { part: { partNumber: { contains: scope } } },
            ],
          }
        : {}),
    },
    include: { part: true, location: { include: { warehouse: true } } },
    orderBy: [{ partId: "asc" }],
  });
  if (items.length === 0) {
    throw new Error(
      scope
        ? `No on-hand inventory matches scope "${scope}"`
        : "No on-hand inventory to count"
    );
  }

  // One count line per part + location (sum lots/serials at the same bin)
  const byKey = new Map<
    string,
    { partId: string; location: string; systemQty: number }
  >();
  for (const it of items) {
    const loc = `${it.location.warehouse.code}/${it.location.code}`;
    const key = `${it.partId}|${loc}`;
    const cur = byKey.get(key) || { partId: it.partId, location: loc, systemQty: 0 };
    cur.systemQty += it.quantityOnHand;
    byKey.set(key, cur);
  }

  const count = await prisma.cycleCount.count();
  return prisma.cycleCount.create({
    data: {
      number: `CC-${String(count + 1).padStart(5, "0")}`,
      scope: scope || null,
      notes: params.notes?.trim() || null,
      createdById: params.userId || null,
      lines: {
        create: [...byKey.values()].map((l) => ({
          partId: l.partId,
          location: l.location,
          systemQty: l.systemQty,
        })),
      },
    },
    include: { lines: true },
  });
}

export async function recordCycleCountLine(params: {
  lineId: string;
  countedQty: number;
  userId?: string;
}) {
  const line = await prisma.cycleCountLine.findUnique({
    where: { id: params.lineId },
    include: { cycleCount: true },
  });
  if (!line) throw new Error("Count line not found");
  if (["COMPLETE", "CANCELLED"].includes(line.cycleCount.status)) {
    throw new Error(`${line.cycleCount.number} is already ${line.cycleCount.status.toLowerCase()}`);
  }
  if (!Number.isFinite(params.countedQty) || params.countedQty < 0) {
    throw new Error("Counted quantity must be zero or more");
  }

  await prisma.cycleCountLine.update({
    where: { id: line.id },
    data: {
      countedQty: params.countedQty,
      variance: params.countedQty - line.systemQty,
      countedById: params.userId || null,
      countedAt: new Date(),
    },
  });
  if (line.cycleCount.status === "OPEN") {
    await prisma.cycleCount.update({
      where: { id: line.cycleCountId },
      data: { status: "COUNTING" },
    });
  }
}

/**
 * Complete the count. Lines with a non-zero variance are posted as inventory
 * adjustments (on-hand moves to the counted quantity at that bin).
 */
export async function completeCycleCount(params: {
  cycleCountId: string;
  userId?: string;
}) {
  const cc = await prisma.cycleCount.findUnique({
    where: { id: params.cycleCountId },
    include: { lines: true },
  });
  if (!cc) throw new Error("Cycle count not found");
  if (["COMPLETE", "CANCELLED"].includes(cc.status)) {
    throw new Error(`${cc.number} is already ${cc.status.toLowerCase()}`);
  }
  const uncounted = cc.lines.filter((l) => l.countedQty == null);
  if (uncounted.length > 0) {
    throw new Error(
      `${uncounted.length} line(s) still uncounted — enter every count (0 is valid) before completing`
    );
  }

  for (const line of cc.lines) {
    const variance = (line.countedQty ?? 0) - line.systemQty;
    if (variance === 0) continue;

    // Apply the delta across the item rows at this part+bin (largest first)
    const [whCode, locCode] = line.location?.includes("/")
      ? (line.location.split("/") as [string, string])
      : ["", line.location || ""];
    const rows = await prisma.inventoryItem.findMany({
      where: {
        partId: line.partId,
        location: {
          code: locCode,
          ...(whCode ? { warehouse: { code: whCode } } : {}),
        },
      },
      orderBy: { quantityOnHand: "desc" },
    });
    let remaining = variance;
    for (const [i, row] of rows.entries()) {
      // Positive variance: add everything to the first row. Negative: drain rows in order.
      const delta =
        remaining > 0
          ? i === 0
            ? remaining
            : 0
          : Math.max(remaining, -row.quantityOnHand);
      if (delta === 0) continue;
      const newOnHand = row.quantityOnHand + delta;
      await prisma.inventoryItem.update({
        where: { id: row.id },
        data: {
          quantityOnHand: newOnHand,
          quantityAvailable: Math.max(
            0,
            newOnHand - row.quantityCommitted - row.quantityQuarantine
          ),
        },
      });
      remaining -= delta;
      if (remaining === 0) break;
    }
    await prisma.cycleCountLine.update({
      where: { id: line.id },
      data: { adjustedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        entityType: "CycleCount",
        entityId: cc.id,
        action: "VARIANCE_ADJUSTED",
        metadata: JSON.stringify({
          number: cc.number,
          partId: line.partId,
          location: line.location,
          systemQty: line.systemQty,
          countedQty: line.countedQty,
          variance,
        }),
        userId: params.userId || null,
      },
    });
  }

  return prisma.cycleCount.update({
    where: { id: cc.id },
    data: { status: "COMPLETE", completedAt: new Date() },
  });
}

export async function cancelCycleCount(cycleCountId: string) {
  const cc = await prisma.cycleCount.findUnique({ where: { id: cycleCountId } });
  if (!cc) throw new Error("Cycle count not found");
  if (cc.status === "COMPLETE") throw new Error("Completed counts cannot be cancelled");
  return prisma.cycleCount.update({
    where: { id: cycleCountId },
    data: { status: "CANCELLED" },
  });
}
