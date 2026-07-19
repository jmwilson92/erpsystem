/**
 * Standalone (manual) purchase requests — not driven by WO shortage, kanban, or MRB.
 *
 * Catalog rules:
 * - Manufacturing / project activity (PROGRAM, SALES_ORDER, DIRECT, or linked
 *   project / WBS / WO / SO) → every line must reference a catalog part.
 * - Facilities / overhead / standalone charge-code budgets (INDIRECT without
 *   project activity) → free-text description lines are allowed.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { startPrApprovalWorkflow } from "@/lib/services/pr-approval";

export type StandalonePrLineInput = {
  partId?: string | null;
  description: string;
  quantity: number;
  estimatedUnitCost?: number;
  uom?: string;
  notes?: string | null;
};

export type PrPurpose =
  | "MANUFACTURING"
  | "PROJECT"
  | "FACILITIES"
  | "OTHER";

/** Manufacturing / project activity requires catalog parts on every line. */
export function prRequiresCatalogParts(params: {
  purpose?: PrPurpose | string | null;
  chargeType?: string | null;
  projectId?: string | null;
  wbsElementId?: string | null;
  workOrderId?: string | null;
  salesOrderId?: string | null;
}): boolean {
  const purpose = (params.purpose || "").toUpperCase();
  if (purpose === "MANUFACTURING" || purpose === "PROJECT") return true;
  if (purpose === "FACILITIES" || purpose === "OTHER") return false;

  if (
    params.projectId ||
    params.wbsElementId ||
    params.workOrderId ||
    params.salesOrderId
  ) {
    return true;
  }
  const ct = (params.chargeType || "").toUpperCase();
  if (ct === "PROGRAM" || ct === "SALES_ORDER" || ct === "DIRECT") return true;
  return false;
}

export async function createStandalonePurchaseRequest(params: {
  lines: StandalonePrLineInput[];
  department?: string | null;
  neededBy?: Date | null;
  justification?: string | null;
  supplierId?: string | null;
  projectId?: string | null;
  wbsElementId?: string | null;
  budgetId?: string | null;
  chargeCode?: string | null;
  chargeType?: "PROGRAM" | "SALES_ORDER" | "DIRECT" | "INDIRECT" | null;
  /** MANUFACTURING | PROJECT → catalog required; FACILITIES | OTHER → free text OK */
  purpose?: PrPurpose | string | null;
  salesOrderId?: string | null;
  workOrderId?: string | null;
  /** DRAFT = save without routing; SUBMITTED = start approval */
  submit?: boolean;
  userId?: string;
}) {
  const purpose = ((params.purpose || "").toUpperCase() || null) as PrPurpose | null;

  // Purpose drives charge type defaults
  let chargeType = params.chargeType || null;
  if (!chargeType) {
    if (purpose === "PROJECT" || params.projectId || params.wbsElementId) {
      chargeType = "PROGRAM";
    } else if (purpose === "MANUFACTURING" || params.workOrderId) {
      chargeType = "DIRECT";
    } else if (params.salesOrderId) {
      chargeType = "SALES_ORDER";
    } else if (purpose === "FACILITIES" || purpose === "OTHER") {
      chargeType = "INDIRECT";
    } else {
      chargeType = "INDIRECT";
    }
  }

  // Project purpose without project link is incomplete
  if (purpose === "PROJECT" && !params.projectId && !params.wbsElementId) {
    throw new Error(
      "Project purchase requests need a project (or WBS) so costs charge correctly"
    );
  }

  const requiresCatalog = prRequiresCatalogParts({
    purpose,
    chargeType,
    projectId: params.projectId,
    wbsElementId: params.wbsElementId,
    workOrderId: params.workOrderId,
    salesOrderId: params.salesOrderId,
  });

  const lines = params.lines
    .map((l) => ({
      partId: l.partId || null,
      description: (l.description || "").trim(),
      quantity: Number(l.quantity) || 0,
      estimatedUnitCost: Number(l.estimatedUnitCost) || 0,
      uom: (l.uom || "EA").trim() || "EA",
      notes: l.notes?.trim() || null,
    }))
    .filter((l) => (requiresCatalog ? !!l.partId : !!l.description) && l.quantity > 0);

  if (!lines.length) {
    throw new Error(
      requiresCatalog
        ? "Add at least one line with a catalog part and quantity > 0"
        : "Add at least one line with description and quantity > 0"
    );
  }

  // Resolve catalog parts + enforce manufacturing/project catalog rule
  for (const line of lines) {
    if (requiresCatalog && !line.partId) {
      throw new Error(
        "Manufacturing and project PRs may only buy catalog parts — pick a part number for every line (no free-text only)"
      );
    }
    if (line.partId) {
      const part = await prisma.part.findUnique({ where: { id: line.partId } });
      if (!part) throw new Error("One or more parts not found in the catalog");
      if (!part.isActive) {
        throw new Error(`Part ${part.partNumber} is inactive — choose an active catalog item`);
      }
      line.description =
        line.description && line.description !== "—"
          ? line.description.includes(part.partNumber)
            ? line.description
            : `${part.partNumber} — ${line.description}`
          : `${part.partNumber} — ${part.description}`;
      if (!line.estimatedUnitCost && part.standardCost) {
        line.estimatedUnitCost = part.standardCost;
      }
      if ((!line.uom || line.uom === "EA") && part.uom) line.uom = part.uom;
    } else if (!line.description) {
      throw new Error("Each free-text line needs a description");
    }
  }

  if (params.supplierId) {
    const s = await prisma.supplier.findUnique({ where: { id: params.supplierId } });
    if (!s) throw new Error("Supplier not found");
  }
  if (params.projectId) {
    const p = await prisma.project.findUnique({ where: { id: params.projectId } });
    if (!p) throw new Error("Project not found");
  }
  if (params.wbsElementId) {
    const w = await prisma.wbsElement.findUnique({
      where: { id: params.wbsElementId },
    });
    if (!w) throw new Error("WBS element not found");
  }
  if (params.budgetId) {
    const b = await prisma.budget.findUnique({ where: { id: params.budgetId } });
    if (!b) throw new Error("Budget not found");
    // Project activity shouldn't charge a pure standalone overhead budget without project link
    if (
      requiresCatalog &&
      b.sourceType === "STANDALONE" &&
      !params.projectId &&
      !params.wbsElementId
    ) {
      // still allowed if they set program/direct charge — no hard fail
    }
  }

  let chargeCode = params.chargeCode?.trim() || null;
  if (!chargeCode && params.budgetId) {
    const b = await prisma.budget.findUnique({ where: { id: params.budgetId } });
    chargeCode = b?.chargeCode || null;
  }

  // Stamp purpose into justification header for audit clarity
  const purposeLabel =
    purpose === "MANUFACTURING"
      ? "Manufacturing (catalog parts)"
      : purpose === "PROJECT"
        ? "Project (catalog parts)"
        : purpose === "FACILITIES"
          ? "Office / facility general (no project; description OK)"
          : purpose === "OTHER"
            ? "Company overhead / standalone budget (description OK)"
            : null;
  const justification = [
    purposeLabel ? `[${purposeLabel}]` : null,
    params.justification?.trim() || "Standalone purchase request",
  ]
    .filter(Boolean)
    .join(" ");

  const totalEstimate = lines.reduce(
    (s, l) => s + l.quantity * l.estimatedUnitCost,
    0
  );

  const prCount = await prisma.purchaseRequest.count();
  const number = `PR-${String(prCount + 1).padStart(5, "0")}`;
  const submit = params.submit !== false;

  const pr = await prisma.purchaseRequest.create({
    data: {
      number,
      status: submit ? "SUBMITTED" : "DRAFT",
      requestedById: params.userId || null,
      department: params.department?.trim() || null,
      neededBy: params.neededBy || null,
      justification,
      totalEstimate,
      supplierId: params.supplierId || null,
      projectId: params.projectId || null,
      wbsElementId: params.wbsElementId || null,
      budgetId: params.budgetId || null,
      chargeCode,
      chargeType,
      salesOrderId: params.salesOrderId || null,
      workOrderId: params.workOrderId || null,
      triggerSource: "MANUAL",
      lines: {
        create: lines.map((l) => ({
          partId: l.partId,
          description: l.description,
          quantity: l.quantity,
          estimatedUnitCost: l.estimatedUnitCost,
          uom: l.uom,
          notes: l.notes,
        })),
      },
    },
    include: {
      lines: true,
      supplier: true,
      project: true,
    },
  });

  if (submit) {
    await startPrApprovalWorkflow({
      purchaseRequestId: pr.id,
      userId: params.userId,
    });
  }

  await logAudit({
    entityType: "PurchaseRequest",
    entityId: pr.id,
    action: submit ? "CREATED_STANDALONE_SUBMITTED" : "CREATED_STANDALONE_DRAFT",
    userId: params.userId,
    metadata: {
      number,
      lineCount: lines.length,
      totalEstimate,
      chargeType,
      triggerSource: "MANUAL",
    },
  });

  return pr;
}

export async function submitDraftPurchaseRequest(params: {
  purchaseRequestId: string;
  userId?: string;
}) {
  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: params.purchaseRequestId },
  });
  if (!pr) throw new Error("Purchase request not found");
  if (pr.status !== "DRAFT") {
    throw new Error(`Only DRAFT PRs can be submitted (current: ${pr.status})`);
  }

  await prisma.purchaseRequest.update({
    where: { id: pr.id },
    data: { status: "SUBMITTED" },
  });

  await startPrApprovalWorkflow({
    purchaseRequestId: pr.id,
    userId: params.userId,
  });

  await logAudit({
    entityType: "PurchaseRequest",
    entityId: pr.id,
    action: "SUBMITTED",
    userId: params.userId,
    metadata: { number: pr.number },
  });

  return prisma.purchaseRequest.findUnique({ where: { id: pr.id } });
}
