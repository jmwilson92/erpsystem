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

/**
 * Update the PO's delivery dates (header EDD and/or per-line promises)
 * WITHOUT the re-approval round — date slips are a supplier reality, not
 * a commercial change. The charge owner (budget owner → WBS owner →
 * project PM → requester) is notified of the new date and asked to flag
 * it if unacceptable. Every change is audited.
 */
export async function updatePoDeliveryDates(params: {
  poId: string;
  promisedDate?: Date | null;
  linePromised?: Record<string, Date | null>;
  userId?: string | null;
}) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.poId },
    include: {
      lines: true,
      supplier: { select: { name: true } },
      purchaseRequest: {
        include: {
          budget: { select: { ownerId: true, name: true } },
          wbsElement: { select: { ownerId: true } },
          project: { select: { projectManagerId: true } },
          workOrder: {
            select: {
              salesOrder: { select: { number: true } },
              project: { select: { projectManagerId: true } },
            },
          },
        },
      },
    },
  });
  if (!po) throw new Error("PO not found");
  if (["CLOSED", "CANCELLED"].includes(po.status)) {
    throw new Error(`PO is ${po.status} — dates can no longer change`);
  }

  const changes: string[] = [];
  const fmt = (d: Date | null | undefined) =>
    d ? d.toISOString().slice(0, 10) : "—";

  if (params.promisedDate !== undefined) {
    const oldStr = fmt(po.promisedDate);
    const newStr = fmt(params.promisedDate);
    if (oldStr !== newStr) {
      await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: { promisedDate: params.promisedDate },
      });
      changes.push(`PO delivery ${oldStr} → ${newStr}`);
    }
  }
  for (const [lineId, date] of Object.entries(params.linePromised || {})) {
    const line = po.lines.find((l) => l.id === lineId);
    if (!line) continue;
    const oldStr = fmt(line.promisedDate);
    const newStr = fmt(date);
    if (oldStr !== newStr) {
      await prisma.purchaseOrderLine.update({
        where: { id: lineId },
        data: { promisedDate: date },
      });
      changes.push(`Line ${line.lineNumber} (${line.description}) ${oldStr} → ${newStr}`);
    }
  }

  if (changes.length === 0) return { changed: 0, notified: null };

  await logAudit({
    entityType: "PurchaseOrder",
    entityId: po.id,
    action: "DELIVERY_DATE_UPDATED",
    userId: params.userId,
    metadata: { poNumber: po.number, changes },
  });

  // Resolve the charge owner to notify
  const pr = po.purchaseRequest;
  const ownerId =
    pr?.budget?.ownerId ||
    pr?.wbsElement?.ownerId ||
    pr?.project?.projectManagerId ||
    pr?.workOrder?.project?.projectManagerId ||
    pr?.requestedById ||
    null;
  let notified: string | null = null;
  if (ownerId && ownerId !== params.userId) {
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { name: true, email: true },
    });
    if (owner?.email) {
      let soNumber = pr?.workOrder?.salesOrder?.number || null;
      if (!soNumber && pr?.salesOrderId) {
        const so = await prisma.salesOrder.findUnique({
          where: { id: pr.salesOrderId },
          select: { number: true },
        });
        soNumber = so?.number || null;
      }
      const context = pr?.budget?.name
        ? `budget "${pr.budget.name}"`
        : soNumber
          ? `sales order ${soNumber}`
          : "your charge";
      try {
        const { sendEmail } = await import("@/lib/services/email");
        await sendEmail({
          to: owner.email,
          subject: `Delivery date changed on ${po.number} (${po.supplier.name})`,
          body: [
            `<p>The delivery date on purchase order <strong>${po.number}</strong> — charged to ${context} — was updated:</p>`,
            `<ul>${changes.map((c) => `<li>${c}</li>`).join("")}</ul>`,
            `<p>If the new date is <strong>not acceptable</strong>, reply to purchasing or comment on the PO so it can be worked with the supplier.</p>`,
          ].join("\n"),
          entityType: "PurchaseOrder",
          entityId: po.id,
          entityLabel: po.number,
          userId: params.userId || undefined,
        });
        notified = owner.name;
      } catch {
        /* email center failure never blocks the date change */
      }
    }
  }
  return { changed: changes.length, notified };
}
