/**
 * RMA — customer returns with warranty evaluation, chargeable repair quotes,
 * and repair work orders (no sales order step).
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  evaluateWarranty,
  findSerial,
  ensureWorkOrderUnits,
} from "@/lib/services/serials";
import { createWorkOrder } from "@/lib/services/work-orders";

async function nextRmaNumber(): Promise<string> {
  const rows = await prisma.rma.findMany({
    where: { number: { startsWith: "RMA-" } },
    select: { number: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.number.split("-").pop() || "0", 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `RMA-${String(max + 1).padStart(5, "0")}`;
}

async function nextQuoteNumber(): Promise<string> {
  const rows = await prisma.quote.findMany({
    where: { number: { startsWith: "QT-" } },
    select: { number: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.number.split("-").pop() || "0", 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `QT-${String(max + 1).padStart(5, "0")}`;
}

/** Lookup SN + part for RMA intake. */
export async function lookupForRma(params: {
  serial: string;
  partNumber?: string | null;
}) {
  const sn = await findSerial(params.serial);
  let part = sn?.part || null;
  if (!part && params.partNumber) {
    part = await prisma.part.findFirst({
      where: {
        OR: [
          { partNumber: params.partNumber.trim() },
          { partNumber: { equals: params.partNumber.trim() } },
        ],
      },
    });
  }
  if (sn && params.partNumber) {
    const pn = params.partNumber.trim().toUpperCase();
    if (sn.part.partNumber.toUpperCase() !== pn) {
      return {
        serial: sn,
        part: sn.part,
        mismatch: true,
        message: `Serial is part ${sn.part.partNumber}, customer reported ${params.partNumber}`,
        warranty: evaluateWarranty(sn, sn.part),
      };
    }
  }
  const warranty = sn
    ? evaluateWarranty(sn, sn.part)
    : {
        eligible: false,
        reason: "Serial not found in system — manual verification required",
        warrantyEnd: null as Date | null,
      };

  return {
    serial: sn,
    part: part || sn?.part || null,
    mismatch: false,
    message: sn ? null : "Serial not in registry",
    warranty,
  };
}

export async function createRmaRequest(params: {
  customerId: string;
  serial: string;
  partNumber?: string | null;
  partId?: string | null;
  symptom?: string | null;
  notes?: string | null;
  userId?: string;
}) {
  const lookup = await lookupForRma({
    serial: params.serial,
    partNumber: params.partNumber,
  });
  const partId = params.partId || lookup.part?.id;
  if (!partId) throw new Error("Part required — enter part number or known serial");

  const customer = await prisma.customer.findUnique({
    where: { id: params.customerId },
  });
  if (!customer) throw new Error("Customer not found");

  const serialFound = Boolean(lookup.serial);
  const autoNotes = [
    params.notes?.trim() || null,
    !serialFound
      ? "⚠ Serial not found in registry — created from customer-reported SN/PN; verify before issue."
      : null,
    lookup.mismatch ? lookup.message : null,
  ]
    .filter(Boolean)
    .join("\n");

  const number = await nextRmaNumber();
  const rma = await prisma.rma.create({
    data: {
      number,
      customerId: params.customerId,
      status: "EVALUATING",
      coverage: lookup.warranty.eligible ? "WARRANTY" : "CHARGEABLE",
      topSerialId: lookup.serial?.id || null,
      topPartId: partId,
      customerSn: params.serial.trim().toUpperCase(),
      customerPartNumber: params.partNumber?.trim() || lookup.part?.partNumber || null,
      symptom: params.symptom || null,
      notes: autoNotes || null,
      warrantyEligible: lookup.warranty.eligible,
      warrantyReason: lookup.warranty.reason,
      createdById: params.userId || null,
    },
    include: {
      customer: true,
      topPart: true,
      topSerial: true,
    },
  });

  await logAudit({
    entityType: "Rma",
    entityId: rma.id,
    action: "CREATED",
    userId: params.userId,
    metadata: {
      number,
      serial: rma.customerSn,
      serialFound,
      partId,
    },
  });

  return {
    rma,
    lookup,
    serialFound,
    warning: !serialFound
      ? "Serial not found in registry — verify customer SN before issuing"
      : lookup.mismatch
        ? lookup.message
        : null,
  };
}

/**
 * Issue RMA after evaluation.
 * WARRANTY / GOODWILL → create repair WO immediately.
 * CHARGEABLE → quote pending (create repair quote).
 */
export async function issueRma(params: {
  rmaId: string;
  coverage: "WARRANTY" | "CHARGEABLE" | "GOODWILL" | "MIXED";
  userId?: string;
  notes?: string | null;
}) {
  const rma = await prisma.rma.findUnique({
    where: { id: params.rmaId },
    include: { topPart: true, topSerial: true, customer: true },
  });
  if (!rma) throw new Error("RMA not found");
  if (["COMPLETE", "SHIPPED", "CANCELLED"].includes(rma.status)) {
    throw new Error(`Cannot issue RMA in status ${rma.status}`);
  }

  const coverage = params.coverage;
  const warrantyLike = coverage === "WARRANTY" || coverage === "GOODWILL";

  let updated = await prisma.rma.update({
    where: { id: rma.id },
    data: {
      coverage,
      warrantyEligible: warrantyLike,
      warrantyReason:
        params.notes ||
        (warrantyLike
          ? rma.warrantyReason || "Issued as warranty/goodwill"
          : rma.warrantyReason || "Chargeable repair"),
      status: warrantyLike ? "WARRANTY_APPROVED" : "QUOTE_PENDING",
      approvedAt: new Date(),
    },
  });

  await logAudit({
    entityType: "Rma",
    entityId: rma.id,
    action: "ISSUED",
    userId: params.userId,
    metadata: { coverage, status: updated.status },
  });

  // Warranty path: go straight to repair WO (user review comment)
  if (warrantyLike) {
    const wo = await createRepairWorkOrderFromRma({
      rmaId: rma.id,
      userId: params.userId,
    });
    updated = await prisma.rma.findUniqueOrThrow({
      where: { id: rma.id },
      include: {
        customer: true,
        topPart: true,
        topSerial: true,
        workOrders: true,
        quote: true,
      },
    });
    return { rma: updated, workOrder: wo, quote: null };
  }

  // Chargeable: create repair quote shell
  const quote = await createRepairQuoteForRma({
    rmaId: rma.id,
    userId: params.userId,
  });
  updated = await prisma.rma.findUniqueOrThrow({
    where: { id: rma.id },
    include: {
      customer: true,
      topPart: true,
      topSerial: true,
      workOrders: true,
      quote: { include: { lines: true } },
    },
  });
  return { rma: updated, workOrder: null, quote };
}

export async function createRepairQuoteForRma(params: {
  rmaId: string;
  lines?: { description: string; quantity: number; unitPrice: number; partId?: string }[];
  userId?: string;
}) {
  const rma = await prisma.rma.findUnique({
    where: { id: params.rmaId },
    include: { customer: true, topPart: true },
  });
  if (!rma) throw new Error("RMA not found");

  const lines =
    params.lines?.length
      ? params.lines
      : [
          {
            description: `Evaluation / repair — ${rma.topPart.partNumber} SN ${rma.customerSn}`,
            quantity: 1,
            unitPrice: 0,
            partId: rma.topPartId,
          },
        ];

  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const number = await nextQuoteNumber();

  const quote = await prisma.quote.create({
    data: {
      number,
      customerId: rma.customerId,
      status: "DRAFT",
      quoteType: "REPAIR",
      notes: `Repair quote for ${rma.number}`,
      totalAmount: total,
      lines: {
        create: lines.map((l, i) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          partId: l.partId || null,
          lineNumber: i + 1,
        })),
      },
    },
    include: { lines: true },
  });

  await prisma.rma.update({
    where: { id: rma.id },
    data: {
      quoteId: quote.id,
      quotedPrice: total,
      status: "QUOTE_PENDING",
    },
  });

  return quote;
}

/** Accept repair quote → create repair WO (no sales order). */
export async function acceptRepairQuote(params: {
  quoteId: string;
  userId?: string;
}) {
  const quote = await prisma.quote.findUnique({
    where: { id: params.quoteId },
    include: { rma: true, lines: true },
  });
  if (!quote) throw new Error("Quote not found");
  // FK lives on Rma.quoteId (reverse relation quote.rma)
  const rmaId = quote.rma?.id;
  if (quote.quoteType !== "REPAIR" || !rmaId) {
    throw new Error("Not a repair quote — use convert to sales order for standard quotes");
  }

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "ACCEPTED" },
  });
  await prisma.rma.update({
    where: { id: rmaId },
    data: {
      status: "QUOTE_ACCEPTED",
      quotedPrice: quote.totalAmount,
      finalPrice: quote.totalAmount,
    },
  });

  const wo = await createRepairWorkOrderFromRma({
    rmaId,
    quoteId: quote.id,
    userId: params.userId,
  });

  return { quote, workOrder: wo };
}

/**
 * Create REPAIR work order linked to RMA (+ optional quote).
 * Skips sales order entirely.
 */
export async function createRepairWorkOrderFromRma(params: {
  rmaId: string;
  quoteId?: string | null;
  userId?: string;
}) {
  const rma = await prisma.rma.findUnique({
    where: { id: params.rmaId },
    include: { topPart: true, workOrders: true },
  });
  if (!rma) throw new Error("RMA not found");

  const existing = rma.workOrders.find(
    (w) => !["COMPLETED", "CLOSED", "CANCELLED"].includes(w.status)
  );
  if (existing) return existing;

  const bom = await prisma.bomHeader.findFirst({
    where: {
      partId: rma.topPartId,
      status: { in: ["CERTIFIED", "PROTOTYPE", "IN_REVIEW"] },
    },
    orderBy: { revision: "desc" },
  });

  const wo = await createWorkOrder({
    type: "REPAIR",
    partId: rma.topPartId,
    bomHeaderId: bom?.id,
    quantity: 1,
    description: `RMA ${rma.number} repair — SN ${rma.customerSn}`,
    travelerNotes: [
      "RMA REPAIR TRAVELER",
      `RMA: ${rma.number}`,
      params.quoteId ? `Quote linked` : rma.coverage === "WARRANTY" ? "Coverage: WARRANTY" : null,
      `Customer SN: ${rma.customerSn}`,
      "Remove failed serialized components → MRB; install replacements; update as-built.",
    ]
      .filter(Boolean)
      .join("\n"),
    sourceType: "OTHER",
    status: "PLANNED",
    rmaId: rma.id,
    quoteId: params.quoteId || rma.quoteId || undefined,
    createdById: params.userId,
    priority: "HIGH",
  });

  // Bind returned serial to unit 1 if known
  await ensureWorkOrderUnits({ workOrderId: wo.id, quantity: 1 });
  if (rma.topSerialId) {
    await prisma.workOrderUnit.updateMany({
      where: { workOrderId: wo.id, unitIndex: 1 },
      data: { serialId: rma.topSerialId, status: "IN_BUILD" },
    });
    await prisma.serialNumber.update({
      where: { id: rma.topSerialId },
      data: { status: "RMA", workOrderId: wo.id },
    });
  }

  await prisma.rma.update({
    where: { id: rma.id },
    data: { status: "IN_WORK" },
  });

  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "CREATED_FROM_RMA",
    userId: params.userId,
    metadata: { rmaId: rma.id, rmaNumber: rma.number },
  });

  return wo;
}

/**
 * Replace / edit repair quote lines (labor, parts, evaluation fees).
 * Recalculates quote + RMA totals.
 */
export async function updateRepairQuote(params: {
  rmaId: string;
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    partId?: string | null;
  }[];
  notes?: string | null;
  userId?: string;
}) {
  const rma = await prisma.rma.findUnique({
    where: { id: params.rmaId },
    include: { quote: true },
  });
  if (!rma) throw new Error("RMA not found");
  if (!rma.quoteId || !rma.quote) throw new Error("No quote on this RMA");
  if (["SHIPPED", "CANCELLED", "COMPLETE"].includes(rma.status)) {
    throw new Error(`Cannot edit quote while RMA is ${rma.status}`);
  }
  if (rma.quote.status === "CONVERTED") {
    throw new Error("Quote already converted — cannot edit");
  }

  const lines = params.lines
    .map((l) => ({
      description: (l.description || "").trim(),
      quantity: Number(l.quantity) || 0,
      unitPrice: Number(l.unitPrice) || 0,
      partId: l.partId || null,
    }))
    .filter((l) => l.description && l.quantity > 0);

  if (!lines.length) throw new Error("At least one quote line is required");

  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  await prisma.quoteLine.deleteMany({ where: { quoteId: rma.quoteId } });
  await prisma.quote.update({
    where: { id: rma.quoteId },
    data: {
      totalAmount: total,
      notes:
        params.notes !== undefined
          ? params.notes
          : rma.quote.notes,
      status: rma.quote.status === "ACCEPTED" ? "ACCEPTED" : "DRAFT",
      lines: {
        create: lines.map((l, i) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          partId: l.partId,
          lineNumber: i + 1,
        })),
      },
    },
  });

  const updated = await prisma.rma.update({
    where: { id: rma.id },
    data: {
      quotedPrice: total,
      finalPrice: total,
      status:
        rma.status === "IN_WORK" || rma.status === "QUOTE_ACCEPTED"
          ? rma.status
          : "QUOTE_PENDING",
    },
    include: {
      quote: { include: { lines: true } },
      customer: true,
      topPart: true,
    },
  });

  await logAudit({
    entityType: "Quote",
    entityId: rma.quoteId,
    action: "REPAIR_QUOTE_UPDATED",
    userId: params.userId,
    metadata: { rmaId: rma.id, total, lineCount: lines.length },
  });

  return updated;
}

export async function adjustRmaQuotePrice(params: {
  rmaId: string;
  newTotal: number;
  reason: string;
  userId?: string;
}) {
  const rma = await prisma.rma.findUnique({
    where: { id: params.rmaId },
    include: { quote: { include: { lines: true } } },
  });
  if (!rma) throw new Error("RMA not found");
  if (["SHIPPED", "CANCELLED"].includes(rma.status)) {
    throw new Error("Cannot adjust price after ship/cancel");
  }
  if (!rma.quoteId || !rma.quote) throw new Error("No quote on this RMA");

  const newTotal = Math.max(0, params.newTotal);
  const old = rma.quote.totalAmount;

  // Adjust last line or create adjustment line
  const lines = rma.quote.lines;
  if (lines.length) {
    const last = lines[lines.length - 1];
    const others = lines
      .slice(0, -1)
      .reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const adjUnit = newTotal - others;
    await prisma.quoteLine.update({
      where: { id: last.id },
      data: {
        unitPrice: adjUnit,
        description:
          adjUnit === last.unitPrice
            ? last.description
            : `${last.description} (adj: ${params.reason})`,
      },
    });
  }

  await prisma.quote.update({
    where: { id: rma.quoteId },
    data: { totalAmount: newTotal },
  });

  const updated = await prisma.rma.update({
    where: { id: rma.id },
    data: {
      quotedPrice: newTotal,
      finalPrice: newTotal,
      priceAdjustmentNotes: [
        rma.priceAdjustmentNotes,
        `${new Date().toISOString().slice(0, 10)}: ${old} → ${newTotal} — ${params.reason}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    include: { quote: { include: { lines: true } } },
  });

  await logAudit({
    entityType: "Rma",
    entityId: rma.id,
    action: "PRICE_ADJUST",
    userId: params.userId,
    metadata: { old, newTotal, reason: params.reason },
  });

  return updated;
}

export async function listRmas(params?: { status?: string; take?: number }) {
  return prisma.rma.findMany({
    where: params?.status ? { status: params.status } : undefined,
    orderBy: { createdAt: "desc" },
    take: params?.take ?? 50,
    include: {
      customer: { select: { code: true, name: true } },
      topPart: { select: { partNumber: true, description: true } },
      topSerial: { select: { serial: true, status: true } },
      quote: { select: { id: true, number: true, status: true, totalAmount: true } },
      workOrders: { select: { id: true, number: true, status: true } },
    },
  });
}

export async function getRmaDetail(id: string) {
  return prisma.rma.findUnique({
    where: { id },
    include: {
      customer: true,
      topPart: true,
      topSerial: {
        include: {
          installsAsParent: {
            where: { status: { in: ["INSTALLED", "REMOVED"] } },
            include: {
              childPart: { select: { partNumber: true, description: true } },
              childSerial: true,
            },
            orderBy: { installedAt: "desc" },
          },
        },
      },
      quote: { include: { lines: true } },
      workOrders: true,
      mrbCases: true,
      serialInstalls: {
        include: {
          childPart: { select: { partNumber: true } },
          childSerial: true,
          parentSerial: true,
        },
        orderBy: { installedAt: "desc" },
      },
      lines: true,
    },
  });
}
