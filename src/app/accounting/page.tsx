import { prisma } from "@/lib/db";
import { getGaapReportPack, listJournalEntries } from "@/lib/services/gaap";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  Landmark,
  TrendingUp,
  TrendingDown,
  Scale,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  actionPostJournal,
  actionCreateAccount,
  actionSavePayrollPolicy,
  actionSaveAccountingSettings,
  actionApproveJournal,
  actionVoidJournal,
  actionRecordArPayment,
  actionRecordApPayment,
  actionCreateExpenseEntry,
} from "@/app/actions";
import { getPayrollPolicy, parseHolidays } from "@/lib/services/timesheets";
import { HolidayPicker } from "@/components/accounting/holiday-picker";
import Link from "next/link";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

function pick(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string {
  const v = sp[key];
  return Array.isArray(v) ? v[0] || "" : v || "";
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const defaultTab = pick(sp, "tab") || "pl";
  const periodFrom = pick(sp, "from");
  const periodTo = pick(sp, "to");
  const jeStatus = pick(sp, "jeStatus");

  const fromDate = periodFrom ? startOfDay(new Date(periodFrom)) : null;
  const toDate = periodTo ? endOfDay(new Date(periodTo)) : null;
  const validFrom =
    fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null;
  const validTo = toDate && !Number.isNaN(toDate.getTime()) ? toDate : null;

  const pack = await getGaapReportPack();
  const [
    accounts,
    journals,
    projects,
    payrollPolicy,
    acctSettings,
    payrollQueue,
    arList,
    apList,
  ] = await Promise.all([
    prisma.account.findMany({ orderBy: { code: "asc" } }),
    listJournalEntries({
      take: 100,
      from: validFrom,
      to: validTo,
      status: jeStatus || null,
    }),
    prisma.project.findMany({
      where: { status: { in: ["ACTIVE", "PLANNING"] } },
      orderBy: { number: "asc" },
      select: { id: true, number: true, name: true },
    }),
    getPayrollPolicy(),
    prisma.accountingSettings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    }),
    prisma.timesheet.findMany({
      where: { status: { in: ["APPROVED", "PROCESSED"] } },
      include: { user: { select: { name: true } }, entries: true },
      orderBy: { periodStart: "desc" },
      take: 25,
    }),
    prisma.arInvoice.findMany({
      include: { customer: true, payments: true },
      orderBy: { invoiceDate: "desc" },
      take: 80,
    }),
    prisma.apInvoice.findMany({
      include: { purchaseOrder: true, payments: true, supplier: true },
      orderBy: { invoiceDate: "desc" },
      take: 80,
    }),
  ]);

  const inPeriod = (d: Date | null | undefined) => {
    if (!d) return true;
    if (validFrom && d < validFrom) return false;
    if (validTo && d > validTo) return false;
    return true;
  };

  const arFiltered = arList.filter((i) => inPeriod(i.invoiceDate));
  const apFiltered = apList.filter((i) => inPeriod(i.invoiceDate));

  const holidayText = parseHolidays(payrollPolicy)
    .map((h) => `${h.date} ${h.name}`)
    .join("\n");

  const {
    incomeStatement: pl,
    balanceSheet: bs,
    trialBalance: tb,
    arAp,
    costAccounting: cost,
  } = pack;

  const directCodes = accounts.filter((a) => a.chargeCodeType === "DIRECT");
  const indirectCodes = accounts.filter((a) => a.chargeCodeType === "INDIRECT");
  const expenseAccounts = accounts.filter((a) =>
    ["EXPENSE", "COGS"].includes(a.type)
  );
  const cashOrAp = accounts.filter((a) =>
    ["ASSET", "LIABILITY"].includes(a.type)
  );
  const pendingJe = journals.filter((j) => j.status === "PENDING_APPROVAL");

  const periodQs = new URLSearchParams();
  if (periodFrom) periodQs.set("from", periodFrom);
  if (periodTo) periodQs.set("to", periodTo);
  const periodSuffix = periodQs.toString() ? `&${periodQs.toString()}` : "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting"
        description={`${acctSettings.basis} basis · FY starts month ${acctSettings.fiscalYearStartMonth}`}
      />

      {/* Period filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <form className="flex flex-wrap items-end gap-2" method="get">
            <input type="hidden" name="tab" value={defaultTab} />
            <label className="text-xs text-slate-500">
              From
              <Input
                name="from"
                type="date"
                defaultValue={periodFrom}
                className="h-8 w-36"
              />
            </label>
            <label className="text-xs text-slate-500">
              To
              <Input
                name="to"
                type="date"
                defaultValue={periodTo}
                className="h-8 w-36"
              />
            </label>
            {defaultTab === "je" && (
              <label className="text-xs text-slate-500">
                JE status
                <select
                  name="jeStatus"
                  className={`${selectClass} h-8`}
                  defaultValue={jeStatus}
                >
                  <option value="">All</option>
                  <option value="PENDING_APPROVAL">Pending approval</option>
                  <option value="POSTED">Posted</option>
                  <option value="DRAFT">Draft</option>
                  <option value="VOID">Void</option>
                </select>
              </label>
            )}
            <Button type="submit" size="sm" className="h-8">
              Apply period
            </Button>
            {(periodFrom || periodTo || jeStatus) && (
              <Button asChild size="sm" variant="outline" className="h-8">
                <Link href={`/accounting?tab=${defaultTab}`}>Clear</Link>
              </Button>
            )}
          </form>
          <p className="text-[11px] text-slate-600">
            Filters AR / AP / Journals line lists. Reports below use full books.
          </p>
        </CardContent>
      </Card>

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
        {pendingJe.length > 0 && (
          <Link
            href={`/accounting?tab=je&jeStatus=PENDING_APPROVAL${periodSuffix}`}
            className="inline-flex items-center gap-1 rounded-full border border-amber-800 px-2.5 py-1 text-amber-400 hover:bg-amber-500/10"
          >
            {pendingJe.length} JE awaiting approval
          </Link>
        )}
      </div>

      <Tabs defaultValue={defaultTab || "pl"}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="pl">Income Statement</TabsTrigger>
          <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
          <TabsTrigger value="tb">Trial Balance</TabsTrigger>
          <TabsTrigger value="ar">AR</TabsTrigger>
          <TabsTrigger value="ap">AP</TabsTrigger>
          <TabsTrigger value="coa">Chart of Accounts</TabsTrigger>
          <TabsTrigger value="je">
            Journals{pendingJe.length ? ` (${pendingJe.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="cost">Cost Integration</TabsTrigger>
          <TabsTrigger value="post">Post JE</TabsTrigger>
          <TabsTrigger value="expense">Expenses</TabsTrigger>
          <TabsTrigger value="payroll">
            Payroll
            {payrollQueue.filter((t) => t.status === "APPROVED").length > 0
              ? ` (${payrollQueue.filter((t) => t.status === "APPROVED").length})`
              : ""}
          </TabsTrigger>
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
                <span className="tabular-nums">
                  {formatCurrency(pl.grossProfit)}
                </span>
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
                <div className="flex justify-between border-t border-slate-800 py-1.5 text-sm">
                  <span className="text-slate-400">
                    Current period earnings
                  </span>
                  <span className="tabular-nums">
                    {formatCurrency(bs.currentEarnings)}
                  </span>
                </div>
                <p className="mt-2 text-right font-semibold text-teal-400">
                  {formatCurrency(bs.liabilitiesAndEquity)}
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
                  <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                    <th className="py-1.5">Code</th>
                    <th className="py-1.5">Account</th>
                    <th className="py-1.5">Type</th>
                    <th className="py-1.5 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-slate-900/80 text-[13px]"
                    >
                      <td className="py-1 font-mono text-teal-400">{a.code}</td>
                      <td className="py-1 text-slate-300">{a.name}</td>
                      <td className="py-1 text-slate-500">{a.type}</td>
                      <td className="py-1 text-right tabular-nums">
                        {formatCurrency(a.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Dense AR ledger */}
        <TabsContent value="ar">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Accounts receivable
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {arFiltered.length} invoices
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-[7rem_1fr_5.5rem_5.5rem_5rem_4.5rem_minmax(10rem,1fr)] gap-x-2 border-b border-slate-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <span>Invoice</span>
                <span>Customer</span>
                <span>Date</span>
                <span className="text-right">Total</span>
                <span className="text-right">Paid</span>
                <span>Status</span>
                <span>Record payment</span>
              </div>
              {arFiltered.map((inv) => {
                const open = inv.total - inv.amountPaid;
                return (
                  <div
                    key={inv.id}
                    className="grid grid-cols-[7rem_1fr_5.5rem_5.5rem_5rem_4.5rem_minmax(10rem,1fr)] items-center gap-x-2 border-b border-slate-900/70 px-3 py-1 text-[12px] hover:bg-slate-900/40"
                  >
                    <span className="font-mono text-teal-400">{inv.number}</span>
                    <span className="truncate text-slate-300">
                      {inv.customer.name}
                    </span>
                    <span className="text-slate-500">
                      {formatDate(inv.invoiceDate)}
                    </span>
                    <span className="text-right tabular-nums">
                      {formatCurrency(inv.total)}
                    </span>
                    <span className="text-right tabular-nums text-slate-400">
                      {formatCurrency(inv.amountPaid)}
                    </span>
                    <StatusBadge status={inv.status} />
                    <div>
                      {open > 0.01 && !["VOID", "PAID"].includes(inv.status) ? (
                        <form
                          action={actionRecordArPayment}
                          className="flex items-center gap-1"
                        >
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <Input
                            name="amount"
                            type="number"
                            step="0.01"
                            min="0.01"
                            defaultValue={open.toFixed(2)}
                            className="h-7 w-20 text-[11px]"
                          />
                          <select
                            name="method"
                            className="h-7 rounded border border-slate-700 bg-slate-950 px-1 text-[10px]"
                            defaultValue="CHECK"
                          >
                            <option value="CHECK">Check</option>
                            <option value="ACH">ACH</option>
                            <option value="WIRE">Wire</option>
                            <option value="CARD">Card</option>
                          </select>
                          <Button type="submit" size="sm" className="h-7 text-[10px]">
                            Pay
                          </Button>
                        </form>
                      ) : (
                        <span className="text-[11px] text-slate-600">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {arFiltered.length === 0 && (
                <p className="p-4 text-sm text-slate-500">No AR in period.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Dense AP ledger */}
        <TabsContent value="ap">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Accounts payable
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {apFiltered.length} invoices
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-[7rem_1fr_5.5rem_5.5rem_5rem_4.5rem_minmax(10rem,1fr)] gap-x-2 border-b border-slate-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <span>Invoice</span>
                <span>Supplier / PO</span>
                <span>Date</span>
                <span className="text-right">Total</span>
                <span className="text-right">Paid</span>
                <span>Status</span>
                <span>Record payment</span>
              </div>
              {apFiltered.map((inv) => {
                const open = inv.total - inv.amountPaid;
                return (
                  <div
                    key={inv.id}
                    className="grid grid-cols-[7rem_1fr_5.5rem_5.5rem_5rem_4.5rem_minmax(10rem,1fr)] items-center gap-x-2 border-b border-slate-900/70 px-3 py-1 text-[12px] hover:bg-slate-900/40"
                  >
                    <span className="font-mono text-amber-400">{inv.number}</span>
                    <span className="truncate text-slate-300">
                      {inv.supplier?.name ||
                        inv.purchaseOrder?.number ||
                        "Manual"}
                    </span>
                    <span className="text-slate-500">
                      {formatDate(inv.invoiceDate)}
                    </span>
                    <span className="text-right tabular-nums">
                      {formatCurrency(inv.total)}
                    </span>
                    <span className="text-right tabular-nums text-slate-400">
                      {formatCurrency(inv.amountPaid)}
                    </span>
                    <StatusBadge status={inv.status} />
                    <div>
                      {open > 0.01 && !["VOID", "PAID"].includes(inv.status) ? (
                        <form
                          action={actionRecordApPayment}
                          className="flex items-center gap-1"
                        >
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <Input
                            name="amount"
                            type="number"
                            step="0.01"
                            min="0.01"
                            defaultValue={open.toFixed(2)}
                            className="h-7 w-20 text-[11px]"
                          />
                          <select
                            name="method"
                            className="h-7 rounded border border-slate-700 bg-slate-950 px-1 text-[10px]"
                            defaultValue="ACH"
                          >
                            <option value="ACH">ACH</option>
                            <option value="CHECK">Check</option>
                            <option value="WIRE">Wire</option>
                            <option value="CARD">Card</option>
                          </select>
                          <Button type="submit" size="sm" className="h-7 text-[10px]">
                            Pay
                          </Button>
                        </form>
                      ) : (
                        <span className="text-[11px] text-slate-600">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {apFiltered.length === 0 && (
                <p className="p-4 text-sm text-slate-500">No AP in period.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="coa">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Create account / charge code
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  action={actionCreateAccount}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <Input name="code" required placeholder="Code e.g. 6100" />
                  <Input name="name" required placeholder="Account name" />
                  <select
                    name="type"
                    className={selectClass}
                    defaultValue="EXPENSE"
                  >
                    {["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE", "COGS"].map(
                      (t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      )
                    )}
                  </select>
                  <select
                    name="chargeCodeType"
                    className={selectClass}
                    defaultValue=""
                  >
                    <option value="">— Charge type —</option>
                    <option value="DIRECT">DIRECT</option>
                    <option value="INDIRECT">INDIRECT</option>
                  </select>
                  <Input
                    name="chargeCode"
                    placeholder="Charge code e.g. DIR-ENG"
                  />
                  <Input
                    name="description"
                    placeholder="Description"
                    className="sm:col-span-2"
                  />
                  <Button type="submit" size="sm">
                    Create account
                  </Button>
                </form>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Chart of accounts · Direct {directCodes.length} / Indirect{" "}
                  {indirectCodes.length}
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-96 overflow-y-auto p-0">
                <div className="grid grid-cols-[4rem_1fr_5rem_5.5rem] gap-x-2 border-b border-slate-800 px-3 py-1 text-[10px] font-semibold uppercase text-slate-500">
                  <span>Code</span>
                  <span>Name</span>
                  <span>Type</span>
                  <span className="text-right">Balance</span>
                </div>
                {accounts.map((a) => (
                  <div
                    key={a.id}
                    className="grid grid-cols-[4rem_1fr_5rem_5.5rem] gap-x-2 border-b border-slate-900/70 px-3 py-0.5 text-[12px]"
                  >
                    <span className="font-mono text-teal-400">{a.code}</span>
                    <span className="truncate text-slate-300">
                      {a.name}
                      {a.chargeCode && (
                        <span className="ml-1 font-mono text-[10px] text-slate-600">
                          {a.chargeCode}
                        </span>
                      )}
                    </span>
                    <span className="text-slate-500">
                      {a.chargeCodeType || a.type}
                    </span>
                    <span className="text-right font-mono tabular-nums text-slate-400">
                      {formatCurrency(a.balance)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Dense notebook-style JE ledger */}
        <TabsContent value="je">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Journal entries
                <span className="ml-2 text-xs font-normal text-slate-500">
                  notebook line items · {journals.length} shown
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-[5.5rem_4.5rem_5rem_1fr_5.5rem_5.5rem_7rem] gap-x-2 border-b border-slate-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <span>JE #</span>
                <span>Date</span>
                <span>Status</span>
                <span>Description / line</span>
                <span className="text-right">Debit</span>
                <span className="text-right">Credit</span>
                <span>Actions</span>
              </div>
              {journals.map((je) => {
                const totalDr = je.lines.reduce((s, l) => s + l.debit, 0);
                return (
                  <div key={je.id} className="border-b border-slate-800/80">
                    <div className="grid grid-cols-[5.5rem_4.5rem_5rem_1fr_5.5rem_5.5rem_7rem] items-center gap-x-2 bg-slate-900/30 px-3 py-1 text-[12px]">
                      <span className="font-mono text-sky-400">{je.number}</span>
                      <span className="text-slate-500">
                        {formatDate(je.date)}
                      </span>
                      <StatusBadge status={je.status} />
                      <span className="truncate text-slate-200">
                        {je.description}
                        {je.source && (
                          <span className="ml-1 text-[10px] text-slate-600">
                            [{je.source}]
                          </span>
                        )}
                      </span>
                      <span className="text-right font-mono tabular-nums text-slate-400">
                        {formatCurrency(totalDr)}
                      </span>
                      <span className="text-right font-mono tabular-nums text-slate-400">
                        {formatCurrency(totalDr)}
                      </span>
                      <span className="flex gap-1">
                        {["PENDING_APPROVAL", "DRAFT"].includes(je.status) && (
                          <form action={actionApproveJournal}>
                            <input type="hidden" name="id" value={je.id} />
                            <Button
                              type="submit"
                              size="sm"
                              className="h-6 px-1.5 text-[10px]"
                            >
                              Approve
                            </Button>
                          </form>
                        )}
                        {je.status !== "VOID" && (
                          <form action={actionVoidJournal}>
                            <input type="hidden" name="id" value={je.id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              className="h-6 px-1.5 text-[10px]"
                            >
                              Void
                            </Button>
                          </form>
                        )}
                      </span>
                    </div>
                    {je.lines.map((l) => (
                      <div
                        key={l.id}
                        className="grid grid-cols-[5.5rem_4.5rem_5rem_1fr_5.5rem_5.5rem_7rem] gap-x-2 px-3 py-0.5 text-[11px] text-slate-500"
                      >
                        <span />
                        <span />
                        <span />
                        <span className="pl-4 font-mono">
                          {l.account.code}{" "}
                          <span className="font-sans text-slate-400">
                            {l.account.name}
                          </span>
                          {l.memo ? (
                            <span className="text-slate-600"> — {l.memo}</span>
                          ) : null}
                        </span>
                        <span className="text-right font-mono tabular-nums">
                          {l.debit > 0 ? formatCurrency(l.debit) : ""}
                        </span>
                        <span className="text-right font-mono tabular-nums">
                          {l.credit > 0 ? formatCurrency(l.credit) : ""}
                        </span>
                        <span />
                      </div>
                    ))}
                    {je.attachments?.length > 0 && (
                      <div className="flex flex-wrap gap-2 px-3 pb-1 pl-[calc(5.5rem+4.5rem+5rem+0.75rem)]">
                        {je.attachments.map((a) => (
                          <a
                            key={a.id}
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-sky-400 hover:underline"
                          >
                            📎 {a.fileName || a.docType || "receipt"}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {journals.length === 0 && (
                <p className="p-4 text-sm text-slate-500">
                  No journal entries for this filter.
                </p>
              )}
            </CardContent>
          </Card>
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

        <TabsContent value="post">
          <Card>
            <CardHeader>
              <CardTitle>Submit journal entry (double-entry)</CardTitle>
              <p className="text-xs text-slate-500">
                Manual journals go to approval before posting balances. Check
                &quot;Post immediately&quot; only when you have authority to skip
                the queue.
              </p>
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
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" name="postNow" value="true" />
                  Post immediately (skip approval)
                </label>
                <Button type="submit" size="sm">
                  Submit for approval
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expense">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Expense / credit-card entry
              </CardTitle>
              <p className="text-xs text-slate-500">
                Dr expense · Cr cash or credit-card payable. Attach receipt URL.
                Defaults to approval queue.
              </p>
            </CardHeader>
            <CardContent>
              <form
                action={actionCreateExpenseEntry}
                className="grid max-w-xl gap-2"
              >
                <Input
                  name="description"
                  required
                  placeholder="Expense description e.g. AWS invoice, team lunch"
                />
                <select
                  name="expenseAccountId"
                  required
                  className={selectClass}
                >
                  <option value="">Expense account…</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
                <select name="creditAccountId" required className={selectClass}>
                  <option value="">Credit (cash / CC payable)…</option>
                  {cashOrAp.map((a) => (
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
                <Input name="chargeCode" placeholder="Charge code" />
                <select name="projectId" className={selectClass}>
                  <option value="">— Project (optional) —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number} {p.name}
                    </option>
                  ))}
                </select>
                <Input name="receiptUrl" placeholder="Receipt URL" />
                <Input name="receiptFileName" placeholder="Receipt file name" />
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" name="postNow" value="true" />
                  Post immediately
                </label>
                <Button type="submit" size="sm">
                  Submit expense
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll" className="space-y-4">
          <Card className="border-teal-900/40 bg-gradient-to-r from-teal-500/5 to-transparent">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-medium text-slate-200">
                  Payroll runs in its own module now
                </p>
                <p className="text-xs text-slate-500">
                  {payrollQueue.filter((t) => t.status === "APPROVED").length}{" "}
                  approved timecard(s) ready to process. Policy below still lives
                  here.
                </p>
              </div>
              <Link href="/accounting/payroll">
                <Button size="sm">Open Payroll →</Button>
              </Link>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Payroll & time policy
                </CardTitle>
                <p className="text-xs text-slate-500">
                  Controls the timesheet period everyone files against, PTO
                  accrual, sick time, and company holidays.
                </p>
              </CardHeader>
              <CardContent>
                <form action={actionSavePayrollPolicy} className="grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-500">
                      Timesheet frequency
                      <select
                        name="timesheetFrequency"
                        className={selectClass}
                        defaultValue={payrollPolicy.timesheetFrequency}
                      >
                        <option value="WEEKLY">Weekly</option>
                        <option value="BIWEEKLY">Biweekly</option>
                        <option value="SEMIMONTHLY">Semimonthly</option>
                      </select>
                    </label>
                    <label className="text-xs text-slate-500">
                      Week starts on
                      <select
                        name="weekStartsOn"
                        className={selectClass}
                        defaultValue={String(payrollPolicy.weekStartsOn)}
                      >
                        <option value="0">Sunday</option>
                        <option value="1">Monday</option>
                        <option value="6">Saturday</option>
                      </select>
                    </label>
                    <label className="text-xs text-slate-500">
                      PTO accrual (hours / period)
                      <Input
                        name="ptoAccrualHoursPerPeriod"
                        type="number"
                        min={0}
                        step={0.5}
                        defaultValue={payrollPolicy.ptoAccrualHoursPerPeriod}
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Sick time (hours / year)
                      <Input
                        name="sickHoursPerYear"
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={payrollPolicy.sickHoursPerYear}
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Overtime after (hours / day)
                      <Input
                        name="otAfterDailyHours"
                        type="number"
                        min={0}
                        step={0.5}
                        defaultValue={payrollPolicy.otAfterDailyHours}
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Double time after (hours / day)
                      <Input
                        name="dtAfterDailyHours"
                        type="number"
                        min={0}
                        step={0.5}
                        defaultValue={payrollPolicy.dtAfterDailyHours}
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Overtime after (hours / week)
                      <Input
                        name="otAfterWeeklyHours"
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={payrollPolicy.otAfterWeeklyHours}
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Max hours / day (hard cap)
                      <Input
                        name="maxHoursPerDay"
                        type="number"
                        min={1}
                        step={0.5}
                        defaultValue={payrollPolicy.maxHoursPerDay}
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      OT multiplier
                      <Input
                        name="otMultiplier"
                        type="number"
                        min={1}
                        step={0.1}
                        defaultValue={payrollPolicy.otMultiplier}
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Double-time multiplier
                      <Input
                        name="dtMultiplier"
                        type="number"
                        min={1}
                        step={0.1}
                        defaultValue={payrollPolicy.dtMultiplier}
                      />
                    </label>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-400">
                      Company holidays
                    </p>
                    <HolidayPicker initialText={holidayText} />
                  </div>
                  <Button type="submit" size="sm">
                    Save payroll policy
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Accounting system</CardTitle>
                <p className="text-xs text-slate-500">
                  Basis and fiscal calendar for reporting.
                </p>
              </CardHeader>
              <CardContent>
                <form
                  action={actionSaveAccountingSettings}
                  className="grid gap-2"
                >
                  <label className="text-xs text-slate-500">
                    Accounting basis
                    <select
                      name="basis"
                      className={selectClass}
                      defaultValue={acctSettings.basis}
                    >
                      <option value="ACCRUAL">
                        Accrual (revenue when earned, expenses when incurred)
                      </option>
                      <option value="CASH">
                        Cash (revenue and expenses when money moves)
                      </option>
                    </select>
                  </label>
                  <label className="text-xs text-slate-500">
                    Fiscal year starts in
                    <select
                      name="fiscalYearStartMonth"
                      className={selectClass}
                      defaultValue={String(acctSettings.fiscalYearStartMonth)}
                    >
                      {[
                        "January",
                        "February",
                        "March",
                        "April",
                        "May",
                        "June",
                        "July",
                        "August",
                        "September",
                        "October",
                        "November",
                        "December",
                      ].map((m, i) => (
                        <option key={m} value={String(i + 1)}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button type="submit" size="sm">
                    Save settings
                  </Button>
                </form>
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
    <div className="mb-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      {rows.length === 0 && (
        <p className="text-xs text-slate-600">No accounts</p>
      )}
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex justify-between border-b border-slate-900/50 py-0.5 text-sm"
        >
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
