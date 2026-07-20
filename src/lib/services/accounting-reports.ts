/**
 * Extra accounting reports: 1099 vendor tracking and budget-vs-actual.
 * Both read from live data (AP payments, enacted budgets); no new ledgers.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/** IRS 1099-NEC reporting threshold (per payee, per year). */
export const IRS_1099_THRESHOLD = 600;

/**
 * 1099 workspace: every vendor flagged 1099-reportable with the total paid
 * in the tax year (from AP payments), the $600 threshold flag, plus the
 * full vendor list so 1099 status / tax IDs can be maintained.
 */
export async function get1099Report(opts?: { year?: number }) {
  const year = opts?.year ?? new Date().getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);

  const [vendors, payments] = await Promise.all([
    prisma.supplier.findMany({
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, is1099: true, taxId: true, contactEmail: true },
    }),
    prisma.apPayment.findMany({
      where: { paymentDate: { gte: start, lt: end } },
      select: { amount: true, invoice: { select: { supplierId: true } } },
    }),
  ]);

  const paidBySupplier = new Map<string, number>();
  for (const p of payments) {
    const sid = p.invoice?.supplierId;
    if (!sid) continue;
    paidBySupplier.set(sid, (paidBySupplier.get(sid) || 0) + p.amount);
  }

  const rows = vendors
    .filter((v) => v.is1099)
    .map((v) => {
      const paid = Math.round((paidBySupplier.get(v.id) || 0) * 100) / 100;
      return {
        id: v.id,
        code: v.code,
        name: v.name,
        taxId: v.taxId,
        email: v.contactEmail,
        paid,
        reportable: paid >= IRS_1099_THRESHOLD,
        missingTaxId: !v.taxId,
      };
    })
    .sort((a, b) => b.paid - a.paid);

  return {
    year,
    rows,
    vendors, // full list for the maintenance panel
    totalPaid: Math.round(rows.reduce((s, r) => s + r.paid, 0) * 100) / 100,
    reportableCount: rows.filter((r) => r.reportable).length,
    missingTaxIds: rows.filter((r) => r.reportable && r.missingTaxId).length,
  };
}

/** Toggle a vendor's 1099 status and tax ID. */
export async function setSupplier1099(params: {
  supplierId: string;
  is1099: boolean;
  taxId?: string | null;
  userId?: string | null;
}) {
  const supplier = await prisma.supplier.update({
    where: { id: params.supplierId },
    data: {
      is1099: params.is1099,
      ...(params.taxId !== undefined ? { taxId: params.taxId?.trim() || null } : {}),
    },
  });
  await logAudit({
    entityType: "Supplier",
    entityId: supplier.id,
    action: "SET_1099",
    userId: params.userId,
    metadata: { is1099: params.is1099 },
  });
  return supplier;
}

/**
 * Budget vs. actual across enacted (and closed) budgets: budgeted vs
 * actual with labor/material/other breakdown, variance, and % used.
 */
export async function getBudgetVsActual() {
  const budgets = await prisma.budget.findMany({
    where: { status: { in: ["ENACTED", "CLOSED"] } },
    orderBy: [{ status: "asc" }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      name: true,
      status: true,
      costClass: true,
      chargeCode: true,
      totalAmount: true,
      laborBudget: true,
      materialBudget: true,
      otherBudget: true,
      actualTotal: true,
      actualLabor: true,
      actualMaterial: true,
      actualOther: true,
      owner: { select: { name: true } },
    },
  });

  const rows = budgets.map((b) => {
    const variance = Math.round((b.totalAmount - b.actualTotal) * 100) / 100;
    const pctUsed = b.totalAmount > 0 ? Math.round((b.actualTotal / b.totalAmount) * 100) : 0;
    return {
      id: b.id,
      number: b.number,
      name: b.name,
      status: b.status,
      costClass: b.costClass,
      chargeCode: b.chargeCode,
      owner: b.owner?.name || null,
      budget: b.totalAmount,
      actual: b.actualTotal,
      variance,
      pctUsed,
      over: b.actualTotal > b.totalAmount,
    };
  });

  const totalBudget = Math.round(rows.reduce((s, r) => s + r.budget, 0) * 100) / 100;
  const totalActual = Math.round(rows.reduce((s, r) => s + r.actual, 0) * 100) / 100;
  return {
    rows,
    totalBudget,
    totalActual,
    totalVariance: Math.round((totalBudget - totalActual) * 100) / 100,
    overCount: rows.filter((r) => r.over).length,
  };
}
