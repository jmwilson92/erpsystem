/**
 * Customer returns: receive goods back to sellable or inspection stock,
 * reverse the original COGS, issue a credit memo against revenue and AR,
 * and disposition inspection stock to sellable or scrap.
 *
 * Journals are balanced, idempotent, tied to the RMA receipt, period-lock
 * aware, and never hard-deleted. A failed post is not swallowed.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { postJournal } from "@/lib/services/gaap";
import { postScrap } from "@/lib/services/gl-posting";
import {
  ensureManufacturingAccountingDefaults,
  resolveItemAccounts,
  getInventoryAccountingSettings,
} from "@/lib/services/inventory-accounting";
import { reliefUnitCost, roundMoney } from "@/lib/services/posting-rules";
import {
  consumeOutboundCost,
  linkConsumptionsToJournal,
  moveCostLayers,
  recordInboundCost,
} from "@/lib/services/cost-layers";
import { openReceivable } from "@/lib/services/ar-balance";

type Db = Prisma.TransactionClient | typeof prisma;
const money = roundMoney;

export const RMA_ACCOUNT_DEFAULTS = [
  {
    eventKey: "RMA_RETURN",
    label: "Customer return received to stock",
    debitCode: "1220",
    creditCode: "5000",
    notes: "Restores finished goods and reduces cost of goods sold at the original relief cost.",
  },
  {
    eventKey: "RMA_INSPECTION",
    label: "Customer return received to inspection",
    debitCode: "1230",
    creditCode: "5000",
    notes: "Holds the returned value in returns inspection until the board decides.",
  },
  {
    eventKey: "RMA_RESTOCK",
    label: "Inspection return released to sellable stock",
    debitCode: "1220",
    creditCode: "1230",
    notes: "Moves accepted returns from inspection into finished goods. COGS was already reversed at receipt.",
  },
  {
    eventKey: "RMA_CREDIT",
    label: "Sales return credit memo",
    debitCode: "4100",
    creditCode: "1100",
    notes: "Reduces revenue (sales returns) and accounts receivable.",
  },
];

export const RMA_EXTRA_ACCOUNTS = [
  { code: "1230", name: "Returns inspection", type: "ASSET" },
  { code: "4100", name: "Sales returns", type: "REVENUE" },
];

let mapsReady = false;

export async function ensureRmaAccountingDefaults() {
  await ensureManufacturingAccountingDefaults();
  if (mapsReady) return;
  for (const spec of RMA_EXTRA_ACCOUNTS) {
    const existing = await prisma.account.findUnique({ where: { code: spec.code } });
    if (!existing) {
      await prisma.account.create({
        data: { code: spec.code, name: spec.name, type: spec.type },
      });
    }
  }
  for (const row of RMA_ACCOUNT_DEFAULTS) {
    await prisma.glAccountMap.upsert({
      where: { eventKey: row.eventKey },
      create: row,
      update: {},
    });
  }
  mapsReady = true;
}

async function accountByCode(code: string, db: Db = prisma) {
  await ensureRmaAccountingDefaults();
  const found = await db.account.findUnique({ where: { code } });
  if (found) return found;
  return db.account.create({ data: { code, name: `Account ${code}`, type: "ASSET" } });
}

async function mappedCodes(eventKey: string) {
  await ensureRmaAccountingDefaults();
  const row =
    (await prisma.glAccountMap.findUnique({ where: { eventKey } })) ||
    RMA_ACCOUNT_DEFAULTS.find((d) => d.eventKey === eventKey);
  if (!row) throw new Error(`No account mapping for ${eventKey}`);
  return row;
}

export async function originalCogsRelief(params: {
  partId: string;
  serialNumber?: string | null;
  salesOrderId?: string | null;
  shipmentId?: string | null;
}) {
  const serial = params.serialNumber?.trim() || null;
  const invoice = params.shipmentId
    ? await prisma.arInvoice.findFirst({ where: { shipmentId: params.shipmentId }, include: { lines: true } })
    : params.salesOrderId
      ? await prisma.arInvoice.findFirst({ where: { salesOrderId: params.salesOrderId }, include: { lines: true }, orderBy: { invoiceDate: "desc" } })
      : null;
  if (invoice) {
    const cogs = await prisma.journalEntry.findMany({
      where: { source: "AR", sourceId: invoice.id, status: "POSTED", description: { startsWith: "COGS" } },
      include: { lines: { include: { account: true } } },
    });
    const cogsDebit = money(
      cogs.reduce(
        (s, je) => s + je.lines.filter((l) => l.account.code === "5000" || l.debit > 0).reduce((n, l) => n + (l.debit || 0), 0),
        0
      )
    );
    const qty = invoice.lines.reduce((s, l) => s + (l.quantity || 0), 0);
    if (cogsDebit > 0 && qty > 0) {
      return {
        unitCost: money(cogsDebit / qty),
        salesOrderId: invoice.salesOrderId || params.salesOrderId || null,
        shipmentId: invoice.shipmentId || params.shipmentId || null,
        shipTransactionId: null as string | null,
        arInvoiceId: invoice.id,
      };
    }
  }
  if (serial) {
    const bySerial = await prisma.materialTransaction.findFirst({
      where: { type: "SHIP", partId: params.partId, serialNumber: serial },
      orderBy: { createdAt: "desc" },
    });
    if (bySerial) {
      return {
        unitCost: money(bySerial.unitCost || 0),
        salesOrderId: bySerial.salesOrderId || params.salesOrderId || null,
        shipmentId: params.shipmentId || null,
        shipTransactionId: bySerial.id,
      };
    }
  }
  if (params.shipmentId) {
    const byShipment = await prisma.materialTransaction.findFirst({
      where: {
        type: "SHIP",
        partId: params.partId,
        OR: [
          { reference: params.shipmentId },
          ...(params.salesOrderId ? [{ salesOrderId: params.salesOrderId }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    if (byShipment) {
      return {
        unitCost: money(byShipment.unitCost || 0),
        salesOrderId: byShipment.salesOrderId || params.salesOrderId || null,
        shipmentId: params.shipmentId,
        shipTransactionId: byShipment.id,
      };
    }
  }
  if (params.salesOrderId) {
    const byOrder = await prisma.materialTransaction.findFirst({
      where: { type: "SHIP", partId: params.partId, salesOrderId: params.salesOrderId },
      orderBy: { createdAt: "desc" },
    });
    if (byOrder) {
      return {
        unitCost: money(byOrder.unitCost || 0),
        salesOrderId: params.salesOrderId,
        shipmentId: params.shipmentId || null,
        shipTransactionId: byOrder.id,
      };
    }
  }
  const part = await prisma.part.findUnique({ where: { id: params.partId } });
  const settings = await getInventoryAccountingSettings();
  return {
    unitCost: reliefUnitCost({
      costingMethod: settings.costingMethod,
      standardCost: part?.standardCost || 0,
      actualUnitCost: part?.averageCost || part?.lastBuyCost || part?.standardCost || 0,
    }),
    salesOrderId: params.salesOrderId || null,
    shipmentId: params.shipmentId || null,
    shipTransactionId: null as string | null,
  };
}

async function originalUnitPrice(params: {
  partId: string;
  salesOrderId?: string | null;
  shipmentId?: string | null;
  arInvoiceId?: string | null;
}) {
  if (params.arInvoiceId) {
    const inv = await prisma.arInvoice.findUnique({
      where: { id: params.arInvoiceId },
      include: { lines: true },
    });
    const line = inv?.lines.find((l) => l.unitPrice > 0);
    if (line) return { unitPrice: money(line.unitPrice), invoiceId: inv!.id };
  }
  if (params.shipmentId) {
    const invoice = await prisma.arInvoice.findFirst({
      where: { shipmentId: params.shipmentId },
      include: { lines: true },
    });
    const line = invoice?.lines.find((l) => l.unitPrice > 0);
    if (line) return { unitPrice: money(line.unitPrice), invoiceId: invoice!.id };
  }
  if (params.salesOrderId) {
    const soLine = await prisma.salesOrderLine.findFirst({
      where: { salesOrderId: params.salesOrderId, partId: params.partId },
    });
    if (soLine) {
      const invoice = await prisma.arInvoice.findFirst({
        where: { salesOrderId: params.salesOrderId },
        orderBy: { invoiceDate: "desc" },
      });
      return { unitPrice: money(soLine.unitPrice || 0), invoiceId: invoice?.id || null };
    }
  }
  return { unitPrice: 0, invoiceId: params.arInvoiceId || null };
}

async function locationFor(destination: "SELLABLE" | "INSPECTION") {
  const type = destination === "INSPECTION" ? "QUARANTINE" : "STORAGE";
  return (
    (await prisma.location.findFirst({ where: { type } })) ||
    (await prisma.location.findFirst({ where: { type: "STORAGE" } })) ||
    (await prisma.location.findFirst())
  );
}

export async function receiveRmaReturn(params: {
  rmaId: string;
  quantity: number;
  destination: "SELLABLE" | "INSPECTION";
  partId?: string | null;
  rmaLineId?: string | null;
  lotNumber?: string | null;
  serialNumber?: string | null;
  salesOrderId?: string | null;
  shipmentId?: string | null;
  arInvoiceId?: string | null;
  unitCost?: number | null;
  unitPrice?: number | null;
  notes?: string | null;
  userId?: string | null;
}) {
  const qty = params.quantity;
  if (!(qty > 0) || !Number.isFinite(qty)) {
    throw new Error("Return quantity must be a positive number");
  }
  const destination = params.destination === "INSPECTION" ? "INSPECTION" : "SELLABLE";
  const rma = await prisma.rma.findUnique({
    where: { id: params.rmaId },
    include: { topPart: true, customer: true, lines: true },
  });
  if (!rma) throw new Error("RMA not found");
  if (["CANCELLED", "CLOSED"].includes(rma.status)) {
    throw new Error(`Cannot receive returns on a ${rma.status} RMA`);
  }
  const partId = params.partId || rma.topPartId;
  if (!partId) throw new Error("A part is required to receive the return");
  const part = await prisma.part.findUnique({ where: { id: partId } });
  if (!part) throw new Error("Part not found");

  const relief = await originalCogsRelief({
    partId,
    serialNumber: params.serialNumber || rma.customerSn,
    salesOrderId: params.salesOrderId,
    shipmentId: params.shipmentId,
  });
  const priced = await originalUnitPrice({
    partId,
    salesOrderId: params.salesOrderId || relief.salesOrderId,
    shipmentId: params.shipmentId || relief.shipmentId,
    arInvoiceId: params.arInvoiceId,
  });
  const unitCost = money(params.unitCost != null && params.unitCost >= 0 ? params.unitCost : relief.unitCost);
  const unitPrice = money(params.unitPrice != null && params.unitPrice >= 0 ? params.unitPrice : priced.unitPrice);
  const amount = money(qty * unitCost);
  const accounts = await resolveItemAccounts(part);
  await ensureRmaAccountingDefaults();
  const eventKey = destination === "INSPECTION" ? "RMA_INSPECTION" : "RMA_RETURN";
  const map = await mappedCodes(eventKey);
  const debit =
    destination === "INSPECTION" ? await accountByCode(map.debitCode) : accounts.fg;
  const credit = await accountByCode(map.creditCode);
  const location = await locationFor(destination);
  if (!location) throw new Error("A storage or quarantine location is required to receive a return");
  const serialNumber = (params.serialNumber || rma.customerSn || "").trim() || undefined;
  if (serialNumber) {
    const existing = await prisma.rmaReceipt.findFirst({
      where: {
        rmaId: rma.id,
        serialNumber,
        partId,
        disposition: { not: "SCRAPPED" },
      },
    });
    if (existing) {
      return {
        receiptId: existing.id,
        inventoryItemId: existing.inventoryItemId,
        materialTransactionId: existing.materialTransactionId,
        journalId: existing.cogsJournalId,
        unitCost: existing.unitCost,
        unitPrice: existing.unitPrice,
        amount: money(existing.quantity * existing.unitCost),
        already: true,
      };
    }
  }

  const result = await prisma.$transaction(async (db) => {
    let lineId = params.rmaLineId || rma.lines[0]?.id || null;
    if (!lineId) {
      const line = await db.rmaLine.create({
        data: {
          rmaId: rma.id,
          partId,
          quantity: qty,
          description: `Returned ${part.partNumber}`,
        },
      });
      lineId = line.id;
    }
    const inv = await db.inventoryItem.create({
      data: {
        partId,
        locationId: location.id,
        quantityOnHand: qty,
        quantityAvailable: destination === "SELLABLE" ? qty : 0,
        quantityQuarantine: destination === "INSPECTION" ? qty : 0,
        lotNumber: params.lotNumber || undefined,
        serialNumber,
        unitCost,
        ownership: "COMPANY",
      },
    });
    const tx = await db.materialTransaction.create({
      data: {
        type: "RMA_RECEIPT",
        partId,
        inventoryItemId: inv.id,
        rmaId: rma.id,
        salesOrderId: relief.salesOrderId || params.salesOrderId || undefined,
        quantity: qty,
        unitCost,
        toLocation: location.code,
        lotNumber: params.lotNumber || undefined,
        serialNumber,
        reference: rma.number,
        notes: params.notes || `Customer return to ${destination === "INSPECTION" ? "inspection" : "sellable stock"}`,
        userId: params.userId,
      },
    });
    const receipt = await db.rmaReceipt.create({
      data: {
        rmaId: rma.id,
        rmaLineId: lineId,
        partId,
        quantity: qty,
        unitCost,
        unitPrice,
        destination,
        disposition: destination === "SELLABLE" ? "RESTOCKED" : "PENDING",
        lotNumber: params.lotNumber || undefined,
        serialNumber,
        salesOrderId: relief.salesOrderId || params.salesOrderId || undefined,
        shipmentId: relief.shipmentId || params.shipmentId || undefined,
        arInvoiceId: priced.invoiceId || (relief as { arInvoiceId?: string | null }).arInvoiceId || params.arInvoiceId || undefined,
        inventoryItemId: inv.id,
        materialTransactionId: tx.id,
        receivedById: params.userId || undefined,
        notes: params.notes || undefined,
      },
    });
    await db.materialTransaction.update({
      where: { id: tx.id },
      data: { rmaReceiptId: receipt.id },
    });
    await recordInboundCost({
      partId,
      locationId: location.id,
      inventoryItemId: inv.id,
      quantity: qty,
      unitCost,
      sourceType: destination === "SELLABLE" ? "RMA_RESTOCK" : "RMA_RECEIPT",
      sourceId: receipt.id,
      materialTransactionId: tx.id,
      ownership: "COMPANY",
      db,
    });
    let journalId: string | null = null;
    if (amount > 0.001) {
      const journal = await postJournal(
        {
          description: `${rma.number} return to ${destination === "INSPECTION" ? "inspection" : "stock"} — ${part.partNumber}`,
          source: "RMA",
          sourceId: receipt.id,
          idempotencyKey: `rma-return:${receipt.id}`,
          createdById: params.userId || undefined,
          status: "POSTED",
          lines: [
            { accountId: debit.id, debit: amount, memo: `${part.partNumber} returned` },
            { accountId: credit.id, credit: amount, memo: `${part.partNumber} COGS reversal` },
          ],
        },
        db
      );
      journalId = journal.id;
      await db.materialTransaction.update({
        where: { id: tx.id },
        data: { journalEntryId: journal.id },
      });
      await linkConsumptionsToJournal({
        materialTransactionId: tx.id,
        journalEntryId: journal.id,
        db,
      });
      await db.rmaReceipt.update({
        where: { id: receipt.id },
        data: { cogsJournalId: journal.id },
      });
    }
    return { receiptId: receipt.id, inventoryItemId: inv.id, materialTransactionId: tx.id, journalId, unitCost, unitPrice, amount, already: false };
  }, { timeout: 20000, maxWait: 10000 });

  await logAudit({
    entityType: "Rma",
    entityId: rma.id,
    action: "RMA_RECEIVED",
    userId: params.userId,
    metadata: { receiptId: result.receiptId, destination, quantity: qty, unitCost, amount },
  });
  return result;
}

export async function issueRmaCreditMemo(params: {
  rmaId: string;
  receiptId?: string | null;
  arInvoiceId?: string | null;
  amount?: number | null;
  notes?: string | null;
  userId?: string | null;
}) {
  const rma = await prisma.rma.findUnique({
    where: { id: params.rmaId },
    include: { customer: true, receipts: true },
  });
  if (!rma) throw new Error("RMA not found");
  if (rma.status === "CANCELLED") throw new Error("Cannot credit a cancelled RMA");
  await ensureRmaAccountingDefaults();

  if (params.receiptId) {
    const existingReceipt = rma.receipts.find((r) => r.id === params.receiptId);
    if (!existingReceipt) throw new Error("Return receipt not found on this RMA");
    if (existingReceipt.creditMemoId) {
      const memo = await prisma.arCreditMemo.findUnique({ where: { id: existingReceipt.creditMemoId } });
      if (memo) return memo;
    }
  }
  const receipts = params.receiptId
    ? rma.receipts.filter((r) => r.id === params.receiptId)
    : rma.receipts.filter((r) => !r.creditMemoId);
  if (!params.receiptId && receipts.length === 0 && params.amount == null) {
    throw new Error("Nothing left to credit on this RMA — every receipt already has a credit memo");
  }

  const lines = receipts.map((r) => ({
    description: `Sales return ${rma.number} — receipt`,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    amount: money(r.quantity * r.unitPrice),
    rmaReceiptId: r.id,
    arInvoiceId: r.arInvoiceId,
  }));
  let total = money(lines.reduce((s, l) => s + l.amount, 0));
  if (params.amount != null) {
    if (!(params.amount > 0) || !Number.isFinite(params.amount)) {
      throw new Error("Credit amount must be a positive number");
    }
    total = money(params.amount);
    if (lines.length === 0) {
      lines.push({
        description: `Sales return ${rma.number}`,
        quantity: 1,
        unitPrice: total,
        amount: total,
        rmaReceiptId: undefined as unknown as string,
        arInvoiceId: params.arInvoiceId || null,
      });
    }
  }
  if (total <= 0.001) {
    throw new Error("Credit memo amount is zero — set the original selling price or enter an amount");
  }

  const invoiceId = params.arInvoiceId || receipts.find((r) => r.arInvoiceId)?.arInvoiceId || null;
  if (invoiceId) {
    const inv = await prisma.arInvoice.findUnique({ where: { id: invoiceId } });
    if (inv) {
      const open = openReceivable(inv);
      if (total - open > 0.001) {
        throw new Error(`Credit of ${total} exceeds the ${open} still open on invoice ${inv.number}`);
      }
    }
  }

  const map = await mappedCodes("RMA_CREDIT");
  const [salesReturns, ar] = await Promise.all([
    accountByCode(map.debitCode),
    accountByCode(map.creditCode),
  ]);

  const existingKey = params.receiptId
    ? `rma-credit:${params.receiptId}`
    : receipts.length
      ? `rma-credit:${[...receipts.map((r) => r.id)].sort().join(",")}`
      : `rma-credit:${rma.id}:manual`;
  const already = await prisma.journalEntry.findUnique({ where: { idempotencyKey: existingKey } });
  if (already) {
    const memo = await prisma.arCreditMemo.findFirst({ where: { journalEntryId: already.id } });
    if (memo) return memo;
  }

  const result = await prisma.$transaction(async (db) => {
    const count = await db.arCreditMemo.count();
    const memo = await db.arCreditMemo.create({
      data: {
        number: `CM-${String(count + 1).padStart(5, "0")}`,
        customerId: rma.customerId,
        rmaId: rma.id,
        arInvoiceId: invoiceId,
        status: "APPLIED",
        subtotal: total,
        total,
        notes: params.notes || `Credit memo for ${rma.number}`,
        createdById: params.userId || undefined,
        lines: {
          create: lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            amount: l.amount,
            rmaReceiptId: l.rmaReceiptId || undefined,
          })),
        },
      },
    });
    const journal = await postJournal(
      {
        description: `Sales return ${memo.number} for ${rma.number}`,
        source: "RMA",
        sourceId: memo.id,
        idempotencyKey: existingKey,
        createdById: params.userId || undefined,
        status: "POSTED",
        lines: [
          { accountId: salesReturns.id, debit: total, memo: `${rma.number} sales return` },
          { accountId: ar.id, credit: total, memo: `${rma.number} AR credit` },
        ],
      },
      db
    );
    await db.arCreditMemo.update({
      where: { id: memo.id },
      data: { journalEntryId: journal.id },
    });
    for (const receipt of receipts) {
      await db.rmaReceipt.update({
        where: { id: receipt.id },
        data: { creditMemoId: memo.id },
      });
    }
    if (invoiceId) {
      const inv = await db.arInvoice.findUnique({ where: { id: invoiceId } });
      if (inv) {
        const amountCredited = money((inv.amountCredited || 0) + total);
        const open = money(inv.total - inv.amountPaid - amountCredited);
        await db.arInvoice.update({
          where: { id: inv.id },
          data: {
            amountCredited,
            status: open <= 0.001 ? "PAID" : inv.amountPaid > 0 || amountCredited > 0 ? "PARTIAL" : inv.status,
          },
        });
      }
    }
    return { ...memo, journalEntryId: journal.id };
  }, { timeout: 20000, maxWait: 10000 });

  await logAudit({
    entityType: "Rma",
    entityId: rma.id,
    action: "RMA_CREDIT_ISSUED",
    userId: params.userId,
    metadata: { creditMemoId: result.id, total, invoiceId },
  });
  return result;
}

export async function dispositionRmaReceipt(params: {
  receiptId: string;
  disposition: "RESTOCK" | "SCRAP";
  userId?: string | null;
  notes?: string | null;
}) {
  const receipt = await prisma.rmaReceipt.findUnique({
    where: { id: params.receiptId },
    include: { rma: true, part: true, inventoryItem: { include: { location: true } } },
  });
  if (!receipt) throw new Error("Return receipt not found");
  if (params.disposition === "RESTOCK") {
    if (receipt.disposition === "RESTOCKED" && receipt.destination === "SELLABLE") {
      return { receiptId: receipt.id, already: true, journalId: receipt.restockJournalId || receipt.cogsJournalId };
    }
    if (receipt.disposition === "SCRAPPED") throw new Error("This return was already scrapped");
    if (receipt.destination !== "INSPECTION" || receipt.disposition !== "PENDING") {
      throw new Error("Only inspection returns waiting on a decision can be released to sellable stock");
    }
  }
  if (params.disposition === "SCRAP") {
    if (receipt.disposition === "SCRAPPED") {
      return { receiptId: receipt.id, already: true, journalId: receipt.scrapJournalId };
    }
  }

  await ensureRmaAccountingDefaults();
  const accounts = await resolveItemAccounts(receipt.part);
  const inspection = await accountByCode((await mappedCodes("RMA_INSPECTION")).debitCode);
  const amount = money(receipt.quantity * (receipt.unitCost || 0));
  const storage = await locationFor("SELLABLE");
  if (params.disposition === "RESTOCK" && !storage) {
    throw new Error("A storage location is required to release returns to sellable stock");
  }

  const result = await prisma.$transaction(async (db) => {
    const claimed = await db.rmaReceipt.updateMany({
      where: {
        id: receipt.id,
        disposition: params.disposition === "SCRAP" ? { not: "SCRAPPED" } : "PENDING",
      },
      data: {
        disposition: params.disposition === "SCRAP" ? "SCRAPPED" : "RESTOCKED",
        notes: params.notes || receipt.notes,
      },
    });
    if (!claimed.count) throw new Error("This return already changed — refresh and retry");

    if (params.disposition === "RESTOCK") {
      const item = receipt.inventoryItem;
      if (!item) throw new Error("The returned inventory row is missing");
      await db.inventoryItem.update({
        where: { id: item.id },
        data: {
          locationId: storage!.id,
          quantityAvailable: item.quantityOnHand,
          quantityQuarantine: 0,
          mrbCaseId: null,
        },
      });
      const tx = await db.materialTransaction.create({
        data: {
          type: "RMA_RESTOCK",
          partId: receipt.partId,
          inventoryItemId: item.id,
          rmaId: receipt.rmaId,
          rmaReceiptId: receipt.id,
          quantity: receipt.quantity,
          unitCost: receipt.unitCost,
          fromLocation: item.location?.code,
          toLocation: storage!.code,
          lotNumber: receipt.lotNumber || undefined,
          serialNumber: receipt.serialNumber || undefined,
          reference: receipt.rma.number,
          notes: params.notes || "Released from inspection to sellable stock",
          userId: params.userId,
        },
      });
      await moveCostLayers({
        partId: receipt.partId,
        fromLocationId: item.locationId,
        toLocationId: storage!.id,
        inventoryItemId: item.id,
        quantity: receipt.quantity,
        materialTransactionId: tx.id,
        ownership: item.ownership,
        fallbackUnitCost: receipt.unitCost,
        db,
      });
      let journalId: string | null = null;
      if (amount > 0.001) {
        const journal = await postJournal(
          {
            description: `${receipt.rma.number} released to sellable stock — ${receipt.part.partNumber}`,
            source: "RMA",
            sourceId: receipt.id,
            idempotencyKey: `rma-restock:${receipt.id}`,
            createdById: params.userId || undefined,
            status: "POSTED",
            lines: [
              { accountId: accounts.fg.id, debit: amount, memo: `${receipt.part.partNumber} to stock` },
              { accountId: inspection.id, credit: amount, memo: `${receipt.part.partNumber} leaves inspection` },
            ],
          },
          db
        );
        journalId = journal.id;
        await db.materialTransaction.update({ where: { id: tx.id }, data: { journalEntryId: journal.id } });
        await linkConsumptionsToJournal({ materialTransactionId: tx.id, journalEntryId: journal.id, db });
        await db.rmaReceipt.update({ where: { id: receipt.id }, data: { restockJournalId: journal.id } });
      }
      return { receiptId: receipt.id, journalId, materialTransactionId: tx.id };
    }

    const item = receipt.inventoryItem;
    if (item) {
      await db.inventoryItem.update({
        where: { id: item.id },
        data: {
          quantityOnHand: 0,
          quantityAvailable: 0,
          quantityQuarantine: 0,
        },
      });
    }
    const tx = await db.materialTransaction.create({
      data: {
        type: "SCRAP",
        partId: receipt.partId,
        inventoryItemId: item?.id,
        rmaId: receipt.rmaId,
        rmaReceiptId: receipt.id,
        quantity: receipt.quantity,
        unitCost: receipt.unitCost,
        fromLocation: item?.location?.code,
        reference: receipt.rma.number,
        notes: params.notes || "Customer return scrapped",
        userId: params.userId,
      },
    });
    const relief = item
      ? await consumeOutboundCost({
          partId: receipt.partId,
          locationId: item.locationId,
          inventoryItemId: item.id,
          quantity: receipt.quantity,
          fallbackUnitCost: receipt.unitCost,
          materialTransactionId: tx.id,
          ownership: item.ownership,
          db,
        })
      : { amount, unitCost: receipt.unitCost };
    if (item && Math.abs(relief.unitCost - (receipt.unitCost || 0)) > 0.0001) {
      await db.materialTransaction.update({ where: { id: tx.id }, data: { unitCost: relief.unitCost } });
    }
    let journalId: string | null = null;
    if (relief.amount > 0.001) {
      const creditCode = receipt.destination === "INSPECTION" && receipt.disposition === "PENDING" ? inspection.code : "1220";
      const journal = await postScrap({
        materialTransactionId: tx.id,
        amount: relief.amount,
        userId: params.userId,
        memo: `${receipt.rma.number} return scrapped — ${receipt.part.partNumber}`,
        creditCode,
        db,
      });
      journalId = journal?.id || null;
      if (journal) {
        await db.materialTransaction.update({ where: { id: tx.id }, data: { journalEntryId: journal.id } });
        await linkConsumptionsToJournal({ materialTransactionId: tx.id, journalEntryId: journal.id, db });
        await db.rmaReceipt.update({ where: { id: receipt.id }, data: { scrapJournalId: journal.id } });
      }
    }
    return { receiptId: receipt.id, journalId, materialTransactionId: tx.id };
  }, { timeout: 20000, maxWait: 10000 });

  await logAudit({
    entityType: "Rma",
    entityId: receipt.rmaId,
    action: params.disposition === "SCRAP" ? "RMA_SCRAPPED" : "RMA_RESTOCKED",
    userId: params.userId,
    metadata: { receiptId: receipt.id, amount },
  });
  return result;
}

/** After an MRB board decision, keep the RMA receipt and its books in step. */
export async function syncRmaReceiptWithMrbDisposition(params: {
  inventoryItemId: string;
  disposition: "USE_AS_IS" | "SCRAP" | "REWORK" | "REPAIR" | "RETURN_TO_SUPPLIER";
  scrapTransactionId?: string | null;
  userId?: string | null;
}) {
  const receipt = await prisma.rmaReceipt.findFirst({
    where: { inventoryItemId: params.inventoryItemId, disposition: "PENDING" },
  });
  if (!receipt) return null;
  if (params.disposition === "USE_AS_IS") {
    return dispositionRmaReceipt({ receiptId: receipt.id, disposition: "RESTOCK", userId: params.userId, notes: "Released by MRB as use-as-is" });
  }
  if (params.disposition === "SCRAP") {
    if (receipt.disposition !== "PENDING") return receipt;
    // Inventory was already zeroed by the MRB path; post the RMA scrap journal if needed.
    return dispositionRmaReceipt({ receiptId: receipt.id, disposition: "SCRAP", userId: params.userId, notes: "Scrapped by MRB" });
  }
  return receipt;
}
