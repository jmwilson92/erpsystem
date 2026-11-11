/** Internal MRB stock reclassification. Caller holds the case lock/transaction. */
import type { InventoryItem, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function moveMrbHeldQuantity(db: Prisma.TransactionClient, params: {
  mrbCaseId: string; quantity: number; kind: "RELEASE" | "RETURN";
  reference: string; notes?: string; userId?: string; workOrderId?: string; storageLocationId?: string;
}) {
  const holds = await db.inventoryItem.findMany({ where: { mrbCaseId: params.mrbCaseId }, include: { location: true }, orderBy: { id: "asc" } });
  if (!Number.isFinite(params.quantity) || params.quantity <= 0 ||
      params.quantity > holds.reduce((n, row) => n + row.quantityOnHand, 0) + 0.000001) throw new Error("Disposition quantity exceeds held inventory");
  let remaining = params.quantity;
  const released: InventoryItem[] = [];
  for (const row of holds) {
    const take = Math.min(remaining, row.quantityOnHand);
    if (take <= 0) continue;
    if (row.quantityQuarantine + 0.000001 < take) throw new Error("Held inventory quarantine quantities require reconciliation");
    if (row.serialNumber && (row.quantityOnHand !== 1 || take !== 1)) throw new Error("Serialized held inventory cannot be split");
    remaining -= take;
    const full = take >= row.quantityOnHand - 0.000001;
    const committed = Math.min(row.quantityCommitted, take);
    let target = row;
    if (params.kind === "RETURN") {
      await db.inventoryItem.update({ where: { id: row.id }, data: {
        quantityOnHand: { decrement: take }, quantityQuarantine: { decrement: take },
        quantityAvailable: 0, quantityCommitted: { decrement: committed }, mrbCaseId: full ? null : params.mrbCaseId,
      } });
    } else {
      const destination = params.storageLocationId
        ? await db.location.findUniqueOrThrow({ where: { id: params.storageLocationId } })
        : row.location.type === "QUARANTINE" ? await db.location.findFirst({ where: { type: "STORAGE" }, orderBy: { id: "asc" } }) : row.location;
      if (!destination || (params.storageLocationId && !["STORAGE", "SHIPPING"].includes(destination.type))) throw new Error("Storage location required to release held inventory");
      const data = { locationId: destination.id, quantityOnHand: take, quantityAvailable: take - committed,
        quantityCommitted: committed, quantityQuarantine: 0, mrbCaseId: null, workOrderId: null };
      if (full) {
        target = { ...row, ...(await db.inventoryItem.update({ where: { id: row.id }, data })) };
      } else {
        await db.inventoryItem.update({ where: { id: row.id }, data: {
          quantityOnHand: { decrement: take }, quantityQuarantine: { decrement: take },
          quantityAvailable: 0, quantityCommitted: { decrement: committed },
        } });
        const slice = await db.inventoryItem.create({ data: { ...data, partId: row.partId, ownership: row.ownership,
          lotNumber: row.lotNumber, serialNumber: row.serialNumber, unitCost: row.unitCost, lastCountedAt: row.lastCountedAt } });
        target = { ...row, ...slice };
      }
      released.push(target);
    }
    await db.materialTransaction.create({ data: { type: params.kind === "RETURN" ? "TRANSFER" : "RELEASE",
      partId: row.partId, inventoryItemId: target.id, quantity: take, unitCost: row.unitCost,
      workOrderId: params.workOrderId, fromLocation: row.location.code, reference: params.reference,
      lotNumber: row.lotNumber, serialNumber: row.serialNumber, notes: params.notes, userId: params.userId } });
  }
  if (remaining > 0.000001) throw new Error("Disposition quantity exceeds held inventory");
  return released;
}

/** Rework restores the original held units; it is not a new manufacturing receipt. */
export async function completeMrbStockRecovery(params: {
  workOrderId: string; mrbCaseId: string; storageLocationId: string; userId?: string;
  serialNumber?: string; lotNumber?: string;
}) {
  return prisma.$transaction(async db => {
    const mrb = await db.mrbCase.update({ where: { id: params.mrbCaseId }, data: { updatedAt: new Date() }, include: { ncr: true } });
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: params.workOrderId }, include: { part: true } });
    if (wo.mrbCaseId !== mrb.id || !["REWORK", "REPAIR"].includes(wo.type)) throw new Error("Invalid MRB recovery work order");
    if (wo.status !== "READY_FOR_PUTAWAY") throw new Error(`WO already ${wo.status} or not ready for putaway`);
    const decision = await db.mrbDisposition.findFirst({ where: { mrbCaseId: mrb.id, OR: [{ reworkWorkOrderId: wo.id }, { repairWorkOrderId: wo.id }] } });
    if (!decision || decision.quantity !== wo.quantity) throw new Error("MRB recovery must match its authorized disposition quantity");
    const holds = await db.inventoryItem.findMany({ where: { mrbCaseId: mrb.id }, orderBy: { id: "asc" } });
    // Serial-only customer RMA component jobs have no stock hold; retain their
    // existing RMA flow rather than claiming they are purchased-stock recovery.
    if (!holds.length && mrb.rmaId && mrb.serialId && mrb.ncr.source === "CUSTOMER") return null;
    if (!holds.length || !wo.partId || holds.some(row => row.partId !== wo.partId)) throw new Error("Original MRB stock is unavailable for recovery");
    if (!Number.isFinite(wo.quantity) || wo.quantity <= 0 || wo.quantity > holds.reduce((n, row) => n + row.quantityOnHand, 0) + 0.000001) throw new Error("Recovery quantity exceeds original held inventory");
    if (params.serialNumber && !holds.some(row => row.serialNumber === params.serialNumber)) throw new Error("Rework must retain original serial identities");
    if (params.lotNumber && holds.some(row => row.lotNumber !== params.lotNumber)) throw new Error("Rework must retain original lot identities");
    const pending = await db.workOrderStepCompletion.count({ where: { workOrderId: wo.id, status: { in: ["PENDING", "IN_PROGRESS", "FAILED"] } } });
    if (pending) throw new Error("Complete and pass every traveler step before MRB recovery putaway");
    const claim = await db.workOrder.updateMany({ where: { id: wo.id, status: "READY_FOR_PUTAWAY", workCenter: wo.workCenter }, data: { status: "COMPLETED" } });
    if (!claim.count) throw new Error("Work order changed; refresh before completing");
    const restored = await moveMrbHeldQuantity(db, { mrbCaseId: mrb.id, quantity: wo.quantity, kind: "RELEASE",
      reference: mrb.number, notes: `${wo.type} complete — ${wo.number}; original stock restored, not manufactured`,
      userId: params.userId, workOrderId: wo.id, storageLocationId: params.storageLocationId });
    const serials = restored.map(row => row.serialNumber).filter((s): s is string => !!s);
    if (wo.part?.isSerialized) {
      if (!Number.isInteger(wo.quantity) || serials.length !== wo.quantity || restored.some(row => row.quantityOnHand !== 1)) throw new Error("Original serialized stock requires per-unit identity reconciliation");
      const records = await db.serialNumber.findMany({ where: { serial: { in: serials }, partId: wo.partId } });
      if (records.length !== serials.length) throw new Error("Original registered serial identities required for rework");
      const wrong = await db.workOrderUnit.count({ where: { workOrderId: wo.id, serialId: { not: null, notIn: records.map(r => r.id) } } });
      if (wrong) throw new Error("Rework traveler must use the original serial identities");
      for (let i = 0; i < records.length; i++) {
        await db.workOrderUnit.upsert({ where: { workOrderId_unitIndex: { workOrderId: wo.id, unitIndex: i + 1 } },
          create: { workOrderId: wo.id, unitIndex: i + 1, serialId: records[i].id, status: "COMPLETE" },
          update: { serialId: records[i].id, status: "COMPLETE" } });
      }
      await db.serialNumber.updateMany({ where: { id: { in: records.map(r => r.id) } }, data: { status: "IN_STOCK", workOrderId: wo.id } });
    }
    // Consume replacement components, never another case's quarantined material.
    const blockedWip = await db.inventoryItem.count({ where: { workOrderId: wo.id, quantityOnHand: { gt: 0 }, mrbCaseId: { not: null, notIn: [mrb.id] } } });
    if (blockedWip) throw new Error("Resolve other quarantined WIP before completing recovery");
    const wip = await db.inventoryItem.findMany({ where: { workOrderId: wo.id, mrbCaseId: null, quantityOnHand: { gt: 0 } }, include: { location: true } });
    for (const row of wip) {
      await db.materialTransaction.create({ data: { type: "ISSUE", partId: row.partId, inventoryItemId: row.id, workOrderId: wo.id,
        quantity: row.quantityOnHand, fromLocation: row.location.code, lotNumber: row.lotNumber, serialNumber: row.serialNumber,
        reference: "WIP_CONSUMED", notes: "Replacement material consumed into repaired original units", userId: params.userId } });
      await db.inventoryItem.update({ where: { id: row.id }, data: { quantityOnHand: 0, quantityAvailable: 0, quantityCommitted: 0 } });
    }
    const remaining = await db.inventoryItem.aggregate({ where: { mrbCaseId: mrb.id }, _sum: { quantityOnHand: true } });
    const unresolved = (remaining._sum.quantityOnHand || 0) > 0.000001;
    await db.mrbCase.update({ where: { id: mrb.id }, data: { status: unresolved ? "OPEN" : "DISPOSITIONED", closedAt: unresolved ? null : new Date() } });
    await db.nonConformance.update({ where: { id: mrb.ncrId }, data: { status: unresolved ? "OPEN" : "DISPOSITIONED" } });
    if (!unresolved && mrb.rmaId) {
      const siblings = await db.mrbCase.count({ where: { rmaId: mrb.rmaId, id: { not: mrb.id }, status: { in: ["OPEN", "IN_REVIEW"] } } });
      if (!siblings) await db.rma.updateMany({ where: { id: mrb.rmaId, status: { notIn: ["CANCELLED", "CLOSED", "SHIPPED", "COMPLETED"] } }, data: { status: "IN_WORK" } });
    }
    await db.workOrder.update({ where: { id: wo.id }, data: { quantityCompleted: wo.quantity, actualEnd: new Date(), currentLocationId: null,
      statusHistory: { create: { fromStatus: "READY_FOR_PUTAWAY", toStatus: "COMPLETED", userId: params.userId, notes: "MRB original stock restored to storage; quantity and identity conserved" } } } });
    await db.traceEvent.create({ data: { eventType: "MRB_RECOVERY_COMPLETE", partId: wo.partId, workOrderId: wo.id, quantity: wo.quantity,
      notes: `Restored original stock for ${mrb.number}`, metadata: JSON.stringify({ inventoryItemIds: restored.map(row => row.id) }), userId: params.userId } });
    return { workOrderId: wo.id, inventoryItemId: restored[0].id, lotNumber: restored[0].lotNumber,
      serialNumber: wo.quantity === 1 ? restored[0].serialNumber || undefined : undefined, unitSerials: serials.map(serial => ({ serial })) };
  });
}
