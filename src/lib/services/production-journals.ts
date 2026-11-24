/**
 * Production journal approval: kit, consume, and finished-goods output
 * can be held as PENDING records (no stock or GL movement) until an
 * assigned approver posts them. The company toggle defaults to off so
 * existing floor flows are unchanged. Approve posts inventory and the
 * GL atomically with the company's costing method. Reject keeps the
 * row (with a reason). Quantity may be edited before approve, with an
 * audit trail. Journals are period-lock aware and never deleted.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { getAccountingCloseDate } from "@/lib/services/gaap";
import { isPeriodLocked } from "@/lib/services/posting-rules";
import { roundMoney } from "@/lib/services/posting-rules";

type Db = Prisma.TransactionClient | typeof prisma;
const money = roundMoney;

export const PRODUCTION_JOURNAL_TYPES = ["KIT", "CONSUME", "OUTPUT"] as const;
export type ProductionJournalType = (typeof PRODUCTION_JOURNAL_TYPES)[number];

export type ProductionApprovalSettings = {
  required: boolean;
  approverUserIds: string[];
  approverRoles: string[];
  threshold: number | null;
};

function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => String(value).trim()).filter(Boolean);
  } catch {
    return raw
      .split(/[,;\s]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }
}

export async function getProductionApprovalSettings(
  db: Db = prisma
): Promise<ProductionApprovalSettings> {
  const row = await db.accountingSettings.findUnique({ where: { id: "default" } });
  const threshold = row?.productionApprovalThreshold;
  return {
    required: row?.productionApprovalRequired === true,
    approverUserIds: parseIdList(row?.productionApproverUserIds),
    approverRoles: parseIdList(row?.productionApproverRoles).map((r) => r.toUpperCase()),
    threshold:
      threshold == null || !Number.isFinite(threshold) || threshold < 0 ? null : threshold,
  };
}

export async function resolveProductionApprover(params: {
  workCenterId?: string | null;
  workCenterCode?: string | null;
  db?: Db;
}): Promise<{ assignedApproverId: string | null; workCenterId: string | null }> {
  const db = params.db || prisma;
  const settings = await getProductionApprovalSettings(db);
  let workCenterId = params.workCenterId || null;
  let stationApprover: string | null = null;
  if (params.workCenterCode || workCenterId) {
    const station = workCenterId
      ? await db.workCenter.findUnique({ where: { id: workCenterId } })
      : await db.workCenter.findFirst({
          where: { code: params.workCenterCode || undefined },
        });
    if (station) {
      workCenterId = station.id;
      stationApprover = station.productionApproverUserId || null;
    }
  }
  return {
    assignedApproverId: stationApprover || settings.approverUserIds[0] || null,
    workCenterId,
  };
}

/**
 * Whether this movement should be held for approval. Auto-approve
 * threshold (amount <= threshold) returns false so the caller posts now.
 */
export async function shouldHoldProductionJournal(params: {
  amount: number;
  workCenterId?: string | null;
  workCenterCode?: string | null;
  db?: Db;
}): Promise<{ hold: boolean; autoApproved: boolean; settings: ProductionApprovalSettings }> {
  const db = params.db || prisma;
  const settings = await getProductionApprovalSettings(db);
  if (!settings.required) {
    return { hold: false, autoApproved: false, settings };
  }
  if (settings.threshold != null && params.amount <= settings.threshold + 0.0001) {
    return { hold: false, autoApproved: true, settings };
  }
  return { hold: true, autoApproved: false, settings };
}

async function nextProductionJournalNumber(db: Db): Promise<string> {
  const last = await db.productionJournal.findFirst({
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const match = last?.number.match(/(\d+)$/);
  const next = (match ? Number(match[1]) : 0) + 1;
  return `PJ-${String(next).padStart(5, "0")}`;
}

const STALE_POSTING_MS = 2 * 60 * 1000;

function isStalePosting(journal: { status: string; updatedAt: Date }): boolean {
  return (
    journal.status === "POSTING" &&
    Date.now() - journal.updatedAt.getTime() > STALE_POSTING_MS
  );
}

async function notifyProductionJournalApprovers(params: {
  id: string;
  number: string;
  type: string;
  workOrderId: string;
  assignedApproverId?: string | null;
  requestedById?: string | null;
  settings: ProductionApprovalSettings;
}) {
  const userIds = new Set<string>(params.settings.approverUserIds);
  if (params.assignedApproverId) userIds.add(params.assignedApproverId);
  if (params.requestedById) userIds.delete(params.requestedById);
  if (userIds.size === 0 && params.settings.approverRoles.length === 0) {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    });
    for (const admin of admins) {
      if (admin.id !== params.requestedById) userIds.add(admin.id);
    }
  }
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    select: { number: true },
  });
  const title = `Production journal ${params.number} needs approval`;
  const body = `${params.number} (${params.type}) for ${wo?.number || "a work order"} is waiting. Stock and the general ledger post only after you sign off.`;
  for (const userId of userIds) {
    await prisma.userNotification.create({
      data: {
        userId,
        type: "PRODUCTION_JOURNAL",
        title,
        body,
        href: `/approvals#pj-${params.id}`,
        entityType: "ProductionJournal",
        entityId: params.id,
      },
    });
  }
}

export type ProductionJournalPayload = {
  kitOrderId?: string;
  linePicks?: Record<string, string>;
  lines?: {
    lineId: string;
    partId: string;
    partNumber?: string;
    quantityRequested: number;
    unitCost?: number;
  }[];
  workOrderId?: string;
  quantity?: number;
  lotNumber?: string;
  serialNumber?: string;
  notes?: string;
  partId?: string;
  consumeSource?: string;
};

export async function queueProductionJournal(params: {
  type: ProductionJournalType;
  workOrderId: string;
  workCenterCode?: string | null;
  workCenterId?: string | null;
  kitOrderId?: string | null;
  partId?: string | null;
  quantity: number;
  amount: number;
  unitCost?: number;
  payload?: ProductionJournalPayload;
  notes?: string;
  requestedById?: string | null;
  db?: Db;
}): Promise<{
  id: string;
  number: string;
  status: string;
  pendingApproval: true;
}> {
  const db = params.db || prisma;
  if (params.type === "KIT" && params.kitOrderId) {
    const existing = await db.productionJournal.findFirst({
      where: { type: "KIT", kitOrderId: params.kitOrderId, status: "PENDING" },
    });
    if (existing) {
      return {
        id: existing.id,
        number: existing.number,
        status: existing.status,
        pendingApproval: true,
      };
    }
  }
  if (params.type === "OUTPUT") {
    const existing = await db.productionJournal.findFirst({
      where: {
        type: "OUTPUT",
        workOrderId: params.workOrderId,
        status: "PENDING",
        quantityRequested: params.quantity,
      },
    });
    if (existing) {
      return {
        id: existing.id,
        number: existing.number,
        status: existing.status,
        pendingApproval: true,
      };
    }
  }
  const route = await resolveProductionApprover({
    workCenterId: params.workCenterId,
    workCenterCode: params.workCenterCode,
    db,
  });
  const number = await nextProductionJournalNumber(db);
  const row = await db.productionJournal.create({
    data: {
      number,
      type: params.type,
      status: "PENDING",
      workOrderId: params.workOrderId,
      workCenterId: route.workCenterId,
      kitOrderId: params.kitOrderId || null,
      partId: params.partId || null,
      quantityRequested: params.quantity,
      amount: money(params.amount),
      unitCost: money(params.unitCost || 0),
      payload: JSON.stringify(params.payload || {}),
      notes: params.notes || null,
      requestedById: params.requestedById || null,
      assignedApproverId: route.assignedApproverId,
    },
  });
  await logAudit({
    entityType: "ProductionJournal",
    entityId: row.id,
    action: "SUBMITTED",
    userId: params.requestedById,
    metadata: {
      number: row.number,
      type: row.type,
      workOrderId: row.workOrderId,
      quantity: row.quantityRequested,
      amount: row.amount,
    },
  });
  await notifyProductionJournalApprovers({
    id: row.id,
    number: row.number,
    type: row.type,
    workOrderId: row.workOrderId,
    assignedApproverId: row.assignedApproverId,
    requestedById: params.requestedById,
    settings: await getProductionApprovalSettings(db),
  });
  return { id: row.id, number: row.number, status: row.status, pendingApproval: true };
}

export async function listPendingProductionJournalsForUser(params: {
  userId: string;
  userRole?: string | null;
}) {
  const settings = await getProductionApprovalSettings();
  const openCount = await prisma.productionJournal.count({
    where: { status: { in: ["PENDING", "POSTING"] } },
  });
  if (!settings.required && !openCount) {
    return [];
  }
  const role = (params.userRole || "").toUpperCase();
  const canByRole =
    settings.approverRoles.includes(role) ||
    (settings.approverUserIds.length === 0 &&
      settings.approverRoles.length === 0 &&
      role === "ADMIN");
  const canByUser = settings.approverUserIds.includes(params.userId);
  const staleBefore = new Date(Date.now() - STALE_POSTING_MS);
  return prisma.productionJournal.findMany({
    where: {
      OR: [
        { status: "PENDING" },
        { status: "POSTING", updatedAt: { lte: staleBefore } },
      ],
      AND: [
        {
          OR: [
            { assignedApproverId: params.userId },
            { workCenter: { productionApproverUserId: params.userId } },
            ...(canByRole || canByUser ? [{}] : []),
          ],
        },
      ],
    },
    include: {
      workOrder: { select: { id: true, number: true } },
      part: { select: { partNumber: true, description: true } },
      kitOrder: { select: { id: true, number: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function countPendingProductionJournalsForUser(params: {
  userId: string;
  userRole?: string | null;
}): Promise<number> {
  return (await listPendingProductionJournalsForUser(params)).length;
}

export async function listProductionJournalsForWorkOrder(workOrderId: string) {
  return prisma.productionJournal.findMany({
    where: { workOrderId },
    orderBy: { createdAt: "desc" },
  });
}

export async function assertNoPendingProductionJournals(workOrderId: string) {
  const pending = await prisma.productionJournal.findMany({
    where: { workOrderId, status: { in: ["PENDING", "POSTING"] } },
    select: { number: true, type: true },
  });
  if (pending.length) {
    const list = pending.map((row) => `${row.number} (${row.type})`).join(", ");
    throw new Error(
      `This job cannot be closed while production journals are waiting for approval: ${list}.`
    );
  }
}

export async function userCanDecideProductionJournal(params: {
  userId?: string | null;
  userRole?: string | null;
  journal: { assignedApproverId?: string | null; workCenterId?: string | null };
}): Promise<boolean> {
  if (!params.userId) return false;
  const settings = await getProductionApprovalSettings();
  const role = (params.userRole || "").toUpperCase();
  if (settings.approverUserIds.includes(params.userId)) return true;
  if (settings.approverRoles.includes(role)) return true;
  if (params.journal.assignedApproverId === params.userId) return true;
  if (params.journal.workCenterId) {
    const station = await prisma.workCenter.findUnique({
      where: { id: params.journal.workCenterId },
      select: { productionApproverUserId: true },
    });
    if (station?.productionApproverUserId === params.userId) return true;
  }
  if (
    settings.approverUserIds.length === 0 &&
    settings.approverRoles.length === 0 &&
    role === "ADMIN"
  ) {
    return true;
  }
  return false;
}

function parsePayload(raw: string | null | undefined): ProductionJournalPayload {
  try {
    return raw ? (JSON.parse(raw) as ProductionJournalPayload) : {};
  } catch {
    return {};
  }
}

export async function editProductionJournalQuantity(params: {
  id: string;
  quantity: number;
  lineQuantities?: Record<string, number>;
  userId?: string | null;
  userRole?: string | null;
  note?: string;
}) {
  if (!(params.quantity > 0) || !Number.isFinite(params.quantity)) {
    throw new Error("Approved quantity must be a positive number");
  }
  const journal = await prisma.productionJournal.findUnique({ where: { id: params.id } });
  if (!journal) throw new Error("Production journal not found");
  if (journal.status !== "PENDING") {
    throw new Error(`This production journal is already ${journal.status.toLowerCase()}`);
  }
  if (!(await userCanDecideProductionJournal({ userId: params.userId, userRole: params.userRole, journal }))) {
    throw new Error("You are not assigned to approve this production journal");
  }
  const payload = parsePayload(journal.payload);
  if (params.lineQuantities && payload.lines) {
    payload.lines = payload.lines.map((line) => ({
      ...line,
      quantityRequested:
        params.lineQuantities![line.lineId] != null && params.lineQuantities![line.lineId] >= 0
          ? params.lineQuantities![line.lineId]
          : line.quantityRequested,
    }));
  }
  if (payload.quantity != null) payload.quantity = params.quantity;
  const unit = journal.unitCost || 0;
  const amount = money(params.quantity * unit) || journal.amount;
  const updated = await prisma.productionJournal.update({
    where: { id: journal.id },
    data: {
      quantityApproved: params.quantity,
      amount,
      payload: JSON.stringify(payload),
      quantityEditedById: params.userId || null,
      quantityEditedAt: new Date(),
      quantityEditNote: params.note || `Quantity changed from ${journal.quantityRequested} to ${params.quantity}`,
    },
  });
  await logAudit({
    entityType: "ProductionJournal",
    entityId: journal.id,
    action: "QUANTITY_EDITED",
    userId: params.userId,
    metadata: {
      number: journal.number,
      from: journal.quantityRequested,
      to: params.quantity,
      note: params.note || null,
    },
  });
  return updated;
}

async function assertPeriodOpenForPost() {
  const closed = await getAccountingCloseDate();
  const periods = await prisma.accountingPeriod.findMany({
    where: { status: "CLOSED" },
    select: { startDate: true, endDate: true },
  });
  if (isPeriodLocked(new Date(), closed, periods.map((p) => ({ start: p.startDate, end: p.endDate })))) {
    throw new Error(
      "The current accounting period is closed. Reopen the period before approving a production journal."
    );
  }
}

export async function approveProductionJournal(params: {
  id: string;
  userId?: string | null;
  userRole?: string | null;
  quantity?: number;
  lineQuantities?: Record<string, number>;
  note?: string;
}) {
  const journal = await prisma.productionJournal.findUnique({ where: { id: params.id } });
  if (!journal) throw new Error("Production journal not found");
  if (journal.status === "APPROVED") return journal;
  if (journal.status === "POSTING" && !isStalePosting(journal)) {
    throw new Error(`${journal.number} is already being posted. Try again in a moment.`);
  }
  if (journal.status !== "PENDING" && !isStalePosting(journal)) {
    throw new Error(`This production journal is already ${journal.status.toLowerCase()}`);
  }
  if (!(await userCanDecideProductionJournal({ userId: params.userId, userRole: params.userRole, journal }))) {
    throw new Error("You are not assigned to approve this production journal");
  }
  await assertPeriodOpenForPost();
  if (params.quantity != null && params.quantity !== (journal.quantityApproved || journal.quantityRequested)) {
    if (journal.status !== "PENDING") {
      throw new Error("Quantity can only be edited while the journal is still pending");
    }
    await editProductionJournalQuantity({
      id: journal.id,
      quantity: params.quantity,
      lineQuantities: params.lineQuantities,
      userId: params.userId,
      userRole: params.userRole,
      note: params.note,
    });
  }
  const claim = await prisma.productionJournal.updateMany({
    where: {
      id: journal.id,
      status: journal.status === "POSTING" ? "POSTING" : "PENDING",
    },
    data: {
      status: "POSTING",
      decidedById: params.userId || null,
      decidedAt: new Date(),
    },
  });
  if (claim.count !== 1) {
    throw new Error(`${journal.number} was already decided by someone else.`);
  }
  const fresh = await prisma.productionJournal.findUniqueOrThrow({ where: { id: journal.id } });
  const qty = fresh.quantityApproved || fresh.quantityRequested;
  const payload = parsePayload(fresh.payload);
  let journalEntryId: string | null = null;

  try {
    if (fresh.type === "KIT") {
      if (!fresh.kitOrderId) throw new Error("This kit journal is missing its kit order");
      const { completeKitOrder } = await import("@/lib/services/order-fulfillment");
      if (payload.lines) {
        for (const line of payload.lines) {
          const approvedQty = line.quantityRequested;
          const current = await prisma.kitOrderLine.findUnique({ where: { id: line.lineId } });
          if (approvedQty + 0.0001 < (current?.quantityRequired || 0)) {
            await prisma.kitOrderLine.update({
              where: { id: line.lineId },
              data: { quantityRequired: approvedQty },
            });
          }
        }
      }
      await completeKitOrder({
        kitOrderId: fresh.kitOrderId,
        userId: params.userId || undefined,
        linePicks: payload.linePicks,
        executeApproved: true,
      });
    } else if (fresh.type === "OUTPUT") {
      const { receiveWorkOrderOutput } = await import("@/lib/services/inventory-accounting");
      const result = await receiveWorkOrderOutput({
        workOrderId: fresh.workOrderId,
        quantity: qty,
        userId: params.userId,
        lotNumber: payload.lotNumber,
        serialNumber: payload.serialNumber,
        notes: payload.notes,
        executeApproved: true,
      });
      journalEntryId = result.journalId || null;
    } else if (fresh.type === "CONSUME") {
      // Consumption at kit (AT_PICK) is posted by the KIT journal. Consumption
      // at output (BACKFLUSH) is posted by the OUTPUT journal. A standalone
      // CONSUME journal runs backflush for the approved quantity.
      const { executeApprovedConsume } = await import("@/lib/services/inventory-accounting");
      const result = await executeApprovedConsume({
        workOrderId: fresh.workOrderId,
        quantity: qty,
        partId: fresh.partId || payload.partId,
        userId: params.userId,
      });
      journalEntryId = result.journalId || null;
    } else {
      throw new Error(`Unknown production journal type ${fresh.type}`);
    }

    const posted = await prisma.productionJournal.update({
      where: { id: fresh.id, status: "POSTING" },
      data: {
        status: "APPROVED",
        quantityApproved: qty,
        decidedById: params.userId || null,
        decidedAt: new Date(),
        journalEntryId,
      },
    });
    await logAudit({
      entityType: "ProductionJournal",
      entityId: fresh.id,
      action: "APPROVED",
      userId: params.userId,
      metadata: { number: fresh.number, type: fresh.type, quantity: qty, journalEntryId },
    });
    return posted;
  } catch (err) {
    await prisma.productionJournal.updateMany({
      where: { id: fresh.id, status: "POSTING" },
      data: { status: "PENDING", decidedById: null, decidedAt: null },
    });
    throw err;
  }
}

export async function rejectProductionJournal(params: {
  id: string;
  reason: string;
  userId?: string | null;
  userRole?: string | null;
}) {
  const reason = (params.reason || "").trim();
  if (!reason) throw new Error("A rejection reason is required");
  const journal = await prisma.productionJournal.findUnique({ where: { id: params.id } });
  if (!journal) throw new Error("Production journal not found");
  if (journal.status !== "PENDING") {
    throw new Error(`This production journal is already ${journal.status.toLowerCase()}`);
  }
  if (!(await userCanDecideProductionJournal({ userId: params.userId, userRole: params.userRole, journal }))) {
    throw new Error("You are not assigned to approve this production journal");
  }
  const updated = await prisma.productionJournal.update({
    where: { id: journal.id, status: "PENDING" },
    data: {
      status: "REJECTED",
      rejectReason: reason,
      decidedById: params.userId || null,
      decidedAt: new Date(),
    },
  });
  await logAudit({
    entityType: "ProductionJournal",
    entityId: journal.id,
    action: "REJECTED",
    userId: params.userId,
    metadata: { number: journal.number, type: journal.type, reason },
  });
  return updated;
}

export async function recordAutoApprovedProductionJournal(params: {
  type: ProductionJournalType;
  workOrderId: string;
  workCenterCode?: string | null;
  kitOrderId?: string | null;
  partId?: string | null;
  quantity: number;
  amount: number;
  unitCost?: number;
  payload?: ProductionJournalPayload;
  journalEntryId?: string | null;
  requestedById?: string | null;
  db?: Db;
}) {
  const db = params.db || prisma;
  const route = await resolveProductionApprover({
    workCenterCode: params.workCenterCode,
    db,
  });
  const number = await nextProductionJournalNumber(db);
  const row = await db.productionJournal.create({
    data: {
      number,
      type: params.type,
      status: "APPROVED",
      workOrderId: params.workOrderId,
      workCenterId: route.workCenterId,
      kitOrderId: params.kitOrderId || null,
      partId: params.partId || null,
      quantityRequested: params.quantity,
      quantityApproved: params.quantity,
      amount: money(params.amount),
      unitCost: money(params.unitCost || 0),
      payload: JSON.stringify(params.payload || {}),
      notes: "Auto-approved: amount at or below the company threshold",
      requestedById: params.requestedById || null,
      assignedApproverId: route.assignedApproverId,
      decidedAt: new Date(),
      decidedById: params.requestedById || null,
      journalEntryId: params.journalEntryId || null,
    },
  });
  await logAudit({
    entityType: "ProductionJournal",
    entityId: row.id,
    action: "AUTO_APPROVED",
    userId: params.requestedById,
    metadata: { number: row.number, type: row.type, amount: row.amount },
  });
  return row;
}


export function productionJournalAsCarinaTask(params: {
  journal: {
    id: string;
    number: string;
    type: string;
    status: string;
    quantityRequested: number;
    quantityApproved: number | null;
    amount: number;
    workOrderId: string;
    createdAt: Date;
    updatedAt: Date;
    workOrder?: { number: string } | null;
  };
  userId: string;
}) {
  const j = params.journal;
  const qty = j.quantityApproved || j.quantityRequested;
  const wo = j.workOrder?.number ? ` for ${j.workOrder.number}` : "";
  return {
    id: `pj:${j.id}`,
    createdById: params.userId,
    text: `Approve ${j.number} (${j.type})${wo}, qty ${qty}. Stock and the ledger post only after you sign off.`,
    parsedIntent: null,
    plan: null,
    status: "needs-approval" as const,
    sortOrder: 0,
    log: "[]",
    resultHref: `/approvals#pj-${j.id}`,
    resultSummary: null,
    confirmedReadback: false,
    readbackText: null,
    approvedAt: null,
    approvedById: null,
    rejectedNote: null,
    approvalId: null,
    approvePermission: null,
    needsInfoQuestion: null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    summarizedAt: null,
    idempotencyKey: null,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  };
}
