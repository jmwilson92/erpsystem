import { prisma } from "@/lib/db";
import { getGaapReportPack } from "@/lib/services/gaap";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Landmark, TrendingUp, TrendingDown, Scale, CheckCircle2, XCircle } from "lucide-react";
import { actionPostJournal, actionCreateAccount } from "@/app/actions";
import { listJournalEntries } from "@/lib/services/gaap";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function AccountingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const defaultTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab || "pl";

  const pack = await getGaapReportPack();
  const [accounts, journals, projects] = await Promise.all([
    prisma.account.findMany({ orderBy: { code: "asc" } }),
    listJournalEntries(40),
    prisma.project.findMany({
      where: { status: { in: ["ACTIVE", "PLANNING"] } },
      orderBy: { number: "asc" },
      select: { id: true, number: true, name: true },
    }),
  ]);

  const {
    incomeStatement: pl,
    balanceSheet: bs,
    trialBalance: tb,
    arAp,
    costAccounting: cost,
  } = pack;

  const directCodes = accounts.filter((a) => a.chargeCodeType === "DIRECT");
  const indirectCodes = accounts.filter((a) => a.chargeCodeType === "INDIRECT");

  return (
    <div className="space-y-6">
      <PageHeader title="Accounting" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Assets"
          value={formatCurrency(bs.assets)}
          icon={Landmark}
          accent="teal"
        />
        <StatCard
          title="Net Income"
          value={formatCurrency(pl.netIncome)}
          icon={TrendingUp}
          accent="emerald"
        />
        <StatCard
          title="AR Outstanding"
          value={formatCurrency(arAp.arOpen)}
          icon={Scale}
          accent="sky"
        />
        <StatCard
          title="AP Outstanding"
          value={formatCurrency(arAp.apOpen)}
          icon={TrendingDown}
          accent="amber"
        />
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
            bs.balanced
              ? "border-emerald-800 text-emerald-400"
              : "border-rose-800 text-rose-400"
          }`}
        >
          {bs.balanced ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          Balance sheet {bs.balanced ? "in balance" : "out of balance"}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
            tb.balanced
              ? "border-emerald-800 text-emerald-400"
              : "border-rose-800 text-rose-400"
          }`}
        >
          {tb.balanced ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          Trial balance Dr {formatCurrency(tb.debit)} / Cr{" "}
          {formatCurrency(tb.credit)}
        </span>
      </div>

      <Tabs defaultValue={defaultTab || "pl"}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="pl">Income Statement</TabsTrigger>
          <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
          <TabsTrigger value="tb">Trial Balance</TabsTrigger>
          <TabsTrigger value="ar">AR</TabsTrigger>
          <TabsTrigger value="ap">AP</TabsTrigger>
          <TabsTrigger value="coa">Chart of Accounts</TabsTrigger>
          <TabsTrigger value="je">Journals</TabsTrigger>
          <TabsTrigger value="cost">Cost Integration</TabsTrigger>
          <TabsTrigger value="post">Post JE</TabsTrigger>
        </TabsList>

        <TabsContent value="pl">
          <Card>
            <CardHeader>
              <CardTitle>Income Statement (GAAP)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Section title="Revenue" rows={pl.revenueAccounts} />
              <div className="flex justify-between font-medium">
                <span>Total revenue</span>
                <span>{formatCurrency(pl.revenue)}</span>
              </div>
              <Section title="Cost of goods sold" rows={pl.cogsAccounts} />
              <div className="flex justify-between border-t border-slate-800 pt-2">
                <span className="text-slate-400">Gross profit</span>
                <span className="tabular-nums">{formatCurrency(pl.grossProfit)}</span>
              </div>
              <Section title="Operating expenses" rows={pl.expenseAccounts} />
              <div className="mt-2 flex justify-between border-t border-slate-700 pt-3 text-lg font-semibold">
                <span>Net income</span>
                <span
                  className={
                    pl.netIncome >= 0 ? "text-emerald-400" : "text-red-400"
                  }
                >
                  {formatCurrency(pl.netIncome)}
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
                <Section title="Assets" rows={bs.assetAccounts} />
                <p className="mt-2 text-right font-semibold text-teal-400">
                  {formatCurrency(bs.assets)}
                </p>
              </div>
              <div>
                <Section title="Liabilities" rows={bs.liabilityAccounts} />
                <Section title="Equity" rows={bs.equityAccounts} />
                <p className="mt-2 text-right font-semibold text-teal-400">
                  {formatCurrency(bs.liabilities + bs.equity)}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tb">
          <Card>
            <CardHeader>
              <CardTitle>Trial Balance (posted journal lines)</CardTitle>
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
          {arAp.ar.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <span className="font-mono text-teal-400">{inv.number}</span>
                  <span className="ml-2 text-sm text-slate-400">
                    {inv.customer.name}
                  </span>
                  <p className="text-xs text-slate-500">
                    {formatDate(inv.invoiceDate)} · Due {formatDate(inv.dueDate)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">
                    {formatCurrency(inv.total)}
                  </p>
                  <StatusBadge status={inv.status} />
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="ap" className="space-y-2">
          {arAp.ap.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <span className="font-mono text-amber-400">{inv.number}</span>
                  <span className="ml-2 text-sm text-slate-400">
                    {inv.purchaseOrder?.number || "Manual"}
                  </span>
                  <p className="text-xs text-slate-500">
                    {formatDate(inv.invoiceDate)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">
                    {formatCurrency(inv.total)}
                  </p>
                  <StatusBadge status={inv.status} />
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="je" className="space-y-2">
          {tb.journals.map((je) => (
            <Card key={je.id}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-sky-400">{je.number}</span>
                  <StatusBadge status={je.status} />
                  <span className="text-xs text-slate-500">
                    {formatDate(je.date)}
                  </span>
                </div>
                <p className="text-sm text-slate-300">{je.description}</p>
                <div className="mt-2 space-y-1 text-xs">
                  {je.lines.map((l) => (
                    <div key={l.id} className="flex justify-between text-slate-500">
                      <span>
                        {l.account.code} {l.account.name}
                      </span>
                      <span>
                        {l.debit > 0
                          ? `Dr ${formatCurrency(l.debit)}`
                          : `Cr ${formatCurrency(l.credit)}`}
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
                <CardTitle>Work order cost variance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Standard cost</span>
                  <span>{formatCurrency(cost.woStd)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Actual cost</span>
                  <span>{formatCurrency(cost.woActual)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-800 pt-2 font-semibold">
                  <span>Variance</span>
                  <span
                    className={
                      cost.woVariance > 0 ? "text-red-400" : "text-emerald-400"
                    }
                  >
                    {formatCurrency(cost.woVariance)}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Engineering & project cost</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Eng labor hours (scanned)</span>
                  <span>{cost.engLaborHours.toFixed(1)} h</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Eng labor cost</span>
                  <span>{formatCurrency(cost.engLaborCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Project actual cost</span>
                  <span>{formatCurrency(cost.projectActualCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Dev budget / actual</span>
                  <span>
                    {formatCurrency(cost.projectDevBudget)} /{" "}
                    {formatCurrency(cost.projectDevActual)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="coa">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Create account / charge code</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={actionCreateAccount} className="grid gap-2 sm:grid-cols-2">
                  <Input name="code" required placeholder="Code e.g. 6100" />
                  <Input name="name" required placeholder="Account name" />
                  <select name="type" className={selectClass} defaultValue="EXPENSE">
                    {["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE", "COGS"].map(
                      (t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      )
                    )}
                  </select>
                  <select name="chargeCodeType" className={selectClass} defaultValue="">
                    <option value="">— Charge type —</option>
                    <option value="DIRECT">DIRECT</option>
                    <option value="INDIRECT">INDIRECT</option>
                  </select>
                  <Input name="chargeCode" placeholder="Charge code e.g. DIR-ENG" />
                  <Input name="description" placeholder="Description" className="sm:col-span-2" />
                  <Button type="submit" size="sm">
                    Create account
                  </Button>
                </form>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Charge codes · Direct {directCodes.length} / Indirect{" "}
                  {indirectCodes.length}
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-72 space-y-1 overflow-y-auto text-xs">
                {accounts.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-900 py-1"
                  >
                    <span>
                      <span className="font-mono text-teal-400">{a.code}</span>{" "}
                      {a.name}
                      {a.chargeCodeType && (
                        <StatusBadge status={a.chargeCodeType} />
                      )}
                      {a.chargeCode && (
                        <span className="ml-1 font-mono text-slate-500">
                          {a.chargeCode}
                        </span>
                      )}
                    </span>
                    <span className="font-mono tabular-nums text-slate-400">
                      {formatCurrency(a.balance)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="je">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent journal entries</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {journals.map((je) => (
                <div
                  key={je.id}
                  className="rounded-lg border border-slate-800 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-teal-400">{je.number}</span>
                    <StatusBadge status={je.status} />
                    {je.chargeCode && (
                      <span className="font-mono text-xs text-slate-500">
                        {je.chargeCode}
                      </span>
                    )}
                    <span className="text-xs text-slate-500">
                      {formatDate(je.postedAt || je.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-300">{je.description}</p>
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
                    {je.lines.map((l) => (
                      <li key={l.id} className="flex justify-between gap-4">
                        <span>
                          {l.account.code} {l.account.name}
                        </span>
                        <span className="font-mono">
                          Dr {formatCurrency(l.debit)} / Cr{" "}
                          {formatCurrency(l.credit)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {je.attachments?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {je.attachments.map((a) => (
                        <a
                          key={a.id}
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-slate-700 px-2 py-0.5 text-sky-400"
                        >
                          {a.fileName || a.docType || "Attachment"}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {!journals.length && (
                <p className="text-sm text-slate-500">No journals posted yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="post">
          <Card>
            <CardHeader>
              <CardTitle>Post balanced journal entry (double-entry)</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={actionPostJournal} className="grid max-w-xl gap-2">
                <Input
                  name="description"
                  required
                  placeholder="Journal description"
                />
                <select name="debitAccountId" required className={selectClass}>
                  <option value="">Debit account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                      {a.chargeCodeType ? ` [${a.chargeCodeType}]` : ""}
                    </option>
                  ))}
                </select>
                <select name="creditAccountId" required className={selectClass}>
                  <option value="">Credit account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
                <Input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="Amount"
                />
                <Input name="chargeCode" placeholder="Charge code (optional)" />
                <select name="projectId" className={selectClass}>
                  <option value="">— Project (optional) —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number} {p.name}
                    </option>
                  ))}
                </select>
                <Input
                  name="receiptUrl"
                  placeholder="Receipt / supporting doc URL"
                />
                <Input
                  name="receiptFileName"
                  placeholder="Receipt file name"
                />
                <Button type="submit" size="sm">
                  Post journal
                </Button>
              </form>
            </CardContent>
          </Card>
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
    <div className="mb-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      {rows.length === 0 && (
        <p className="text-xs text-slate-600">No accounts</p>
      )}
      {rows.map((r) => (
        <div key={r.id} className="flex justify-between py-0.5 text-sm">
          <span className="text-slate-400">
            <span className="font-mono text-teal-500/80">{r.code}</span> {r.name}
          </span>
          <span className="tabular-nums text-slate-300">
            {formatCurrency(r.balance)}
          </span>
        </div>
      ))}
    </div>
  );
}
