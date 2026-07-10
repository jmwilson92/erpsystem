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
      balanced: Math.abs(totalAssets - (totalLiab + totalEquity)) < 0.01,
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

/** Post a simple balanced journal (GAAP double-entry). */
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
  const count = await prisma.journalEntry.count();
  const number = `JE-${String(count + 1).padStart(5, "0")}`;
  const je = await prisma.journalEntry.create({
    data: {
      number,
      description: params.description,
      status: "POSTED",
      source: params.source || "MANUAL",
      sourceId: params.sourceId,
      projectId: params.projectId,
      chargeCode: params.chargeCode,
      createdById: params.createdById,
      postedAt: new Date(),
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

  // Update account balances (assets/expenses increase with debit)
  for (const line of je.lines) {
    const acct = await prisma.account.findUnique({
      where: { id: line.accountId },
    });
    if (!acct) continue;
    const delta =
      ["ASSET", "EXPENSE", "COGS"].includes(acct.type)
        ? (line.debit || 0) - (line.credit || 0)
        : (line.credit || 0) - (line.debit || 0);
    await prisma.account.update({
      where: { id: acct.id },
      data: { balance: { increment: delta } },
    });
  }

  return je;
}

export async function listJournalEntries(take = 50) {
  return prisma.journalEntry.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: {
      lines: { include: { account: true } },
      attachments: true,
    },
  });
}
