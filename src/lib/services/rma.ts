/**
 * RMA — customer returns with warranty evaluation, chargeable repair quotes,
 * and repair work orders (no sales order step).
 */
import { Prisma } from "@prisma/client";
import { prisma, currentRequestSchema, isValidSchemaName } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  evaluateWarranty,
  findSerial,
  ensureWorkOrderUnits,
} from "@/lib/services/serials";
import { createWorkOrder } from "@/lib/services/work-orders";

const TERMINAL_RMA = ["COMPLETE", "COMPLETED", "CLOSED", "SHIPPED", "CANCELLED"];
function assertOpenRma(rma: { status: string }) {
  if (TERMINAL_RMA.includes(rma.status)) throw new Error(`Cannot change repair quote while RMA is ${rma.status}`);
}
function repairMoney(value: number) {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100))) throw new Error("Repair quote total must be finite, nonnegative and safely representable in cents");
  return Math.round(value * 100) / 100;
}
function validateRepairLines(lines: { description: string; quantity: number; unitPrice: number }[]) {
  if (!lines.length || lines.some(l => !l.description?.trim() || !Number.isFinite(l.quantity) || l.quantity <= 0 || !Number.isFinite(l.unitPrice) || !Number.isFinite(l.quantity * l.unitPrice))) throw new Error("Repair quote lines require descriptions, positive finite quantities and finite prices");
  return repairMoney(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
}
async function withRepairQuoteLock<T>(rmaId: string, work: (db: Prisma.TransactionClient, quoteTable: Prisma.Sql) => Promise<T>) {
  const schema = await currentRequestSchema();
  if (!isValidSchemaName(schema)) throw new Error("Invalid RMA schema");
  const rmaTable = Prisma.raw(`"${schema}"."Rma"`), quoteTable = Prisma.raw(`"${schema}"."Quote"`), linesTable = Prisma.raw(`"${schema}"."QuoteLine"`);
  return prisma.$transaction(async db => {
    await db.$queryRaw(Prisma.sql`SELECT id FROM ${rmaTable} WHERE id = ${rmaId} FOR UPDATE`);
    const identity = await db.rma.findUniqueOrThrow({ where: { id: rmaId }, select: { quoteId: true } });
    if (identity.quoteId) {
      await db.$queryRaw(Prisma.sql`SELECT id FROM ${quoteTable} WHERE id = ${identity.quoteId} FOR UPDATE`);
      await db.$queryRaw(Prisma.sql`SELECT id FROM ${linesTable} WHERE "quoteId" = ${identity.quoteId} ORDER BY id FOR UPDATE`);
    }
    return work(db, quoteTable);
  });
}

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

async function nextQuoteNumber(db: Prisma.TransactionClient = prisma): Promise<string> {
  const rows = await db.quote.findMany({
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
  assertOpenRma(rma);
  if (["QUOTE_ACCEPTED", "IN_WORK", "MRB_HOLD"].includes(rma.status)) throw new Error("RMA is already authorized/in repair; cannot reissue evaluation");

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
  return withRepairQuoteLock(params.rmaId, async (db, quoteTable) => {
    const rma = await db.rma.findUnique({
      where: { id: params.rmaId },
      include: { customer: true, topPart: true, quote: { include: { lines: true } } },
    });
    if (!rma) throw new Error("RMA not found");
    assertOpenRma(rma);
    if (rma.quote) {
      if (rma.quote.quoteType !== "REPAIR" || rma.quote.customerId !== rma.customerId) throw new Error("Linked repair quote identity is inconsistent");
      return rma.quote;
    }
    if (!["REQUESTED", "EVALUATING", "QUOTE_PENDING", "QUOTE_SENT"].includes(rma.status)) throw new Error("Cannot create a new quote after repair authorization/work");

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

    const total = validateRepairLines(lines);
    await db.$executeRaw(Prisma.sql`LOCK TABLE ${quoteTable} IN SHARE ROW EXCLUSIVE MODE`);
    const number = await nextQuoteNumber(db);

    const quote = await db.quote.create({
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

    await db.rma.update({
      where: { id: rma.id },
      data: {
        quoteId: quote.id,
        quotedPrice: total,
        status: "QUOTE_PENDING",
      },
    });

    await logAudit({ entityType: "Rma", entityId: rma.id, action: "REPAIR_QUOTE_CREATED", userId: params.userId, metadata: { quoteId: quote.id, total } }, db);
    return quote;
  });
}

/** Accept repair quote → create repair WO (no sales order). */
export async function acceptRepairQuote(params: {
  quoteId: string;
  userId?: string;
}) {
  const identity = await prisma.quote.findUniqueOrThrow({ where: { id: params.quoteId }, include: { rma: true } });
  const rmaId = identity.rma?.id;
  if (identity.quoteType !== "REPAIR" || !rmaId) throw new Error("Not a repair quote — use convert to sales order for standard quotes");
  const prepared = await withRepairQuoteLock(rmaId, async db => {
    const quote = await db.quote.findUniqueOrThrow({ where: { id: params.quoteId }, include: { rma: true, lines: true } });
    if (quote.rma?.id !== rmaId || quote.quoteType !== "REPAIR" || quote.customerId !== quote.rma.customerId) throw new Error("Linked repair quote identity is inconsistent");
    assertOpenRma(quote.rma);
    if (!["DRAFT", "SENT", "ACCEPTED"].includes(quote.status)) throw new Error("Repair quote cannot be accepted in its current status");
    if (validateRepairLines(quote.lines) !== repairMoney(quote.totalAmount)) throw new Error("Repair quote lines do not reconcile to the header total");
    const existingRepair = await db.workOrder.findFirst({ where: { rmaId, quoteId: quote.id }, orderBy: { createdAt: "desc" } });
    if (quote.status === "ACCEPTED" && existingRepair) {
      if (existingRepair.status === "CANCELLED") throw new Error("Repair work was cancelled; controlled reauthorization is required");
      return { quote, workOrder: existingRepair };
    }
    if (["IN_WORK", "MRB_HOLD"].includes(quote.rma.status)) throw new Error("RMA is already in repair; reconcile its existing work before accepting again");
    await db.quote.update({ where: { id: quote.id }, data: { status: "ACCEPTED" } });
    await db.rma.update({ where: { id: rmaId }, data: { status: "QUOTE_ACCEPTED", quotedPrice: quote.totalAmount, finalPrice: quote.totalAmount } });
    await logAudit({ entityType: "Rma", entityId: rmaId, action: "REPAIR_QUOTE_ACCEPTED", userId: params.userId, metadata: { quoteId: quote.id, total: quote.totalAmount } }, db);
    return { quote, workOrder: null };
  });
  if (prepared.workOrder) return prepared;
  // Scheduler/WO creation is an existing separate workflow; not a distributed transaction.
  const workOrder = await createRepairWorkOrderFromRma({ rmaId, quoteId: params.quoteId, userId: params.userId });
  const quote = await prisma.quote.findUniqueOrThrow({ where: { id: params.quoteId }, include: { rma: true, lines: true } });
  return { quote, workOrder };
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
  assertOpenRma(rma);
  if (params.quoteId && params.quoteId !== rma.quoteId) throw new Error("Repair quote does not belong to this RMA");

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
    where: { id: rma.id, status: { notIn: TERMINAL_RMA } },
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
  return withRepairQuoteLock(params.rmaId, async db => {
    const rma = await db.rma.findUnique({
      where: { id: params.rmaId },
      include: { quote: true },
    });
    if (!rma) throw new Error("RMA not found");
    if (!rma.quoteId || !rma.quote) throw new Error("No quote on this RMA");
    assertOpenRma(rma);
    if (rma.quote.quoteType !== "REPAIR" || rma.quote.customerId !== rma.customerId) throw new Error("Linked repair quote identity is inconsistent");
    if (rma.quote.status === "CONVERTED") {
      throw new Error("Quote already converted — cannot edit");
    }

    const lines = params.lines.map(l => ({ ...l, description: l.description?.trim() || "", partId: l.partId || null }));
    const total = validateRepairLines(lines);

    await db.quoteLine.deleteMany({ where: { quoteId: rma.quoteId } });
    await db.quote.update({
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

    const updated = await db.rma.update({
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
    }, db);

    return updated;
  });
}

export async function adjustRmaQuotePrice(params: {
  rmaId: string;
  newTotal: number;
  reason: string;
  userId?: string;
}) {
  return withRepairQuoteLock(params.rmaId, async db => {
    const rma = await db.rma.findUnique({
      where: { id: params.rmaId },
      include: { quote: { include: { lines: { orderBy: [{ lineNumber: "asc" }, { id: "asc" }] } } } },
    });
    if (!rma) throw new Error("RMA not found");
    assertOpenRma(rma);
    if (!rma.quoteId || !rma.quote) throw new Error("No quote on this RMA");

    if (rma.quote.quoteType !== "REPAIR" || rma.quote.customerId !== rma.customerId || rma.quote.status === "CONVERTED") throw new Error("Linked repair quote identity/state is inconsistent");
    if (!params.reason?.trim()) throw new Error("Price adjustment reason is required");
    const newTotal = repairMoney(params.newTotal);
    const old = rma.quote.totalAmount;

    // Adjust last line or create adjustment line
    const lines = rma.quote.lines;
    if (lines.length) validateRepairLines(lines);
    if (lines.length) {
      const last = lines[lines.length - 1];
      const others = lines
        .slice(0, -1)
        .reduce((s, l) => s + l.quantity * l.unitPrice, 0);
      const adjUnit = (newTotal - others) / last.quantity;
      if (!Number.isFinite(adjUnit)) throw new Error("Adjusted unit price is not finite");
      await db.quoteLine.update({
        where: { id: last.id },
        data: {
          unitPrice: adjUnit,
          description:
            adjUnit === last.unitPrice
              ? last.description
              : `${last.description} (adj: ${params.reason})`,
        },
      });
    } else {
      await db.quoteLine.create({ data: { quoteId: rma.quoteId, description: `Repair price adjustment — ${params.reason.trim()}`, quantity: 1, unitPrice: newTotal, lineNumber: 1 } });
    }
    const actualLines = await db.quoteLine.findMany({ where: { quoteId: rma.quoteId } });
    if (validateRepairLines(actualLines) !== newTotal) throw new Error("Adjusted quote lines do not reconcile to the requested total");

    await db.quote.update({
      where: { id: rma.quoteId },
      data: { totalAmount: newTotal },
    });

    const updated = await db.rma.update({
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
      metadata: { old, newTotal, reason: params.reason.trim() },
    }, db);

    return updated;
  });
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
