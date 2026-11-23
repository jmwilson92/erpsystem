/**
 * Manufacturing inventory subledger and the journals that keep it in
 * step with the general ledger: receipts (GR/IR), consumption, finished
 * goods output, close variances, COGS, and the accountant reports.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { postJournal } from "@/lib/services/gaap";
import {
  closeVariancePlan,
  finishedGoodsOutputEntry,
  purchaseMatchEntry,
  reliefUnitCost,
  resolveConsumptionTiming,
  roundMoney,
  type ConsumptionTiming,
} from "@/lib/services/posting-rules";
import {
  ensureAccountingDefaults,
  postDirectLabor,
  postInventoryAdjustment,
  postMaterialIssue,
  postScrap,
} from "@/lib/services/gl-posting";

type Db = Prisma.TransactionClient | typeof prisma;

const money = roundMoney;

export const MFG_ACCOUNT_DEFAULTS: {
  eventKey: string;
  label: string;
  debitCode: string;
  creditCode: string;
  notes: string;
}[] = [
  {
    eventKey: "PO_RECEIPT",
    label: "Purchase received into inventory",
    debitCode: "1200",
    creditCode: "2010",
    notes: "Capitalizes company-owned receipts. Credits the GR/IR clearing account.",
  },
  {
    eventKey: "AP_MATCH",
    label: "Supplier invoice matched to a receipt",
    debitCode: "2010",
    creditCode: "2000",
    notes: "Clears GR/IR and records the payable. Price difference goes to PPV.",
  },
  {
    eventKey: "PPV",
    label: "Purchase price variance",
    debitCode: "6221",
    creditCode: "2010",
    notes: "Used as the variance account on the invoice-match journal.",
  },
  {
    eventKey: "FG_OUTPUT",
    label: "Finished goods received from a job",
    debitCode: "1220",
    creditCode: "1210",
    notes: "Each output relieves WIP at standard or current cost. The job may stay open.",
  },
  {
    eventKey: "COGS",
    label: "Cost of goods sold on shipment",
    debitCode: "5000",
    creditCode: "1220",
    notes: "Relieves finished goods when a shipment leaves the dock.",
  },
  {
    eventKey: "UNISSUE",
    label: "Material returned from a job to stock",
    debitCode: "1200",
    creditCode: "1210",
    notes: "Reverses an issue. The original issue journal is left in place.",
  },
  {
    eventKey: "MATERIAL_USAGE_VAR",
    label: "Material usage variance",
    debitCode: "6230",
    creditCode: "1210",
    notes: "Issued material versus standard material in the quantity completed.",
  },
  {
    eventKey: "LABOR_RATE_VAR",
    label: "Labor rate variance",
    debitCode: "6240",
    creditCode: "1210",
    notes: "Actual labor dollars versus clocked hours at the standard rate.",
  },
  {
    eventKey: "LABOR_EFF_VAR",
    label: "Labor efficiency variance",
    debitCode: "6250",
    creditCode: "1210",
    notes: "Clocked hours versus allocated hours, at the standard rate.",
  },
  {
    eventKey: "OH_VAR",
    label: "Overhead variance",
    debitCode: "6260",
    creditCode: "1210",
    notes: "Absorbed shop overhead versus standard overhead on completed quantity.",
  },
  {
    eventKey: "WO_RESIDUAL",
    label: "Residual WIP at close",
    debitCode: "6200",
    creditCode: "1210",
    notes: "Any leftover WIP after the detailed variances, including fringe mix and rounding.",
  },
  {
    eventKey: "RMA_RETURN",
    label: "Customer return received to stock",
    debitCode: "1220",
    creditCode: "5000",
    notes: "Restores inventory and reduces cost of goods sold.",
  },
  {
    eventKey: "OSP_RECEIPT",
    label: "Outside processing received to a job",
    debitCode: "1210",
    creditCode: "2010",
    notes: "Subcontract work is charged to WIP, not raw materials.",
  },
];

export const MFG_EXTRA_ACCOUNTS = [
  { code: "2010", name: "Goods received / invoices received", type: "LIABILITY" },
  { code: "6220", name: "Inventory adjustment", type: "EXPENSE" },
  { code: "6221", name: "Purchase price variance", type: "EXPENSE" },
  { code: "6230", name: "Material usage variance", type: "EXPENSE" },
  { code: "6240", name: "Labor rate variance", type: "EXPENSE" },
  { code: "6250", name: "Labor efficiency variance", type: "EXPENSE" },
  { code: "6260", name: "Overhead variance", type: "EXPENSE" },
];

let mapsReady = false;

export async function ensureManufacturingAccountingDefaults() {
  await ensureAccountingDefaults();
  if (mapsReady) return;
  for (const spec of MFG_EXTRA_ACCOUNTS) {
    const existing = await prisma.account.findUnique({ where: { code: spec.code } });
    if (!existing) {
      await prisma.account.create({
        data: { code: spec.code, name: spec.name, type: spec.type },
      });
    }
  }
  for (const row of MFG_ACCOUNT_DEFAULTS) {
    await prisma.glAccountMap.upsert({
      where: { eventKey: row.eventKey },
      create: row,
      update: {},
    });
  }
  // Give inventory adjustments their own account on brands-new maps only.
  const adjust = await prisma.glAccountMap.findUnique({ where: { eventKey: "INV_ADJUST" } });
  if (!adjust) {
    await prisma.glAccountMap.create({
      data: {
        eventKey: "INV_ADJUST",
        label: "Inventory count difference",
        debitCode: "6220",
        creditCode: "1200",
        notes: "A shortage debits the adjustment account. A surplus swaps the sides.",
      },
    });
  }
  mapsReady = true;
}

export async function getInventoryAccountingSettings(db: Db = prisma) {
  await ensureManufacturingAccountingDefaults();
  const row = await db.accountingSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  return {
    costingMethod: (row.costingMethod || "STANDARD").toUpperCase(),
    consumptionTiming: resolveConsumptionTiming(null, row.consumptionTiming),
    useGrirClearing: row.useGrirClearing !== false,
    evaluatedReceiptSettlement: row.evaluatedReceiptSettlement !== false,
  };
}

async function accountByCode(code: string) {
  await ensureManufacturingAccountingDefaults();
  const found = await prisma.account.findUnique({ where: { code } });
  if (found) return found;
  return prisma.account.create({ data: { code, name: `Account ${code}`, type: "ASSET" } });
}

async function mappedCodes(eventKey: string) {
  await ensureManufacturingAccountingDefaults();
  const row =
    (await prisma.glAccountMap.findUnique({ where: { eventKey } })) ||
    MFG_ACCOUNT_DEFAULTS.find((d) => d.eventKey === eventKey);
  if (!row) throw new Error(`No account mapping for ${eventKey}`);
  return row;
}

export async function resolveItemAccounts(part?: {
  inventoryAccountId?: string | null;
  cogsAccountId?: string | null;
  itemStructure?: string | null;
  sourcingMethod?: string | null;
} | null) {
  const receipt = await mappedCodes("PO_RECEIPT");
  const output = await mappedCodes("FG_OUTPUT");
  const cogs = await mappedCodes("COGS");
  const isFinished =
    (part?.itemStructure || "").toUpperCase() === "TOP_LEVEL_ASSEMBLY" ||
    ((part?.sourcingMethod || "").toUpperCase() === "BUILD" &&
      (part?.itemStructure || "").toUpperCase() === "SUB_ASSEMBLY");
  const inventory = part?.inventoryAccountId
    ? await prisma.account.findUnique({ where: { id: part.inventoryAccountId } })
    : await accountByCode(isFinished ? output.debitCode : receipt.debitCode);
  const fg = part?.inventoryAccountId
    ? inventory
    : await accountByCode(output.debitCode);
  const cogsAcct = part?.cogsAccountId
    ? await prisma.account.findUnique({ where: { id: part.cogsAccountId } })
    : await accountByCode(cogs.debitCode);
  const wip = await accountByCode(output.creditCode);
  if (!inventory || !fg || !cogsAcct) {
    throw new Error("Inventory or COGS account is missing from the chart");
  }
  return { inventory, fg, wip, cogs: cogsAcct, receipt, output, cogsMap: cogs };
}

export async function consumptionTimingForPart(
  part?: { consumptionTiming?: string | null } | null,
  db: Db = prisma
): Promise<ConsumptionTiming> {
  const settings = await getInventoryAccountingSettings(db);
  return resolveConsumptionTiming(part?.consumptionTiming, settings.consumptionTiming);
}

async function woCharge(workOrderId?: string | null) {
  if (!workOrderId) return { workOrderId: null, projectId: null, programId: null };
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, projectId: true, project: { select: { programId: true } } },
  });
  return {
    workOrderId: wo?.id || workOrderId,
    projectId: wo?.projectId || null,
    programId: wo?.project?.programId || null,
  };
}

async function linkTransactionJournal(transactionId: string | null | undefined, journalId: string | null | undefined, db: Db = prisma) {
  if (!transactionId || !journalId) return;
  await db.materialTransaction.update({
    where: { id: transactionId },
    data: { journalEntryId: journalId },
  });
}

export async function postPurchaseReceipt(params: {
  receiptId: string;
  receiptNumber: string;
  purchaseOrderId: string;
  amount: number;
  governmentOwned?: boolean;
  workOrderId?: string | null;
  isOutsideProcessing?: boolean;
  inventoryAccountId?: string;
  userId?: string | null;
  memo?: string;
}) {
  const settings = await getInventoryAccountingSettings();
  if (params.governmentOwned) return null;
  const amount = money(params.amount);
  if (amount <= 0.001) return null;
  const eventKey = params.isOutsideProcessing ? "OSP_RECEIPT" : "PO_RECEIPT";
  const map = await mappedCodes(eventKey);
  const debit = params.inventoryAccountId
    ? await prisma.account.findUnique({ where: { id: params.inventoryAccountId } })
    : await accountByCode(map.debitCode);
  const creditCode = settings.useGrirClearing ? map.creditCode : "2000";
  const credit = await accountByCode(creditCode);
  if (!debit || !credit) throw new Error("Receipt accounts are missing from the chart");
  const charge = await woCharge(params.workOrderId);
  const journal = await postJournal({
    description: `Receipt ${params.receiptNumber} — inventory capitalization`,
    source: "AP",
    sourceId: params.receiptId,
    idempotencyKey: `po-receipt:${params.receiptId}`,
    createdById: params.userId || undefined,
    projectId: charge.projectId || undefined,
    programId: charge.programId || undefined,
    workOrderId: charge.workOrderId || undefined,
    status: "POSTED",
    lines: [
      { accountId: debit.id, debit: amount, memo: params.memo || params.receiptNumber },
      { accountId: credit.id, credit: amount, memo: params.receiptNumber },
    ],
  });
  return journal;
}

export async function matchSupplierInvoice(params: {
  sourceId: string;
  receiptValue: number;
  invoiceValue: number;
  userId?: string | null;
  memo?: string;
  description?: string;
}) {
  await getInventoryAccountingSettings();
  const map = await mappedCodes("AP_MATCH");
  const ppv = await mappedCodes("PPV");
  const [grir, ap, ppvAcct] = await Promise.all([
    accountByCode(map.debitCode),
    accountByCode(map.creditCode),
    accountByCode(ppv.debitCode),
  ]);
  const lines = purchaseMatchEntry({
    receiptValue: params.receiptValue,
    invoiceValue: params.invoiceValue,
    grirAccountId: grir.id,
    apAccountId: ap.id,
    ppvAccountId: ppvAcct.id,
  });
  if (!lines) return null;
  return postJournal({
    description: params.description || "Supplier invoice matched to a receipt",
    source: "AP",
    sourceId: params.sourceId,
    idempotencyKey: `ap-match:${params.sourceId}`,
    createdById: params.userId || undefined,
    status: "POSTED",
    lines: lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo,
    })),
  });
}

export async function shouldPostIssueAtPick(part: {
  consumptionTiming?: string | null;
}): Promise<boolean> {
  return (await consumptionTimingForPart(part)) === "AT_PICK";
}

export async function unissueToStock(params: {
  workOrderId: string;
  inventoryItemId: string;
  quantity: number;
  userId?: string | null;
  memo?: string;
}) {
  const qty = params.quantity;
  if (!(qty > 0)) throw new Error("Return quantity must be positive");
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    include: { part: true },
  });
  if (!wo) throw new Error("Work order not found");
  if (["COMPLETED", "CLOSED", "CANCELLED"].includes(wo.status)) {
    throw new Error("Cannot return material from a closed job");
  }
  const wipRow = await prisma.inventoryItem.findUnique({
    where: { id: params.inventoryItemId },
    include: { location: true, part: true },
  });
  if (!wipRow || wipRow.workOrderId !== wo.id) {
    throw new Error("That bin is not staged to this job");
  }
  if (wipRow.quantityOnHand + 1e-9 < qty) {
    throw new Error("Cannot return more than is staged on the job");
  }
  const storage =
    (await prisma.location.findFirst({ where: { type: "STORAGE" } })) ||
    (await prisma.location.findFirst());
  if (!storage) throw new Error("A storage location is required to return material");
  const amount = money(qty * (wipRow.unitCost || 0));
  const accounts = await resolveItemAccounts(wipRow.part);
  const result = await prisma.$transaction(async (db) => {
    const claimed = await db.inventoryItem.updateMany({
      where: { id: wipRow.id, quantityOnHand: { gte: qty } },
      data: {
        quantityOnHand: { decrement: qty },
      },
    });
    if (!claimed.count) throw new Error("Staged quantity changed — refresh and retry");
    const dest = await db.inventoryItem.create({
      data: {
        partId: wipRow.partId,
        locationId: storage.id,
        quantityOnHand: qty,
        quantityAvailable: qty,
        unitCost: wipRow.unitCost,
        lotNumber: wipRow.lotNumber,
        serialNumber: wipRow.serialNumber,
        ownership: wipRow.ownership,
      },
    });
    const tx = await db.materialTransaction.create({
      data: {
        type: "UNISSUE",
        partId: wipRow.partId,
        inventoryItemId: dest.id,
        workOrderId: wo.id,
        quantity: qty,
        unitCost: wipRow.unitCost,
        fromLocation: wipRow.location.code,
        toLocation: storage.code,
        lotNumber: wipRow.lotNumber,
        serialNumber: wipRow.serialNumber,
        reference: wo.number,
        notes: params.memo || "Returned from the job to stock",
        userId: params.userId,
      },
    });
    let journalId: string | null = null;
    if (wipRow.ownership !== "GOVERNMENT" && amount > 0.001) {
      const journal = await postJournal(
        {
          description: `Material returned from ${wo.number} to stock`,
          source: "INVENTORY",
          sourceId: tx.id,
          idempotencyKey: `unissue:${tx.id}`,
          workOrderId: wo.id,
          projectId: wo.projectId || undefined,
          createdById: params.userId || undefined,
          status: "POSTED",
          lines: [
            {
              accountId: accounts.inventory.id,
              debit: amount,
              memo: `${wipRow.part.partNumber} returned`,
            },
            {
              accountId: accounts.wip.id,
              credit: amount,
              costElement: "MATERIAL",
              workOrderId: wo.id,
              projectId: wo.projectId || undefined,
              memo: `${wipRow.part.partNumber} returned`,
            },
          ],
        },
        db
      );
      journalId = journal.id;
      await db.materialTransaction.update({
        where: { id: tx.id },
        data: { journalEntryId: journal.id },
      });
    }
    return { inventoryItemId: dest.id, materialTransactionId: tx.id, journalId };
  }, { timeout: 20000, maxWait: 10000 });
  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "MATERIAL_UNISSUED",
    userId: params.userId,
    metadata: { quantity: qty, partId: wipRow.partId },
  });
  return result;
}

async function bomRequirement(workOrderId: string, outputQty: number, db: Db = prisma) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: { quantity: true, bomHeaderId: true },
  });
  if (!wo?.bomHeaderId) return [] as { partId: string; quantity: number }[];
  const lines = await db.bomLine.findMany({
    where: { bomHeaderId: wo.bomHeaderId },
    select: { componentPartId: true, quantity: true },
  });
  const factor = (wo.quantity || 1) > 0 ? outputQty / (wo.quantity || 1) : outputQty;
  return lines
    .filter((l) => l.componentPartId)
    .map((l) => ({ partId: l.componentPartId, quantity: l.quantity * factor }));
}

async function consumeStagedProportion(params: {
  workOrderId: string;
  outputQty: number;
  remainingBefore: number;
  userId?: string | null;
  db?: Db;
}) {
  const db = params.db || prisma;
  const rows = await db.inventoryItem.findMany({
    where: { workOrderId: params.workOrderId, quantityOnHand: { gt: 0 } },
    include: { location: true },
  });
  const denom = params.remainingBefore > 0 ? params.remainingBefore : params.outputQty;
  for (const row of rows) {
    const take = money(row.quantityOnHand * (params.outputQty / denom));
    if (take <= 0.0001) continue;
    const left = Math.max(0, money(row.quantityOnHand - take));
    await db.inventoryItem.update({
      where: { id: row.id },
      data: { quantityOnHand: left, quantityAvailable: 0 },
    });
    await db.materialTransaction.create({
      data: {
        type: "ISSUE",
        partId: row.partId,
        inventoryItemId: row.id,
        workOrderId: params.workOrderId,
        quantity: take,
        unitCost: row.unitCost,
        fromLocation: row.location.code,
        reference: "WIP_CONSUMED",
        notes: "Staged material built into this finished-goods receipt",
        userId: params.userId,
      },
    });
  }
}

async function backflushForOutput(params: {
  workOrderId: string;
  outputQty: number;
  userId?: string | null;
  db?: Db;
}) {
  const db = params.db || prisma;
  const required = await bomRequirement(params.workOrderId, params.outputQty, db);
  for (const need of required) {
    const part = await db.part.findUnique({ where: { id: need.partId } });
    if (!part) continue;
    if ((await consumptionTimingForPart(part, db)) !== "BACKFLUSH") continue;
    // If this part was already charged to the job at pick, do not post again.
    const alreadyPosted = await db.materialTransaction.findFirst({
      where: {
        workOrderId: params.workOrderId,
        partId: need.partId,
        journalEntryId: { not: null },
        type: { in: ["KIT", "ISSUE"] },
        NOT: { reference: "BACKFLUSH" },
      },
    });
    if (alreadyPosted) continue;
    const stagedRows = await db.inventoryItem.findMany({
      where: { workOrderId: params.workOrderId, partId: need.partId, quantityOnHand: { gt: 0 } },
    });
    const stagedQty = stagedRows.reduce((s, r) => s + r.quantityOnHand, 0);
    if (stagedQty > 0.0001) {
      // Physical qty was staged at pick without a journal. Post the backflush
      // now for this output; consumeStagedProportion will reduce the bin.
      let left = need.quantity;
      for (const row of stagedRows) {
        if (left <= 0.0001) break;
        const take = Math.min(row.quantityOnHand, left);
        left -= take;
        const issued = await db.materialTransaction.create({
          data: {
            type: "ISSUE",
            partId: need.partId,
            inventoryItemId: row.id,
            workOrderId: params.workOrderId,
            quantity: take,
            unitCost: row.unitCost,
            reference: "BACKFLUSH",
            notes: "Backflushed at finished-goods receipt (material already staged)",
            userId: params.userId,
          },
        });
        if (row.unitCost * take > 0.001) {
          const journal = await postMaterialIssue({
            materialTransactionId: issued.id,
            workOrderId: params.workOrderId,
            amount: money(row.unitCost * take),
            userId: params.userId,
            memo: `${part.partNumber} backflush`,
            db,
          });
          if (journal) {
            await db.materialTransaction.update({
              where: { id: issued.id },
              data: { journalEntryId: journal.id },
            });
          }
        }
      }
      continue;
    }
    let remaining = need.quantity;
    const bins = await db.inventoryItem.findMany({
      where: {
        partId: need.partId,
        workOrderId: null,
        quantityAvailable: { gt: 0 },
        quantityQuarantine: 0,
        mrbCaseId: null,
      },
      include: { location: true, part: true },
      orderBy: { updatedAt: "asc" },
    });
    for (const bin of bins) {
      if (remaining <= 0.0001) break;
      const take = Math.min(bin.quantityAvailable, remaining);
      const stock = await db.inventoryItem.updateMany({
        where: { id: bin.id, quantityAvailable: { gte: take }, quantityOnHand: { gte: take } },
        data: {
          quantityOnHand: { decrement: take },
          quantityAvailable: { decrement: take },
        },
      });
      if (!stock.count) continue;
      remaining -= take;
      const issued = await db.materialTransaction.create({
        data: {
          type: "ISSUE",
          partId: need.partId,
          inventoryItemId: bin.id,
          workOrderId: params.workOrderId,
          quantity: take,
          unitCost: bin.unitCost,
          fromLocation: bin.location.code,
          reference: "BACKFLUSH",
          notes: "Backflushed at finished-goods receipt",
          userId: params.userId,
        },
      });
      if (bin.ownership !== "GOVERNMENT" && bin.unitCost * take > 0.001) {
        const journal = await postMaterialIssue({
          materialTransactionId: issued.id,
          workOrderId: params.workOrderId,
          amount: money(bin.unitCost * take),
          userId: params.userId,
          memo: `${part.partNumber} backflush`,
          db,
        });
        if (journal) {
          await db.materialTransaction.update({
            where: { id: issued.id },
            data: { journalEntryId: journal.id },
          });
        }
      }
    }
    if (remaining > 0.0001) {
      throw new Error(
        `Not enough stock to backflush ${part.partNumber}: short ${money(remaining)}`
      );
    }
  }
}

export async function receiveWorkOrderOutput(params: {
  workOrderId: string;
  quantity: number;
  userId?: string | null;
  lotNumber?: string;
  serialNumber?: string;
  notes?: string;
}) {
  const qty = params.quantity;
  if (!(qty > 0) || !Number.isFinite(qty)) {
    throw new Error("Finished quantity must be a positive number");
  }
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    include: { part: true },
  });
  if (!wo) throw new Error("Work order not found");
  if (["COMPLETED", "CLOSED", "CANCELLED"].includes(wo.status)) {
    throw new Error(`WO already ${wo.status}`);
  }
  if (wo.type === "TASK_ONLY") {
    throw new Error("Task-only work orders do not receive finished goods");
  }
  if (!wo.partId) throw new Error("This job has no part to receive into stock");
  const remaining = money((wo.quantity || 0) - (wo.quantityCompleted || 0));
  if (qty - remaining > 0.0001) {
    throw new Error(`Only ${remaining} remain to receive on ${wo.number}`);
  }
  const settings = await getInventoryAccountingSettings();
  const storage =
    (await prisma.location.findFirst({ where: { type: "STORAGE" } })) ||
    (await prisma.location.findFirst());
  if (!storage) throw new Error("A storage location is required for finished goods");
  const unitStd = (wo.standardCost || 0) / (wo.quantity || 1);
  const actualUnit = unitStd;
  const unitCost = reliefUnitCost({
    costingMethod: settings.costingMethod,
    standardCost: unitStd,
    actualUnitCost: actualUnit,
  });
  const amount = money(unitCost * qty);
  const accounts = await resolveItemAccounts(wo.part);
  const lotNumber = params.lotNumber || `LOT-WO-${wo.number.replace(/\W/g, "")}-${Date.now().toString(36).toUpperCase()}`;
  const serialNumber =
    params.serialNumber ||
    (wo.part?.isSerialized && qty <= 1 ? `SN-${wo.number}-${String((wo.quantityCompleted || 0) + 1).padStart(2, "0")}` : undefined);

  const result = await prisma.$transaction(async (db) => {
    const claimed = await db.workOrder.updateMany({
      where: {
        id: wo.id,
        quantityCompleted: wo.quantityCompleted,
        status: { notIn: ["COMPLETED", "CLOSED", "CANCELLED"] },
      },
      data: { quantityCompleted: { increment: qty }, status: "IN_PROGRESS" },
    });
    if (!claimed.count) throw new Error("The job changed before this receipt — refresh and retry");
    const inv = await db.inventoryItem.create({
      data: {
        partId: wo.partId!,
        locationId: storage.id,
        quantityOnHand: qty,
        quantityAvailable: wo.salesOrderId ? 0 : qty,
        quantityCommitted: wo.salesOrderId ? qty : 0,
        lotNumber,
        serialNumber,
        unitCost,
        ownership: "COMPANY",
      },
    });
    const tx = await db.materialTransaction.create({
      data: {
        type: "WO_OUTPUT",
        partId: wo.partId!,
        inventoryItemId: inv.id,
        workOrderId: wo.id,
        salesOrderId: wo.salesOrderId || undefined,
        quantity: qty,
        unitCost,
        toLocation: storage.code,
        lotNumber,
        serialNumber,
        reference: wo.number,
        notes: params.notes || "Finished goods received; job remains open",
        userId: params.userId,
      },
    });
    await consumeStagedProportion({
      workOrderId: wo.id,
      outputQty: qty,
      remainingBefore: remaining,
      userId: params.userId,
      db,
    });
    await backflushForOutput({
      workOrderId: wo.id,
      outputQty: qty,
      userId: params.userId,
      db,
    });
    let journalId: string | null = null;
    const entry = finishedGoodsOutputEntry({
      amount,
      fgAccountId: accounts.fg.id,
      wipAccountId: accounts.wip.id,
    });
    if (entry) {
      const journal = await postJournal(
        {
          description: `Finished goods from ${wo.number} (${qty} of ${wo.quantity})`,
          source: "WO",
          sourceId: tx.id,
          idempotencyKey: `wo-output:${tx.id}`,
          workOrderId: wo.id,
          projectId: wo.projectId || undefined,
          createdById: params.userId || undefined,
          status: "POSTED",
          lines: entry.map((l) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo,
            workOrderId: wo.id,
            projectId: wo.projectId || undefined,
          })),
        },
        db
      );
      journalId = journal.id;
      await db.materialTransaction.update({
        where: { id: tx.id },
        data: { journalEntryId: journal.id },
      });
    }
    const output = await db.workOrderOutput.create({
      data: {
        workOrderId: wo.id,
        quantity: qty,
        unitCost,
        standardAmount: amount,
        lotNumber,
        serialNumber,
        inventoryItemId: inv.id,
        materialTransactionId: tx.id,
        journalEntryId: journalId,
        receivedById: params.userId || undefined,
        notes: params.notes,
      },
    });
    return { inventoryItemId: inv.id, outputId: output.id, journalId, lotNumber, serialNumber, unitCost, amount };
  }, { timeout: 20000, maxWait: 10000 });

  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "FG_RECEIVED",
    userId: params.userId,
    metadata: { quantity: qty, lotNumber, remaining: money(remaining - qty) },
  });
  return result;
}

async function wipBalanceForJob(workOrderId: string, wipAccountId: string) {
  const lines = await prisma.journalLine.findMany({
    where: {
      workOrderId,
      accountId: wipAccountId,
      journalEntry: { status: "POSTED" },
    },
    select: { debit: true, credit: true },
  });
  return money(lines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0));
}

export async function closeWorkOrderBooks(params: {
  workOrderId: string;
  userId?: string | null;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    include: { part: true },
  });
  if (!wo) throw new Error("Work order not found");
  const accounts = await resolveItemAccounts(wo.part);
  const completed = wo.quantityCompleted || 0;
  const qty = wo.quantity || 1;
  const ratio = qty > 0 ? completed / qty : 1;

  const materialLines = await prisma.journalLine.findMany({
    where: {
      workOrderId: wo.id,
      costElement: "MATERIAL",
      journalEntry: { status: "POSTED" },
    },
    select: { debit: true, credit: true },
  });
  const materialIssued = money(
    materialLines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)
  );
  const laborLines = await prisma.journalLine.findMany({
    where: {
      workOrderId: wo.id,
      costElement: "LABOR",
      journalEntry: { status: "POSTED" },
    },
    select: { debit: true, credit: true, journalEntry: { select: { sourceId: true } } },
  });
  const actualLabor = money(
    laborLines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)
  );
  const ohLines = await prisma.journalLine.findMany({
    where: {
      workOrderId: wo.id,
      costElement: { in: ["OVERHEAD", "FRINGE"] },
      journalEntry: { status: "POSTED" },
    },
    select: { debit: true, credit: true },
  });
  const absorbedOverhead = money(
    ohLines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)
  );

  const timeAgg = await prisma.timeEntry.aggregate({
    where: { workOrderId: wo.id, status: { in: ["APPROVED", "PROCESSED"] } },
    _sum: { hours: true, costAmount: true },
  });
  const clockedHours = timeAgg._sum.hours || 0;
  const standardHours = (wo.allocatedHours || 0) * ratio;
  const standardLaborRate =
    standardHours > 0 && actualLabor === 0
      ? 0
      : clockedHours > 0
        ? actualLabor / clockedHours
        : 0;
  // Rate variance should compare actual dollars to clocked hours at the
  // planned rate when we have allocated hours; otherwise treat rate as zero
  // and let residual catch the mix.
  const plannedRate =
    wo.allocatedHours && wo.allocatedHours > 0 && actualLabor > 0
      ? actualLabor / Math.max(clockedHours, wo.allocatedHours)
      : clockedHours > 0
        ? actualLabor / clockedHours
        : 0;

  // Standard material / labor / OH inside the finished-good standard are not
  // stored separately. Use issued material allocated to completed qty as the
  // "standard material" floor only when we have no better split — actually
  // the usage variance is issued minus a prorated standard of the WO.
  // wo.standardCost is the full job standard (material+conversion). We cannot
  // split it reliably, so usage/rate/eff/oh may be zero-ish and residual
  // holds the true leftover. When allocated hours exist we still report labor variances.
  const standardMaterial = 0;
  const standardOverhead = 0;
  const wip = await wipBalanceForJob(wo.id, accounts.wip.id);
  const plan = closeVariancePlan({
    wipBalance: wip,
    materialIssued,
    standardMaterial,
    actualLabor,
    clockedHours,
    standardHours,
    standardLaborRate: plannedRate || standardLaborRate,
    absorbedOverhead,
    standardOverhead,
  });

  const keyToEvent: Record<string, string> = {
    MATERIAL_USAGE: "MATERIAL_USAGE_VAR",
    LABOR_RATE: "LABOR_RATE_VAR",
    LABOR_EFFICIENCY: "LABOR_EFF_VAR",
    OVERHEAD: "OH_VAR",
    RESIDUAL: "WO_RESIDUAL",
  };

  // Consume any leftover staging so it does not linger after close.
  const leftover = await prisma.inventoryItem.findMany({
    where: { workOrderId: wo.id, quantityOnHand: { gt: 0 } },
    include: { location: true },
  });
  for (const row of leftover) {
    await prisma.materialTransaction.create({
      data: {
        type: "ISSUE",
        partId: row.partId,
        inventoryItemId: row.id,
        workOrderId: wo.id,
        quantity: row.quantityOnHand,
        unitCost: row.unitCost,
        fromLocation: row.location.code,
        reference: "WIP_CLOSE",
        notes: "Remaining staged material cleared at job close",
        userId: params.userId,
      },
    });
    await prisma.inventoryItem.update({
      where: { id: row.id },
      data: { quantityOnHand: 0, quantityAvailable: 0 },
    });
  }

  const lines: {
    accountId: string;
    debit: number;
    credit: number;
    memo?: string;
    workOrderId?: string;
  }[] = [];
  for (const bucket of plan) {
    const eventKey = keyToEvent[bucket.key];
    const map = await mappedCodes(eventKey);
    const varianceAcct = await accountByCode(map.debitCode);
    const amt = money(Math.abs(bucket.amount));
    if (bucket.amount > 0) {
      lines.push({ accountId: varianceAcct.id, debit: amt, credit: 0, memo: bucket.memo, workOrderId: wo.id });
      lines.push({ accountId: accounts.wip.id, debit: 0, credit: amt, memo: bucket.memo, workOrderId: wo.id });
    } else {
      lines.push({ accountId: accounts.wip.id, debit: amt, credit: 0, memo: bucket.memo, workOrderId: wo.id });
      lines.push({ accountId: varianceAcct.id, debit: 0, credit: amt, memo: bucket.memo, workOrderId: wo.id });
    }
  }
  if (!lines.length) return { journalId: null, wipBefore: wip, plan };

  const journal = await postJournal({
    description: `Closed ${wo.number} — remaining WIP to variance`,
    source: "WO",
    sourceId: wo.id,
    idempotencyKey: `wo-close:${wo.id}`,
    workOrderId: wo.id,
    projectId: wo.projectId || undefined,
    createdById: params.userId || undefined,
    status: "POSTED",
    lines,
  });
  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "WO_BOOKS_CLOSED",
    userId: params.userId,
    metadata: { wipBefore: wip, buckets: plan },
  });
  return { journalId: journal.id, wipBefore: wip, plan };
}

export async function absorbApprovedTimesheetLabor(params: {
  timesheetId: string;
  userId?: string | null;
}) {
  const sheet = await prisma.timesheet.findUnique({
    where: { id: params.timesheetId },
    include: { entries: true, user: { select: { name: true } } },
  });
  if (!sheet) throw new Error("Timesheet not found");
  for (const entry of sheet.entries) {
    if (!entry.workOrderId && !entry.projectId) continue;
    const amt = entry.costAmount || entry.hours * (entry.laborRate || 0);
    if (amt <= 0) continue;
    await postDirectLabor({
      timeEntryId: entry.id,
      amount: money(amt),
      workOrderId: entry.workOrderId,
      projectId: entry.projectId,
      userId: params.userId,
      date: entry.date,
      memo: `Labor ${sheet.user?.name || "employee"} → ${entry.workOrderId ? "job" : "project"}`,
    });
  }
}

export async function postRmaStockReturn(params: {
  rmaId: string;
  partId: string;
  quantity: number;
  unitCost: number;
  materialTransactionId: string;
  userId?: string | null;
}) {
  const amount = money(params.quantity * params.unitCost);
  if (amount <= 0.001) return null;
  const part = await prisma.part.findUnique({ where: { id: params.partId } });
  const accounts = await resolveItemAccounts(part);
  const journal = await postJournal({
    description: "Customer return received to stock",
    source: "RMA",
    sourceId: params.rmaId,
    idempotencyKey: `rma-return:${params.materialTransactionId}`,
    createdById: params.userId || undefined,
    status: "POSTED",
    lines: [
      { accountId: accounts.fg.id, debit: amount, memo: part?.partNumber },
      { accountId: accounts.cogs.id, credit: amount, memo: part?.partNumber },
    ],
  });
  await linkTransactionJournal(params.materialTransactionId, journal.id);
  return journal;
}

export async function getWipByWorkOrderReport(opts?: {
  from?: Date;
  to?: Date;
  includeClosed?: boolean;
}) {
  await ensureManufacturingAccountingDefaults();
  const wip = await accountByCode("1210");
  const where: Prisma.JournalLineWhereInput = {
    accountId: wip.id,
    journalEntry: {
      status: "POSTED",
      ...(opts?.from || opts?.to
        ? {
            date: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
  };
  const lines = await prisma.journalLine.findMany({
    where,
    include: {
      journalEntry: { select: { date: true, source: true, description: true, number: true } },
    },
  });
  const beginningWhere: Prisma.JournalLineWhereInput | null = opts?.from
    ? {
        accountId: wip.id,
        journalEntry: { status: "POSTED", date: { lt: opts.from } },
      }
    : null;
  const beginningLines = beginningWhere
    ? await prisma.journalLine.findMany({ where: beginningWhere })
    : [];

  type Row = {
    workOrderId: string | null;
    number: string;
    status: string;
    beginning: number;
    materialIn: number;
    laborIn: number;
    overheadIn: number;
    relieved: number;
    variance: number;
    ending: number;
  };
  const buckets = new Map<string, Row>();
  const ensure = (id: string | null): Row => {
    const key = id || "__unassigned";
    let row = buckets.get(key);
    if (!row) {
      row = {
        workOrderId: id,
        number: id ? "" : "Not tagged to a job",
        status: "",
        beginning: 0,
        materialIn: 0,
        laborIn: 0,
        overheadIn: 0,
        relieved: 0,
        variance: 0,
        ending: 0,
      };
      buckets.set(key, row);
    }
    return row;
  };
  for (const l of beginningLines) {
    const row = ensure(l.workOrderId);
    row.beginning = money(row.beginning + (l.debit || 0) - (l.credit || 0));
  }
  for (const l of lines) {
    const row = ensure(l.workOrderId);
    const net = money((l.debit || 0) - (l.credit || 0));
    const element = (l.costElement || "").toUpperCase();
    if (net > 0.001) {
      if (element === "MATERIAL") row.materialIn = money(row.materialIn + net);
      else if (element === "LABOR") row.laborIn = money(row.laborIn + net);
      else if (element === "OVERHEAD" || element === "FRINGE" || element === "OSP") {
        row.overheadIn = money(row.overheadIn + net);
      } else if (element) {
        row.materialIn = money(row.materialIn + net);
      } else {
        // Untagged debit to WIP — usually a reversal of relief; treat as reduced relief
        row.relieved = money(row.relieved - net);
      }
    } else if (net < -0.001) {
      const credit = money(-net);
      const desc = (l.journalEntry.description || "").toLowerCase();
      const memo = (l.memo || "").toLowerCase();
      if (desc.includes("variance") || memo.includes("variance") || memo.includes("residual")) {
        row.variance = money(row.variance + credit);
      } else {
        row.relieved = money(row.relieved + credit);
      }
    }
  }
  const ids = [...buckets.keys()].filter((k) => k !== "__unassigned");
  const orders = ids.length
    ? await prisma.workOrder.findMany({
        where: { id: { in: ids } },
        select: { id: true, number: true, status: true, quantity: true, quantityCompleted: true },
      })
    : [];
  const byId = Object.fromEntries(orders.map((o) => [o.id, o]));
  const rows = [...buckets.values()].map((row) => {
    const wo = row.workOrderId ? byId[row.workOrderId] : null;
    if (wo) {
      row.number = wo.number;
      row.status = wo.status;
    }
    row.ending = money(
      row.beginning + row.materialIn + row.laborIn + row.overheadIn - row.relieved - row.variance
    );
    return row;
  });
  const visible = opts?.includeClosed
    ? rows
    : rows.filter((r) => !r.status || !["CANCELLED"].includes(r.status) || Math.abs(r.ending) > 0.001);
  visible.sort((a, b) => a.number.localeCompare(b.number));
  const totals = visible.reduce(
    (s, r) => ({
      beginning: money(s.beginning + r.beginning),
      materialIn: money(s.materialIn + r.materialIn),
      laborIn: money(s.laborIn + r.laborIn),
      overheadIn: money(s.overheadIn + r.overheadIn),
      relieved: money(s.relieved + r.relieved),
      variance: money(s.variance + r.variance),
      ending: money(s.ending + r.ending),
    }),
    { beginning: 0, materialIn: 0, laborIn: 0, overheadIn: 0, relieved: 0, variance: 0, ending: 0 }
  );
  return { rows: visible, totals, wipAccount: { id: wip.id, code: wip.code, name: wip.name } };
}

function classifyInventoryRow(row: {
  workOrderId: string | null;
  location: { type: string };
  part: {
    inventoryAccountId: string | null;
    itemStructure: string | null;
    sourcingMethod: string | null;
  };
}) {
  if (row.workOrderId) return "WIP" as const;
  if ((row.location.type || "").toUpperCase() === "WIP" || (row.location.type || "").toUpperCase() === "STAGING") {
    return "WIP" as const;
  }
  const structure = (row.part.itemStructure || "").toUpperCase();
  if (structure === "TOP_LEVEL_ASSEMBLY" || structure === "SUB_ASSEMBLY") return "FG" as const;
  return "RM" as const;
}

export async function getInventoryGlReconciliation() {
  await ensureManufacturingAccountingDefaults();
  const [rm, wip, fg] = await Promise.all([
    accountByCode("1200"),
    accountByCode("1210"),
    accountByCode("1220"),
  ]);
  const items = await prisma.inventoryItem.findMany({
    where: { quantityOnHand: { not: 0 } },
    include: {
      location: { select: { type: true, code: true } },
      part: {
        select: {
          partNumber: true,
          description: true,
          inventoryAccountId: true,
          itemStructure: true,
          sourcingMethod: true,
        },
      },
    },
  });
  const sub = { RM: 0, WIP: 0, FG: 0 };
  const byAccount = new Map<string, number>();
  const detail: {
    partNumber: string;
    location: string;
    class: "RM" | "WIP" | "FG";
    quantity: number;
    unitCost: number;
    value: number;
    accountCode: string;
  }[] = [];
  for (const item of items) {
    const cls = classifyInventoryRow(item);
    const value = money(item.quantityOnHand * (item.unitCost || 0));
    sub[cls] = money(sub[cls] + value);
    const account =
      item.part.inventoryAccountId && cls !== "WIP"
        ? item.part.inventoryAccountId
        : cls === "WIP"
          ? wip.id
          : cls === "FG"
            ? fg.id
            : rm.id;
    byAccount.set(account, money((byAccount.get(account) || 0) + value));
    const acctRow = account === wip.id ? wip : account === fg.id ? fg : rm;
    detail.push({
      partNumber: item.part.partNumber,
      location: item.location.code,
      class: cls,
      quantity: item.quantityOnHand,
      unitCost: item.unitCost,
      value,
      accountCode: acctRow.code,
    });
  }

  async function glFromJournals(accountId: string, opening: number) {
    const lines = await prisma.journalLine.aggregate({
      where: { accountId, journalEntry: { status: "POSTED" } },
      _sum: { debit: true, credit: true },
    });
    return money(opening + (lines._sum.debit || 0) - (lines._sum.credit || 0));
  }

  const wipReport = await getWipByWorkOrderReport({ includeClosed: true });
  const wipJobs = wipReport.totals.ending;
  const groups = [
    { key: "RM" as const, label: "Raw materials", account: rm, subledger: sub.RM },
    { key: "WIP" as const, label: "Work in process", account: wip, subledger: wipJobs },
    { key: "FG" as const, label: "Finished goods", account: fg, subledger: sub.FG },
  ];
  const rows = [];
  for (const g of groups) {
    const gl = await glFromJournals(g.account.id, 0);
    rows.push({
      key: g.key,
      label: g.label,
      accountCode: g.account.code,
      accountName: g.account.name,
      accountId: g.account.id,
      subledger: g.subledger,
      gl,
      difference: money(g.subledger - gl),
    });
  }
  return {
    rows,
    inBalance: rows.every((r) => Math.abs(r.difference) <= 0.01),
    wipMaterialOnHand: sub.WIP,
    wipConversion: money((rows.find((r) => r.key === "WIP")?.gl || 0) - sub.WIP),
    detail,
    asOf: new Date(),
  };
}

export async function getInventoryTransactionRegister(opts?: {
  type?: string;
  workOrderId?: string;
  partId?: string;
  from?: Date;
  to?: Date;
  take?: number;
}) {
  const take = Math.min(opts?.take || 200, 500);
  const rows = await prisma.materialTransaction.findMany({
    where: {
      ...(opts?.type ? { type: opts.type } : {}),
      ...(opts?.workOrderId ? { workOrderId: opts.workOrderId } : {}),
      ...(opts?.partId ? { partId: opts.partId } : {}),
      ...(opts?.from || opts?.to
        ? {
            createdAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    include: {
      journalEntry: {
        select: { id: true, number: true, status: true, description: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  const partIds = [...new Set(rows.map((r) => r.partId).filter((id): id is string => !!id))];
  const parts = partIds.length
    ? await prisma.part.findMany({
        where: { id: { in: partIds } },
        select: { id: true, partNumber: true, description: true },
      })
    : [];
  const partMap = Object.fromEntries(parts.map((p) => [p.id, p]));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    date: r.createdAt,
    partNumber: r.partId ? partMap[r.partId]?.partNumber || r.partId : "",
    description: r.partId ? partMap[r.partId]?.description || "" : "",
    quantity: r.quantity,
    unitCost: r.unitCost,
    value: money(r.quantity * (r.unitCost || 0)),
    fromLocation: r.fromLocation,
    toLocation: r.toLocation,
    lotNumber: r.lotNumber,
    serialNumber: r.serialNumber,
    workOrderId: r.workOrderId,
    reference: r.reference,
    notes: r.notes,
    journalId: r.journalEntryId,
    journalNumber: r.journalEntry?.number || null,
    journalStatus: r.journalEntry?.status || null,
  }));
}

export async function manufacturingCloseChecklist() {
  await ensureManufacturingAccountingDefaults();
  const wip = await accountByCode("1210");
  const grir = await accountByCode("2010");
  const [wipLines, grirLines, openCounts] = await Promise.all([
    prisma.journalLine.groupBy({
      by: ["workOrderId"],
      where: { accountId: wip.id, journalEntry: { status: "POSTED" } },
      _sum: { debit: true, credit: true },
    }),
    prisma.journalLine.aggregate({
      where: { accountId: grir.id, journalEntry: { status: "POSTED" } },
      _sum: { debit: true, credit: true },
    }),
    prisma.cycleCount.count({ where: { status: { notIn: ["COMPLETE", "CANCELLED"] } } }),
  ]);
  const openWip = wipLines.filter((r) => {
    const bal = money((r._sum.debit || 0) - (r._sum.credit || 0));
    return Math.abs(bal) > 0.01 && r.workOrderId;
  });
  const openJobs = openWip.length
    ? await prisma.workOrder.findMany({
        where: { id: { in: openWip.map((r) => r.workOrderId!) }, status: { notIn: ["CANCELLED"] } },
        select: { id: true, number: true, status: true },
      })
    : [];
  const grirBalance = money((grirLines._sum.credit || 0) - (grirLines._sum.debit || 0));
  return {
    openJobsWithWip: openJobs,
    openWipCount: openJobs.length,
    unmatchedGrir: grirBalance,
    openCycleCounts: openCounts,
  };
}

// Re-export helpers that shop-floor code already used, so one import site can
// post scrap or a count adjustment without swallowing the error.
export { postInventoryAdjustment, postScrap, postMaterialIssue };
