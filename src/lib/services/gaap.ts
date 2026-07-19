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

/**
 * Register-style account ledger: every posted journal line hitting the
 * account, oldest→newest, with a running balance in the account's natural
 * (normal-balance) sign. Also returns opening balance before the window.
 */
export async function getAccountRegister(
  accountId: string,
  opts?: { from?: Date | null; to?: Date | null }
) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });
  if (!account) return null;

  const debitNormal = ["ASSET", "EXPENSE", "COGS"].includes(account.type);
  const signed = (debit: number, credit: number) =>
    debitNormal ? (debit || 0) - (credit || 0) : (credit || 0) - (debit || 0);

  const lines = await prisma.journalLine.findMany({
    where: { accountId, journalEntry: { status: "POSTED" } },
    include: {
      journalEntry: {
        select: { id: true, number: true, date: true, description: true, source: true },
      },
    },
    orderBy: [{ journalEntry: { date: "asc" } }, { id: "asc" }],
  });

  const from = opts?.from ?? null;
  const to = opts?.to ?? null;

  let opening = 0;
  const windowRows: {
    id: string;
    date: Date;
    number: string;
    description: string;
    source: string | null;
    journalEntryId: string;
    memo: string | null;
    debit: number;
    credit: number;
    balance: number;
  }[] = [];

  // First pass: opening balance from lines strictly before the window.
  for (const l of lines) {
    const d = l.journalEntry.date;
    if (from && d < from) {
      opening += signed(l.debit, l.credit);
    }
  }

  let running = opening;
  for (const l of lines) {
    const d = l.journalEntry.date;
    if (from && d < from) continue;
    if (to && d > to) continue;
    running += signed(l.debit, l.credit);
    windowRows.push({
      id: l.id,
      date: d,
      number: l.journalEntry.number,
      description: l.journalEntry.description,
      source: l.journalEntry.source,
      journalEntryId: l.journalEntry.id,
      memo: l.memo,
      debit: l.debit || 0,
      credit: l.credit || 0,
      balance: running,
    });
  }

  const totalDebit = windowRows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = windowRows.reduce((s, r) => s + r.credit, 0);

  return {
    account,
    debitNormal,
    opening,
    closing: running,
    totalDebit,
    totalCredit,
    // newest first for display
    rows: windowRows.reverse(),
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
  /** Entry date (defaults to now). Used by recurring/reversing entries. */
  date?: Date;
  /** Links a REVERSAL entry back to the journal it reverses. */
  reversesJournalId?: string;
  /** Dates the automatic reversing entry for a posted accrual. */
  autoReverseOn?: Date;
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
  if (status === "POSTED") {
    await assertPeriodOpen(params.date || new Date(), "post");
  }
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
      date: params.date || new Date(),
      reversesJournalId: params.reversesJournalId || null,
      autoReverseOn: params.autoReverseOn || null,
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

/** Current month-end close date, or null if the books are fully open. */
export async function getAccountingCloseDate(): Promise<Date | null> {
  const s = await prisma.accountingSettings.findUnique({
    where: { id: "default" },
    select: { closedThroughDate: true },
  });
  return s?.closedThroughDate ?? null;
}

/** Throw if `date` falls in a closed period. */
async function assertPeriodOpen(date: Date, action: string) {
  const closed = await getAccountingCloseDate();
  if (closed && date <= closed) {
    throw new Error(
      `Period is closed through ${closed.toLocaleDateString()} — cannot ${action} an entry dated ${date.toLocaleDateString()}. Reopen the period first (Accounting → month-end close).`
    );
  }
}

/** Set (or clear) the month-end closing date. */
export async function setAccountingCloseDate(params: {
  date: Date | null;
  userId?: string | null;
}) {
  return prisma.accountingSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      closedThroughDate: params.date,
      closedById: params.userId ?? null,
      closedAt: params.date ? new Date() : null,
    },
    update: {
      closedThroughDate: params.date,
      closedById: params.userId ?? null,
      closedAt: params.date ? new Date() : null,
    },
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
  await assertPeriodOpen(je.date, "post");
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
  await assertPeriodOpen(je.date, "void");
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

/**
 * Post the mirror image of a POSTED journal (debits↔credits) and link the
 * pair via reversesJournalId. Used for correcting entries and month-start
 * accrual reversals. Refuses to reverse twice.
 */
export async function reverseJournalEntry(params: {
  id: string;
  date?: Date;
  description?: string;
  userId?: string | null;
}) {
  const je = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: params.id },
    include: { lines: true },
  });
  if (je.status !== "POSTED") {
    throw new Error(`Only POSTED journals can be reversed (this one is ${je.status})`);
  }
  const existing = await prisma.journalEntry.findFirst({
    where: { reversesJournalId: je.id, status: { not: "VOID" } },
  });
  if (existing) {
    throw new Error(`${je.number} was already reversed by ${existing.number}`);
  }
  return postJournal({
    description: params.description || `Reversal of ${je.number}: ${je.description}`,
    source: "REVERSAL",
    sourceId: je.id,
    reversesJournalId: je.id,
    projectId: je.projectId || undefined,
    chargeCode: je.chargeCode || undefined,
    createdById: params.userId || undefined,
    date: params.date || new Date(),
    status: "POSTED",
    lines: je.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.credit || 0,
      credit: l.debit || 0,
      memo: l.memo || undefined,
      chargeCode: l.chargeCode || undefined,
    })),
  });
}

/**
 * Materialize due auto-reversals: any POSTED accrual whose autoReverseOn
 * date has arrived and which has no reversal yet gets its mirror entry
 * posted, dated on the scheduled day. Idempotent — safe to call on every
 * accounting page load.
 */
export async function runDueAutoReversals() {
  const due = await prisma.journalEntry.findMany({
    where: { status: "POSTED", autoReverseOn: { lte: new Date() } },
    select: { id: true, autoReverseOn: true },
  });
  const results: { id: string; number: string }[] = [];
  for (const je of due) {
    try {
      const rev = await reverseJournalEntry({
        id: je.id,
        date: je.autoReverseOn || new Date(),
        userId: null,
      });
      results.push({ id: rev.id, number: rev.number });
    } catch {
      // already reversed or period closed — skip quietly
    }
  }
  return results;
}

/* ── Statement of Cash Flows (indirect method) ─────────────────── */

function classifyLiability(a: { name: string; code: string }) {
  return /loan|note payable|notes payable|debt|mortgage|bond|line of credit/i.test(
    a.name
  )
    ? "FINANCING"
    : "OPERATING";
}

function isFixedAsset(a: { name: string; code: string; subtype?: string | null }) {
  if (a.subtype && /fixed|ppe|property/i.test(a.subtype)) return true;
  if (/equipment|machinery|building|property|vehicle|leasehold|furniture|accumulated dep/i.test(a.name)) return true;
  return a.code.startsWith("15") || a.code.startsWith("16") || a.code.startsWith("17");
}

/**
 * GAAP Statement of Cash Flows, indirect method, computed from posted
 * journal activity in the period. Reconciles net income to cash by adding
 * back non-cash charges and working-capital swings, then shows investing
 * (fixed assets) and financing (debt + equity) flows. The computed net
 * change is cross-checked against actual movement on cash accounts.
 */
export async function getCashFlowStatement(opts?: {
  from?: Date | null;
  to?: Date | null;
}) {
  const now = new Date();
  const from = opts?.from ?? new Date(now.getFullYear(), 0, 1);
  const to = opts?.to ?? now;

  const [accounts, bankAccounts, lines] = await Promise.all([
    prisma.account.findMany(),
    prisma.bankAccount.findMany({ select: { glAccountId: true, kind: true } }),
    prisma.journalLine.findMany({
      where: {
        journalEntry: { status: "POSTED", date: { gte: from, lte: to } },
      },
      select: { accountId: true, debit: true, credit: true },
    }),
  ]);

  // Cash = the 1000 account, CASH-subtype accounts, and GL accounts backing
  // checking/savings bank accounts. Credit-card GL accounts are liabilities
  // and stay in working capital.
  const cashIds = new Set<string>();
  for (const a of accounts) {
    if (a.type !== "ASSET") continue;
    if (a.code === "1000" || (a.subtype && /cash|bank/i.test(a.subtype))) {
      cashIds.add(a.id);
    }
  }
  for (const b of bankAccounts) {
    if (b.glAccountId && b.kind !== "CREDIT_CARD") cashIds.add(b.glAccountId);
  }

  // Signed movement per account in the period (natural balance sign).
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const delta = new Map<string, number>();
  for (const l of lines) {
    const a = acctById.get(l.accountId);
    if (!a) continue;
    const debitNormal = ["ASSET", "EXPENSE", "COGS"].includes(a.type);
    const move = debitNormal
      ? (l.debit || 0) - (l.credit || 0)
      : (l.credit || 0) - (l.debit || 0);
    delta.set(l.accountId, (delta.get(l.accountId) || 0) + move);
  }

  type Row = { account: string; code: string; amount: number };
  const operating: Row[] = [];
  const investing: Row[] = [];
  const financing: Row[] = [];

  let netIncome = 0;
  let depreciation = 0;
  let cashMovement = 0;

  for (const [id, d] of delta) {
    const a = acctById.get(id)!;
    if (Math.abs(d) < 0.005) continue;

    if (cashIds.has(id)) {
      cashMovement += d;
      continue;
    }

    if (["REVENUE"].includes(a.type)) {
      netIncome += d;
      continue;
    }
    if (["EXPENSE", "COGS"].includes(a.type)) {
      netIncome -= d;
      // Depreciation/amortization is a non-cash charge — add back.
      if (/depreciation|amortization/i.test(a.name)) depreciation += d;
      continue;
    }

    const row = { account: a.name, code: a.code, amount: 0 };
    if (a.type === "ASSET") {
      if (isFixedAsset(a)) {
        // Purchase of fixed assets = cash out
        row.amount = -d;
        investing.push(row);
      } else {
        // Increase in AR/inventory/prepaids consumes cash
        row.amount = -d;
        operating.push(row);
      }
    } else if (a.type === "LIABILITY") {
      row.amount = d; // increase in payables frees cash / new debt raises cash
      (classifyLiability(a) === "FINANCING" ? financing : operating).push(row);
    } else if (a.type === "EQUITY") {
      row.amount = d; // contributions in, distributions out
      financing.push(row);
    }
  }

  const sumRows = (rows: Row[]) => rows.reduce((s, r) => s + r.amount, 0);
  const operatingTotal = netIncome + depreciation + sumRows(operating);
  const investingTotal = sumRows(investing);
  const financingTotal = sumRows(financing);
  const netChange = operatingTotal + investingTotal + financingTotal;

  return {
    from,
    to,
    netIncome,
    depreciation,
    operating: operating.sort((a, b) => a.code.localeCompare(b.code)),
    investing: investing.sort((a, b) => a.code.localeCompare(b.code)),
    financing: financing.sort((a, b) => a.code.localeCompare(b.code)),
    operatingTotal,
    investingTotal,
    financingTotal,
    netChange,
    cashMovement,
    // Ledger cross-check: statement net change vs. actual cash-account movement
    reconciled: Math.abs(netChange - cashMovement) < 0.01,
  };
}
