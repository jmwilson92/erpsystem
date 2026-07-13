"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createWorkOrder } from "@/lib/services/work-orders";
import { getAvailableQty } from "@/lib/services/order-fulfillment";

async function nextNumber(prefix: string, model: "forecast" | "mrs") {
  if (model === "forecast") {
    const rows = await prisma.forecast.findMany({
      where: { number: { startsWith: `${prefix}-` } },
      select: { number: true },
    });
    let max = 0;
    for (const r of rows) {
      const n = parseInt(r.number.split("-").pop() || "0", 10);
      if (n > max) max = n;
    }
    return `${prefix}-${String(max + 1).padStart(5, "0")}`;
  }
  const rows = await prisma.materialRequisition.findMany({
    where: { number: { startsWith: `${prefix}-` } },
    select: { number: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.number.split("-").pop() || "0", 10);
    if (n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(5, "0")}`;
}

export async function createForecast(params: {
  name: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  notes?: string | null;
  lines: { partId: string; quantity: number; dueDate?: Date | null; notes?: string | null }[];
  userId?: string;
}) {
  if (!params.name?.trim()) throw new Error("Forecast name required");
  if (!params.lines.length) throw new Error("Add at least one forecast line");

  const number = await nextNumber("FC", "forecast");
  const forecast = await prisma.forecast.create({
    data: {
      number,
      name: params.name.trim(),
      status: "ACTIVE",
      periodStart: params.periodStart || null,
      periodEnd: params.periodEnd || null,
      notes: params.notes || null,
      createdById: params.userId || null,
      lines: {
        create: params.lines.map((l) => ({
          partId: l.partId,
          quantity: l.quantity,
          dueDate: l.dueDate || null,
          notes: l.notes || null,
        })),
      },
    },
    include: { lines: { include: { part: true } } },
  });

  await logAudit({
    entityType: "Forecast",
    entityId: forecast.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number, lineCount: params.lines.length },
  });

  return forecast;
}

/**
 * Net forecast demand against stock, explode BUILD BOMs for component needs,
 * and create a Material Requisition sheet (MRS-#####).
 */
export async function generateMaterialRequisitionFromForecast(params: {
  forecastId: string;
  userId?: string;
  name?: string;
}) {
  const forecast = await prisma.forecast.findUnique({
    where: { id: params.forecastId },
    include: {
      lines: { include: { part: true } },
    },
  });
  if (!forecast) throw new Error("Forecast not found");

  type MrsLineDraft = {
    partId: string;
    requiredQty: number;
    onHandQty: number;
    shortQty: number;
    action: string;
    parentPartId?: string | null;
    level: number;
    notes?: string;
  };

  const drafts: MrsLineDraft[] = [];
  const MAX_DEPTH = 10;
  // Stock is netted across the whole run: once a demand line consumes
  // on-hand, later lines for the same part see only what's left.
  const stockCache = new Map<string, number>();
  const allocated = new Map<string, number>();

  /**
   * Recursively net a part's demand against stock. Shortfalls on buildable
   * parts (certified BOM, not pure PURCHASE) explode into their component
   * needs — nested sub-BOMs explode all the way down.
   */
  async function explode(
    partId: string,
    partNumber: string,
    sourcingMethod: string,
    qtyNeeded: number,
    parentPartId: string | null,
    level: number,
    chain: Set<string>
  ): Promise<void> {
    if (!stockCache.has(partId)) {
      stockCache.set(partId, await getAvailableQty(partId));
    }
    const used = allocated.get(partId) || 0;
    const onHand = Math.max(0, (stockCache.get(partId) || 0) - used);
    allocated.set(partId, used + Math.min(onHand, qtyNeeded));
    const short = Math.max(0, qtyNeeded - onHand);

    if (short <= 0) {
      drafts.push({
        partId,
        requiredQty: qtyNeeded,
        onHandQty: onHand,
        shortQty: 0,
        action: "STOCK",
        parentPartId,
        level,
        notes:
          level === 0
            ? `Forecast ${qtyNeeded} covered by on-hand ${onHand}`
            : `Component — covered by stock`,
      });
      return;
    }

    const certifiedBom =
      sourcingMethod === "PURCHASE"
        ? null
        : await prisma.bomHeader.findFirst({
            where: { partId, status: "CERTIFIED" },
            orderBy: { revision: "desc" },
            include: { lines: { include: { componentPart: true } } },
          });

    if (!certifiedBom) {
      drafts.push({
        partId,
        requiredQty: qtyNeeded,
        onHandQty: onHand,
        shortQty: short,
        action: "BUY",
        parentPartId,
        level,
        notes:
          level === 0
            ? `No certified BOM / purchase item — buy ${short}`
            : `Purchase short (L${level})`,
      });
      return;
    }

    drafts.push({
      partId,
      requiredQty: qtyNeeded,
      onHandQty: onHand,
      shortQty: short,
      action: "BUILD",
      parentPartId,
      level,
      notes:
        level === 0
          ? `Build ${short} of ${partNumber} (need ${qtyNeeded}, on-hand ${onHand})`
          : `Sub-assembly build ${short} (L${level})`,
    });

    if (level >= MAX_DEPTH) return;

    for (const bl of certifiedBom.lines) {
      if (chain.has(bl.componentPartId)) continue; // cycle guard
      const nextChain = new Set(chain);
      nextChain.add(partId);
      await explode(
        bl.componentPartId,
        bl.componentPart.partNumber,
        bl.componentPart.sourcingMethod,
        bl.quantity * short,
        partId,
        level + 1,
        nextChain
      );
    }
  }

  for (const fl of forecast.lines) {
    await explode(
      fl.partId,
      fl.part.partNumber,
      fl.part.sourcingMethod,
      fl.quantity,
      null,
      0,
      new Set([fl.partId])
    );
  }

  // Collapse duplicate part lines (sum shorts, prefer BUILD > BUY > STOCK)
  const actionRank: Record<string, number> = {
    BUILD: 0,
    BUY: 1,
    STOCK: 2,
    NONE: 3,
  };
  const byPart = new Map<string, MrsLineDraft>();
  for (const d of drafts) {
    const key = `${d.partId}:${d.parentPartId || ""}`;
    const existing = byPart.get(key);
    if (!existing) {
      byPart.set(key, { ...d });
      continue;
    }
    existing.requiredQty += d.requiredQty;
    existing.shortQty += d.shortQty;
    existing.onHandQty = Math.min(existing.onHandQty, d.onHandQty);
    existing.level = Math.min(existing.level, d.level);
    if ((actionRank[d.action] ?? 9) < (actionRank[existing.action] ?? 9)) {
      existing.action = d.action;
    }
  }

  const number = await nextNumber("MRS", "mrs");
  const mrs = await prisma.materialRequisition.create({
    data: {
      number,
      status: "DRAFT",
      forecastId: forecast.id,
      name:
        params.name ||
        `MRS from ${forecast.number} — ${forecast.name}`,
      notes: `Generated from forecast ${forecast.number} against current stock.`,
      createdById: params.userId || null,
      lines: {
        create: Array.from(byPart.values()).map((d) => ({
          partId: d.partId,
          requiredQty: d.requiredQty,
          onHandQty: d.onHandQty,
          shortQty: d.shortQty,
          action: d.action,
          parentPartId: d.parentPartId || null,
          level: d.level,
          notes: d.notes || null,
        })),
      },
    },
    include: {
      lines: { include: { part: true }, orderBy: { action: "asc" } },
      forecast: true,
    },
  });

  await logAudit({
    entityType: "MaterialRequisition",
    entityId: mrs.id,
    action: "CREATED_FROM_FORECAST",
    userId: params.userId,
    metadata: { number, forecastId: forecast.id, lineCount: mrs.lines.length },
  });

  return mrs;
}

/**
 * Release MRS: create MWO- work orders for BUILD lines (shortQty > 0) and
 * one purchase request covering all BUY shorts (linked line-by-line; the
 * PO created from that PR hangs off it).
 */
export async function releaseMaterialRequisition(params: {
  materialRequisitionId: string;
  userId?: string;
  workCenter?: string;
}) {
  const mrs = await prisma.materialRequisition.findUnique({
    where: { id: params.materialRequisitionId },
    include: {
      lines: { include: { part: true } },
      workOrders: true,
    },
  });
  if (!mrs) throw new Error("Material requisition not found");
  if (mrs.status === "CANCELLED") throw new Error("MRS is cancelled");

  const buildLines = mrs.lines.filter(
    (l) => l.action === "BUILD" && l.shortQty > 0 && !l.workOrderId
  );

  const created: { woId: string; number: string; partNumber: string }[] = [];

  for (const line of buildLines) {
    const bom = await prisma.bomHeader.findFirst({
      where: { partId: line.partId, status: "CERTIFIED" },
      orderBy: { revision: "desc" },
    });
    if (!bom) {
      // Can't build without BOM — leave line for manual fix
      await prisma.materialRequisitionLine.update({
        where: { id: line.id },
        data: {
          notes: [line.notes, "Release skipped — no certified BOM"]
            .filter(Boolean)
            .join("; "),
        },
      });
      continue;
    }

    const wo = await createWorkOrder({
      type: "PRODUCTION",
      sourceType: "MATERIAL_REQ",
      materialRequisitionId: mrs.id,
      bomHeaderId: bom.id,
      partId: line.partId,
      quantity: line.shortQty,
      createdById: params.userId,
      workCenter: params.workCenter || "ASM-01",
      description: `Forecast build via ${mrs.number} — ${line.part.partNumber}`,
      travelerNotes: [
        "DIGITAL TRAVELER",
        `Source: Material requisition ${mrs.number}`,
        `MRS line action: BUILD qty ${line.shortQty}`,
        "Contains: BOM, Work Instructions, Kit list, sign-offs, material trace",
      ].join("\n"),
    });

    await prisma.materialRequisitionLine.update({
      where: { id: line.id },
      data: { workOrderId: wo.id },
    });

    created.push({
      woId: wo.id,
      number: wo.number,
      partNumber: line.part.partNumber,
    });
  }

  // ── BUY lines → one purchase request for the whole sheet ──
  const buyLines = mrs.lines.filter(
    (l) => l.action === "BUY" && l.shortQty > 0 && !l.purchaseRequestId
  );
  let createdPr: { id: string; number: string } | null = null;
  if (buyLines.length > 0) {
    const preferred = await prisma.supplier.findFirst({
      where: { status: { in: ["APPROVED", "CONDITIONAL"] } },
      orderBy: { overallScore: "desc" },
    });
    const prCount = await prisma.purchaseRequest.count();
    const prNumber = `PR-${String(prCount + 1).padStart(5, "0")}`;
    const totalEstimate = buyLines.reduce(
      (s, l) => s + l.shortQty * (l.part.standardCost || l.part.lastBuyCost || 0),
      0
    );
    const pr = await prisma.purchaseRequest.create({
      data: {
        number: prNumber,
        status: "SUBMITTED",
        requestedById: params.userId || null,
        department: "Planning",
        neededBy: new Date(Date.now() + 14 * 86_400_000),
        justification: `Buy demand from material requisition ${mrs.number}${mrs.name ? ` — ${mrs.name}` : ""}`,
        totalEstimate,
        supplierId: preferred?.id,
        triggerSource: "MATERIAL_REQ",
        materialRequisitionId: mrs.id,
        lines: {
          create: buyLines.map((l) => ({
            partId: l.partId,
            description: `${l.part.partNumber} — ${l.part.description}`,
            quantity: l.shortQty,
            estimatedUnitCost: l.part.standardCost || l.part.lastBuyCost || 0,
            uom: l.part.uom,
            notes: `MRS ${mrs.number} shortfall (need ${l.requiredQty}, on-hand ${l.onHandQty})`,
          })),
        },
      },
    });
    createdPr = { id: pr.id, number: pr.number };

    await prisma.materialRequisitionLine.updateMany({
      where: { id: { in: buyLines.map((l) => l.id) } },
      data: { purchaseRequestId: pr.id },
    });

    try {
      const { startPrApprovalWorkflow } = await import(
        "@/lib/services/pr-approval"
      );
      await startPrApprovalWorkflow({
        purchaseRequestId: pr.id,
        userId: params.userId,
      });
    } catch {
      /* PR stays SUBMITTED; approvals can be assigned manually */
    }
  }

  await prisma.materialRequisition.update({
    where: { id: mrs.id },
    data: {
      status:
        created.length || createdPr
          ? "IN_PROGRESS"
          : mrs.status === "DRAFT"
            ? "RELEASED"
            : mrs.status,
      releasedAt: mrs.releasedAt || new Date(),
    },
  });

  await logAudit({
    entityType: "MaterialRequisition",
    entityId: mrs.id,
    action: "RELEASED",
    userId: params.userId,
    metadata: {
      number: mrs.number,
      workOrders: created.map((c) => c.number),
      purchaseRequest: createdPr?.number || null,
    },
  });

  return {
    mrsId: mrs.id,
    mrsNumber: mrs.number,
    workOrders: created,
    purchaseRequest: createdPr,
  };
}

/** Planner adjustment of an MRS line — the generated plan is a starting
 *  point. Blocked once the line is released to a WO or PR. */
export async function updateMrsLine(params: {
  lineId: string;
  requiredQty?: number;
  action?: string;
  notes?: string | null;
  userId?: string;
}) {
  const line = await prisma.materialRequisitionLine.findUnique({
    where: { id: params.lineId },
    include: { materialRequisition: true, part: true },
  });
  if (!line) throw new Error("MRS line not found");
  if (["CLOSED", "CANCELLED"].includes(line.materialRequisition.status)) {
    throw new Error("Sheet is closed — no further adjustments");
  }
  if (line.workOrderId || line.purchaseRequestId) {
    throw new Error(
      "Line already released to a work order / purchase request — adjust there"
    );
  }
  const requiredQty =
    params.requiredQty !== undefined && params.requiredQty >= 0
      ? params.requiredQty
      : line.requiredQty;
  const action =
    params.action && ["BUILD", "BUY", "STOCK", "NONE"].includes(params.action)
      ? params.action
      : line.action;
  const shortQty = Math.max(0, requiredQty - line.onHandQty);
  const updated = await prisma.materialRequisitionLine.update({
    where: { id: line.id },
    data: {
      requiredQty,
      action,
      shortQty,
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
    },
  });
  await logAudit({
    entityType: "MaterialRequisition",
    entityId: line.materialRequisitionId,
    action: "LINE_ADJUSTED",
    userId: params.userId,
    metadata: {
      partNumber: line.part.partNumber,
      fromQty: line.requiredQty,
      toQty: requiredQty,
      fromAction: line.action,
      toAction: action,
    },
  });
  return updated;
}

/** Add a manual line to an MRS (planner supplement to the generated plan). */
export async function addMrsLine(params: {
  materialRequisitionId: string;
  partId: string;
  requiredQty: number;
  action?: string;
  notes?: string | null;
  userId?: string;
}) {
  const mrs = await prisma.materialRequisition.findUnique({
    where: { id: params.materialRequisitionId },
  });
  if (!mrs) throw new Error("Material requisition not found");
  if (["CLOSED", "CANCELLED"].includes(mrs.status)) {
    throw new Error("Sheet is closed — no further adjustments");
  }
  if (!(params.requiredQty > 0)) throw new Error("Quantity must be > 0");
  const part = await prisma.part.findUnique({ where: { id: params.partId } });
  if (!part) throw new Error("Part not found");
  const onHand = await getAvailableQty(part.id);
  const action =
    params.action && ["BUILD", "BUY", "STOCK", "NONE"].includes(params.action)
      ? params.action
      : part.sourcingMethod === "PURCHASE"
        ? "BUY"
        : "BUILD";
  const line = await prisma.materialRequisitionLine.create({
    data: {
      materialRequisitionId: mrs.id,
      partId: part.id,
      requiredQty: params.requiredQty,
      onHandQty: onHand,
      shortQty: Math.max(0, params.requiredQty - onHand),
      action,
      level: 0,
      notes: params.notes || "Added by planner",
    },
  });
  await logAudit({
    entityType: "MaterialRequisition",
    entityId: mrs.id,
    action: "LINE_ADDED",
    userId: params.userId,
    metadata: { partNumber: part.partNumber, qty: params.requiredQty, action },
  });
  return line;
}

/** Remove an MRS line the planner doesn't want (not yet released to WO/PR). */
export async function removeMrsLine(params: {
  lineId: string;
  userId?: string;
}) {
  const line = await prisma.materialRequisitionLine.findUnique({
    where: { id: params.lineId },
    include: { materialRequisition: true, part: true },
  });
  if (!line) throw new Error("MRS line not found");
  if (["CLOSED", "CANCELLED"].includes(line.materialRequisition.status)) {
    throw new Error("Sheet is closed — no further adjustments");
  }
  if (line.workOrderId || line.purchaseRequestId) {
    throw new Error(
      "Line already released to a work order / purchase request — cannot remove"
    );
  }
  await prisma.materialRequisitionLine.delete({ where: { id: line.id } });
  await logAudit({
    entityType: "MaterialRequisition",
    entityId: line.materialRequisitionId,
    action: "LINE_REMOVED",
    userId: params.userId,
    metadata: { partNumber: line.part.partNumber },
  });
}
