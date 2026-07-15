/**
 * GAAP-oriented reporting helpers — double-entry trial balance,
 * income statement, balance sheet, cash activity proxy from journals.
 */
import { prisma } from "@/lib/db";

export async function getGaapReportPack() {
  const [accounts, journals, ar, ap, woAgg, engLabor, projectDev] =
    await Promise.all([
      prisma.account.findMany({ orderBy: { code: "asc" } }),
      prisma.journalEntry.findMany({
        where: { status: "POSTED" },
        include: { lines: { include: { account: true } } },
        orderBy: { date: "desc" },
        take: 100,
      }),
      prisma.arInvoice.findMany({
        include: { customer: true, payments: true },
      }),
      prisma.apInvoice.findMany({
        include: { payments: true, purchaseOrder: true },
      }),
      prisma.workOrder.aggregate({
        _sum: { actualCost: true, standardCost: true },
      }),
      prisma.timeEntry.aggregate({
        where: { type: "ENG_SCAN", status: "APPROVED" },
        _sum: { hours: true, costAmount: true },
      }),
      prisma.project.aggregate({
        _sum: { developmentActual: true, developmentBudget: true, actualCost: true },
      }),
    ]);

  const byType = (t: string) => accounts.filter((a) => a.type === t);
  const sum = (rows: { balance: number }[]) =>
    rows.reduce((s, a) => s + a.balance, 0);

  const assets = byType("ASSET");
  const liabilities = byType("LIABILITY");
  const equity = byType("EQUITY");
  const revenue = byType("REVENUE");
  const cogs = byType("COGS");
  const expenses = byType("EXPENSE");

  const totalAssets = sum(assets);
  const totalLiab = sum(liabilities);
  const totalEquity = sum(equity);
  const totalRev = sum(revenue);
  const totalCogs = sum(cogs);
  const totalOpex = sum(expenses);
  const grossProfit = totalRev - totalCogs;
  const netIncome = grossProfit - totalOpex;

  // Trial balance: debits = credits for posted JE lines
  let tbDebit = 0;
  let tbCredit = 0;
  for (const je of journals) {
    for (const line of je.lines) {
      tbDebit += line.debit || 0;
      tbCredit += line.credit || 0;
    }
  }

  const arOpen = ar
    .filter((i) => ["OPEN", "PARTIAL"].includes(i.status))
    .reduce((s, i) => s + (i.total - i.amountPaid), 0);
  const apOpen = ap
    .filter((i) => ["OPEN", "PARTIAL"].includes(i.status))
    .reduce((s, i) => s + (i.total - i.amountPaid), 0);

  const woActual = woAgg._sum.actualCost || 0;
  const woStd = woAgg._sum.standardCost || 0;

  return {
    incomeStatement: {
      revenue: totalRev,
      cogs: totalCogs,
      grossProfit,
      operatingExpenses: totalOpex,
      netIncome,
      revenueAccounts: revenue,
      cogsAccounts: cogs,
      expenseAccounts: expenses,
    },
    balanceSheet: {
      assets: totalAssets,
      liabilities: totalLiab,
      equity: totalEquity,
      // Revenue/expense accounts haven't been closed to retained earnings,
      // so the accounting equation is A = L + E + current-period earnings.
      currentEarnings: netIncome,
      liabilitiesAndEquity: totalLiab + totalEquity + netIncome,
      balanced:
        Math.abs(totalAssets - (totalLiab + totalEquity + netIncome)) < 0.01,
      assetAccounts: assets,
      liabilityAccounts: liabilities,
      equityAccounts: equity,
    },
    trialBalance: {
      debit: tbDebit,
      credit: tbCredit,
      balanced: Math.abs(tbDebit - tbCredit) < 0.01,
      journals,
    },
    arAp: { arOpen, apOpen, ar, ap },
    costAccounting: {
      woActual,
      woStd,
      woVariance: woActual - woStd,
      engLaborHours: engLabor._sum.hours || 0,
      engLaborCost: engLabor._sum.costAmount || 0,
      projectDevActual: projectDev._sum.developmentActual || 0,
      projectDevBudget: projectDev._sum.developmentBudget || 0,
      projectActualCost: projectDev._sum.actualCost || 0,
    },
  };
}

async function applyJournalBalances(
  lines: { accountId: string; debit: number; credit: number }[]
) {
  for (const line of lines) {
    const acct = await prisma.account.findUnique({
      where: { id: line.accountId },
    });
    if (!acct) continue;
    const delta = ["ASSET", "EXPENSE", "COGS"].includes(acct.type)
      ? (line.debit || 0) - (line.credit || 0)
      : (line.credit || 0) - (line.debit || 0);
    await prisma.account.update({
      where: { id: acct.id },
      data: { balance: { increment: delta } },
    });
  }
}

/**
 * Create a balanced journal. System sources (PAYROLL, AP, AR, …) post
 * immediately. Manual entries default to PENDING_APPROVAL until approved.
 * status: DRAFT | PENDING_APPROVAL | POSTED
 */
export async function postJournal(params: {
  description: string;
  lines: {
    accountId: string;
    debit?: number;
    credit?: number;
    memo?: string;
    chargeCode?: string;
  }[];
  source?: string;
  sourceId?: string;
  projectId?: string;
  chargeCode?: string;
  createdById?: string;
  /** Force status. Default: MANUAL → PENDING_APPROVAL, else POSTED. */
  status?: "DRAFT" | "PENDING_APPROVAL" | "POSTED";
  attachments?: {
    url: string;
    fileName?: string;
    caption?: string;
    docType?: string;
  }[];
}) {
  const debit = params.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const credit = params.lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(debit - credit) > 0.001) {
    throw new Error(
      `Journal not balanced: debits ${debit} ≠ credits ${credit}`
    );
  }
  if (params.lines.length < 2) {
    throw new Error("Journal needs at least two lines");
  }
  const source = params.source || "MANUAL";
  const status =
    params.status ||
    (source === "MANUAL" ? "PENDING_APPROVAL" : "POSTED");
  const count = await prisma.journalEntry.count();
  const number = `JE-${String(count + 1).padStart(5, "0")}`;
  const je = await prisma.journalEntry.create({
    data: {
      number,
      description: params.description,
      status,
      source,
      sourceId: params.sourceId,
      projectId: params.projectId,
      chargeCode: params.chargeCode,
      createdById: params.createdById,
      postedAt: status === "POSTED" ? new Date() : null,
      lines: {
        create: params.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit || 0,
          credit: l.credit || 0,
          memo: l.memo || null,
          chargeCode: l.chargeCode || params.chargeCode || null,
        })),
      },
      attachments: params.attachments?.length
        ? {
            create: params.attachments.map((a) => ({
              url: a.url,
              fileName: a.fileName,
              caption: a.caption,
              docType: a.docType || "RECEIPT",
              uploadedById: params.createdById,
            })),
          }
        : undefined,
    },
    include: { lines: true, attachments: true },
  });

  if (status === "POSTED") {
    await applyJournalBalances(je.lines);
    await applyArSettlementFromJournal(je);
  }

  return je;
}

/**
 * When a journal that credits the AR control account is linked to a specific
 * AR invoice (source AR_SETTLE, sourceId = invoiceId), apply that credit to the
 * invoice's subledger — so posting the JE settles the invoice automatically
 * instead of the user having to record the payment separately in AR. The GL is
 * already booked by the JE itself, so no second JE is posted here. Idempotent.
 */
async function applyArSettlementFromJournal(je: {
  number: string;
  source: string | null;
  sourceId: string | null;
  lines: { accountId: string; credit: number }[];
}) {
  if (je.source !== "AR_SETTLE" || !je.sourceId) return;
  const ar = await prisma.account.findFirst({ where: { code: "1100" } });
  if (!ar) return;
  const credit = je.lines
    .filter((l) => l.accountId === ar.id)
    .reduce((s, l) => s + (l.credit || 0), 0);
  if (credit <= 0) return;
  const inv = await prisma.arInvoice.findUnique({ where: { id: je.sourceId } });
  if (!inv || ["PAID", "VOID"].includes(inv.status)) return;
  // Don't double-apply if this JE already settled the invoice.
  const already = await prisma.arPayment.findFirst({
    where: { invoiceId: inv.id, reference: je.number },
  });
  if (already) return;
  const amountPaid = Math.min(inv.total, inv.amountPaid + credit);
  const status =
    amountPaid >= inv.total - 0.001 ? "PAID" : amountPaid > 0 ? "PARTIAL" : inv.status;
  await prisma.arPayment.create({
    data: {
      invoiceId: inv.id,
      amount: Math.min(credit, inv.total - inv.amountPaid),
      method: "JOURNAL",
      reference: je.number,
      paymentDate: new Date(),
    },
  });
  await prisma.arInvoice.update({
    where: { id: inv.id },
    data: { amountPaid, status },
  });
}

/** Approve a pending journal — posts balances. */
export async function approveJournal(params: {
  id: string;
  approvedById?: string | null;
}) {
  const je = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: params.id },
    include: { lines: true },
  });
  if (je.status === "POSTED") return je;
  if (!["PENDING_APPROVAL", "DRAFT"].includes(je.status)) {
    throw new Error(`Cannot approve journal in status ${je.status}`);
  }
  const updated = await prisma.journalEntry.update({
    where: { id: je.id },
    data: { status: "POSTED", postedAt: new Date() },
    include: { lines: true, attachments: true },
  });
  await applyJournalBalances(updated.lines);
  await applyArSettlementFromJournal(updated);
  return updated;
}

export async function voidJournal(params: {
  id: string;
  reason?: string | null;
  voidedById?: string | null;
}) {
  if (!params.reason?.trim()) {
    throw new Error("A void reason is required");
  }
  const je = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: params.id },
    include: { lines: true },
  });
  if (je.status === "VOID") return je;
  if (je.status === "POSTED") {
    // Reverse balances
    await applyJournalBalances(
      je.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.credit,
        credit: l.debit,
      }))
    );
  }
  return prisma.journalEntry.update({
    where: { id: je.id },
    data: { status: "VOID", voidReason: params.reason.trim() },
  });
}

export async function listJournalEntries(opts?: {
  take?: number;
  from?: Date | null;
  to?: Date | null;
  status?: string | null;
}) {
  const take = opts?.take ?? 80;
  const dateFilter =
    opts?.from || opts?.to
      ? {
          date: {
            ...(opts.from ? { gte: opts.from } : {}),
            ...(opts.to ? { lte: opts.to } : {}),
          },
        }
      : {};
  return prisma.journalEntry.findMany({
    where: {
      ...dateFilter,
      ...(opts?.status ? { status: opts.status } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
    include: {
      lines: { include: { account: true } },
      attachments: true,
    },
  });
}

/** Record a customer receipt against an AR invoice. */
export async function recordArPayment(params: {
  invoiceId: string;
  amount: number;
  method?: string;
  reference?: string | null;
  paymentDate?: Date;
  userId?: string | null;
}) {
  if (params.amount <= 0) throw new Error("Payment amount must be positive");
  const inv = await prisma.arInvoice.findUniqueOrThrow({
    where: { id: params.invoiceId },
  });
  if (["PAID", "VOID"].includes(inv.status)) {
    throw new Error(`Invoice ${inv.number} is ${inv.status}`);
  }
  const amountPaid = Math.min(inv.total, inv.amountPaid + params.amount);
  const status =
    amountPaid >= inv.total - 0.001
      ? "PAID"
      : amountPaid > 0
        ? "PARTIAL"
        : inv.status;

  const payment = await prisma.arPayment.create({
    data: {
      invoiceId: inv.id,
      amount: params.amount,
      method: params.method || "CHECK",
      reference: params.reference || null,
      paymentDate: params.paymentDate || new Date(),
    },
  });
  await prisma.arInvoice.update({
    where: { id: inv.id },
    data: { amountPaid, status },
  });

  // Cash-side JE: Dr Cash / Cr AR
  const cash = await prisma.account.findFirst({ where: { code: "1000" } });
  const ar = await prisma.account.findFirst({ where: { code: "1100" } });
  if (cash && ar && cash.id !== ar.id) {
    await postJournal({
      description: `AR receipt ${inv.number}`,
      source: "AR",
      sourceId: payment.id,
      createdById: params.userId || undefined,
      status: "POSTED",
      lines: [
        { accountId: cash.id, debit: params.amount, memo: inv.number },
        { accountId: ar.id, credit: params.amount, memo: inv.number },
      ],
    });
  }
  return payment;
}

/** Record a vendor payment against an AP invoice. */
export async function recordApPayment(params: {
  invoiceId: string;
  amount: number;
  method?: string;
  reference?: string | null;
  paymentDate?: Date;
  userId?: string | null;
}) {
  if (params.amount <= 0) throw new Error("Payment amount must be positive");
  const inv = await prisma.apInvoice.findUniqueOrThrow({
    where: { id: params.invoiceId },
  });
  if (["PAID", "VOID"].includes(inv.status)) {
    throw new Error(`Invoice ${inv.number} is ${inv.status}`);
  }
  const amountPaid = Math.min(inv.total, inv.amountPaid + params.amount);
  const status =
    amountPaid >= inv.total - 0.001
      ? "PAID"
      : amountPaid > 0
        ? "PARTIAL"
        : inv.status;

  const payment = await prisma.apPayment.create({
    data: {
      invoiceId: inv.id,
      amount: params.amount,
      method: params.method || "ACH",
      reference: params.reference || null,
      paymentDate: params.paymentDate || new Date(),
    },
  });
  await prisma.apInvoice.update({
    where: { id: inv.id },
    data: { amountPaid, status },
  });

  const cash = await prisma.account.findFirst({ where: { code: "1000" } });
  const ap = await prisma.account.findFirst({ where: { code: "2000" } });
  if (cash && ap) {
    await postJournal({
      description: `AP payment ${inv.number}`,
      source: "AP",
      sourceId: payment.id,
      createdById: params.userId || undefined,
      status: "POSTED",
      lines: [
        { accountId: ap.id, debit: params.amount, memo: inv.number },
        { accountId: cash.id, credit: params.amount, memo: inv.number },
      ],
    });
  }
  return payment;
}

/** Quick expense journal: Dr expense account / Cr cash or payable. */
export async function createExpenseEntry(params: {
  description: string;
  expenseAccountId: string;
  creditAccountId: string;
  amount: number;
  receiptUrl?: string | null;
  receiptFileName?: string | null;
  chargeCode?: string | null;
  projectId?: string | null;
  createdById?: string | null;
  submitForApproval?: boolean;
}) {
  if (params.amount <= 0) throw new Error("Amount must be positive");
  const attachments = params.receiptUrl
    ? [
        {
          url: params.receiptUrl,
          fileName: params.receiptFileName || "receipt",
          docType: "RECEIPT",
        },
      ]
    : undefined;
  return postJournal({
    description: params.description,
    source: "EXPENSE",
    projectId: params.projectId || undefined,
    chargeCode: params.chargeCode || undefined,
    createdById: params.createdById || undefined,
    status: params.submitForApproval === false ? "POSTED" : "PENDING_APPROVAL",
    attachments,
    lines: [
      {
        accountId: params.expenseAccountId,
        debit: params.amount,
        chargeCode: params.chargeCode || undefined,
      },
      {
        accountId: params.creditAccountId,
        credit: params.amount,
        chargeCode: params.chargeCode || undefined,
      },
    ],
  });
}
