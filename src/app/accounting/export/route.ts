/**
 * Financial report CSV export.
 *   GET /accounting/export?report=pl|bs|cf|tb&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Streams a CSV download of the requested statement from the live books.
 */
import { prisma } from "@/lib/db";
import { getGaapReportPack, getCashFlowStatement } from "@/lib/services/gaap";
import { getBudgetVsActual, get1099Report } from "@/lib/services/accounting-reports";
import { getCurrentUser, userHasPermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
const money = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !(await userHasPermission(user.id, "accounting.reports.read"))) {
    return new Response("Not authorized", { status: 403 });
  }
  const url = new URL(req.url);
  const report = (url.searchParams.get("report") || "pl").toLowerCase();
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  const validFrom = from && !Number.isNaN(from.getTime()) ? from : null;
  const validTo = to && !Number.isNaN(to.getTime()) ? to : null;

  let rows: (string | number | null)[][] = [];
  let name = "report";

  if (report === "pl") {
    const { incomeStatement: pl } = await getGaapReportPack();
    name = "income-statement";
    rows = [
      ["Section", "Code", "Account", "Amount"],
      ...pl.revenueAccounts.map((a) => ["Revenue", a.code, a.name, money(a.balance)]),
      ["", "", "Total revenue", money(pl.revenue)],
      ...pl.cogsAccounts.map((a) => ["COGS", a.code, a.name, money(a.balance)]),
      ["", "", "Gross profit", money(pl.grossProfit)],
      ...pl.expenseAccounts.map((a) => ["Operating expense", a.code, a.name, money(a.balance)]),
      ["", "", "Operating expenses", money(pl.operatingExpenses)],
      ["", "", "Net income", money(pl.netIncome)],
    ];
  } else if (report === "bs") {
    const { balanceSheet: bs } = await getGaapReportPack();
    name = "balance-sheet";
    rows = [
      ["Section", "Code", "Account", "Amount"],
      ...bs.assetAccounts.map((a) => ["Asset", a.code, a.name, money(a.balance)]),
      ["", "", "Total assets", money(bs.assets)],
      ...bs.liabilityAccounts.map((a) => ["Liability", a.code, a.name, money(a.balance)]),
      ...bs.equityAccounts.map((a) => ["Equity", a.code, a.name, money(a.balance)]),
      ["", "", "Current period earnings", money(bs.currentEarnings)],
      ["", "", "Total liabilities & equity", money(bs.liabilitiesAndEquity)],
    ];
  } else if (report === "tb") {
    const accounts = await prisma.account.findMany({ orderBy: { code: "asc" } });
    name = "trial-balance";
    const debitNormal = (t: string) => ["ASSET", "EXPENSE", "COGS"].includes(t);
    let td = 0;
    let tc = 0;
    const body = accounts.map((a) => {
      const dr = debitNormal(a.type) ? Math.max(a.balance, 0) : Math.max(-a.balance, 0);
      const cr = debitNormal(a.type) ? Math.max(-a.balance, 0) : Math.max(a.balance, 0);
      td += dr;
      tc += cr;
      return [a.code, a.name, a.type, money(dr), money(cr)];
    });
    rows = [
      ["Code", "Account", "Type", "Debit", "Credit"],
      ...body,
      ["", "", "Totals", money(td), money(tc)],
    ];
  } else if (report === "cf") {
    const cf = await getCashFlowStatement({ from: validFrom, to: validTo });
    name = "cash-flow";
    rows = [
      ["Section", "Line", "Amount"],
      ["Operating", "Net income", money(cf.netIncome)],
      ...(cf.depreciation > 0
        ? [["Operating", "Depreciation & amortization", money(cf.depreciation)] as (string | number)[]]
        : []),
      ...cf.operating.map((r) => ["Operating", `${r.code} ${r.account}`, money(r.amount)]),
      ["Operating", "Net cash from operating", money(cf.operatingTotal)],
      ...cf.investing.map((r) => ["Investing", `${r.code} ${r.account}`, money(r.amount)]),
      ["Investing", "Net cash from investing", money(cf.investingTotal)],
      ...cf.financing.map((r) => ["Financing", `${r.code} ${r.account}`, money(r.amount)]),
      ["Financing", "Net cash from financing", money(cf.financingTotal)],
      ["", "Net change in cash", money(cf.netChange)],
    ];
  } else if (report === "budget") {
    const b = await getBudgetVsActual();
    name = "budget-vs-actual";
    rows = [
      ["Budget", "Name", "Charge code", "Owner", "Status", "Budget", "Actual", "Variance", "% used"],
      ...b.rows.map((r) => [
        r.number,
        r.name,
        r.chargeCode || "",
        r.owner || "",
        r.status,
        money(r.budget),
        money(r.actual),
        money(r.variance),
        r.pctUsed,
      ]),
      ["", "", "", "", "Totals", money(b.totalBudget), money(b.totalActual), money(b.totalVariance), ""],
    ];
  } else if (report === "1099") {
    const r = await get1099Report({
      year: Number(url.searchParams.get("year")) || undefined,
    });
    name = `1099-vendors-${r.year}`;
    rows = [
      ["Vendor code", "Vendor", "Tax ID", "Paid (YTD)", "1099 reportable"],
      ...r.rows.map((v) => [
        v.code,
        v.name,
        v.taxId || "",
        money(v.paid),
        v.reportable ? "YES" : "no",
      ]),
    ];
  } else {
    return new Response("Unknown report", { status: 400 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const csv = "﻿" + toCsv(rows); // BOM so Excel reads UTF-8
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
