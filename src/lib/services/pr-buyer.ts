import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export type ChargeType = "PROGRAM" | "SALES_ORDER" | "DIRECT" | "INDIRECT";

/** Human-readable charge summary for buyer verification / accounting. */
export async function getPrChargeSnapshot(purchaseRequestId: string) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: purchaseRequestId },
    include: {
      project: {
        select: {
          id: true,
          number: true,
          name: true,
          programId: true,
          program: { select: { id: true, code: true, name: true } },
        },
      },
      wbsElement: {
        select: { id: true, code: true, name: true, budgetCost: true },
      },
      workOrder: {
        select: {
          id: true,
          number: true,
          salesOrderId: true,
          projectId: true,
          wbsElementId: true,
          project: {
            select: {
              number: true,
              name: true,
              program: { select: { code: true, name: true } },
            },
          },
          wbsElement: { select: { code: true, name: true } },
          salesOrder: { select: { number: true } },
        },
      },
    },
  });
  if (!pr) return null;

  let salesOrderNumber: string | null = null;
  if (pr.salesOrderId) {
    const so = await prisma.salesOrder.findUnique({
      where: { id: pr.salesOrderId },
      select: { number: true },
    });
    salesOrderNumber = so?.number || null;
  } else if (pr.workOrder?.salesOrder?.number) {
    salesOrderNumber = pr.workOrder.salesOrder.number;
  }

  const project = pr.project || pr.workOrder?.project || null;
  const wbs = pr.wbsElement || pr.workOrder?.wbsElement || null;
  const program = project?.program || null;

  const inferred: ChargeType = program || project || wbs
    ? "PROGRAM"
    : salesOrderNumber
      ? "SALES_ORDER"
      : pr.chargeType === "INDIRECT"
        ? "INDIRECT"
        : "DIRECT";

  const chargeType = (pr.chargeType as ChargeType) || inferred;

  const labels: string[] = [];
  if (program) labels.push(`Program ${program.code} — ${program.name}`);
  if (project) labels.push(`Project ${project.number} — ${project.name}`);
  if (wbs) labels.push(`WBS ${wbs.code} — ${wbs.name}`);
  if (salesOrderNumber) labels.push(`SO ${salesOrderNumber}`);
  if (pr.workOrder) labels.push(`WO ${pr.workOrder.number}`);
  if (chargeType === "DIRECT" && !labels.length) labels.push("Direct charge");
  if (chargeType === "INDIRECT") labels.push("Indirect / overhead");

  return {
    chargeType,
    inferred,
    program,
    project,
    wbs,
    salesOrderId: pr.salesOrderId || pr.workOrder?.salesOrderId || null,
    salesOrderNumber,
    workOrder: pr.workOrder
      ? { id: pr.workOrder.id, number: pr.workOrder.number }
      : null,
    glAccountId: pr.glAccountId,
    summary: labels.join(" · ") || "No charge code linked — set before purchase",
    accountingReady: !!(
      (chargeType === "PROGRAM" && (project || wbs || program)) ||
      (chargeType === "SALES_ORDER" && salesOrderNumber) ||
      chargeType === "DIRECT" ||
      chargeType === "INDIRECT"
    ),
  };
}

export async function saveBuyerPackage(params: {
  purchaseRequestId: string;
  userId?: string;
  lines: {
    id: string;
    quantity: number;
    estimatedUnitCost: number;
    description?: string;
    notes?: string | null;
  }[];
  supplierId?: string | null;
  buyerNotes?: string | null;
  soleSource?: boolean;
  soleSourceJustification?: string | null;
  chargeType?: ChargeType | null;
  projectId?: string | null;
  wbsElementId?: string | null;
  salesOrderId?: string | null;
  glAccountId?: string | null;
  /** Enacted budget to charge (non-project buys); mirrors its chargeCode */
  budgetId?: string | null;
  buyerConfirmedPrices?: boolean;
  buyerConfirmedShip?: boolean;
  quoteFileUrl?: string | null;
  quoteFileName?: string | null;
}) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: params.purchaseRequestId },
    include: { lines: true },
  });
  if (!pr) throw new Error("Purchase request not found");
  if (["CONVERTED", "CANCELLED", "REJECTED"].includes(pr.status)) {
    throw new Error(`Cannot edit PR in status ${pr.status}`);
  }

  for (const line of params.lines) {
    if (!pr.lines.some((l) => l.id === line.id)) {
      throw new Error("Unknown PR line");
    }
    if (!(line.quantity > 0)) throw new Error("Quantity must be > 0");
    if (line.estimatedUnitCost < 0) throw new Error("Unit cost cannot be negative");
  }

  if (params.soleSource && !params.soleSourceJustification?.trim()) {
    throw new Error("Sole-source justification is required when sole source is checked");
  }

  for (const line of params.lines) {
    await prisma.purchaseRequestLine.update({
      where: { id: line.id },
      data: {
        quantity: line.quantity,
        estimatedUnitCost: line.estimatedUnitCost,
        description: line.description || undefined,
        notes: line.notes ?? undefined,
      },
    });
  }

  const totalEstimate = params.lines.reduce(
    (s, l) => s + l.quantity * l.estimatedUnitCost,
    0
  );

  const updated = await prisma.purchaseRequest.update({
    where: { id: pr.id },
    data: {
      totalEstimate,
      supplierId: params.supplierId === undefined ? undefined : params.supplierId || null,
      buyerNotes: params.buyerNotes ?? undefined,
      soleSource: params.soleSource ?? undefined,
      soleSourceJustification:
        params.soleSourceJustification === undefined
          ? undefined
          : params.soleSourceJustification || null,
      chargeType: params.chargeType ?? undefined,
      projectId:
        params.projectId === undefined ? undefined : params.projectId || null,
      wbsElementId:
        params.wbsElementId === undefined
          ? undefined
          : params.wbsElementId || null,
      salesOrderId:
        params.salesOrderId === undefined
          ? undefined
          : params.salesOrderId || null,
      glAccountId:
        params.glAccountId === undefined
          ? undefined
          : params.glAccountId || null,
      ...(params.budgetId !== undefined
        ? {
            budgetId: params.budgetId || null,
            chargeCode: params.budgetId
              ? (
                  await prisma.budget.findUnique({
                    where: { id: params.budgetId },
                    select: { chargeCode: true },
                  })
                )?.chargeCode || null
              : null,
          }
        : {}),
      buyerConfirmedPrices: params.buyerConfirmedPrices ?? undefined,
      buyerConfirmedShip: params.buyerConfirmedShip ?? undefined,
      quoteFileUrl:
        params.quoteFileUrl === undefined
          ? undefined
          : params.quoteFileUrl || null,
      quoteFileName:
        params.quoteFileName === undefined
          ? undefined
          : params.quoteFileName || null,
    },
  });

  await logAudit({
    entityType: "PurchaseRequest",
    entityId: pr.id,
    action: "BUYER_PACKAGE_SAVED",
    userId: params.userId,
    metadata: {
      totalEstimate,
      lineCount: params.lines.length,
      chargeType: params.chargeType ?? pr.chargeType,
      soleSource: params.soleSource ?? pr.soleSource,
      buyerConfirmedPrices: params.buyerConfirmedPrices,
      lines: params.lines.map((l) => ({
        id: l.id,
        quantity: l.quantity,
        unitCost: l.estimatedUnitCost,
      })),
    },
  });

  return updated;
}

/** Assignment = scan-in for buyer time. Starts the clock for that person. */
export async function assignPrBuyer(params: {
  purchaseRequestId: string;
  buyerUserId: string | null;
  assignedById?: string;
}) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: params.purchaseRequestId },
  });
  if (!pr) throw new Error("Purchase request not found");

  if (params.buyerUserId) {
    const buyer = await prisma.user.findUnique({
      where: { id: params.buyerUserId },
    });
    if (!buyer?.isActive) throw new Error("Buyer user not found or inactive");
  }

  // Clock out previous buyer if reassigning
  if (
    pr.buyerWorkStartedAt &&
    pr.buyerWorkStartedById &&
    pr.buyerWorkStartedById !== params.buyerUserId
  ) {
    await clockOutBuyerWork({
      purchaseRequestId: pr.id,
      userId: pr.buyerWorkStartedById,
      reason: "REASSIGNED",
    });
  }

  const now = new Date();
  // Assignment hands the PR over — it does NOT start the new buyer's
  // clock. They scan in when they actually open/work the PR. If the
  // assigner was on the clock (e.g. did the legwork before delegating),
  // the clockOutBuyerWork above already closed their time.
  const selfAssign = params.buyerUserId === params.assignedById;
  const updated = await prisma.purchaseRequest.update({
    where: { id: pr.id },
    data: {
      assignedBuyerId: params.buyerUserId,
      assignedById: params.buyerUserId ? params.assignedById || null : null,
      assignedAt: params.buyerUserId ? now : null,
      // Only assigning YOURSELF starts a clock immediately
      buyerWorkStartedAt: selfAssign && params.buyerUserId ? now : null,
      buyerWorkStartedById: selfAssign ? params.buyerUserId || null : null,
    },
  });

  await logAudit({
    entityType: "PurchaseRequest",
    entityId: pr.id,
    action: params.buyerUserId ? "BUYER_ASSIGNED" : "BUYER_UNASSIGNED",
    userId: params.assignedById,
    metadata: {
      assignedBuyerId: params.buyerUserId,
      previousBuyerId: pr.assignedBuyerId,
      startedAt: selfAssign && params.buyerUserId ? now.toISOString() : null,
    },
  });

  return updated;
}

/** Scan-in if this buyer is working the PR and not already clocked.
 *  `claim` (default true — explicit work like saving the package) lets an
 *  unassigned worker become the buyer; page views pass claim:false so
 *  merely LOOKING at a PR never puts a bystander on the clock. */
export async function ensureBuyerScanIn(params: {
  purchaseRequestId: string;
  userId: string;
  claim?: boolean;
}) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: params.purchaseRequestId },
  });
  if (!pr) return null;
  if (pr.buyerWorkStartedAt && pr.buyerWorkStartedById === params.userId) {
    return pr;
  }
  // If someone else is on it, don't steal
  if (pr.buyerWorkStartedAt && pr.buyerWorkStartedById !== params.userId) {
    return pr;
  }
  const claim = params.claim !== false;
  // Without claim rights, only the ASSIGNED buyer auto-starts a clock
  if (!claim && pr.assignedBuyerId !== params.userId) {
    return pr;
  }
  const now = new Date();
  const updated = await prisma.purchaseRequest.update({
    where: { id: pr.id },
    data: {
      buyerWorkStartedAt: now,
      buyerWorkStartedById: params.userId,
      assignedBuyerId: pr.assignedBuyerId || params.userId,
      assignedAt: pr.assignedAt || now,
    },
  });
  await logAudit({
    entityType: "PurchaseRequest",
    entityId: pr.id,
    action: "BUYER_SCAN_IN",
    userId: params.userId,
    metadata: { startedAt: now.toISOString() },
  });
  return updated;
}

/**
 * Scan-out: post elapsed hours to the buyer's timesheet against the PR charge.
 */
export async function clockOutBuyerWork(params: {
  purchaseRequestId: string;
  userId: string;
  reason?: string;
}) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: params.purchaseRequestId },
  });
  if (!pr?.buyerWorkStartedAt || !pr.buyerWorkStartedById) {
    return { hours: 0, entryId: null as string | null };
  }
  if (pr.buyerWorkStartedById !== params.userId) {
    // Only the person who scanned in is clocked out (or force on reassign with their id)
  }

  const end = new Date();
  const ms = end.getTime() - pr.buyerWorkStartedAt.getTime();
  // Minimum 6 minutes (0.1h) if they did any work; cap reasonable day
  let hours = Math.round((ms / 3600000) * 100) / 100;
  if (hours < 0.1 && ms > 30_000) hours = 0.1;
  if (hours > 12) hours = 12;

  await prisma.purchaseRequest.update({
    where: { id: pr.id },
    data: {
      buyerWorkStartedAt: null,
      buyerWorkStartedById: null,
    },
  });

  if (hours < 0.05) {
    await logAudit({
      entityType: "PurchaseRequest",
      entityId: pr.id,
      action: "BUYER_SCAN_OUT",
      userId: params.userId,
      metadata: { hours: 0, reason: params.reason || "CONFIRM", skipped: true },
    });
    return { hours: 0, entryId: null as string | null };
  }

  let chargeCode: string | null = null;
  if (pr.chargeType === "INDIRECT") chargeCode = "IND-BUYER";
  else if (pr.chargeType === "DIRECT") chargeCode = "DIR-BUYER";
  else if (pr.chargeType === "SALES_ORDER") chargeCode = `SO-${pr.salesOrderId?.slice(-6) || "BUY"}`;
  else if (pr.chargeType === "PROGRAM") chargeCode = null; // project/wbs carries it

  const { getOrCreateTimesheet } = await import("@/lib/services/timesheets");
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  let timesheetId: string | null = null;
  try {
    const sheet = await getOrCreateTimesheet(params.userId, date);
    if (["OPEN", "REJECTED"].includes(sheet.status)) {
      timesheetId = sheet.id;
    }
  } catch {
    /* leave unattached */
  }

  const laborRate = 65;
  const entry = await prisma.timeEntry.create({
    data: {
      userId: params.userId,
      timesheetId: timesheetId || undefined,
      date,
      hours,
      type: "BUYER",
      purchaseRequestId: pr.id,
      projectId: pr.projectId || undefined,
      wbsElementId: pr.wbsElementId || undefined,
      chargeCode: chargeCode || undefined,
      description: `Buyer package ${pr.number}${
        params.reason ? ` (${params.reason})` : ""
      }`,
      status: "SUBMITTED",
      laborRate,
      costAmount: Math.round(hours * laborRate * 100) / 100,
    },
  });

  await logAudit({
    entityType: "PurchaseRequest",
    entityId: pr.id,
    action: "BUYER_SCAN_OUT",
    userId: params.userId,
    metadata: {
      hours,
      timeEntryId: entry.id,
      timesheetId,
      chargeType: pr.chargeType,
      projectId: pr.projectId,
      wbsElementId: pr.wbsElementId,
      reason: params.reason || "CONFIRM",
    },
  });

  return { hours, entryId: entry.id };
}

/**
 * Complete the BUYER_PACKAGE step directly (does not rely on generic decidePrApproval
 * or form submit-button name/value quirks).
 */
export async function confirmBuyerPackageStep(params: {
  purchaseRequestId: string;
  userId?: string;
  userRole?: string;
  comments?: string;
}) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: params.purchaseRequestId },
  });
  if (!pr) throw new Error("Purchase request not found");
  if (pr.status !== "SUBMITTED") {
    throw new Error(`PR is ${pr.status}, not in pipeline`);
  }

  // Purchasing / assigned buyer / admin only
  const role = params.userRole || "";
  const canConfirm =
    role === "ADMIN" ||
    role === "PURCHASING" ||
    role === "EXECUTIVE" ||
    (params.userId && pr.assignedBuyerId === params.userId);
  if (!canConfirm) {
    throw new Error("Only purchasing (or the assigned buyer) can confirm the package");
  }

  const gate = isBuyerPackageComplete({
    buyerConfirmedPrices: pr.buyerConfirmedPrices,
    quoteFileUrl: pr.quoteFileUrl,
    buyerNotes: pr.buyerNotes,
    soleSource: pr.soleSource,
    soleSourceJustification: pr.soleSourceJustification,
  });
  if (!gate.ok) {
    throw new Error(
      `Buyer package incomplete — ${gate.missing.join("; ")}. Save the workbench with “prices verified” checked and/or a quote attached, then confirm.`
    );
  }

  const all = await prisma.approval.findMany({
    where: {
      entityType: "PurchaseRequest",
      entityId: pr.id,
    },
    include: { policyStep: true },
    orderBy: { stepOrder: "asc" },
  });

  // Demand confirm must already be done
  const demand = all.find(
    (a) =>
      a.policyStep?.routingKey === "REQUEST_CONFIRM" ||
      a.policyStep?.routingKey === "CHARGE_OWNER" ||
      /confirm demand/i.test(a.stage)
  );
  if (demand && demand.status === "PENDING") {
    throw new Error(
      `Demand is still open (“${demand.stage}”). Charge owner must confirm demand before the buyer package can close.`
    );
  }

  const buyerStep = all.find(
    (a) =>
      a.status === "PENDING" &&
      (a.policyStep?.routingKey === "BUYER_PACKAGE" ||
        /buyer package/i.test(a.stage))
  );

  if (!buyerStep) {
    const alreadyDone = all.find(
      (a) =>
        a.status === "APPROVED" &&
        (a.policyStep?.routingKey === "BUYER_PACKAGE" ||
          /buyer package/i.test(a.stage))
    );
    if (alreadyDone) {
      const next = all.find(
        (a) => a.status === "PENDING" && a.stepOrder > alreadyDone.stepOrder
      );
      if (next) {
        await prisma.purchaseRequest.update({
          where: { id: pr.id },
          data: { currentStepOrder: next.stepOrder },
        });
      }
      return {
        status: "SUBMITTED" as const,
        nextStep: next?.stage || null,
        alreadyDone: true,
      };
    }
    const pending = all.filter((a) => a.status === "PENDING");
    throw new Error(
      pending.length
        ? `No buyer package step open (open: ${pending.map((p) => p.stage).join("; ")}).`
        : "No open approval steps on this PR."
    );
  }

  // Mark buyer step done
  await prisma.approval.update({
    where: { id: buyerStep.id },
    data: {
      status: "APPROVED",
      approverId: params.userId || null,
      comments: params.comments || "Buyer package confirmed",
      decidedAt: new Date(),
    },
  });

  const next = all.find(
    (a) => a.status === "PENDING" && a.stepOrder > buyerStep.stepOrder
  );

  if (next) {
    await prisma.purchaseRequest.update({
      where: { id: pr.id },
      data: { currentStepOrder: next.stepOrder, status: "SUBMITTED" },
    });
  } else {
    // No further steps — fully approved
    await prisma.purchaseRequest.update({
      where: { id: pr.id },
      data: {
        status: "APPROVED",
        currentStepOrder: 0,
        approvedById: params.userId || null,
        approvedAt: new Date(),
      },
    });
  }

  await logAudit({
    entityType: "PurchaseRequest",
    entityId: pr.id,
    action: "STEP_APPROVED",
    userId: params.userId,
    metadata: {
      stage: buyerStep.stage,
      routingKey: "BUYER_PACKAGE",
      nextStage: next?.stage || null,
      comments: params.comments || "Buyer package confirmed",
    },
  });

  if (!next) {
    await logAudit({
      entityType: "PurchaseRequest",
      entityId: pr.id,
      action: "APPROVED",
      userId: params.userId,
      metadata: { via: "BUYER_PACKAGE_LAST_STEP" },
    });
  }

  // Auto scan-out → timecard
  if (params.userId) {
    await clockOutBuyerWork({
      purchaseRequestId: pr.id,
      userId: params.userId,
      reason: "PACKAGE_CONFIRMED",
    });
  }

  return {
    status: (next ? "SUBMITTED" : "APPROVED") as "SUBMITTED" | "APPROVED",
    nextStep: next?.stage || null,
    alreadyDone: false,
  };
}

/** Whether the buyer package gate is satisfied for pipeline release. */
export function isBuyerPackageComplete(pr: {
  buyerConfirmedPrices: boolean;
  quoteFileUrl: string | null;
  buyerNotes: string | null;
  soleSource: boolean;
  soleSourceJustification: string | null;
}): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!pr.buyerConfirmedPrices && !pr.quoteFileUrl) {
    missing.push("confirm prices and/or attach a supplier quote");
  }
  if (pr.soleSource && !pr.soleSourceJustification?.trim()) {
    missing.push("sole-source justification");
  }
  return { ok: missing.length === 0, missing };
}
