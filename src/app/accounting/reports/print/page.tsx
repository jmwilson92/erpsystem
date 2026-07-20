import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { notFound } from "next/navigation";
import { getGaapReportPack, getCashFlowStatement } from "@/lib/services/gaap";
import { PrintFrame } from "@/components/print/print-frame";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TITLES: Record<string, string> = {
  pl: "Income Statement",
  bs: "Balance Sheet",
  cf: "Statement of Cash Flows",
  tb: "Trial Balance",
};

function Row({
  label,
  code,
  amount,
  bold,
  rule,
}: {
  label: string;
  code?: string;
  amount: number;
  bold?: boolean;
  rule?: boolean;
}) {
  return (
    <div
      className={`flex justify-between py-1 ${
        rule ? "border-t border-neutral-400" : "border-b border-neutral-200"
      } ${bold ? "font-semibold" : ""}`}
    >
      <span>
        {code && <span className="mr-1 font-mono text-neutral-500">{code}</span>}
        {label}
      </span>
      <span className="tabular-nums">{formatCurrency(amount)}</span>
    </div>
  );
}

export default async function PrintReportsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await getCurrentUser();
  if (!viewer || !(await userHasPermission(viewer.id, "accounting.reports.read"))) {
    notFound();
  }
  const sp = searchParams ? await searchParams : {};
  const pick = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const only = (pick("report") || "").toLowerCase();
  const which = only && TITLES[only] ? [only] : ["pl", "bs", "cf", "tb"];
  const fromRaw = pick("from");
  const toRaw = pick("to");
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  const validFrom = from && !Number.isNaN(from.getTime()) ? from : null;
  const validTo = to && !Number.isNaN(to.getTime()) ? to : null;

  const [company, pack, cf, accounts] = await Promise.all([
    prisma.companySettings.findUnique({ where: { id: "default" } }),
    getGaapReportPack(),
    getCashFlowStatement({ from: validFrom, to: validTo }),
    prisma.account.findMany({ orderBy: { code: "asc" } }),
  ]);
  const pl = pack.incomeStatement;
  const bs = pack.balanceSheet;
  const debitNormal = (t: string) => ["ASSET", "EXPENSE", "COGS"].includes(t);

  return (
    <PrintFrame>
      <div className="mb-6 border-b border-neutral-300 pb-3 text-center">
        <h1 className="text-lg font-bold">{company?.name || "ForgeRP"}</h1>
        <p className="text-sm text-neutral-600">
          {which.length === 1 ? TITLES[which[0]] : "Financial Statements"} · as of{" "}
          {formatDate(new Date())}
          {which.includes("cf")
            ? ` · cash flows ${formatDate(cf.from)}–${formatDate(cf.to)}`
            : ""}
        </p>
      </div>

      {which.includes("pl") && (
        <section className="mb-8 text-sm">
          <h2 className="mb-2 text-base font-semibold">Income Statement</h2>
          <p className="mb-1 text-xs font-semibold uppercase text-neutral-500">Revenue</p>
          {pl.revenueAccounts.map((a) => (
            <Row key={a.id} code={a.code} label={a.name} amount={a.balance} />
          ))}
          <Row label="Total revenue" amount={pl.revenue} bold />
          <p className="mb-1 mt-3 text-xs font-semibold uppercase text-neutral-500">
            Cost of goods sold
          </p>
          {pl.cogsAccounts.map((a) => (
            <Row key={a.id} code={a.code} label={a.name} amount={a.balance} />
          ))}
          <Row label="Gross profit" amount={pl.grossProfit} bold rule />
          <p className="mb-1 mt-3 text-xs font-semibold uppercase text-neutral-500">
            Operating expenses
          </p>
          {pl.expenseAccounts.map((a) => (
            <Row key={a.id} code={a.code} label={a.name} amount={a.balance} />
          ))}
          <Row label="Net income" amount={pl.netIncome} bold rule />
        </section>
      )}

      {which.includes("bs") && (
        <section className="mb-8 text-sm">
          <h2 className="mb-2 text-base font-semibold">Balance Sheet</h2>
          <p className="mb-1 text-xs font-semibold uppercase text-neutral-500">Assets</p>
          {bs.assetAccounts.map((a) => (
            <Row key={a.id} code={a.code} label={a.name} amount={a.balance} />
          ))}
          <Row label="Total assets" amount={bs.assets} bold rule />
          <p className="mb-1 mt-3 text-xs font-semibold uppercase text-neutral-500">
            Liabilities
          </p>
          {bs.liabilityAccounts.map((a) => (
            <Row key={a.id} code={a.code} label={a.name} amount={a.balance} />
          ))}
          <p className="mb-1 mt-3 text-xs font-semibold uppercase text-neutral-500">Equity</p>
          {bs.equityAccounts.map((a) => (
            <Row key={a.id} code={a.code} label={a.name} amount={a.balance} />
          ))}
          <Row label="Current period earnings" amount={bs.currentEarnings} />
          <Row label="Total liabilities & equity" amount={bs.liabilitiesAndEquity} bold rule />
        </section>
      )}

      {which.includes("cf") && (
        <section className="mb-8 text-sm">
          <h2 className="mb-2 text-base font-semibold">Statement of Cash Flows</h2>
          <p className="mb-1 text-xs font-semibold uppercase text-neutral-500">Operating</p>
          <Row label="Net income" amount={cf.netIncome} />
          {cf.depreciation > 0 && (
            <Row label="Depreciation & amortization" amount={cf.depreciation} />
          )}
          {cf.operating.map((r) => (
            <Row key={r.code} code={r.code} label={r.account} amount={r.amount} />
          ))}
          <Row label="Net cash from operating" amount={cf.operatingTotal} bold />
          <p className="mb-1 mt-3 text-xs font-semibold uppercase text-neutral-500">Investing</p>
          {cf.investing.map((r) => (
            <Row key={r.code} code={r.code} label={r.account} amount={r.amount} />
          ))}
          <Row label="Net cash from investing" amount={cf.investingTotal} bold />
          <p className="mb-1 mt-3 text-xs font-semibold uppercase text-neutral-500">Financing</p>
          {cf.financing.map((r) => (
            <Row key={r.code} code={r.code} label={r.account} amount={r.amount} />
          ))}
          <Row label="Net cash from financing" amount={cf.financingTotal} bold />
          <Row label="Net change in cash" amount={cf.netChange} bold rule />
        </section>
      )}

      {which.includes("tb") && (
        <section className="mb-4 text-sm">
          <h2 className="mb-2 text-base font-semibold">Trial Balance</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-neutral-800 text-left text-xs">
                <th className="py-1">Code</th>
                <th className="py-1">Account</th>
                <th className="py-1 text-right">Debit</th>
                <th className="py-1 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const dr = debitNormal(a.type) ? Math.max(a.balance, 0) : Math.max(-a.balance, 0);
                const cr = debitNormal(a.type) ? Math.max(-a.balance, 0) : Math.max(a.balance, 0);
                return (
                  <tr key={a.id} className="border-b border-neutral-200">
                    <td className="py-0.5 font-mono text-neutral-500">{a.code}</td>
                    <td className="py-0.5">{a.name}</td>
                    <td className="py-0.5 text-right tabular-nums">
                      {dr ? formatCurrency(dr) : ""}
                    </td>
                    <td className="py-0.5 text-right tabular-nums">
                      {cr ? formatCurrency(cr) : ""}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-neutral-800 font-semibold">
                <td className="py-1" colSpan={2}>
                  Totals
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatCurrency(pack.trialBalance.debit)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatCurrency(pack.trialBalance.credit)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </PrintFrame>
  );
}
