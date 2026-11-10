/**
 * Closed-loop billing — the transactions raise the invoices.
 *
 * Shipping a sales order raises the AR invoice (net 30) and posts the
 * revenue + COGS journals. Receiving against a PO creates the AP
 * voucher by evaluated receipt settlement (ERS): the 3-way match is
 * PO price × received quantity, so the payable always ties back to a
 * receipt. Accounting pays/collects from the AR/AP tabs as before.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { postJournal } from "@/lib/services/gaap";
import { chargeForPurchaseOrder, chargeForSalesOrder } from "@/lib/services/gl-posting";

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

  // Revenue recognition: Dr AR / Cr Sales Revenue.
  // The program comes from the work order on this sales order (PMO), not a second contract file.
  const charge = await chargeForSalesOrder(so.id);
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
      programId: charge.programId || undefined,
      projectId: charge.projectId || undefined,
      workOrderId: charge.workOrderId || undefined,
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

  // Inventory capitalization: Dr Inventory - Raw Materials / Cr AP.
  // Tagged to the PO's project program so the receipt is traceable. The job
  // is charged later, when the material is issued — not on receipt.
  const charge = await chargeForPurchaseOrder(po.id);
  const [inv, ap] = await Promise.all([account("1200"), account("2000")]);
  if (inv && ap) {
    const gfpNote = po.isGovernmentProperty
      ? "Government property receipt — confirm this should sit on the company books"
      : params.receiptNumber;
    await postJournal({
      description: `Receipt ${params.receiptNumber} — PO ${po.number} inventory capitalization`,
      source: "AP",
      sourceId: voucher.id,
      programId: charge.programId || undefined,
      projectId: charge.projectId || undefined,
      clinId: charge.clinId || undefined,
      createdById: params.userId || undefined,
      lines: [
        { accountId: inv.id, debit: total, memo: gfpNote },
        { accountId: ap.id, credit: total, memo: po.number },
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

/**
 * Manual vendor invoice (outside / services / non-ERS).
 * Use when the supplier bills you without a receiving-based voucher, or for
 * non-inventory services. Optionally links a PO. Posts Dr Expense (or AP hold)
 * / Cr AP. Pay later from Accounting → AP or the supplier Invoices tab.
 */
export async function createVendorApInvoice(params: {
  supplierId: string;
  amount: number;
  /** Vendor's invoice number if known */
  vendorInvoiceNumber?: string | null;
  invoiceDate?: Date;
  dueDate?: Date | null;
  purchaseOrderId?: string | null;
  /** When set, the bill is outside processing on that job (WIP), not a period expense. */
  workOrderId?: string | null;
  description?: string | null;
  /** GL expense account to debit (default 6000 Operating expense if present) */
  expenseAccountId?: string | null;
  tax?: number;
  userId?: string | null;
}) {
  const amount = money(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invoice amount must be positive and finite");

  const supplier = await prisma.supplier.findUnique({
    where: { id: params.supplierId },
  });
  if (!supplier) throw new Error("Supplier / vendor not found");

  if (params.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: params.purchaseOrderId },
    });
    if (!po) throw new Error("Purchase order not found");
    if (po.supplierId !== params.supplierId) {
      throw new Error("PO belongs to a different supplier");
    }
  }

  const tax = money(params.tax ?? 0);
  const total = money(amount + tax);
  if (!Number.isFinite(tax) || tax < 0 || !Number.isFinite(total)) throw new Error("Invoice tax and total must be finite and non-negative");
  const count = await prisma.apInvoice.count();
  const number = `AP-${String(count + 1).padStart(5, "0")}`;
  const due =
    params.dueDate ||
    new Date(Date.now() + NET_DAYS * 86_400_000);

  const notes = [
    params.description?.trim() || "Vendor invoice",
    params.vendorInvoiceNumber
      ? `Vendor inv # ${params.vendorInvoiceNumber}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const voucherId = randomUUID();
  let posting: Parameters<typeof postJournal>[0];
  if (params.workOrderId) {
    const { prepareOutsideProcessingJournal } = await import("@/lib/services/gl-posting");
    const prepared = await prepareOutsideProcessingJournal({
      sourceId: voucherId, amount: total, workOrderId: params.workOrderId,
      userId: params.userId, memo: `Vendor bill ${number} — ${supplier.name}`,
    });
    if (!prepared) throw new Error("Outside processing posting must be positive");
    posting = prepared;
  } else {
    const expense = (params.expenseAccountId
      ? await prisma.account.findUnique({ where: { id: params.expenseAccountId } }) : null)
      || (await account("6000")) || (await account("5100"))
      || (await prisma.account.findFirst({ where: { type: "EXPENSE", isActive: true }, orderBy: { code: "asc" } }));
    const ap = await account("2000");
    if (!expense || !ap) throw new Error("Missing expense or accounts payable GL account");
    posting = {
      description: `Vendor AP ${number} — ${supplier.name}`,
      source: "AP", sourceId: voucherId, createdById: params.userId || undefined,
      date: params.invoiceDate,
      lines: [{ accountId: expense.id, debit: total, memo: notes.slice(0, 120) },
        { accountId: ap.id, credit: total, memo: number }],
    };
  }
  const voucher = await prisma.$transaction(async (db) => {
    const voucher = await db.apInvoice.create({
    data: {
      id: voucherId,
      number,
      supplierId: params.supplierId,
      purchaseOrderId: params.purchaseOrderId || null,
      invoiceDate: params.invoiceDate || new Date(),
      dueDate: due,
      status: "OPEN",
      subtotal: amount,
      tax,
      total,
      notes,
    },
  });
    await postJournal(posting, db);
    return voucher;
  });

  await logAudit({
    entityType: "ApInvoice",
    entityId: voucher.id,
    action: "VENDOR_INVOICE_CREATED",
    userId: params.userId,
    metadata: {
      number,
      supplierId: params.supplierId,
      total,
      purchaseOrderId: params.purchaseOrderId,
      vendorInvoiceNumber: params.vendorInvoiceNumber,
    },
  });

  return voucher;
}
