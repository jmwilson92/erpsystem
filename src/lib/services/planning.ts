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
    notes?: string;
  };

  const drafts: MrsLineDraft[] = [];

  for (const fl of forecast.lines) {
    const onHand = await getAvailableQty(fl.partId);
    const need = Math.max(0, fl.quantity - onHand);
    if (need <= 0) {
      drafts.push({
        partId: fl.partId,
        requiredQty: fl.quantity,
        onHandQty: onHand,
        shortQty: 0,
        action: "STOCK",
        notes: `Forecast ${fl.quantity} covered by on-hand ${onHand}`,
      });
      continue;
    }

    // Prefer BUILD if certified BOM exists and part is not pure PURCHASE
    const certifiedBom = await prisma.bomHeader.findFirst({
      where: { partId: fl.partId, status: "CERTIFIED" },
      orderBy: { revision: "desc" },
      include: { lines: { include: { componentPart: true } } },
    });

    const canBuild =
      !!certifiedBom && fl.part.sourcingMethod !== "PURCHASE";

    if (canBuild && certifiedBom) {
      drafts.push({
        partId: fl.partId,
        requiredQty: need,
        onHandQty: onHand,
        shortQty: need,
        action: "BUILD",
        notes: `Build ${need} of ${fl.part.partNumber} (forecast ${fl.quantity}, on-hand ${onHand})`,
      });

      // Component netting for kit / buy
      for (const bl of certifiedBom.lines) {
        const compNeed = bl.quantity * need;
        const compOnHand = await getAvailableQty(bl.componentPartId);
        const compShort = Math.max(0, compNeed - compOnHand);
        if (compShort <= 0) {
          drafts.push({
            partId: bl.componentPartId,
            requiredQty: compNeed,
            onHandQty: compOnHand,
            shortQty: 0,
            action: "STOCK",
            parentPartId: fl.partId,
            notes: `Component for ${fl.part.partNumber} — covered by stock`,
          });
        } else {
          // Sub-assembly with BOM? BUILD else BUY
          const subBom = await prisma.bomHeader.findFirst({
            where: {
              partId: bl.componentPartId,
              status: "CERTIFIED",
            },
          });
          const buildComp =
            !!subBom && bl.componentPart.sourcingMethod !== "PURCHASE";
          drafts.push({
            partId: bl.componentPartId,
            requiredQty: compNeed,
            onHandQty: compOnHand,
            shortQty: compShort,
            action: buildComp ? "BUILD" : "BUY",
            parentPartId: fl.partId,
            notes: buildComp
              ? `Sub-assembly short for ${fl.part.partNumber}`
              : `Purchase short for ${fl.part.partNumber} kit`,
          });
        }
      }
    } else {
      drafts.push({
        partId: fl.partId,
        requiredQty: need,
        onHandQty: onHand,
        shortQty: need,
        action: "BUY",
        notes: `No certified BOM / purchase item — buy ${need}`,
      });
    }
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
 * Release MRS: create MWO- work orders for BUILD lines (shortQty > 0).
 * Each MWO references the MRS number.
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

  await prisma.materialRequisition.update({
    where: { id: mrs.id },
    data: {
      status: created.length ? "IN_PROGRESS" : mrs.status === "DRAFT" ? "RELEASED" : mrs.status,
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
    },
  });

  return { mrsId: mrs.id, mrsNumber: mrs.number, workOrders: created };
}
