import type { Prisma } from "@prisma/client";
import { userHasPermission } from "@/lib/auth";

import { verifySignaturePin } from "./signature-pin";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function listGfpContracts() {
  const rows = await prisma.governmentProperty.findMany({
    where: { contractNumber: { not: null } },
    select: { contractNumber: true },
    distinct: ["contractNumber"],
    orderBy: { contractNumber: "asc" },
  });
  return rows
    .map((r) => r.contractNumber)
    .filter((c): c is string => !!c && c.trim().length > 0);
}

export async function listGfpByContract(contractNumber?: string | null) {
  return prisma.governmentProperty.findMany({
    where: contractNumber
      ? { contractNumber }
      : undefined,
    orderBy: { assetTag: "asc" },
    include: {
      complianceChecks: { orderBy: { checkedAt: "desc" }, take: 5 },
      documents: { orderBy: { uploadedAt: "desc" } },
      auditRecords: { orderBy: { scheduledFor: "desc" }, take: 5 },
      checkouts: {
        orderBy: { checkedOutAt: "desc" },
        take: 20,
        include: {
          checkedOutBy: { select: { id: true, name: true, email: true } },
          checkedInBy: { select: { id: true, name: true, email: true } },
        },
      },
      consumptions: {
        where: { status: { in: ["PENDING_APPROVAL", "APPROVED"] } },
        orderBy: { requestedAt: "desc" },
        take: 5,
      },
      checkedOutTo: { select: { id: true, name: true, email: true } },
      inventoryItem: { include: { part: true } },
    },
  });
}

export async function listMasterDd1149(contractNumber?: string | null) {
  return prisma.gfpDocument.findMany({
    where: {
      docType: "DD1149",
      ...(contractNumber ? { contractNumber } : {}),
    },
    orderBy: { uploadedAt: "desc" },
    include: {
      property: { select: { id: true, assetTag: true, description: true } },
    },
  });
}

export async function attachGfpDocument(params: {
  propertyId?: string;
  contractNumber?: string;
  docType?: string;
  url: string;
  fileName?: string;
  caption?: string;
  formNumber?: string;
  formDate?: Date | null;
  uploadedById?: string;
}) {
  let contractNumber = params.contractNumber || null;
  if (params.propertyId && !contractNumber) {
    const prop = await prisma.governmentProperty.findUnique({
      where: { id: params.propertyId },
      select: { contractNumber: true },
    });
    contractNumber = prop?.contractNumber || null;
  }
  const doc = await prisma.gfpDocument.create({
    data: {
      propertyId: params.propertyId || null,
      contractNumber,
      docType: params.docType || "DD1149",
      url: params.url,
      fileName: params.fileName,
      caption: params.caption,
      formNumber: params.formNumber,
      formDate: params.formDate || undefined,
      uploadedById: params.uploadedById,
    },
  });
  await logAudit({
    entityType: "GfpDocument",
    entityId: doc.id,
    action: "CREATED",
    userId: params.uploadedById,
    metadata: { docType: doc.docType, propertyId: params.propertyId },
  });
  return doc;
}

export async function setGfpAuditInterval(params: {
  propertyId: string;
  auditIntervalDays: number;
  userId?: string;
}) {
  const days = Math.max(1, Math.floor(params.auditIntervalDays));
  const prop = await prisma.governmentProperty.findUnique({
    where: { id: params.propertyId },
  });
  if (!prop) throw new Error("GFP item not found");

  const base = prop.lastInventoryDate || new Date();
  const nextAuditDue = new Date(base);
  nextAuditDue.setDate(nextAuditDue.getDate() + days);

  const updated = await prisma.governmentProperty.update({
    where: { id: prop.id },
    data: { auditIntervalDays: days, nextAuditDue },
  });

  // Ensure a scheduled audit exists for the next due date
  const existing = await prisma.gfpAuditRecord.findFirst({
    where: {
      propertyId: prop.id,
      status: { in: ["SCHEDULED", "OVERDUE"] },
    },
  });
  if (!existing) {
    await prisma.gfpAuditRecord.create({
      data: {
        propertyId: prop.id,
        scheduledFor: nextAuditDue,
        status: nextAuditDue < new Date() ? "OVERDUE" : "SCHEDULED",
      },
    });
  } else {
    await prisma.gfpAuditRecord.update({
      where: { id: existing.id },
      data: {
        scheduledFor: nextAuditDue,
        status: nextAuditDue < new Date() ? "OVERDUE" : "SCHEDULED",
      },
    });
  }

  await logAudit({
    entityType: "GovernmentProperty",
    entityId: prop.id,
    action: "AUDIT_INTERVAL_SET",
    userId: params.userId,
    changes: { auditIntervalDays: days, nextAuditDue },
  });
  return updated;
}

async function lockGfpProperty(db: Prisma.TransactionClient, id: string) {
  const before = await db.governmentProperty.findUnique({ where: { id } });
  if (!before) throw new Error("GFP item not found");
  // No timestamp mutation for an idempotent retry, but obtain the row lock and
  // refuse a stale write if another property operation won first.
  const claim = await db.governmentProperty.updateMany({ where: { id, updatedAt: before.updatedAt }, data: { updatedAt: before.updatedAt } });
  if (!claim.count) throw new Error("GFP property changed concurrently; refresh and retry");
  return db.governmentProperty.findUniqueOrThrow({ where: { id }, include: { inventoryItem: { include: { part: true, location: true } } } });
}

export async function completeGfpAudit(params: {
  auditId?: string; propertyId: string; result: "PASS" | "FAIL" | "N_A";
  findings?: string; notes?: string; auditedById?: string;
}) {
  if (!["PASS", "FAIL", "N_A"].includes(params.result)) throw new Error("Invalid GFP audit result");
  return prisma.$transaction(async db => {
    const prop = await lockGfpProperty(db, params.propertyId);
    const existing = params.auditId ? await db.gfpAuditRecord.findUnique({ where: { id: params.auditId } }) :
      await db.gfpAuditRecord.findFirst({ where: { propertyId: prop.id, status: { in: ["SCHEDULED", "OVERDUE"] } }, orderBy: { scheduledFor: "asc" } });
    if (params.auditId && (!existing || existing.propertyId !== prop.id)) throw new Error("Audit does not belong to this property");
    if (existing?.status === "COMPLETED") return existing;
    if (existing && !["SCHEDULED", "OVERDUE"].includes(existing.status)) throw new Error("Audit is not pending completion");
    const now = new Date(), nextAuditDue = new Date(now);
    nextAuditDue.setDate(nextAuditDue.getDate() + (prop.auditIntervalDays || 90));
    const data = { status: "COMPLETED", completedAt: now, result: params.result, findings: params.findings, notes: params.notes, auditedById: params.auditedById };
    const audit = existing ? await db.gfpAuditRecord.update({ where: { id: existing.id }, data }) :
      await db.gfpAuditRecord.create({ data: { ...data, propertyId: prop.id, scheduledFor: now } });
    await db.governmentProperty.update({ where: { id: prop.id }, data: { lastInventoryDate: now, nextAuditDue } });
    const next = await db.gfpAuditRecord.findFirst({ where: { propertyId: prop.id, status: { in: ["SCHEDULED", "OVERDUE"] } }, orderBy: { scheduledFor: "asc" } });
    if (next) await db.gfpAuditRecord.update({ where: { id: next.id }, data: { scheduledFor: nextAuditDue, status: "SCHEDULED" } });
    else await db.gfpAuditRecord.create({ data: { propertyId: prop.id, scheduledFor: nextAuditDue, status: "SCHEDULED" } });
    await db.complianceCheck.create({ data: { propertyId: prop.id, checkType: "PHYSICAL_INVENTORY", status: params.result, checkedById: params.auditedById, checkedAt: now, notes: params.notes, findings: params.findings } });
    await logAudit({ entityType: "GfpAuditRecord", entityId: audit.id, action: "COMPLETED", userId: params.auditedById, metadata: { propertyId: params.propertyId, result: params.result } }, db);
    return audit;
  });
}

export async function checkoutGfp(params: { propertyId: string; checkedOutById: string; purpose?: string; expectedReturn?: Date | null }) {
  if (params.expectedReturn && !Number.isFinite(params.expectedReturn.getTime())) throw new Error("Invalid expected return date");
  const checkout = await prisma.$transaction(async db => {
    const prop = await lockGfpProperty(db, params.propertyId);
    if (!["ACTIVE", "IN_STORAGE", "IN_USE"].includes(prop.status) || prop.checkedOutToId || await db.gfpCheckout.count({ where: { propertyId: prop.id, status: "OPEN" } })) throw new Error("Item is already checked out or unavailable");
    const now = new Date();
    const row = await db.gfpCheckout.create({ data: { propertyId: prop.id, checkedOutById: params.checkedOutById, checkedOutAt: now, purpose: params.purpose, expectedReturn: params.expectedReturn || undefined, status: "OPEN" } });
    await db.governmentProperty.update({ where: { id: prop.id }, data: { status: "CHECKED_OUT", checkedOutToId: params.checkedOutById, checkedOutAt: now } });
    await logAudit({ entityType: "GovernmentProperty", entityId: params.propertyId, action: "CHECKOUT", userId: params.checkedOutById, metadata: { checkoutId: row.id, purpose: params.purpose } }, db);
    return row;
  });
  return checkout;
}

export async function checkinGfp(params: {
  propertyId: string;
  checkedInById: string;
  notes?: string;
  /** CHECKIN | RETURN_TO_GOV | TRANSFER_COMPANY */
  disposition?: "CHECKIN" | "RETURN_TO_GOV" | "TRANSFER_COMPANY";
}) {
  if (params.disposition && params.disposition !== "CHECKIN" &&
      !(await userHasPermission(params.checkedInById, "gfp.manage"))) {
    throw new Error("GFP management permission required for ownership disposition");
  }
  const prop = await prisma.governmentProperty.findUnique({
    where: { id: params.propertyId },
  });
  if (!prop) throw new Error("GFP item not found");

  const disposition = params.disposition || "CHECKIN";
  const open = await prisma.gfpCheckout.findFirst({
    where: { propertyId: prop.id, status: "OPEN" },
    orderBy: { checkedOutAt: "desc" },
  });

  const now = new Date();
  let checkoutStatus = "RETURNED";
  let propStatus = "ACTIVE";
  let action = "CHECKIN";

  if (disposition === "RETURN_TO_GOV") {
    checkoutStatus = "RETURNED_TO_GOVERNMENT";
    propStatus = "DISPOSED";
    action = "RETURNED_TO_GOVERNMENT";
  } else if (disposition === "TRANSFER_COMPANY") {
    checkoutStatus = "TRANSFERRED_TO_COMPANY";
    propStatus = "DISPOSED";
    action = "TRANSFERRED_TO_COMPANY";
  }

  if (open) {
    await prisma.gfpCheckout.update({
      where: { id: open.id },
      data: {
        status: checkoutStatus,
        disposition,
        checkedInAt: now,
        checkedInById: params.checkedInById,
        checkedInNotes: params.notes,
      },
    });
  } else if (disposition !== "CHECKIN") {
    // Allow return/transfer without an open checkout (e.g. still in storage)
    await prisma.gfpCheckout.create({
      data: {
        propertyId: prop.id,
        checkedOutById: params.checkedInById,
        checkedOutAt: now,
        checkedInAt: now,
        checkedInById: params.checkedInById,
        checkedInNotes: params.notes,
        status: checkoutStatus,
        disposition,
        purpose:
          disposition === "RETURN_TO_GOV"
            ? "Government requested return"
            : "Approved transfer to company-owned",
      },
    });
  } else {
    throw new Error("No open checkout for this item");
  }

  await prisma.governmentProperty.update({
    where: { id: prop.id },
    data: {
      status: propStatus,
      checkedOutToId: null,
      checkedOutAt: null,
      notes:
        disposition === "TRANSFER_COMPANY"
          ? [prop.notes, "Transferred to company-owned property"].filter(Boolean).join("\n")
          : disposition === "RETURN_TO_GOV"
            ? [prop.notes, "Returned to government"].filter(Boolean).join("\n")
            : prop.notes,
    },
  });

  // When transferring to company, flip linked inventory ownership
  if (disposition === "TRANSFER_COMPANY" && prop.inventoryItemId) {
    await prisma.inventoryItem.update({
      where: { id: prop.inventoryItemId },
      data: { ownership: "COMPANY" },
    });
  }

  await logAudit({
    entityType: "GovernmentProperty",
    entityId: prop.id,
    action,
    userId: params.checkedInById,
    metadata: {
      checkoutId: open?.id,
      disposition,
      notes: params.notes,
    },
  });
  return open;
}

export async function listGfpCheckoutHistory(opts?: {
  propertyId?: string;
  contractNumber?: string;
  q?: string;
  limit?: number;
}) {
  return prisma.gfpCheckout.findMany({
    where: {
      ...(opts?.propertyId ? { propertyId: opts.propertyId } : {}),
      ...(opts?.contractNumber || opts?.q
        ? {
            property: {
              ...(opts.contractNumber
                ? { contractNumber: opts.contractNumber }
                : {}),
              ...(opts.q
                ? {
                    OR: [
                      { assetTag: { contains: opts.q } },
                      { description: { contains: opts.q } },
                      { serialNumber: { contains: opts.q } },
                      { uid: { contains: opts.q } },
                      { partNumber: { contains: opts.q } },
                      { contractNumber: { contains: opts.q } },
                    ],
                  }
                : {}),
            },
          }
        : {}),
    },
    orderBy: { checkedOutAt: "desc" },
    take: opts?.limit ?? 200,
    include: {
      property: {
        select: {
          id: true,
          assetTag: true,
          description: true,
          contractNumber: true,
          status: true,
        },
      },
      checkedOutBy: { select: { id: true, name: true, email: true } },
      checkedInBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function searchGfpItems(q: string) {
  const term = q.trim();
  if (!term) return listGfpByContract(null);
  return prisma.governmentProperty.findMany({
    where: {
      OR: [
        { assetTag: { contains: term } },
        { description: { contains: term } },
        { serialNumber: { contains: term } },
        { uid: { contains: term } },
        { partNumber: { contains: term } },
        { contractNumber: { contains: term } },
        { location: { contains: term } },
        { custodialCode: { contains: term } },
      ],
    },
    orderBy: { assetTag: "asc" },
    include: {
      complianceChecks: { orderBy: { checkedAt: "desc" }, take: 3 },
      documents: { orderBy: { uploadedAt: "desc" }, take: 5 },
      auditRecords: { orderBy: { scheduledFor: "desc" }, take: 3 },
      checkouts: {
        orderBy: { checkedOutAt: "desc" },
        take: 10,
        include: {
          checkedOutBy: { select: { id: true, name: true } },
          checkedInBy: { select: { id: true, name: true } },
        },
      },
      consumptions: {
        where: { status: { in: ["PENDING_APPROVAL", "APPROVED"] } },
        take: 3,
      },
      checkedOutTo: { select: { id: true, name: true, email: true } },
      inventoryItem: { include: { part: true } },
    },
  });
}

function assertGfpConsumptionQuantity(prop: Awaited<ReturnType<typeof lockGfpProperty>>, quantity: number, workOrderId?: string | null) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Consumption quantity must be positive and finite");
  if (["DISPOSED", "CONSUMED", "LOST"].includes(prop.status)) throw new Error("Property is unavailable or already disposed/consumed");
  const stock = prop.inventoryItem;
  if (!stock) {
    if (prop.propertyType === "MATERIAL" || prop.classification === "MATERIAL") throw new Error("Material consumption requires linked inventory");
    if (quantity !== 1) throw new Error("An individual asset can only be consumed as one whole unit");
    return;
  }
  if (stock.ownership !== "GOVERNMENT" || stock.mrbCaseId || stock.quantityQuarantine > 0) throw new Error("Only released government-owned inventory can be consumed");
  const staged = !!workOrderId && stock.workOrderId === workOrderId;
  if (!Number.isFinite(stock.quantityOnHand) || quantity > stock.quantityOnHand || (!staged && quantity > stock.quantityAvailable)) throw new Error("Consumption quantity exceeds available property inventory");
  if (stock.quantityAvailable < 0 || stock.quantityCommitted < 0 || stock.quantityAvailable + stock.quantityCommitted > stock.quantityOnHand + 0.000001) throw new Error("Inventory quantity reconciliation required before consumption");
  if ((stock.serialNumber || stock.part.isSerialized) && (quantity !== 1 || stock.quantityOnHand !== 1)) throw new Error("Serialized property requires one whole physical unit");
}

export async function requestGfpConsumption(params: { propertyId: string; workOrderId?: string; quantity?: number; reason?: string; requestedById?: string }) {
  const quantity = params.quantity ?? 1;
  const rec = await prisma.$transaction(async db => {
    const prop = await lockGfpProperty(db, params.propertyId);
    assertGfpConsumptionQuantity(prop, quantity, params.workOrderId);
    if (params.workOrderId && !await db.workOrder.findUnique({ where: { id: params.workOrderId } })) throw new Error("Work order not found");
    const row = await db.gfpConsumption.create({ data: { propertyId: prop.id, workOrderId: params.workOrderId || null, quantity, reason: params.reason, requestedById: params.requestedById, status: "PENDING_APPROVAL" } });
    await logAudit({ entityType: "GfpConsumption", entityId: row.id, action: "REQUESTED", userId: params.requestedById, metadata: { propertyId: params.propertyId, workOrderId: params.workOrderId } }, db);
    return row;
  });
  return rec;
}

export async function decideGfpConsumption(params: { consumptionId: string; approve: boolean; approvedById: string; approvalNotes?: string; pinCode?: string }) {
  if (!(await userHasPermission(params.approvedById, "gfp.manage"))) throw new Error("GFP management permission required for consumption decision");
  await verifySignaturePin(params.approvedById, params.pinCode);
  const updated = await prisma.$transaction(async db => {
    const initial = await db.gfpConsumption.findUniqueOrThrow({ where: { id: params.consumptionId } });
    const prop = await lockGfpProperty(db, initial.propertyId);
    const rec = await db.gfpConsumption.findUniqueOrThrow({ where: { id: initial.id } });
    if (rec.status !== "PENDING_APPROVAL") throw new Error("Request is not pending approval");
    const now = new Date();
    const claim = await db.gfpConsumption.updateMany({ where: { id: rec.id, status: "PENDING_APPROVAL" }, data: {
      status: params.approve ? "CONSUMED" : "REJECTED", approvedById: params.approvedById, approvedAt: now,
      approvalNotes: params.approvalNotes, consumedAt: params.approve ? now : null,
    } });
    if (!claim.count) throw new Error("Consumption decision changed concurrently");
    if (!params.approve) {
      await logAudit({ entityType: "GfpConsumption", entityId: rec.id, action: "REJECTED", userId: params.approvedById }, db);
      return db.gfpConsumption.findUniqueOrThrow({ where: { id: rec.id } });
    }
    assertGfpConsumptionQuantity(prop, rec.quantity, rec.workOrderId);
    const stock = prop.inventoryItem;
    let remaining = 0;
    if (stock) {
      const fromAvailable = Math.min(stock.quantityAvailable, rec.quantity), fromCommitted = Math.min(stock.quantityCommitted, rec.quantity - fromAvailable);
      const changed = await db.inventoryItem.updateMany({ where: { id: stock.id, updatedAt: stock.updatedAt, ownership: "GOVERNMENT", mrbCaseId: null, quantityQuarantine: 0 }, data: {
        quantityOnHand: { decrement: rec.quantity }, quantityAvailable: { decrement: fromAvailable }, quantityCommitted: { decrement: fromCommitted },
      } });
      if (!changed.count) throw new Error("Property stock changed concurrently; refresh and retry");
      remaining = stock.quantityOnHand - rec.quantity;
      await db.materialTransaction.create({ data: { type: "ISSUE", partId: stock.partId, inventoryItemId: stock.id, workOrderId: rec.workOrderId,
        quantity: rec.quantity, unitCost: stock.unitCost, fromLocation: stock.location.code, lotNumber: stock.lotNumber, serialNumber: stock.serialNumber,
        reference: rec.id, notes: `Government property consumption: ${prop.assetTag}`, userId: params.approvedById } });
      await db.traceEvent.create({ data: { eventType: "GFP_CONSUMED", partId: stock.partId, workOrderId: rec.workOrderId, quantity: rec.quantity,
        lotNumber: stock.lotNumber, serialNumber: stock.serialNumber, notes: `Consumed ${prop.assetTag}; request ${rec.id}`, userId: params.approvedById } });
      if (remaining === 0 && stock.serialNumber) await db.serialNumber.updateMany({ where: { serial: stock.serialNumber, partId: stock.partId }, data: { status: "CONSUMED" } });
    }
    const full = remaining <= 0;
    await db.governmentProperty.update({ where: { id: prop.id }, data: {
      status: full ? "CONSUMED" : prop.status, checkedOutToId: full ? null : prop.checkedOutToId, checkedOutAt: full ? null : prop.checkedOutAt,
      notes: [prop.notes, `Consumed ${rec.quantity} against WO ${rec.workOrderId || "—"}`].filter(Boolean).join("\n"),
    } });
    if (full) await db.gfpCheckout.updateMany({ where: { propertyId: prop.id, status: "OPEN" }, data: { status: "RETURNED", checkedInAt: now, checkedInById: params.approvedById, checkedInNotes: "Closed due to full consumption" } });
    await logAudit({ entityType: "GfpConsumption", entityId: rec.id, action: "APPROVED_CONSUMED", userId: params.approvedById }, db);
    return db.gfpConsumption.findUniqueOrThrow({ where: { id: rec.id } });
  });
  return updated;
}

export async function listPendingGfpConsumptions() {
  return prisma.gfpConsumption.findMany({
    where: { status: "PENDING_APPROVAL" },
    orderBy: { requestedAt: "desc" },
    include: {
      property: true,
      workOrder: { select: { id: true, number: true, description: true } },
      requestedBy: { select: { id: true, name: true } },
    },
  });
}

export async function listUpcomingGfpAudits(limit = 50) {
  return prisma.gfpAuditRecord.findMany({
    where: { status: { in: ["SCHEDULED", "OVERDUE"] } },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    include: {
      property: {
        select: {
          id: true,
          assetTag: true,
          description: true,
          contractNumber: true,
          location: true,
        },
      },
    },
  });
}
