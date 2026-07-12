/**
 * Closed-loop billing — the transactions raise the invoices.
 *
 * Shipping a sales order raises the AR invoice (net 30) and posts the
 * revenue + COGS journals. Receiving against a PO creates the AP
 * voucher by evaluated receipt settlement (ERS): the 3-way match is
 * PO price × received quantity, so the payable always ties back to a
 * receipt. Accounting pays/collects from the AR/AP tabs as before.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { postJournal } from "@/lib/services/gaap";

const NET_DAYS = 30;
const money = (n: number) => Math.round(n * 100) / 100;

async function account(code: string) {
  return prisma.account.findFirst({ where: { code } });
}

/** Raise the AR invoice for a shipped sales order (idempotent per SO). */
export async function raiseArInvoiceForShipment(params: {
  salesOrderId: string;
  userId?: string | null;
}) {
  const existing = await prisma.arInvoice.findFirst({
    where: { salesOrderId: params.salesOrderId },
  });
  if (existing) return existing; // already billed

  const so = await prisma.salesOrder.findUnique({
    where: { id: params.salesOrderId },
    include: {
      customer: true,
      lines: { include: { part: true } },
    },
  });
  if (!so || so.lines.length === 0) return null;

  const subtotal = money(
    so.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  );
  if (subtotal <= 0) return null;

  const count = await prisma.arInvoice.count();
  const invoice = await prisma.arInvoice.create({
    data: {
      number: `INV-${String(count + 1).padStart(5, "0")}`,
      customerId: so.customerId,
      salesOrderId: so.id,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + NET_DAYS * 86_400_000),
      status: "OPEN",
      subtotal,
      total: subtotal,
      notes: `Auto-raised on shipment of ${so.number}`,
      lines: {
        create: so.lines.map((l) => ({
          description: `${l.part?.partNumber || "Item"} — ${l.part?.description || l.description || so.number}`,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          amount: money(l.quantity * l.unitPrice),
        })),
      },
    },
  });

  // Revenue recognition: Dr AR / Cr Sales Revenue
  const [ar, revenue, cogsAcct, fg] = await Promise.all([
    account("1100"),
    account("4000"),
    account("5000"),
    account("1220"),
  ]);
  if (ar && revenue) {
    await postJournal({
      description: `Revenue — ${so.number} shipped (${invoice.number})`,
      source: "AR",
      sourceId: invoice.id,
      createdById: params.userId || undefined,
      lines: [
        { accountId: ar.id, debit: subtotal },
        { accountId: revenue.id, credit: subtotal },
      ],
    });
  }
  // COGS relief at standard: Dr COGS / Cr Finished Goods
  const cogsValue = money(
    so.lines.reduce((s, l) => s + l.quantity * (l.part?.standardCost || 0), 0)
  );
  if (cogsAcct && fg && cogsValue > 0) {
    await postJournal({
      description: `COGS — ${so.number} shipped at standard`,
      source: "AR",
      sourceId: invoice.id,
      createdById: params.userId || undefined,
      lines: [
        { accountId: cogsAcct.id, debit: cogsValue },
        { accountId: fg.id, credit: cogsValue },
      ],
    });
  }

  await logAudit({
    entityType: "ArInvoice",
    entityId: invoice.id,
    action: "AR_AUTO_RAISED",
    userId: params.userId,
    metadata: { salesOrder: so.number, total: subtotal, cogs: cogsValue },
  });
  return invoice;
}

/**
 * Evaluated receipt settlement: receiving against a PO creates the AP
 * voucher at PO price × received qty (the 3-way match), one voucher
 * per receipt.
 */
export async function raiseApInvoiceForReceipt(params: {
  purchaseOrderId: string;
  receiptNumber: string;
  received: { description: string; quantity: number; unitCost: number }[];
  userId?: string | null;
}) {
  const total = money(
    params.received.reduce((s, r) => s + r.quantity * r.unitCost, 0)
  );
  if (total <= 0) return null;

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.purchaseOrderId },
    include: { supplier: true },
  });
  if (!po) return null;

  const count = await prisma.apInvoice.count();
  const voucher = await prisma.apInvoice.create({
    data: {
      number: `AP-${String(count + 1).padStart(5, "0")}`,
      supplierId: po.supplierId,
      purchaseOrderId: po.id,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + NET_DAYS * 86_400_000),
      status: "OPEN",
      subtotal: total,
      total,
      notes: `ERS voucher — 3-way match (PO ${po.number} price × ${params.receiptNumber} received qty)`,
    },
  });

  // Inventory capitalization: Dr Inventory - Raw Materials / Cr AP
  const [inv, ap] = await Promise.all([account("1200"), account("2000")]);
  if (inv && ap) {
    await postJournal({
      description: `Receipt ${params.receiptNumber} — PO ${po.number} inventory capitalization`,
      source: "AP",
      sourceId: voucher.id,
      createdById: params.userId || undefined,
      lines: [
        { accountId: inv.id, debit: total },
        { accountId: ap.id, credit: total },
      ],
    });
  }

  await logAudit({
    entityType: "ApInvoice",
    entityId: voucher.id,
    action: "AP_ERS_VOUCHER",
    userId: params.userId,
    metadata: { po: po.number, receipt: params.receiptNumber, total },
  });
  return voucher;
}
