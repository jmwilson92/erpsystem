"use server";

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

export async function completeGfpAudit(params: {
  auditId?: string;
  propertyId: string;
  result: "PASS" | "FAIL" | "N_A";
  findings?: string;
  notes?: string;
  auditedById?: string;
}) {
  const prop = await prisma.governmentProperty.findUnique({
    where: { id: params.propertyId },
  });
  if (!prop) throw new Error("GFP item not found");

  let audit = params.auditId
    ? await prisma.gfpAuditRecord.findUnique({ where: { id: params.auditId } })
    : await prisma.gfpAuditRecord.findFirst({
        where: {
          propertyId: prop.id,
          status: { in: ["SCHEDULED", "OVERDUE"] },
        },
        orderBy: { scheduledFor: "asc" },
      });

  const now = new Date();
  if (audit) {
    audit = await prisma.gfpAuditRecord.update({
      where: { id: audit.id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        result: params.result,
        findings: params.findings,
        notes: params.notes,
        auditedById: params.auditedById,
      },
    });
  } else {
    audit = await prisma.gfpAuditRecord.create({
      data: {
        propertyId: prop.id,
        scheduledFor: now,
        completedAt: now,
        status: "COMPLETED",
        result: params.result,
        findings: params.findings,
        notes: params.notes,
        auditedById: params.auditedById,
      },
    });
  }

  const interval = prop.auditIntervalDays || 90;
  const nextAuditDue = new Date(now);
  nextAuditDue.setDate(nextAuditDue.getDate() + interval);

  await prisma.governmentProperty.update({
    where: { id: prop.id },
    data: {
      lastInventoryDate: now,
      nextAuditDue,
      condition:
        params.result === "FAIL" ? prop.condition : prop.condition,
    },
  });

  await prisma.gfpAuditRecord.create({
    data: {
      propertyId: prop.id,
      scheduledFor: nextAuditDue,
      status: "SCHEDULED",
    },
  });

  await prisma.complianceCheck.create({
    data: {
      propertyId: prop.id,
      checkType: "PHYSICAL_INVENTORY",
      status: params.result === "N_A" ? "N_A" : params.result,
      checkedById: params.auditedById,
      checkedAt: now,
      notes: params.notes,
      findings: params.findings,
    },
  });

  await logAudit({
    entityType: "GfpAuditRecord",
    entityId: audit.id,
    action: "COMPLETED",
    userId: params.auditedById,
    changes: { result: params.result },
  });
  return audit;
}

export async function checkoutGfp(params: {
  propertyId: string;
  checkedOutById: string;
  purpose?: string;
  expectedReturn?: Date | null;
}) {
  const prop = await prisma.governmentProperty.findUnique({
    where: { id: params.propertyId },
  });
  if (!prop) throw new Error("GFP item not found");
  if (prop.status === "CONSUMED" || prop.status === "DISPOSED") {
    throw new Error("Cannot check out disposed/consumed property");
  }
  if (prop.checkedOutToId || prop.status === "CHECKED_OUT") {
    throw new Error("Item is already checked out");
  }

  const now = new Date();
  const checkout = await prisma.gfpCheckout.create({
    data: {
      propertyId: prop.id,
      checkedOutById: params.checkedOutById,
      checkedOutAt: now,
      purpose: params.purpose,
      expectedReturn: params.expectedReturn || undefined,
      status: "OPEN",
    },
  });

  await prisma.governmentProperty.update({
    where: { id: prop.id },
    data: {
      status: "CHECKED_OUT",
      checkedOutToId: params.checkedOutById,
      checkedOutAt: now,
    },
  });

  await logAudit({
    entityType: "GovernmentProperty",
    entityId: prop.id,
    action: "CHECKOUT",
    userId: params.checkedOutById,
    metadata: { checkoutId: checkout.id, purpose: params.purpose },
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

export async function requestGfpConsumption(params: {
  propertyId: string;
  workOrderId?: string;
  quantity?: number;
  reason?: string;
  requestedById?: string;
}) {
  const prop = await prisma.governmentProperty.findUnique({
    where: { id: params.propertyId },
  });
  if (!prop) throw new Error("GFP item not found");
  if (["DISPOSED", "CONSUMED"].includes(prop.status)) {
    throw new Error("Property already disposed/consumed");
  }

  if (params.workOrderId) {
    const wo = await prisma.workOrder.findUnique({
      where: { id: params.workOrderId },
    });
    if (!wo) throw new Error("Work order not found");
  }

  const rec = await prisma.gfpConsumption.create({
    data: {
      propertyId: prop.id,
      workOrderId: params.workOrderId || null,
      quantity: params.quantity ?? 1,
      reason: params.reason,
      requestedById: params.requestedById,
      status: "PENDING_APPROVAL",
    },
  });

  await logAudit({
    entityType: "GfpConsumption",
    entityId: rec.id,
    action: "REQUESTED",
    userId: params.requestedById,
    metadata: {
      propertyId: prop.id,
      workOrderId: params.workOrderId,
    },
  });
  return rec;
}

export async function decideGfpConsumption(params: {
  consumptionId: string;
  approve: boolean;
  approvedById: string;
  approvalNotes?: string;
  pinCode?: string;
}) {
  // PM approval requires PIN
  const approver = await prisma.user.findUnique({
    where: { id: params.approvedById },
  });
  if (!approver) throw new Error("Approver not found");
  if (!approver.pinCode?.trim()) {
    throw new Error(
      "Approver has no PIN configured — set a PIN before approving"
    );
  }
  const expectedPin = approver.pinCode.trim();
  if (!params.pinCode || params.pinCode.trim() !== expectedPin) {
    throw new Error(`Invalid PIN for ${approver.name} — each person signs with their own PIN (set it under My Account)`);
  }

  const rec = await prisma.gfpConsumption.findUnique({
    where: { id: params.consumptionId },
    include: { property: true },
  });
  if (!rec) throw new Error("Consumption request not found");
  if (rec.status !== "PENDING_APPROVAL") {
    throw new Error("Request is not pending approval");
  }

  const now = new Date();
  if (!params.approve) {
    return prisma.gfpConsumption.update({
      where: { id: rec.id },
      data: {
        status: "REJECTED",
        approvedById: params.approvedById,
        approvedAt: now,
        approvalNotes: params.approvalNotes,
      },
    });
  }

  const updated = await prisma.gfpConsumption.update({
    where: { id: rec.id },
    data: {
      status: "CONSUMED",
      approvedById: params.approvedById,
      approvedAt: now,
      approvalNotes: params.approvalNotes,
      consumedAt: now,
    },
  });

  await prisma.governmentProperty.update({
    where: { id: rec.propertyId },
    data: {
      status: "CONSUMED",
      checkedOutToId: null,
      checkedOutAt: null,
      notes: [rec.property.notes, `Consumed against WO ${rec.workOrderId || "—"}`]
        .filter(Boolean)
        .join("\n"),
    },
  });

  // Close any open checkout
  await prisma.gfpCheckout.updateMany({
    where: { propertyId: rec.propertyId, status: "OPEN" },
    data: {
      status: "RETURNED",
      checkedInAt: now,
      checkedInById: params.approvedById,
      checkedInNotes: "Closed due to consumption",
    },
  });

  await logAudit({
    entityType: "GfpConsumption",
    entityId: rec.id,
    action: "APPROVED_CONSUMED",
    userId: params.approvedById,
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
