"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createWorkOrder } from "@/lib/services/work-orders";
import { getAvailableQty } from "@/lib/services/order-fulfillment";
import {
  defaultChildOffsetMinutes,
  estimateMinutesForWorkInstructions,
  getPlanningSettings,
  neededByFromLead,
  resolveBuyLeadDays,
  subtractWorkingMinutes,
  buildCalendarContext,
} from "@/lib/services/schedule";
import { addDays } from "date-fns";

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

/** On-hand + open production WO remaining + open PO remaining for a part. */
export async function getPartSupplySnapshot(partId: string): Promise<{
  onHand: number;
  openWoQty: number;
  openPoQty: number;
  total: number;
}> {
  const [onHand, openWos, poLines] = await Promise.all([
    getAvailableQty(partId),
    prisma.workOrder.findMany({
      where: {
        partId,
        type: { in: ["PRODUCTION", "PROTOTYPE"] },
        status: {
          notIn: ["COMPLETED", "CANCELLED", "CLOSED", "SCRAPPED"],
        },
      },
      select: { quantity: true, quantityCompleted: true },
    }),
    prisma.purchaseOrderLine.findMany({
      where: {
        partId,
        purchaseOrder: {
          status: {
            in: [
              "APPROVED",
              "ISSUED",
              "ACKNOWLEDGED",
              "PARTIAL_RECEIPT",
            ],
          },
        },
      },
      select: { quantity: true, quantityReceived: true },
    }),
  ]);
  const openWoQty = openWos.reduce(
    (s, w) => s + Math.max(0, w.quantity - (w.quantityCompleted || 0)),
    0
  );
  const openPoQty = poLines.reduce(
    (s, l) => s + Math.max(0, l.quantity - (l.quantityReceived || 0)),
    0
  );
  return {
    onHand,
    openWoQty,
    openPoQty,
    total: onHand + openWoQty + openPoQty,
  };
}

/**
 * Net forecast demand against stock + open WO + open PO supply,
 * explode BUILD BOMs (with scrap) for component needs, create MRS-#####.
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
      materialRequisitions: {
        where: { status: { in: ["DRAFT", "RELEASED", "IN_PROGRESS"] } },
        select: { id: true, number: true, status: true },
      },
    },
  });
  if (!forecast) throw new Error("Forecast not found");
  if (forecast.status === "CANCELLED" || forecast.status === "CLOSED") {
    throw new Error(`Forecast is ${forecast.status} — reopen before generating MRS`);
  }

  type MrsLineDraft = {
    partId: string;
    requiredQty: number;
    onHandQty: number;
    shortQty: number;
    action: string;
    parentPartId?: string | null;
    level: number;
    notes?: string;
    dueDate?: Date | null;
  };

  const drafts: MrsLineDraft[] = [];
  const MAX_DEPTH = 10;
  // Supply is netted across the whole run: once a demand line consumes
  // available supply, later lines for the same part see only what's left.
  const supplyCache = new Map<
    string,
    { onHand: number; openWoQty: number; openPoQty: number; total: number }
  >();
  const allocated = new Map<string, number>();

  async function supplyFor(partId: string) {
    if (!supplyCache.has(partId)) {
      supplyCache.set(partId, await getPartSupplySnapshot(partId));
    }
    return supplyCache.get(partId)!;
  }

  /**
   * Recursively net demand against on-hand + open WO + open PO.
   * Shortfalls on buildable parts explode certified BOMs (scrap applied).
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
    const snap = await supplyFor(partId);
    const used = allocated.get(partId) || 0;
    const available = Math.max(0, snap.total - used);
    const take = Math.min(available, qtyNeeded);
    allocated.set(partId, used + take);
    const short = Math.max(0, qtyNeeded - available);
    // Report on-hand column as full supply snapshot (for planner visibility)
    const onHandDisplay = snap.total;

    if (short <= 0) {
      drafts.push({
        partId,
        requiredQty: qtyNeeded,
        onHandQty: onHandDisplay,
        shortQty: 0,
        action: "STOCK",
        parentPartId,
        level,
        notes:
          level === 0
            ? `Forecast ${qtyNeeded} covered by supply (stock ${snap.onHand} + WO ${snap.openWoQty} + PO ${snap.openPoQty})`
            : `Component covered (stock ${snap.onHand} + WO ${snap.openWoQty} + PO ${snap.openPoQty})`,
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
        onHandQty: onHandDisplay,
        shortQty: short,
        action: "BUY",
        parentPartId,
        level,
        notes:
          level === 0
            ? `Buy ${short} (need ${qtyNeeded}; stock ${snap.onHand}, open WO ${snap.openWoQty}, open PO ${snap.openPoQty})`
            : `Purchase short L${level}: buy ${short} (supply stock ${snap.onHand} / WO ${snap.openWoQty} / PO ${snap.openPoQty})`,
      });
      return;
    }

    drafts.push({
      partId,
      requiredQty: qtyNeeded,
      onHandQty: onHandDisplay,
      shortQty: short,
      action: "BUILD",
      parentPartId,
      level,
      notes:
        level === 0
          ? `Build ${short} of ${partNumber} (need ${qtyNeeded}; stock ${snap.onHand}, WO ${snap.openWoQty}, PO ${snap.openPoQty})`
          : `Sub-assembly build ${short} L${level} (supply stock ${snap.onHand} / WO ${snap.openWoQty} / PO ${snap.openPoQty})`,
    });

    if (level >= MAX_DEPTH) return;

    for (const bl of certifiedBom.lines) {
      if (chain.has(bl.componentPartId)) continue; // cycle guard
      const nextChain = new Set(chain);
      nextChain.add(partId);
      const scrap = bl.scrapFactor || 0;
      const childQty = bl.quantity * short * (1 + scrap);
      await explode(
        bl.componentPartId,
        bl.componentPart.partNumber,
        bl.componentPart.sourcingMethod,
        childQty,
        partId,
        level + 1,
        nextChain
      );
    }
  }

  for (const fl of forecast.lines) {
    const before = drafts.length;
    await explode(
      fl.partId,
      fl.part.partNumber,
      fl.part.sourcingMethod,
      fl.quantity,
      null,
      0,
      new Set([fl.partId])
    );
    // Stamp top-level demand need-by onto new drafts for this line
    const needBy = fl.dueDate || forecast.periodEnd || null;
    if (needBy) {
      for (let i = before; i < drafts.length; i++) {
        if (drafts[i].level === 0 && drafts[i].partId === fl.partId) {
          drafts[i].dueDate = needBy;
        }
      }
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
    existing.level = Math.min(existing.level, d.level);
    if ((actionRank[d.action] ?? 9) < (actionRank[existing.action] ?? 9)) {
      existing.action = d.action;
    }
  }

  const number = await nextNumber("MRS", "mrs");
  const openSheets = forecast.materialRequisitions || [];
  const mrs = await prisma.materialRequisition.create({
    data: {
      number,
      status: "DRAFT",
      forecastId: forecast.id,
      name:
        params.name ||
        `MRS from ${forecast.number} — ${forecast.name}`,
      notes: [
        `Generated from forecast ${forecast.number} as of ${new Date().toISOString()}.`,
        `Supply netting: on-hand + open production WO remaining + open PO remaining.`,
        `BOM explode applies scrap factor.`,
        openSheets.length
          ? `Note: ${openSheets.length} open MRS already exist (${openSheets.map((m) => m.number).join(", ")}).`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
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
          dueDate: d.dueDate || null,
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
 * Release MRS: create MWO- work orders for BUILD lines (shortQty > 0) with
 * parent/child pegging + working-calendar dates, and one PR for BUY shorts
 * with lead-time–aware neededBy.
 */
export async function releaseMaterialRequisition(params: {
  materialRequisitionId: string;
  userId?: string;
  workCenter?: string;
}) {
  const settings = await getPlanningSettings();
  const mrs = await prisma.materialRequisition.findUnique({
    where: { id: params.materialRequisitionId },
    include: {
      lines: { include: { part: true } },
      workOrders: true,
      forecast: { include: { lines: true } },
    },
  });
  if (!mrs) throw new Error("Material requisition not found");
  if (mrs.status === "CANCELLED") throw new Error("MRS is cancelled");

  const defaultWc =
    params.workCenter ||
    (
      await prisma.workCenter.findFirst({
        where: { isActive: true, area: "MANUFACTURING", isDefault: true },
        select: { code: true },
      })
    )?.code ||
    (
      await prisma.workCenter.findFirst({
        where: { isActive: true, area: "MANUFACTURING" },
        orderBy: { sortOrder: "asc" },
        select: { code: true },
      })
    )?.code ||
    "ASM-01";

  const buildLines = mrs.lines
    .filter((l) => l.action === "BUILD" && l.shortQty > 0 && !l.workOrderId)
    // Parents (level 0) first so children can peg to plannedStart
    .sort((a, b) => a.level - b.level || a.part.partNumber.localeCompare(b.part.partNumber));

  const created: {
    woId: string;
    number: string;
    partNumber: string;
    level: number;
  }[] = [];
  /** partId → { woId, plannedStart, plannedEnd } for pegging */
  const partWo = new Map<
    string,
    { woId: string; plannedStart: Date | null; plannedEnd: Date | null }
  >();

  for (const line of buildLines) {
    const bom = await prisma.bomHeader.findFirst({
      where: { partId: line.partId, status: "CERTIFIED" },
      orderBy: { revision: "desc" },
    });
    if (!bom) {
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

    // Resolve due date: line override → forecast FG line → periodEnd → parent-derived
    let dueDate: Date | null = line.dueDate || null;
    let parentWorkOrderId: string | undefined;
    let scheduleOffsetMinutes: number | undefined =
      line.scheduleOffsetMinutes ?? undefined;

    if (line.parentPartId) {
      const parent = partWo.get(line.parentPartId);
      if (parent?.woId) parentWorkOrderId = parent.woId;
      if (parent?.plannedStart) {
        // Estimate child process time for default offset if planner didn't set one
        const linked = await prisma.workInstruction.findMany({
          where: { partId: line.partId, status: "RELEASED" },
          orderBy: { revision: "desc" },
          take: 1,
          select: { id: true },
        });
        const childEst = await estimateMinutesForWorkInstructions(
          linked.map((w) => w.id),
          line.shortQty
        );
        const offset =
          scheduleOffsetMinutes ??
          defaultChildOffsetMinutes(
            childEst.estimatedMinutes,
            settings.stagingBufferMinutes
          );
        scheduleOffsetMinutes = offset;
        const { ctx } = await buildCalendarContext({
          workCenter: defaultWc,
        });
        dueDate = subtractWorkingMinutes(parent.plannedStart, offset, ctx);
      }
    }

    if (!dueDate && mrs.forecast) {
      const fl = mrs.forecast.lines.find((f) => f.partId === line.partId);
      dueDate = fl?.dueDate || mrs.forecast.periodEnd || null;
    }
    if (!dueDate && mrs.forecast?.periodEnd) {
      dueDate = mrs.forecast.periodEnd;
    }

    const wo = await createWorkOrder({
      type: "PRODUCTION",
      sourceType: "MATERIAL_REQ",
      materialRequisitionId: mrs.id,
      bomHeaderId: bom.id,
      partId: line.partId,
      quantity: line.shortQty,
      createdById: params.userId,
      workCenter: defaultWc,
      dueDate: dueDate || undefined,
      scheduleMode: dueDate ? "BACK" : "FORWARD",
      parentWorkOrderId,
      scheduleOffsetMinutes,
      description: `Forecast build via ${mrs.number} — ${line.part.partNumber}`,
      travelerNotes: [
        "DIGITAL TRAVELER",
        `Source: Material requisition ${mrs.number}`,
        `MRS line action: BUILD qty ${line.shortQty}`,
        dueDate
          ? `Need by: ${dueDate.toISOString().slice(0, 10)}`
          : "Need by: (forward from today)",
        parentWorkOrderId ? `Peg parent WO: ${parentWorkOrderId}` : null,
        scheduleOffsetMinutes != null
          ? `Finish before parent by ${scheduleOffsetMinutes} working min`
          : null,
        "Contains: BOM, Work Instructions, Kit list, sign-offs, material trace",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    await prisma.materialRequisitionLine.update({
      where: { id: line.id },
      data: {
        workOrderId: wo.id,
        scheduleOffsetMinutes: scheduleOffsetMinutes ?? line.scheduleOffsetMinutes,
        dueDate: dueDate || line.dueDate,
      },
    });

    partWo.set(line.partId, {
      woId: wo.id,
      plannedStart: wo.plannedStart,
      plannedEnd: wo.plannedEnd,
    });

    created.push({
      woId: wo.id,
      number: wo.number,
      partNumber: line.part.partNumber,
      level: line.level,
    });
  }

  // ── BUY lines → one PR; neededBy from earliest consuming build start / lead ──
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

    // Earliest parent build plannedStart among parents of buy lines
    let earliestNeed = mrs.forecast?.periodEnd || addDays(new Date(), settings.defaultBuyLeadDays);
    for (const bl of buyLines) {
      if (bl.parentPartId && partWo.get(bl.parentPartId)?.plannedStart) {
        const ps = partWo.get(bl.parentPartId)!.plannedStart!;
        if (ps < earliestNeed) earliestNeed = ps;
      } else if (bl.dueDate && bl.dueDate < earliestNeed) {
        earliestNeed = bl.dueDate;
      }
    }
    // Use max lead across buy lines so PR isn't unrealistically tight
    let maxLead = settings.defaultBuyLeadDays;
    for (const bl of buyLines) {
      const lead = await resolveBuyLeadDays(bl.partId);
      if (lead > maxLead) maxLead = lead;
    }
    const neededBy = neededByFromLead(earliestNeed, maxLead);

    const pr = await prisma.purchaseRequest.create({
      data: {
        number: prNumber,
        status: "SUBMITTED",
        requestedById: params.userId || null,
        department: "Planning",
        neededBy,
        justification: `Buy demand from material requisition ${mrs.number}${mrs.name ? ` — ${mrs.name}` : ""} (lead ≤ ${maxLead}d)`,
        totalEstimate,
        supplierId: preferred?.id,
        triggerSource: "MATERIAL_REQ",
        materialRequisitionId: mrs.id,
        lines: {
          create: await Promise.all(
            buyLines.map(async (l) => {
              const lead = await resolveBuyLeadDays(l.partId);
              return {
                partId: l.partId,
                description: `${l.part.partNumber} — ${l.part.description}`,
                quantity: l.shortQty,
                estimatedUnitCost: l.part.standardCost || l.part.lastBuyCost || 0,
                uom: l.part.uom,
                notes: `MRS ${mrs.number} shortfall (need ${l.requiredQty}, on-hand ${l.onHandQty}); lead ${lead}d`,
              };
            })
          ),
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
 *  point. Blocked once the line is released to a WO or PR (except offset/due). */
export async function updateMrsLine(params: {
  lineId: string;
  requiredQty?: number;
  action?: string;
  notes?: string | null;
  dueDate?: Date | null;
  scheduleOffsetMinutes?: number | null;
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
  const released = !!(line.workOrderId || line.purchaseRequestId);
  // Qty/action locked after release; schedule offset & due remain editable
  if (
    released &&
    (params.requiredQty !== undefined || params.action !== undefined)
  ) {
    throw new Error(
      "Line already released to a work order / purchase request — adjust qty/action there"
    );
  }
  const requiredQty =
    !released &&
    params.requiredQty !== undefined &&
    params.requiredQty >= 0
      ? params.requiredQty
      : line.requiredQty;
  const action =
    !released &&
    params.action &&
    ["BUILD", "BUY", "STOCK", "NONE"].includes(params.action)
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
      ...(params.dueDate !== undefined ? { dueDate: params.dueDate } : {}),
      ...(params.scheduleOffsetMinutes !== undefined
        ? { scheduleOffsetMinutes: params.scheduleOffsetMinutes }
        : {}),
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
      dueDate: params.dueDate,
      scheduleOffsetMinutes: params.scheduleOffsetMinutes,
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

// ── Forecast lifecycle ─────────────────────────────────────────────────────

export async function updateForecast(params: {
  forecastId: string;
  name?: string;
  notes?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  status?: string;
  userId?: string;
}) {
  const existing = await prisma.forecast.findUnique({
    where: { id: params.forecastId },
  });
  if (!existing) throw new Error("Forecast not found");
  if (existing.status === "CANCELLED" && params.status !== "ACTIVE" && params.status !== "DRAFT") {
    throw new Error("Forecast is cancelled");
  }
  const status =
    params.status &&
    ["DRAFT", "ACTIVE", "CLOSED", "CANCELLED"].includes(params.status)
      ? params.status
      : undefined;
  const updated = await prisma.forecast.update({
    where: { id: params.forecastId },
    data: {
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
      ...(params.periodStart !== undefined
        ? { periodStart: params.periodStart }
        : {}),
      ...(params.periodEnd !== undefined ? { periodEnd: params.periodEnd } : {}),
      ...(status ? { status } : {}),
    },
  });
  await logAudit({
    entityType: "Forecast",
    entityId: updated.id,
    action: "UPDATED",
    userId: params.userId,
    metadata: { status: updated.status },
  });
  return updated;
}

export async function upsertForecastLine(params: {
  forecastId: string;
  lineId?: string;
  partId: string;
  quantity: number;
  dueDate?: Date | null;
  notes?: string | null;
  userId?: string;
}) {
  const forecast = await prisma.forecast.findUnique({
    where: { id: params.forecastId },
  });
  if (!forecast) throw new Error("Forecast not found");
  if (["CLOSED", "CANCELLED"].includes(forecast.status)) {
    throw new Error("Forecast is closed/cancelled — reopen to edit lines");
  }
  if (!(params.quantity > 0)) throw new Error("Quantity must be > 0");
  if (params.lineId) {
    return prisma.forecastLine.update({
      where: { id: params.lineId },
      data: {
        partId: params.partId,
        quantity: params.quantity,
        dueDate: params.dueDate ?? null,
        notes: params.notes ?? null,
      },
    });
  }
  return prisma.forecastLine.create({
    data: {
      forecastId: params.forecastId,
      partId: params.partId,
      quantity: params.quantity,
      dueDate: params.dueDate ?? null,
      notes: params.notes ?? null,
    },
  });
}

export async function removeForecastLine(params: {
  lineId: string;
  userId?: string;
}) {
  const line = await prisma.forecastLine.findUnique({
    where: { id: params.lineId },
    include: { forecast: true, part: true },
  });
  if (!line) throw new Error("Line not found");
  if (["CLOSED", "CANCELLED"].includes(line.forecast.status)) {
    throw new Error("Forecast is closed/cancelled");
  }
  await prisma.forecastLine.delete({ where: { id: line.id } });
  await logAudit({
    entityType: "Forecast",
    entityId: line.forecastId,
    action: "LINE_REMOVED",
    userId: params.userId,
    metadata: { partNumber: line.part.partNumber },
  });
}

// ── CTP-lite (capable to promise) ──────────────────────────────────────────

export type CtpVerdict = "OK" | "TIGHT" | "MISS" | "STOCK" | "NO_BOM";

export type CtpLineResult = {
  lineId: string;
  partNumber: string | null;
  quantity: number;
  makeQty: number;
  estimatedMinutes: number;
  dueDate: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  freeHoursInWindow: number;
  loadHoursNeeded: number;
  verdict: CtpVerdict;
  message: string;
};

/**
 * Rough capable-to-promise: for each SO line, compare process hours needed
 * against free staffed capacity in the back-scheduled window. Does not reserve.
 */
export async function assessCapableToPromise(salesOrderId: string): Promise<{
  salesOrderId: string;
  overall: CtpVerdict;
  suggestedShipDate: string | null;
  lines: CtpLineResult[];
  notes: string;
}> {
  const so = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: {
      lines: { include: { part: true } },
    },
  });
  if (!so) throw new Error("Sales order not found");

  const { getCapacityAndWorkload } = await import("@/lib/services/capacity");
  const {
    estimateMinutesForWorkInstructions,
    backSchedule,
    forwardSchedule,
  } = await import("@/lib/services/schedule");

  const results: CtpLineResult[] = [];
  let worst: CtpVerdict = "OK";
  let latestEnd: Date | null = null;

  const rank = (v: CtpVerdict) =>
    ({ STOCK: 0, OK: 1, TIGHT: 2, MISS: 3, NO_BOM: 3 }[v] ?? 1);

  for (const line of so.lines) {
    if (!line.partId) continue;
    const remaining = Math.max(0, line.quantity - (line.quantityAllocated || 0));
    if (remaining <= 0 || ["READY", "SHIPPED"].includes(line.fulfillmentStatus)) {
      results.push({
        lineId: line.id,
        partNumber: line.part?.partNumber || null,
        quantity: line.quantity,
        makeQty: 0,
        estimatedMinutes: 0,
        dueDate: so.requiredDate?.toISOString() || null,
        plannedStart: null,
        plannedEnd: null,
        freeHoursInWindow: 0,
        loadHoursNeeded: 0,
        verdict: "STOCK",
        message: "Covered by allocation / ready",
      });
      continue;
    }

    const available = await getAvailableQty(line.partId);
    const makeQty = Math.max(0, remaining - available);
    if (makeQty <= 0) {
      results.push({
        lineId: line.id,
        partNumber: line.part?.partNumber || null,
        quantity: line.quantity,
        makeQty: 0,
        estimatedMinutes: 0,
        dueDate: so.requiredDate?.toISOString() || null,
        plannedStart: null,
        plannedEnd: null,
        freeHoursInWindow: 0,
        loadHoursNeeded: 0,
        verdict: "STOCK",
        message: `On-hand covers remaining ${remaining}`,
      });
      continue;
    }

    const bom = await prisma.bomHeader.findFirst({
      where: { partId: line.partId, status: "CERTIFIED" },
      orderBy: { revision: "desc" },
    });
    if (!bom && line.part?.sourcingMethod !== "PURCHASE") {
      results.push({
        lineId: line.id,
        partNumber: line.part?.partNumber || null,
        quantity: line.quantity,
        makeQty,
        estimatedMinutes: 0,
        dueDate: so.requiredDate?.toISOString() || null,
        plannedStart: null,
        plannedEnd: null,
        freeHoursInWindow: 0,
        loadHoursNeeded: 0,
        verdict: "NO_BOM",
        message: "No certified BOM — cannot CTP make path",
      });
      if (rank("NO_BOM") > rank(worst)) worst = "NO_BOM";
      continue;
    }

    const wis = await prisma.workInstruction.findMany({
      where: { partId: line.partId, status: "RELEASED" },
      orderBy: { revision: "desc" },
      take: 1,
      select: { id: true },
    });
    const est = await estimateMinutesForWorkInstructions(
      wis.map((w) => w.id),
      makeQty
    );
    const due = so.requiredDate || new Date();
    const sched = await backSchedule({
      dueDate: due,
      estimatedMinutes: est.estimatedMinutes,
      workCenter: "ASM-01",
    });

    // Free capacity in planned window: available plant hours for week(s) covering window
    const cap = await getCapacityAndWorkload(sched.plannedStart, {
      horizonStart: sched.plannedStart,
      horizonEnd: sched.plannedEnd,
    });
    const free = Math.max(
      0,
      cap.totals.availableHours - cap.totals.projectedHours
    );
    const needH = est.estimatedMinutes / 60;
    let verdict: CtpVerdict = "OK";
    let message = `~${needH.toFixed(1)}h process; ~${free.toFixed(1)}h free in window`;
    if (needH > free * 1.0) {
      verdict = "MISS";
      message = `Needs ${needH.toFixed(1)}h but only ~${free.toFixed(1)}h free before ${due.toISOString().slice(0, 10)}`;
    } else if (needH > free * 0.85 || free < needH + 4) {
      verdict = "TIGHT";
      message = `Tight: needs ${needH.toFixed(1)}h of ~${free.toFixed(1)}h free`;
    }

    // Suggested finish if miss: forward from today
    if (verdict === "MISS") {
      const fwd = await forwardSchedule({
        startDate: new Date(),
        estimatedMinutes: est.estimatedMinutes,
        dueDate: due,
        workCenter: "ASM-01",
      });
      if (!latestEnd || fwd.plannedEnd > latestEnd) latestEnd = fwd.plannedEnd;
      message += ` · earliest finish ~${fwd.plannedEnd.toISOString().slice(0, 10)}`;
    } else if (!latestEnd || sched.plannedEnd > latestEnd) {
      latestEnd = sched.plannedEnd;
    }

    if (rank(verdict) > rank(worst)) worst = verdict;

    results.push({
      lineId: line.id,
      partNumber: line.part?.partNumber || null,
      quantity: line.quantity,
      makeQty,
      estimatedMinutes: est.estimatedMinutes,
      dueDate: due.toISOString(),
      plannedStart: sched.plannedStart.toISOString(),
      plannedEnd: sched.plannedEnd.toISOString(),
      freeHoursInWindow: Math.round(free * 10) / 10,
      loadHoursNeeded: Math.round(needH * 10) / 10,
      verdict,
      message,
    });
  }

  if (results.every((r) => r.verdict === "STOCK")) worst = "STOCK";

  return {
    salesOrderId,
    overall: worst,
    suggestedShipDate: latestEnd ? latestEnd.toISOString().slice(0, 10) : null,
    lines: results,
    notes:
      "Rough-cut CTP — does not reserve capacity or check multi-station routing. Plan fulfillment still required.",
  };
}
