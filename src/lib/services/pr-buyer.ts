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

  const updated = await prisma.purchaseRequest.update({
    where: { id: pr.id },
    data: {
      assignedBuyerId: params.buyerUserId,
      assignedById: params.buyerUserId ? params.assignedById || null : null,
      assignedAt: params.buyerUserId ? new Date() : null,
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
    },
  });

  return updated;
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
