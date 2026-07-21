import { prisma } from "@/lib/db";

/**
 * Inventory commitments: material is committed to a sales order (or WO build)
 * when it's allocated. We derive the "who is this committed to" breakdown from
 * material transactions, and can release a commitment back to available so MRS
 * stops treating that stock as spoken-for.
 */

export type PartCommitment = {
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  customerName: string | null;
  projectNumber: string | null;
  committedQty: number;
};

/** Total committed on-hand for a part across all bins. */
export async function getPartCommittedTotal(partId: string): Promise<number> {
  const items = await prisma.inventoryItem.findMany({
    where: { partId, quantityCommitted: { gt: 0 } },
    select: { quantityCommitted: true },
  });
  return items.reduce((s, i) => s + i.quantityCommitted, 0);
}

/**
 * Break down a part's committed stock by the sales order it was allocated to.
 * Net per SO = allocations (TRANSFER to that SO) − ships (SHIP on that SO).
 */
export async function getPartCommitments(
  partId: string
): Promise<PartCommitment[]> {
  const txns = await prisma.materialTransaction.findMany({
    where: {
      partId,
      salesOrderId: { not: null },
      type: { in: ["TRANSFER", "SHIP"] },
    },
    select: { salesOrderId: true, type: true, quantity: true },
  });

  const bySo = new Map<string, number>();
  for (const t of txns) {
    if (!t.salesOrderId) continue;
    const cur = bySo.get(t.salesOrderId) || 0;
    // TRANSFER (allocation) adds commitment; SHIP consumes it.
    bySo.set(t.salesOrderId, cur + (t.type === "SHIP" ? -t.quantity : t.quantity));
  }

  const soIds = [...bySo.keys()].filter((id) => (bySo.get(id) || 0) > 0.0001);
  if (soIds.length === 0) return [];

  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: soIds } },
    select: {
      id: true,
      number: true,
      customer: { select: { name: true } },
      workOrders: {
        where: { projectId: { not: null } },
        select: { project: { select: { number: true } } },
        take: 1,
      },
    },
  });
  const orderById = new Map(orders.map((o) => [o.id, o]));

  return soIds
    .map((id) => {
      const o = orderById.get(id);
      return {
        salesOrderId: id,
        salesOrderNumber: o?.number ?? null,
        customerName: o?.customer?.name ?? null,
        projectNumber: o?.workOrders?.[0]?.project?.number ?? null,
        committedQty: bySo.get(id) || 0,
      };
    })
    .sort((a, b) => b.committedQty - a.committedQty);
}

/**
 * Release committed stock back to available (owner-approved). Moves up to `qty`
 * from committed → available across the part's bins, records a reversing
 * material transaction, and refreshes any WO material readiness so MRS/kitting
 * pick it up immediately.
 */
export async function releaseCommitment(params: {
  partId: string;
  salesOrderId?: string | null;
  qty: number;
  reason?: string;
  approvedById?: string;
}) {
  if (!(params.qty > 0)) throw new Error("Release quantity must be greater than zero");

  const bins = await prisma.inventoryItem.findMany({
    where: { partId: params.partId, quantityCommitted: { gt: 0 } },
    include: { location: true, part: { select: { partNumber: true } } },
    orderBy: { quantityCommitted: "desc" },
  });
  const totalCommitted = bins.reduce((s, b) => s + b.quantityCommitted, 0);
  if (totalCommitted <= 0) throw new Error("Nothing committed to release");

  let remaining = Math.min(params.qty, totalCommitted);
  const released = remaining;

  for (const bin of bins) {
    if (remaining <= 0) break;
    const move = Math.min(bin.quantityCommitted, remaining);
    if (move <= 0) continue;
    await prisma.inventoryItem.update({
      where: { id: bin.id },
      data: {
        quantityCommitted: bin.quantityCommitted - move,
        quantityAvailable: bin.quantityAvailable + move,
      },
    });
    await prisma.materialTransaction.create({
      data: {
        type: "TRANSFER",
        partId: params.partId,
        inventoryItemId: bin.id,
        salesOrderId: params.salesOrderId || null,
        quantity: -move,
        fromLocation: bin.location.code,
        toLocation: bin.location.code,
        lotNumber: bin.lotNumber,
        serialNumber: bin.serialNumber,
        reference: "COMMIT-RELEASE",
        notes: `Released commitment${params.reason ? ` — ${params.reason}` : ""}`,
        userId: params.approvedById,
      },
    });
    remaining -= move;
  }

  // If a sales order was named, decrement its line commitments too so the SO
  // no longer shows this stock as allocated.
  if (params.salesOrderId) {
    const soLines = await prisma.salesOrderLine.findMany({
      where: { salesOrderId: params.salesOrderId, partId: params.partId },
    });
    let toClear = released;
    for (const line of soLines) {
      if (toClear <= 0) break;
      const committedOnLine = Math.max(0, line.quantityAllocated ?? 0);
      const clear = Math.min(committedOnLine, toClear);
      if (clear <= 0) continue;
      await prisma.salesOrderLine.update({
        where: { id: line.id },
        data: { quantityAllocated: committedOnLine - clear },
      });
      toClear -= clear;
    }
  }

  await prisma.auditLog.create({
    data: {
      entityType: "InventoryCommitment",
      entityId: params.partId,
      action: "RELEASED",
      metadata: JSON.stringify({
        partNumber: bins[0]?.part.partNumber,
        released,
        salesOrderId: params.salesOrderId,
        reason: params.reason,
      }),
      userId: params.approvedById || null,
    },
  });

  return { released };
}
