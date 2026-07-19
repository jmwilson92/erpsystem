/**
 * PO amendments — purchasing can edit an issued PO, but every edit goes
 * back through the same round of approvers the PR went through. The PO
 * sits in PENDING_REAPPROVAL (receiving is blocked) until the chain
 * approves; a rejection carries a reason and purchasing edits again.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/** Approver chain for an amendment: the linked PR's decision steps
 *  (charge owner + any threshold/finance steps), cloned onto the PO. */
async function buildAmendmentApprovals(poId: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    select: { id: true, purchaseRequestId: true, totalAmount: true },
  });
  if (!po) throw new Error("PO not found");

  await prisma.approval.deleteMany({
    where: { entityType: "PurchaseOrder", entityId: po.id },
  });

  type Step = { approverId: string | null; stage: string; minAmount: number };
  const steps: Step[] = [];
  if (po.purchaseRequestId) {
    const prApprovals = await prisma.approval.findMany({
      where: {
        entityType: "PurchaseRequest",
        entityId: po.purchaseRequestId,
        policyStep: {
          routingKey: {
            in: ["PURCHASE_APPROVAL", "CHARGE_OWNER", "CHARGE_ESCALATION", "ROLE"],
          },
        },
      },
      include: { policyStep: true },
      orderBy: { stepOrder: "asc" },
    });
    for (const a of prApprovals) {
      steps.push({
        approverId: a.approverId,
        stage: `Amendment — ${a.stage || a.policyStep?.name || "approval"}`,
        minAmount: a.policyStep?.minAmount || 0,
      });
    }
  }
  if (steps.length === 0) {
    // No PR lineage (manual PO) — charge owner unknown; route to admin/exec
    const admin = await prisma.user.findFirst({
      where: { isActive: true, role: { in: ["ADMIN", "EXECUTIVE"] } },
      orderBy: { name: "asc" },
    });
    steps.push({
      approverId: admin?.id || null,
      stage: "Amendment — operations approval",
      minAmount: 0,
    });
  }

  // Threshold steps only apply when the amended total still crosses them
  const applicable = steps.filter((s) => po.totalAmount >= (s.minAmount || 0));
  const rows = [];
  let order = 0;
  for (const s of applicable) {
    rows.push(
      await prisma.approval.create({
        data: {
          entityType: "PurchaseOrder",
          entityId: po.id,
          stepOrder: order++,
          status: "PENDING",
          approverId: s.approverId,
          stage: s.stage,
          minAmount: s.minAmount,
        },
      })
    );
  }
  return rows;
}

export async function amendPurchaseOrder(params: {
  poId: string;
  userId?: string;
  promisedDate?: Date | null;
  notes?: string | null;
  lines?: { lineId: string; quantity: number; unitCost: number }[];
}) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.poId },
    include: { lines: true },
  });
  if (!po) throw new Error("PO not found");
  if (["CLOSED", "CANCELLED"].includes(po.status)) {
    throw new Error(`Cannot amend a ${po.status} PO`);
  }

  const before = {
    promisedDate: po.promisedDate?.toISOString() || null,
    totalAmount: po.totalAmount,
    lines: po.lines.map((l) => ({
      id: l.id,
      quantity: l.quantity,
      unitCost: l.unitCost,
    })),
  };

  for (const edit of params.lines || []) {
    const line = po.lines.find((l) => l.id === edit.lineId);
    if (!line) continue;
    if (edit.quantity <= 0) throw new Error("Line quantity must be positive");
    if (edit.unitCost < 0) throw new Error("Unit cost cannot be negative");
    await prisma.purchaseOrderLine.update({
      where: { id: line.id },
      data: { quantity: edit.quantity, unitCost: edit.unitCost },
    });
  }
  const freshLines = await prisma.purchaseOrderLine.findMany({
    where: { purchaseOrderId: po.id },
  });
  const totalAmount = freshLines.reduce(
    (s, l) => s + l.quantity * l.unitCost,
    0
  );

  const updated = await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: {
      ...(params.promisedDate !== undefined
        ? { promisedDate: params.promisedDate }
        : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
      totalAmount,
      status: "PENDING_REAPPROVAL",
    },
  });

  const approvals = await buildAmendmentApprovals(po.id);

  await logAudit({
    entityType: "PurchaseOrder",
    entityId: po.id,
    action: "AMENDED",
    userId: params.userId,
    changes: {
      before,
      after: { promisedDate: updated.promisedDate?.toISOString() || null, totalAmount },
    },
    metadata: { approvers: approvals.length },
  });

  return { po: updated, approvals };
}

export async function decidePoAmendment(params: {
  poId: string;
  decision: "APPROVED" | "REJECTED";
  comments?: string | null;
  userId: string;
  userRole?: string;
}) {
  const pending = await prisma.approval.findMany({
    where: {
      entityType: "PurchaseOrder",
      entityId: params.poId,
      status: "PENDING",
    },
    orderBy: { stepOrder: "asc" },
  });
  if (!pending.length) throw new Error("No amendment approvals pending");
  const current = pending[0];
  const mine =
    current.approverId === params.userId ||
    params.userRole === "ADMIN" ||
    (!current.approverId &&
      ["EXECUTIVE", "ACCOUNTING"].includes(params.userRole || ""));
  if (!mine) throw new Error("This amendment step is not assigned to you");

  if (params.decision === "REJECTED") {
    if (!params.comments?.trim()) {
      throw new Error("A rejection reason is required");
    }
    await prisma.approval.updateMany({
      where: {
        entityType: "PurchaseOrder",
        entityId: params.poId,
        status: "PENDING",
      },
      data: { status: "REJECTED" },
    });
    await prisma.approval.update({
      where: { id: current.id },
      data: { comments: params.comments.trim(), decidedAt: new Date() },
    });
    await logAudit({
      entityType: "PurchaseOrder",
      entityId: params.poId,
      action: "AMEND_REJECTED",
      userId: params.userId,
      metadata: { reason: params.comments.trim() },
    });
    return { status: "PENDING_REAPPROVAL", rejected: true };
  }

  await prisma.approval.update({
    where: { id: current.id },
    data: {
      status: "APPROVED",
      comments: params.comments?.trim() || null,
      decidedAt: new Date(),
    },
  });
  const remaining = await prisma.approval.count({
    where: {
      entityType: "PurchaseOrder",
      entityId: params.poId,
      status: "PENDING",
    },
  });
  if (remaining === 0) {
    await prisma.purchaseOrder.update({
      where: { id: params.poId },
      data: { status: "ISSUED" },
    });
    await logAudit({
      entityType: "PurchaseOrder",
      entityId: params.poId,
      action: "AMEND_APPROVED",
      userId: params.userId,
    });
    return { status: "ISSUED", rejected: false };
  }
  return { status: "PENDING_REAPPROVAL", rejected: false };
}

/** Pending PO amendment steps assigned to this user (for /approvals). */
export async function listPoAmendmentsForUser(params: {
  userId?: string;
  userRole?: string;
}) {
  if (!params.userId) return [];
  const pos = await prisma.purchaseOrder.findMany({
    where: { status: "PENDING_REAPPROVAL" },
    select: {
      id: true,
      number: true,
      totalAmount: true,
      supplier: { select: { name: true } },
    },
  });
  const out: {
    id: string;
    number: string;
    totalAmount: number;
    supplier: string;
    stage: string;
  }[] = [];
  for (const po of pos) {
    const current = await prisma.approval.findFirst({
      where: {
        entityType: "PurchaseOrder",
        entityId: po.id,
        status: "PENDING",
      },
      orderBy: { stepOrder: "asc" },
    });
    if (!current) continue;
    const mine =
      current.approverId === params.userId ||
      params.userRole === "ADMIN" ||
      (!current.approverId &&
        ["EXECUTIVE", "ACCOUNTING"].includes(params.userRole || ""));
    if (mine)
      out.push({
        id: po.id,
        number: po.number,
        totalAmount: po.totalAmount,
        supplier: po.supplier.name,
        stage: current.stage || "Amendment approval",
      });
  }
  return out;
}
