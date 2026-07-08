import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Landmark, TrendingUp, TrendingDown, Scale } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AccountingPage() {
  const [accounts, journals, arInvoices, apInvoices, budgets, woCosts] =
    await Promise.all([
      prisma.account.findMany({ orderBy: { code: "asc" } }),
      prisma.journalEntry.findMany({
        orderBy: { date: "desc" },
        include: { lines: { include: { account: true } } },
        take: 20,
      }),
      prisma.arInvoice.findMany({
        include: { customer: true, payments: true },
        orderBy: { invoiceDate: "desc" },
      }),
      prisma.apInvoice.findMany({
        include: { payments: true, purchaseOrder: true },
        orderBy: { invoiceDate: "desc" },
      }),
      prisma.budget.findMany(),
      prisma.workOrder.aggregate({
        _sum: { actualCost: true, standardCost: true },
      }),
    ]);

  const assets = accounts.filter((a) => a.type === "ASSET");
  const liabilities = accounts.filter((a) => a.type === "LIABILITY");
  const equity = accounts.filter((a) => a.type === "EQUITY");
  const revenue = accounts.filter((a) => a.type === "REVENUE");
  const expenses = accounts.filter((a) =>
    ["EXPENSE", "COGS"].includes(a.type)
  );

  const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
  const totalLiab = liabilities.reduce((s, a) => s + a.balance, 0);
  const totalRev = revenue.reduce((s, a) => s + a.balance, 0);
  const totalExp = expenses.reduce((s, a) => s + a.balance, 0);
  const netIncome = totalRev - totalExp;

  const arOpen = arInvoices
    .filter((i) => ["OPEN", "PARTIAL"].includes(i.status))
    .reduce((s, i) => s + (i.total - i.amountPaid), 0);
  const apOpen = apInvoices
    .filter((i) => ["OPEN", "PARTIAL"].includes(i.status))
    .reduce((s, i) => s + (i.total - i.amountPaid), 0);

  const variance =
    (woCosts._sum.actualCost || 0) - (woCosts._sum.standardCost || 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting"
        description="GL, AR/AP, cost accounting integration with work orders"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Assets" value={formatCurrency(totalAssets)} icon={Landmark} accent="teal" />
        <StatCard title="Net Income (YTD)" value={formatCurrency(netIncome)} icon={TrendingUp} accent="emerald" />
        <StatCard title="AR Outstanding" value={formatCurrency(arOpen)} icon={Scale} accent="sky" />
        <StatCard title="AP Outstanding" value={formatCurrency(apOpen)} icon={TrendingDown} accent="amber" />
      </div>

      <Tabs defaultValue="pl">
        <TabsList>
          <TabsTrigger value="pl">P&L</TabsTrigger>
          <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
          <TabsTrigger value="tb">Trial Balance</TabsTrigger>
          <TabsTrigger value="ar">AR</TabsTrigger>
          <TabsTrigger value="ap">AP</TabsTrigger>
          <TabsTrigger value="je">Journals</TabsTrigger>
          <TabsTrigger value="cost">Cost / Budget</TabsTrigger>
        </TabsList>

        <TabsContent value="pl">
          <Card>
            <CardHeader>
              <CardTitle>Profit & Loss</CardTitle>
            </CardHeader>
            <CardContent>
              <Section title="Revenue" rows={revenue} />
              <Section title="COGS & Expenses" rows={expenses} />
              <div className="mt-4 flex justify-between border-t border-slate-700 pt-3 text-lg font-semibold">
                <span>Net Income</span>
                <span className={netIncome >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {formatCurrency(netIncome)}
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bs">
          <Card>
            <CardHeader>
              <CardTitle>Balance Sheet</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <div>
                <Section title="Assets" rows={assets} />
                <p className="mt-2 text-right font-semibold text-teal-400">
                  {formatCurrency(totalAssets)}
                </p>
              </div>
              <div>
                <Section title="Liabilities" rows={liabilities} />
                <Section title="Equity" rows={equity} />
                <p className="mt-2 text-right font-semibold text-teal-400">
                  {formatCurrency(totalLiab + equity.reduce((s, a) => s + a.balance, 0))}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tb">
          <Card>
            <CardHeader>
              <CardTitle>Trial Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-500">
                    <th className="pb-2">Code</th>
                    <th className="pb-2">Account</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} className="border-t border-slate-800/60">
                      <td className="py-1.5 font-mono text-teal-400">{a.code}</td>
                      <td className="py-1.5 text-slate-300">{a.name}</td>
                      <td className="py-1.5 text-slate-500">{a.type}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatCurrency(a.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ar" className="space-y-2">
          {arInvoices.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <span className="font-mono text-teal-400">{inv.number}</span>
                  <span className="ml-2 text-sm text-slate-400">{inv.customer.name}</span>
                  <p className="text-xs text-slate-500">
                    {formatDate(inv.invoiceDate)} · Due {formatDate(inv.dueDate)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{formatCurrency(inv.total)}</p>
                  <StatusBadge status={inv.status} />
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="ap" className="space-y-2">
          {apInvoices.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <span className="font-mono text-amber-400">{inv.number}</span>
                  <span className="ml-2 text-sm text-slate-400">
                    {inv.purchaseOrder?.number || "Manual"}
                  </span>
                  <p className="text-xs text-slate-500">{formatDate(inv.invoiceDate)}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{formatCurrency(inv.total)}</p>
                  <StatusBadge status={inv.status} />
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="je" className="space-y-2">
          {journals.map((je) => (
            <Card key={je.id}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-sky-400">{je.number}</span>
                  <StatusBadge status={je.status} />
                  <span className="text-xs text-slate-500">{formatDate(je.date)}</span>
                </div>
                <p className="text-sm text-slate-300">{je.description}</p>
                <div className="mt-2 space-y-1 text-xs">
                  {je.lines.map((l) => (
                    <div key={l.id} className="flex justify-between text-slate-500">
                      <span>
                        {l.account.code} {l.account.name}
                      </span>
                      <span>
                        {l.debit > 0 ? `Dr ${formatCurrency(l.debit)}` : `Cr ${formatCurrency(l.credit)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="cost">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>WO Cost Variance (Actual vs Standard)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Standard Cost (all WOs)</span>
                  <span>{formatCurrency(woCosts._sum.standardCost || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Actual Cost</span>
                  <span>{formatCurrency(woCosts._sum.actualCost || 0)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-800 pt-2 font-semibold">
                  <span>Variance</span>
                  <span className={variance > 0 ? "text-red-400" : "text-emerald-400"}>
                    {formatCurrency(variance)}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Budgets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {budgets.map((b) => {
                  const pct = b.amount > 0 ? Math.round((b.actual / b.amount) * 100) : 0;
                  return (
                    <div key={b.id}>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-300">{b.name}</span>
                        <span className="tabular-nums text-slate-500">
                          {formatCurrency(b.actual)} / {formatCurrency(b.amount)} ({pct}%)
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full ${pct > 90 ? "bg-amber-500" : "bg-teal-500"}`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Section({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; code: string; name: string; balance: number }[];
}) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </p>
      {rows.map((a) => (
        <div key={a.id} className="flex justify-between py-1 text-sm">
          <span className="text-slate-400">
            <span className="font-mono text-slate-500">{a.code}</span> {a.name}
          </span>
          <span className="tabular-nums text-slate-200">{formatCurrency(a.balance)}</span>
        </div>
      ))}
    </div>
  );
}
