import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { InlineSetting } from "@/components/settings/inline-setting";
import {
  getGaapReportPack,
  listJournalEntries,
  getCashFlowStatement,
  runDueAutoReversals,
  getAccountingOverview,
  getReclassifyData,
  getMonthEndCloseStatus,
} from "@/lib/services/gaap";
import { getBankingOverview } from "@/lib/services/banking";
import {
  getBudgetVsActual,
  get1099Report,
} from "@/lib/services/accounting-reports";
import {
  listScheduledReports,
  runDueScheduledReports,
} from "@/lib/services/scheduled-reports";
import {
  IncomeExpenseTrendChart,
  SpendDonut,
} from "@/components/accounting/overview-charts";
import { ReclassifyGrid } from "@/components/accounting/reclassify-grid";
import {
  IncomeStatementChart,
  BalanceSheetChart,
  CashFlowChart,
} from "@/components/accounting/report-charts";
import {
  listRecurringJournals,
  runDueRecurringJournals,
} from "@/lib/services/recurring-journals";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
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
  FilePlus2,
  Receipt,
  Banknote,
  HandCoins,
  Wallet,
  CreditCard,
  ArrowRight,
  LayoutDashboard,
  BookOpen,
  ListTree,
  BarChart3,
  Download,
  Printer,
  ClipboardCheck,
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
  actionReverseJournal,
  actionCreateRecurringJournal,
  actionToggleRecurringJournal,
  actionDeleteRecurringJournal,
  actionRunRecurringJournals,
  actionCreateVendorApInvoice,
  actionCreateExpenseEntry,
  actionReimburseExpense,
  actionSetAccountingCloseDate,
  actionSetSupplier1099,
  actionCreateScheduledReport,
  actionToggleScheduledReport,
  actionDeleteScheduledReport,
  actionRunScheduledReports,
} from "@/app/actions";
import { Lock, LockOpen } from "lucide-react";
import { getExpenseReimbursements } from "@/lib/services/hr";
import { getPayrollPolicy, parseHolidays } from "@/lib/services/timesheets";
import { HolidayPicker } from "@/components/accounting/holiday-picker";
import { PayrollTab } from "@/components/accounting/payroll-tab";
import { BankingTab } from "@/components/accounting/banking-tab";
import Link from "next/link";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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
  const defaultTab = pick(sp, "tab") || "overview";
  const periodFrom = pick(sp, "from");
  const periodTo = pick(sp, "to");
  const jeStatus = pick(sp, "jeStatus");

  const fromDate = periodFrom ? startOfDay(new Date(periodFrom)) : null;
  const toDate = periodTo ? endOfDay(new Date(periodTo)) : null;
  const validFrom =
    fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null;
  const validTo = toDate && !Number.isNaN(toDate.getTime()) ? toDate : null;

  // Memorized transactions & accrual reversals materialize on page load —
  // idempotent between due dates, same as QuickBooks' scheduled entries.
  try {
    await runDueRecurringJournals();
    await runDueAutoReversals();
    await runDueScheduledReports();
  } catch {
    /* never block the books on scheduler hiccups */
  }

  const pack = await getGaapReportPack();
  const [cashFlow, recurringTemplates, overview, bankOverview, closeStatus] =
    await Promise.all([
      getCashFlowStatement({ from: validFrom, to: validTo }),
      listRecurringJournals(),
      getAccountingOverview({ months: 12 }),
      getBankingOverview(),
      getMonthEndCloseStatus(),
    ]);
  const reclassifyData =
    defaultTab === "reclassify"
      ? await getReclassifyData({
          accountId: pick(sp, "acct") || null,
          from: validFrom,
          to: validTo,
        })
      : null;
  const budgetVsActual =
    defaultTab === "budget" ? await getBudgetVsActual() : null;
  const report1099 =
    defaultTab === "1099"
      ? await get1099Report({ year: Number(pick(sp, "year")) || undefined })
      : null;
  const scheduledReports =
    defaultTab === "scheduled" ? await listScheduledReports() : null;
  const [
    accounts,
    journals,
    projects,
    payrollPolicy,
    acctSettings,
    payrollQueue,
    arList,
    apList,
    reimbursements,
    apSuppliers,
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
    getExpenseReimbursements(),
    prisma.supplier.findMany({
      where: { status: { in: ["APPROVED", "CONDITIONAL"] } },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
      take: 300,
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

  // AR/AP aging snapshot (point-in-time, not period-bound). Buckets by days
  // past due using the due date when present, else the invoice date.
  const agingOf = (
    invoices: {
      status: string;
      total: number;
      amountPaid: number;
      invoiceDate: Date;
      dueDate: Date | null;
    }[]
  ) => {
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 };
    const nowMs = Date.now();
    for (const i of invoices) {
      if (!["OPEN", "PARTIAL"].includes(i.status)) continue;
      const open = i.total - i.amountPaid;
      if (open <= 0.01) continue;
      const basis = i.dueDate ?? i.invoiceDate;
      const daysPast = Math.floor((nowMs - basis.getTime()) / 86_400_000);
      if (daysPast <= 0) buckets.current += open;
      else if (daysPast <= 30) buckets.d30 += open;
      else if (daysPast <= 60) buckets.d60 += open;
      else if (daysPast <= 90) buckets.d90 += open;
      else buckets.d90plus += open;
      buckets.total += open;
    }
    return buckets;
  };
  const arAging = agingOf(arList);
  const apAging = agingOf(apList);

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

  const settingsUser = await getCurrentUser();
  const canEditSettings = await userHasPermission(
    settingsUser?.id,
    "accounting.journal.post"
  );

  // QuickBooks-style primary nav — each area maps to one or more views.
  // The active area is whichever contains the current ?tab=. Multi-view
  // areas (Expenses, Journals, Reports) get a secondary sub-nav.
  const payrollReady = payrollQueue.filter((t) => t.status === "APPROVED").length;
  const NAV: {
    key: string;
    label: string;
    icon: typeof Landmark;
    tabs: string[];
    badge?: number;
  }[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard, tabs: ["overview"] },
    { key: "banking", label: "Banking", icon: CreditCard, tabs: ["banking"] },
    { key: "sales", label: "Sales", icon: HandCoins, tabs: ["ar"] },
    { key: "expenses", label: "Expenses", icon: Receipt, tabs: ["ap", "expense"] },
    {
      key: "journals",
      label: "Journals",
      icon: BookOpen,
      tabs: ["je", "post", "recurring", "reclassify"],
      badge: pendingJe.length || undefined,
    },
    { key: "coa", label: "Chart of Accounts", icon: ListTree, tabs: ["coa"] },
    {
      key: "reports",
      label: "Reports",
      icon: BarChart3,
      tabs: ["pl", "bs", "cf", "tb", "cost", "budget", "1099", "scheduled"],
    },
    {
      key: "payroll",
      label: "Payroll",
      icon: Wallet,
      tabs: ["payroll"],
      badge: payrollReady || undefined,
    },
  ];
  const SUBLABEL: Record<string, string> = {
    ap: "Bills & AP",
    expense: "Expense / card entry",
    je: "Register",
    post: "Post entry",
    recurring: `Recurring${recurringTemplates.length ? ` (${recurringTemplates.length})` : ""}`,
    reclassify: "Reclassify",
    pl: "Income Statement",
    bs: "Balance Sheet",
    cf: "Cash Flow",
    tb: "Trial Balance",
    cost: "Cost Integration",
    budget: "Budget vs Actual",
    "1099": "1099 Vendors",
    scheduled: "Scheduled",
  };
  const activeGroup = NAV.find((n) => n.tabs.includes(defaultTab)) ?? NAV[0];
  const showPeriodBar = ["sales", "expenses", "journals", "reports"].includes(
    activeGroup.key
  );

  // Table ⇄ Chart toggle on reports (QuickBooks-style).
  const reportView = pick(sp, "view") === "chart" ? "chart" : "table";
  const viewToggle = (tab: string) => (
    <div className="inline-flex shrink-0 rounded-lg border border-slate-700 p-0.5 text-xs">
      <Link
        href={`/accounting?tab=${tab}${periodSuffix}`}
        scroll={false}
        className={`rounded-md px-2.5 py-1 transition ${
          reportView === "table"
            ? "bg-slate-800 text-teal-400"
            : "text-slate-400 hover:text-slate-200"
        }`}
      >
        Table
      </Link>
      <Link
        href={`/accounting?tab=${tab}&view=chart${periodSuffix}`}
        scroll={false}
        className={`rounded-md px-2.5 py-1 transition ${
          reportView === "chart"
            ? "bg-slate-800 text-teal-400"
            : "text-slate-400 hover:text-slate-200"
        }`}
      >
        Chart
      </Link>
    </div>
  );
  const reportTools = (report: string, hasChart: boolean, hasPrint = true) => (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {hasChart && viewToggle(report)}
      <a
        href={`/accounting/export?report=${report}${periodSuffix}`}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500"
      >
        <Download className="h-3.5 w-3.5" /> CSV
      </a>
      {hasPrint && (
        <a
          href={`/accounting/reports/print?report=${report}${periodSuffix}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500"
        >
          <Printer className="h-3.5 w-3.5" /> Print
        </a>
      )}
    </div>
  );

  // QuickBooks-style date-range presets (server-computed, pure links).
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const fyStartMonth = (acctSettings.fiscalYearStartMonth || 1) - 1; // 0-indexed
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const thisQuarterStart = new Date(now.getFullYear(), qStartMonth, 1);
  const thisQuarterEnd = new Date(now.getFullYear(), qStartMonth + 3, 0);
  // Fiscal year containing today
  const fyStartYear =
    now.getMonth() >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = new Date(fyStartYear, fyStartMonth, 1);
  const fyEnd = new Date(fyStartYear + 1, fyStartMonth, 0);
  const datePresets: { label: string; from?: string; to?: string }[] = [
    { label: "This month", from: iso(thisMonthStart), to: iso(thisMonthEnd) },
    { label: "Last month", from: iso(lastMonthStart), to: iso(lastMonthEnd) },
    {
      label: "This quarter",
      from: iso(thisQuarterStart),
      to: iso(thisQuarterEnd),
    },
    { label: "Fiscal YTD", from: iso(fyStart), to: iso(now) },
    { label: "Fiscal year", from: iso(fyStart), to: iso(fyEnd) },
    { label: "All dates" },
  ];
  const presetHref = (p: { from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    qs.set("tab", defaultTab);
    if (p.from) qs.set("from", p.from);
    if (p.to) qs.set("to", p.to);
    return `/accounting?${qs.toString()}`;
  };
  const activePreset = datePresets.find(
    (p) => (p.from || "") === (periodFrom || "") && (p.to || "") === (periodTo || "")
  )?.label;


  // Spend per sales order: POs cut from SO-charged PRs (directly or via the
  // WO the PR supplied) rolled up against the order value, so accounting
  // can watch profit / loss per SO. Charge-code (budget) buys live in
  // Budgets; this is the sales-order side.
  const soSpendPos = await prisma.purchaseOrder.findMany({
    where: {
      status: { notIn: ["CANCELLED"] },
      purchaseRequest: {
        OR: [
          { chargeType: "SALES_ORDER" },
          { workOrder: { salesOrderId: { not: null } } },
        ],
      },
    },
    select: {
      totalAmount: true,
      purchaseRequest: {
        select: {
          salesOrderId: true,
          workOrder: { select: { salesOrderId: true } },
        },
      },
    },
  });
  const spendBySo = new Map<string, number>();
  for (const po of soSpendPos) {
    const soId =
      po.purchaseRequest?.salesOrderId ||
      po.purchaseRequest?.workOrder?.salesOrderId;
    if (!soId) continue;
    spendBySo.set(soId, (spendBySo.get(soId) || 0) + po.totalAmount);
  }
  // Labor charged to SOs (buyer packaging time, etc.) rolls into SO spend
  const soLabor = await prisma.timeEntry.findMany({
    where: {
      costAmount: { gt: 0 },
      purchaseRequest: {
        OR: [
          { salesOrderId: { not: null } },
          { workOrder: { salesOrderId: { not: null } } },
        ],
      },
    },
    select: {
      costAmount: true,
      purchaseRequest: {
        select: {
          salesOrderId: true,
          workOrder: { select: { salesOrderId: true } },
        },
      },
    },
  });
  for (const t of soLabor) {
    const soId =
      t.purchaseRequest?.salesOrderId ||
      t.purchaseRequest?.workOrder?.salesOrderId;
    if (!soId) continue;
    spendBySo.set(soId, (spendBySo.get(soId) || 0) + t.costAmount);
  }
  const soSpendOrders = spendBySo.size
    ? await prisma.salesOrder.findMany({
        where: { id: { in: [...spendBySo.keys()] } },
        select: { id: true, number: true, status: true, totalAmount: true },
        orderBy: { number: "asc" },
      })
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting"
        description={`${acctSettings.basis} basis · FY starts month ${acctSettings.fiscalYearStartMonth}`}
      />

      {/* Period filter bar — only where line lists are filtered */}
      {showPeriodBar && (
      <Card>
        <CardContent className="space-y-3 p-3">
          {/* Quick date-range presets (QuickBooks-style) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] uppercase tracking-wider text-slate-600">
              Period
            </span>
            {datePresets.map((p) => {
              const active = activePreset === p.label;
              return (
                <Link
                  key={p.label}
                  href={presetHref(p)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                    active
                      ? "border-teal-500 bg-teal-500/10 text-teal-300"
                      : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                  }`}
                >
                  {p.label}
                </Link>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-3">
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
          </div>
        </CardContent>
      </Card>
      )}

      {activeGroup.key === "overview" && (
      <>
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
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
            acctSettings.closedThroughDate
              ? "border-slate-700 text-slate-300"
              : "border-emerald-800 text-emerald-400"
          }`}
        >
          {acctSettings.closedThroughDate ? (
            <>
              <Lock className="h-3.5 w-3.5" />
              Closed through {formatDate(acctSettings.closedThroughDate)}
            </>
          ) : (
            <>
              <LockOpen className="h-3.5 w-3.5" />
              Books open
            </>
          )}
        </span>
      </div>
      </>
      )}

      {/* Settings + month-end close live in the Reports area */}
      {activeGroup.key === "reports" && (
      <>
      {/* Accounting settings — editable inline; also on Admin → Company Settings */}
      <Card className="border-slate-800">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-3">
          <InlineSetting
            label="Accounting basis"
            name="basis"
            type="select"
            value={acctSettings.basis}
            display={acctSettings.basis === "CASH" ? "Cash" : "Accrual"}
            options={[
              { value: "ACCRUAL", label: "Accrual" },
              { value: "CASH", label: "Cash" },
            ]}
            action={actionSaveAccountingSettings}
            hiddenFields={{
              fiscalYearStartMonth: String(acctSettings.fiscalYearStartMonth),
            }}
            canEdit={canEditSettings}
          />
          <InlineSetting
            label="Fiscal year starts"
            name="fiscalYearStartMonth"
            type="select"
            value={String(acctSettings.fiscalYearStartMonth)}
            display={MONTH_NAMES[(acctSettings.fiscalYearStartMonth || 1) - 1]}
            options={MONTH_NAMES.map((m, i) => ({
              value: String(i + 1),
              label: m,
            }))}
            action={actionSaveAccountingSettings}
            hiddenFields={{ basis: acctSettings.basis }}
            canEdit={canEditSettings}
          />
          <Link
            href="/admin/settings"
            className="text-xs text-teal-400 hover:underline"
          >
            All company settings →
          </Link>
        </CardContent>
      </Card>

      {/* Month-end close checklist */}
      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-4 w-4 text-teal-400" />
              Month-end close
            </CardTitle>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${
                closeStatus.ready
                  ? "border-emerald-800 text-emerald-400"
                  : "border-amber-800 text-amber-400"
              }`}
            >
              {closeStatus.ready ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              {closeStatus.ready
                ? "Ready to close"
                : `${closeStatus.openCount} item${closeStatus.openCount === 1 ? "" : "s"} open`}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {acctSettings.closedThroughDate
              ? `Books closed through ${formatDate(acctSettings.closedThroughDate)} — journals on/before that date are locked from posting, approval, and voiding.`
              : "Clear these before locking the period. The close never blocks — items are guidance."}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            {closeStatus.items.map((it) => (
              <Link
                key={it.key}
                href={it.href}
                scroll={false}
                className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-1.5 text-sm hover:border-slate-600"
              >
                {it.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-amber-400" />
                )}
                <span className="text-slate-200">{it.label}</span>
                <span className="ml-2 truncate text-xs text-slate-500">
                  {it.detail}
                </span>
                {!it.done && (
                  <span className="ml-auto shrink-0 rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-300">
                    {it.count}
                  </span>
                )}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3">
            <form action={actionSetAccountingCloseDate} className="flex items-end gap-2">
              <label className="text-xs text-slate-500">
                Close through
                <Input
                  name="closeDate"
                  type="date"
                  defaultValue={
                    acctSettings.closedThroughDate
                      ? new Date(acctSettings.closedThroughDate)
                          .toISOString()
                          .slice(0, 10)
                      : ""
                  }
                  className="h-8 w-40"
                />
              </label>
              <Button type="submit" size="sm" className="h-8">
                {acctSettings.closedThroughDate ? "Update close date" : "Close period"}
              </Button>
            </form>
            {acctSettings.closedThroughDate && (
              <form action={actionSetAccountingCloseDate}>
                <input type="hidden" name="closeDate" value="" />
                <Button type="submit" size="sm" variant="outline" className="h-8">
                  Reopen
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
      </>
      )}

      <Tabs value={defaultTab}>
        {/* Primary section nav (QuickBooks-style, real links) */}
        <div className="-mx-1 flex items-center gap-0.5 overflow-x-auto border-b border-slate-800 px-1">
          {NAV.map((n) => {
            const active = n.key === activeGroup.key;
            const Icon = n.icon;
            return (
              <Link
                key={n.key}
                href={`/accounting?tab=${n.tabs[0]}`}
                scroll={false}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "border-teal-500 text-teal-400"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {n.label}
                {n.badge ? (
                  <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-300">
                    {n.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>

        {/* Secondary sub-nav for multi-view areas */}
        {activeGroup.tabs.length > 1 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {activeGroup.tabs.map((t) => {
              const active = t === defaultTab;
              return (
                <Link
                  key={t}
                  href={`/accounting?tab=${t}${periodSuffix}`}
                  scroll={false}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    active
                      ? "border-teal-500 bg-teal-500/10 text-teal-300"
                      : "border-slate-700 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {SUBLABEL[t] || t}
                </Link>
              );
            })}
          </div>
        )}

        <TabsContent value="overview" className="space-y-4">
          {/* Greeting */}
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold text-slate-100">
                {(() => {
                  const h = new Date().getHours();
                  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
                  const first = settingsUser?.name?.split(" ")[0];
                  return `Good ${part}${first ? `, ${first}` : ""}`;
                })()}
              </h2>
              <p className="text-sm text-slate-500">
                Here&apos;s how the books look over the last 12 months.
              </p>
            </div>
            <span className="text-xs text-slate-500">
              {acctSettings.basis === "CASH" ? "Cash" : "Accrual"} basis ·{" "}
              {overview.netIncome >= 0 ? "profitable" : "operating at a loss"} trailing year
            </span>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Journal entry", icon: FilePlus2, tab: "post", accent: "text-sky-400" },
              { label: "Record expense", icon: Receipt, tab: "expense", accent: "text-amber-400" },
              { label: "Receive payment", icon: HandCoins, tab: "ar", accent: "text-emerald-400" },
              { label: "Pay a bill", icon: Banknote, tab: "ap", accent: "text-rose-400" },
              { label: "Bank feeds", icon: CreditCard, tab: "banking", accent: "text-teal-400" },
              { label: "Run payroll", icon: Wallet, tab: "payroll", accent: "text-violet-400" },
            ].map((a) => (
              <Link
                key={a.tab}
                href={`/accounting?tab=${a.tab}`}
                scroll={false}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/40 px-2 py-3 text-center transition hover:border-teal-500/40 hover:bg-slate-900/70"
              >
                <a.icon className={`h-5 w-5 ${a.accent}`} />
                <span className="text-xs font-medium text-slate-300">{a.label}</span>
              </Link>
            ))}
          </div>

          {/* Books-close status */}
          <Link
            href="/accounting?tab=pl"
            scroll={false}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2.5 text-sm transition hover:border-teal-500/40"
          >
            <ClipboardCheck className="h-4 w-4 shrink-0 text-teal-400" />
            <span className="font-medium text-slate-200">Month-end close</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                closeStatus.ready
                  ? "border-emerald-800 text-emerald-400"
                  : "border-amber-800 text-amber-400"
              }`}
            >
              {closeStatus.ready ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {closeStatus.ready
                ? "Ready to close"
                : `${closeStatus.openCount} item${closeStatus.openCount === 1 ? "" : "s"} to clear`}
            </span>
            <span className="text-xs text-slate-500">
              {closeStatus.closedThroughDate
                ? `Closed through ${formatDate(closeStatus.closedThroughDate)}`
                : "Books open"}
            </span>
            <ArrowRight className="ml-auto h-4 w-4 text-slate-500" />
          </Link>

          {/* Trend + bank accounts */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">Income vs. expenses</CardTitle>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                      Income{" "}
                      <span className="font-mono text-slate-300">
                        {formatCurrency(overview.totalIncome)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
                      Expenses{" "}
                      <span className="font-mono text-slate-300">
                        {formatCurrency(overview.totalExpense)}
                      </span>
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Trailing 12 months · net{" "}
                  <span
                    className={
                      overview.netIncome >= 0 ? "text-emerald-400" : "text-rose-400"
                    }
                  >
                    {formatCurrency(overview.netIncome)}
                  </span>
                </p>
              </CardHeader>
              <CardContent>
                <IncomeExpenseTrendChart data={overview.trend} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Bank accounts</CardTitle>
                  <Link
                    href="/accounting?tab=banking"
                    className="flex items-center gap-0.5 text-xs text-teal-400 hover:underline"
                  >
                    Banking <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <p className="text-lg font-bold tabular-nums text-slate-100">
                  {formatCurrency(
                    bankOverview.reduce((s, a) => s + a.currentBalance, 0)
                  )}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    across {bankOverview.length}
                  </span>
                </p>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {bankOverview.length === 0 && (
                  <p className="py-4 text-center text-sm text-slate-500">
                    No bank accounts connected yet.
                  </p>
                )}
                {bankOverview.map((a) => (
                  <Link
                    key={a.id}
                    href={`/accounting?tab=banking&acct=${a.id}`}
                    className="flex items-center gap-2 rounded-lg border border-slate-800 px-2.5 py-1.5 text-sm hover:border-teal-500/40"
                  >
                    {a.kind === "CREDIT_CARD" ? (
                      <CreditCard className="h-4 w-4 shrink-0 text-violet-400" />
                    ) : (
                      <Landmark className="h-4 w-4 shrink-0 text-teal-400" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-slate-300">
                      {a.name}
                      {a.last4 ? (
                        <span className="text-slate-600"> ···{a.last4}</span>
                      ) : null}
                    </span>
                    {a.unmatched > 0 && (
                      <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-px text-[10px] font-semibold text-amber-300">
                        {a.unmatched} to review
                      </span>
                    )}
                    <span className="shrink-0 font-mono tabular-nums text-slate-200">
                      {formatCurrency(a.currentBalance)}
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Spend donut + aging */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Where the money went</CardTitle>
                <p className="text-xs text-slate-500">
                  Spending by category · trailing 12 months
                </p>
              </CardHeader>
              <CardContent>
                <SpendDonut data={overview.spendByCategory} />
              </CardContent>
            </Card>
            <div className="space-y-4">
              <AgingSummary title="AR aging — who owes you" buckets={arAging} tone="ar" />
              <AgingSummary title="AP aging — what you owe" buckets={apAging} tone="ap" />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pl">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Income Statement (GAAP)</CardTitle>
              {reportTools("pl", true)}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {reportView === "chart" ? (
                <IncomeStatementChart
                  revenue={pl.revenue}
                  cogs={pl.cogs}
                  grossProfit={pl.grossProfit}
                  operatingExpenses={pl.operatingExpenses}
                  netIncome={pl.netIncome}
                />
              ) : (
              <>
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
              </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bs">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Balance Sheet</CardTitle>
              {reportTools("bs", true)}
            </CardHeader>
            {reportView === "chart" ? (
              <CardContent>
                <BalanceSheetChart
                  assets={bs.assets}
                  liabilities={bs.liabilities}
                  equity={bs.equity}
                  currentEarnings={bs.currentEarnings}
                />
              </CardContent>
            ) : (
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
            )}
          </Card>
        </TabsContent>

        <TabsContent value="cf">
          <Card>
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between">
                <CardTitle>Statement of Cash Flows (indirect method)</CardTitle>
                {reportTools("cf", true)}
              </div>
              <p className="text-xs text-slate-500">
                {formatDate(cashFlow.from)} → {formatDate(cashFlow.to)} · from
                posted journal activity. Defaults to calendar year-to-date;
                use the period filter above to change it.
              </p>
            </CardHeader>
            <CardContent className="max-w-2xl space-y-4 text-sm">
              {reportView === "chart" ? (
                <CashFlowChart
                  operating={cashFlow.operatingTotal}
                  investing={cashFlow.investingTotal}
                  financing={cashFlow.financingTotal}
                  netChange={cashFlow.netChange}
                />
              ) : (
              <>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Operating activities
                </p>
                <CfRow label="Net income" value={cashFlow.netIncome} strong />
                {cashFlow.depreciation > 0 && (
                  <CfRow
                    label="Add back: depreciation & amortization"
                    value={cashFlow.depreciation}
                  />
                )}
                {cashFlow.operating.map((r) => (
                  <CfRow
                    key={r.code}
                    label={`${r.amount >= 0 ? "Decrease" : "Increase"} in ${r.account}`}
                    code={r.code}
                    value={r.amount}
                  />
                ))}
                <CfTotal
                  label="Net cash from operating activities"
                  value={cashFlow.operatingTotal}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Investing activities
                </p>
                {cashFlow.investing.length === 0 && (
                  <p className="text-xs text-slate-600">No investing activity in period.</p>
                )}
                {cashFlow.investing.map((r) => (
                  <CfRow
                    key={r.code}
                    label={`${r.amount < 0 ? "Purchases of" : "Proceeds from"} ${r.account}`}
                    code={r.code}
                    value={r.amount}
                  />
                ))}
                <CfTotal
                  label="Net cash from investing activities"
                  value={cashFlow.investingTotal}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Financing activities
                </p>
                {cashFlow.financing.length === 0 && (
                  <p className="text-xs text-slate-600">No financing activity in period.</p>
                )}
                {cashFlow.financing.map((r) => (
                  <CfRow key={r.code} label={r.account} code={r.code} value={r.amount} />
                ))}
                <CfTotal
                  label="Net cash from financing activities"
                  value={cashFlow.financingTotal}
                />
              </div>
              <div className="flex justify-between border-t border-slate-700 pt-3 text-lg font-semibold">
                <span>Net change in cash</span>
                <span
                  className={
                    cashFlow.netChange >= 0 ? "text-emerald-400" : "text-red-400"
                  }
                >
                  {formatCurrency(cashFlow.netChange)}
                </span>
              </div>
              <p
                className={`flex items-center gap-1.5 text-xs ${
                  cashFlow.reconciled ? "text-emerald-500" : "text-amber-400"
                }`}
              >
                {cashFlow.reconciled ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                {cashFlow.reconciled
                  ? "Ties to cash-account movement on the ledger."
                  : `Ledger cash moved ${formatCurrency(cashFlow.cashMovement)} — difference usually means journals posted directly between non-cash accounts and cash outside the period, or unclassified accounts.`}
              </p>
              </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tb">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Trial Balance</CardTitle>
              {reportTools("tb", false)}
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
                      className="border-b border-slate-900/80 text-[13px] hover:bg-slate-900/40"
                    >
                      <td className="py-1 font-mono">
                        <Link
                          href={`/accounting/account/${a.id}${periodSuffix ? `?${periodSuffix.slice(1)}` : ""}`}
                          className="text-teal-400 hover:underline"
                        >
                          {a.code}
                        </Link>
                      </td>
                      <td className="py-1 text-slate-300">
                        <Link
                          href={`/accounting/account/${a.id}${periodSuffix ? `?${periodSuffix.slice(1)}` : ""}`}
                          className="hover:text-teal-300 hover:underline"
                        >
                          {a.name}
                        </Link>
                      </td>
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
        <TabsContent value="ar" className="space-y-4">
          <AgingSummary title="AR aging" buckets={arAging} tone="ar" />
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
                            Record
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
        <TabsContent value="ap" className="space-y-4">
          {reimbursements.length > 0 && (
            <Card className="border-amber-900/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Employee reimbursements
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {reimbursements.length} approved · awaiting payment
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {reimbursements.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-mono text-teal-400">{r.number}</span>
                      <span className="ml-2 text-slate-300">{r.user.name}</span>
                      <span className="ml-2 text-xs text-slate-500">{r.title}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono tabular-nums text-slate-200">
                        {formatCurrency(r.totalAmount)}
                      </span>
                      <form action={actionReimburseExpense}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" size="sm">
                          Record reimbursement
                        </Button>
                      </form>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <AgingSummary title="AP aging" buckets={apAging} tone="ap" />

          <Card className="border-teal-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Enter outside vendor invoice
              </CardTitle>
              <p className="text-xs text-slate-500">
                Track bills from outside vendors (services, non-inventory). PO
                receipts still auto-create AP. Pay open balances in the grid
                below.
              </p>
            </CardHeader>
            <CardContent>
              <form
                action={actionCreateVendorApInvoice}
                className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
              >
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Vendor *
                  </label>
                  <select
                    name="supplierId"
                    required
                    className={`${selectClass} mt-1`}
                  >
                    <option value="">— Select —</option>
                    {apSuppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} · {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Amount *
                  </label>
                  <Input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Vendor invoice #
                  </label>
                  <Input name="vendorInvoiceNumber" className="mt-1" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Due date
                  </label>
                  <Input name="dueDate" type="date" className="mt-1" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Expense account
                  </label>
                  <select
                    name="expenseAccountId"
                    className={`${selectClass} mt-1`}
                  >
                    <option value="">— default OpEx —</option>
                    {expenseAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Description
                  </label>
                  <Input
                    name="description"
                    className="mt-1"
                    placeholder="What was purchased / service"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <Button type="submit" size="sm">
                    Create vendor AP invoice
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Accounts payable
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {apFiltered.length} invoices · pay open balances here
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
                            Record
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
                  <Link
                    key={a.id}
                    href={`/accounting/account/${a.id}`}
                    className="grid grid-cols-[4rem_1fr_5rem_5.5rem] gap-x-2 border-b border-slate-900/70 px-3 py-0.5 text-[12px] hover:bg-slate-900/50"
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
                  </Link>
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
                        {je.status === "POSTED" && (
                          <form action={actionReverseJournal}>
                            <input type="hidden" name="id" value={je.id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              className="h-6 px-1.5 text-[10px]"
                              title="Post the mirror entry (debits ↔ credits)"
                            >
                              Reverse
                            </Button>
                          </form>
                        )}
                        {je.status !== "VOID" && (
                          <form
                            action={actionVoidJournal}
                            className="flex gap-1"
                          >
                            <input type="hidden" name="id" value={je.id} />
                            <input
                              name="reason"
                              required
                              placeholder="Void reason"
                              className="h-6 w-28 rounded-md border border-slate-700 bg-slate-950 px-1.5 text-[10px] text-slate-200"
                            />
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
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Spend by sales order</CardTitle>
              <p className="text-xs text-slate-500">
                Purchase spend traced to each sales order (SO-charged PRs and
                the buys feeding their work orders) against the order value —
                the live profit / loss watch per order.
              </p>
            </CardHeader>
            <CardContent>
              {soSpendOrders.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No sales-order-charged purchases yet.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase text-slate-500">
                      <th className="pb-2">Sales order</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2 text-right">Order value</th>
                      <th className="pb-2 text-right">PO spend</th>
                      <th className="pb-2 text-right">Margin so far</th>
                    </tr>
                  </thead>
                  <tbody>
                    {soSpendOrders.map((so) => {
                      const spend = spendBySo.get(so.id) || 0;
                      const margin = so.totalAmount - spend;
                      return (
                        <tr key={so.id} className="border-t border-slate-800/60">
                          <td className="py-2">
                            <Link
                              href={`/sales/${so.id}`}
                              className="font-mono text-xs text-sky-400 hover:underline"
                            >
                              {so.number}
                            </Link>
                          </td>
                          <td className="py-2 text-xs text-slate-400">
                            {so.status}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {formatCurrency(so.totalAmount)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {formatCurrency(spend)}
                          </td>
                          <td
                            className={`py-2 text-right tabular-nums ${
                              margin < 0 ? "text-red-400" : "text-emerald-400"
                            }`}
                          >
                            {formatCurrency(margin)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
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

        <TabsContent value="budget">
          {budgetVsActual && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>Budget vs. Actual</CardTitle>
                  <p className="text-xs text-slate-500">
                    Enacted budgets · budget {formatCurrency(budgetVsActual.totalBudget)}{" "}
                    vs actual {formatCurrency(budgetVsActual.totalActual)} ·{" "}
                    {budgetVsActual.overCount} over budget
                  </p>
                </div>
                {reportTools("budget", false, false)}
              </CardHeader>
              <CardContent className="p-0">
                <div className="grid grid-cols-[1fr_5rem_6rem_6rem_6rem_8rem] gap-x-2 border-b border-slate-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <span>Budget</span>
                  <span>Class</span>
                  <span className="text-right">Budgeted</span>
                  <span className="text-right">Actual</span>
                  <span className="text-right">Variance</span>
                  <span>Used</span>
                </div>
                {budgetVsActual.rows.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-[1fr_5rem_6rem_6rem_6rem_8rem] items-center gap-x-2 border-b border-slate-900/70 px-3 py-1.5 text-[12px] hover:bg-slate-900/40"
                  >
                    <span className="min-w-0 truncate text-slate-300">
                      <span className="font-mono text-teal-400">{r.number}</span>{" "}
                      {r.name}
                      {r.chargeCode ? (
                        <span className="ml-1 font-mono text-[10px] text-slate-600">
                          {r.chargeCode}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[11px] text-slate-500">{r.costClass}</span>
                    <span className="text-right font-mono tabular-nums text-slate-300">
                      {formatCurrency(r.budget)}
                    </span>
                    <span className="text-right font-mono tabular-nums text-slate-300">
                      {formatCurrency(r.actual)}
                    </span>
                    <span
                      className={`text-right font-mono tabular-nums ${
                        r.variance < 0 ? "text-rose-400" : "text-emerald-400"
                      }`}
                    >
                      {formatCurrency(r.variance)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                        <span
                          className={`block h-full ${
                            r.over ? "bg-rose-500" : r.pctUsed > 85 ? "bg-amber-500" : "bg-teal-500"
                          }`}
                          style={{ width: `${Math.min(r.pctUsed, 100)}%` }}
                        />
                      </span>
                      <span className="w-9 text-right text-[11px] tabular-nums text-slate-400">
                        {r.pctUsed}%
                      </span>
                    </span>
                  </div>
                ))}
                {budgetVsActual.rows.length === 0 && (
                  <p className="p-6 text-center text-sm text-slate-500">
                    No enacted budgets yet. Create budgets under Budgets.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="1099" className="space-y-4">
          {report1099 && (
            <>
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>1099 Vendors · {report1099.year}</CardTitle>
                    <p className="text-xs text-slate-500">
                      {report1099.reportableCount} vendor(s) paid ≥{" "}
                      {formatCurrency(600)} · {formatCurrency(report1099.totalPaid)}{" "}
                      total
                      {report1099.missingTaxIds > 0 && (
                        <span className="ml-1 text-amber-400">
                          · {report1099.missingTaxIds} missing a tax ID
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-lg border border-slate-700 p-0.5 text-xs">
                      {[0, 1, 2].map((back) => {
                        const y = new Date().getFullYear() - back;
                        const active = y === report1099.year;
                        return (
                          <Link
                            key={y}
                            href={`/accounting?tab=1099&year=${y}`}
                            scroll={false}
                            className={`rounded-md px-2.5 py-1 ${
                              active ? "bg-slate-800 text-teal-400" : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            {y}
                          </Link>
                        );
                      })}
                    </div>
                    {reportTools("1099", false, false)}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="grid grid-cols-[1fr_9rem_7rem_6rem] gap-x-2 border-b border-slate-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <span>Vendor</span>
                    <span>Tax ID</span>
                    <span className="text-right">Paid {report1099.year}</span>
                    <span>1099</span>
                  </div>
                  {report1099.rows.map((v) => (
                    <div
                      key={v.id}
                      className="grid grid-cols-[1fr_9rem_7rem_6rem] items-center gap-x-2 border-b border-slate-900/70 px-3 py-1.5 text-[12px]"
                    >
                      <span className="truncate text-slate-300">
                        <span className="font-mono text-teal-400">{v.code}</span> {v.name}
                      </span>
                      <span
                        className={`font-mono text-[11px] ${
                          v.missingTaxId && v.reportable ? "text-amber-400" : "text-slate-500"
                        }`}
                      >
                        {v.taxId || (v.reportable ? "⚠ missing" : "—")}
                      </span>
                      <span className="text-right font-mono tabular-nums text-slate-300">
                        {formatCurrency(v.paid)}
                      </span>
                      <span>
                        {v.reportable ? (
                          <span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-semibold text-emerald-300">
                            reportable
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-600">under $600</span>
                        )}
                      </span>
                    </div>
                  ))}
                  {report1099.rows.length === 0 && (
                    <p className="p-6 text-center text-sm text-slate-500">
                      No vendors flagged 1099-reportable. Mark them below.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Maintain 1099 status</CardTitle>
                  <p className="text-xs text-slate-500">
                    Flag contractor / service vendors as 1099-reportable and record
                    their EIN or SSN.
                  </p>
                </CardHeader>
                <CardContent className="max-h-96 space-y-1 overflow-y-auto">
                  {report1099.vendors.map((v) => (
                    <form
                      key={v.id}
                      action={actionSetSupplier1099}
                      className="flex flex-wrap items-center gap-2 border-b border-slate-900 py-1.5 text-sm"
                    >
                      <input type="hidden" name="supplierId" value={v.id} />
                      <span className="min-w-0 flex-1 truncate text-slate-300">
                        <span className="font-mono text-slate-500">{v.code}</span> {v.name}
                      </span>
                      <label className="flex items-center gap-1 text-[11px] text-slate-400">
                        <input
                          type="checkbox"
                          name="is1099"
                          value="true"
                          defaultChecked={v.is1099}
                          className="h-3.5 w-3.5 accent-teal-500"
                        />
                        1099
                      </label>
                      <Input
                        name="taxId"
                        defaultValue={v.taxId || ""}
                        placeholder="EIN / SSN"
                        className="h-7 w-32 text-xs"
                      />
                      <Button type="submit" size="sm" variant="outline" className="h-7 text-[10px]">
                        Save
                      </Button>
                    </form>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="scheduled" className="space-y-4">
          {scheduledReports && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Schedule a report email</CardTitle>
                  <p className="text-xs text-slate-500">
                    Have a financial report emailed on a cadence.{" "}
                    {process.env.RESEND_API_KEY
                      ? "Delivered via your mail provider."
                      : "Mail isn't configured, so sends are logged in the email center until you set RESEND_API_KEY."}
                  </p>
                </CardHeader>
                <CardContent>
                  <form action={actionCreateScheduledReport} className="grid gap-2">
                    <Input name="name" placeholder="Name e.g. Monthly P&L to owners" />
                    <select name="report" required className={selectClass} defaultValue="pl">
                      <option value="pl">Income Statement</option>
                      <option value="bs">Balance Sheet</option>
                      <option value="cf">Cash Flow</option>
                      <option value="tb">Trial Balance</option>
                      <option value="budget">Budget vs. Actual</option>
                      <option value="1099">1099 Vendor Summary</option>
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <select name="frequency" className={selectClass} defaultValue="MONTHLY">
                        <option value="WEEKLY">Weekly</option>
                        <option value="MONTHLY">Monthly</option>
                        <option value="QUARTERLY">Quarterly</option>
                      </select>
                      <Input
                        name="dayOfMonth"
                        type="number"
                        min="1"
                        max="28"
                        defaultValue="1"
                        title="Day of month (1–28); for weekly, 1=Mon … 7=Sun"
                      />
                    </div>
                    <Input
                      name="recipients"
                      required
                      placeholder="Recipients — comma separated emails"
                    />
                    <Button type="submit" size="sm">
                      Schedule report
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-base">
                      Scheduled reports · {scheduledReports.length}
                    </CardTitle>
                    <p className="text-xs text-slate-500">
                      Due reports send automatically when Accounting loads.
                    </p>
                  </div>
                  <form action={actionRunScheduledReports}>
                    <Button type="submit" size="sm" variant="outline">
                      Send due now
                    </Button>
                  </form>
                </CardHeader>
                <CardContent className="space-y-2">
                  {scheduledReports.length === 0 && (
                    <p className="py-4 text-center text-sm text-slate-500">
                      Nothing scheduled yet.
                    </p>
                  )}
                  {scheduledReports.map((s) => (
                    <div
                      key={s.id}
                      className="rounded-lg border border-slate-800 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-sm font-medium text-slate-200">
                            {s.name}
                          </span>
                          <span className="ml-2 text-xs text-slate-500">
                            {s.reportLabel} · {s.frequency.toLowerCase()} · day {s.dayOfMonth}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <form action={actionToggleScheduledReport}>
                            <input type="hidden" name="id" value={s.id} />
                            <input
                              type="hidden"
                              name="isActive"
                              value={s.isActive ? "false" : "true"}
                            />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                            >
                              {s.isActive ? "Pause" : "Resume"}
                            </Button>
                          </form>
                          <form action={actionDeleteScheduledReport}>
                            <input type="hidden" name="id" value={s.id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px] text-rose-400"
                            >
                              Delete
                            </Button>
                          </form>
                        </div>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-slate-500">
                        → {s.recipients} ·{" "}
                        {s.isActive
                          ? `next ${s.nextRunAt ? formatDate(s.nextRunAt) : "—"}`
                          : "paused"}
                        {s.lastRunAt ? ` · last ${formatDate(s.lastRunAt)}` : ""}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
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
                <select name="settleArInvoiceId" className={selectClass} defaultValue="">
                  <option value="">— Settle AR invoice? (optional) —</option>
                  {arList
                    .filter((i) => !["PAID", "VOID"].includes(i.status))
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.number} · {i.customer.name} · open{" "}
                        {formatCurrency(i.total - i.amountPaid)}
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-slate-500">
                  Pick an invoice to auto-apply the AR credit to its balance when
                  this JE posts — no need to record the payment again in AR.
                </p>
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
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" name="autoReverse" value="true" />
                  Accrual — auto-reverse on the 1st of next month
                </label>
                <Button type="submit" size="sm">
                  Submit for approval
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recurring" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Memorize a recurring journal
                </CardTitle>
                <p className="text-xs text-slate-500">
                  Rent, depreciation, standing accruals — posts itself on
                  schedule. Mark it as an accrual to auto-reverse each entry on
                  the 1st of the following month.
                </p>
              </CardHeader>
              <CardContent>
                <form
                  action={actionCreateRecurringJournal}
                  className="grid gap-2"
                >
                  <Input
                    name="name"
                    required
                    placeholder="Name e.g. Monthly rent — Building A"
                  />
                  <select name="debitAccountId" required className={selectClass}>
                    <option value="">Debit account…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
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
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      name="amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      placeholder="Amount"
                    />
                    <select name="frequency" className={selectClass} defaultValue="MONTHLY">
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                      <option value="QUARTERLY">Quarterly</option>
                      <option value="ANNUALLY">Annually</option>
                    </select>
                    <Input
                      name="dayOfMonth"
                      type="number"
                      min="1"
                      max="28"
                      defaultValue="1"
                      title="Day of month to post (1–28); for weekly, 1=Mon … 7=Sun"
                    />
                  </div>
                  <Input name="memo" placeholder="Line memo (optional)" />
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    <input type="checkbox" name="autoReverse" value="true" />
                    Accrual — each posting auto-reverses on the 1st of the next
                    month
                  </label>
                  <Button type="submit" size="sm">
                    Memorize journal
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <div>
                  <CardTitle className="text-base">
                    Scheduled journals · {recurringTemplates.length}
                  </CardTitle>
                  <p className="text-xs text-slate-500">
                    Due entries post automatically when Accounting loads, or run
                    them now.
                  </p>
                </div>
                <form action={actionRunRecurringJournals}>
                  <Button type="submit" size="sm" variant="outline">
                    Run due now
                  </Button>
                </form>
              </CardHeader>
              <CardContent className="space-y-2">
                {recurringTemplates.length === 0 && (
                  <p className="py-4 text-center text-sm text-slate-500">
                    Nothing memorized yet.
                  </p>
                )}
                {recurringTemplates.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-lg border border-slate-800 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-sm font-medium text-slate-200">
                          {t.name}
                        </span>
                        <span className="ml-2 text-xs text-slate-500">
                          {t.frequency.toLowerCase()} · day {t.dayOfMonth} ·{" "}
                          {formatCurrency(t.amount)}
                          {t.autoReverse ? " · auto-reversing accrual" : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <form action={actionToggleRecurringJournal}>
                          <input type="hidden" name="id" value={t.id} />
                          <input
                            type="hidden"
                            name="isActive"
                            value={t.isActive ? "false" : "true"}
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px]"
                          >
                            {t.isActive ? "Pause" : "Resume"}
                          </Button>
                        </form>
                        <form action={actionDeleteRecurringJournal}>
                          <input type="hidden" name="id" value={t.id} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px] text-rose-400"
                          >
                            Delete
                          </Button>
                        </form>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {t.lines
                        .map(
                          (l) =>
                            `${l.debit ? "Dr" : "Cr"} ${l.accountCode || "?"} ${l.accountName || ""}`
                        )
                        .join(" / ")}
                      {" · "}
                      {t.isActive
                        ? `next ${t.nextRunAt ? formatDate(t.nextRunAt) : "—"}`
                        : "paused"}
                      {t.lastRunAt ? ` · last ${formatDate(t.lastRunAt)}` : ""}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="reclassify" className="space-y-4">
          {reclassifyData && (
            <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
              {/* Account rail */}
              <Card className="h-fit">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Accounts</CardTitle>
                  <p className="text-xs text-slate-500">Filter lines by account</p>
                </CardHeader>
                <CardContent className="max-h-[36rem] overflow-y-auto p-0">
                  <Link
                    href="/accounting?tab=reclassify"
                    scroll={false}
                    className={`flex items-center justify-between border-b border-slate-900/70 px-3 py-1.5 text-xs hover:bg-slate-900/50 ${
                      !pick(sp, "acct")
                        ? "bg-teal-500/10 text-teal-300"
                        : "text-slate-300"
                    }`}
                  >
                    <span>All accounts</span>
                  </Link>
                  {reclassifyData.accounts.map((a) => {
                    const active = a.id === pick(sp, "acct");
                    return (
                      <Link
                        key={a.id}
                        href={`/accounting?tab=reclassify&acct=${a.id}`}
                        scroll={false}
                        className={`flex items-center gap-2 border-b border-slate-900/70 px-3 py-1 text-xs hover:bg-slate-900/50 ${
                          active ? "bg-teal-500/10" : ""
                        }`}
                      >
                        <span className="font-mono text-teal-400">{a.code}</span>
                        <span className="truncate text-slate-300">{a.name}</span>
                        <span className="ml-auto shrink-0 font-mono tabular-nums text-slate-500">
                          {formatCurrency(a.balance)}
                        </span>
                      </Link>
                    );
                  })}
                </CardContent>
              </Card>

              {/* Transaction grid */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Reclassify transactions
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {reclassifyData.total} line
                      {reclassifyData.total === 1 ? "" : "s"}
                      {pick(sp, "acct")
                        ? ` in ${reclassifyData.accounts.find((a) => a.id === pick(sp, "acct"))?.code || ""}`
                        : ""}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ReclassifyGrid
                    lines={reclassifyData.lines}
                    accounts={reclassifyData.accounts}
                    activeAcct={pick(sp, "acct")}
                  />
                </CardContent>
              </Card>
            </div>
          )}
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
          <PayrollTab />

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

        <TabsContent value="banking" className="space-y-4">
          <BankingTab selectedId={pick(sp, "acct")} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AgingSummary({
  title,
  buckets,
  tone,
}: {
  title: string;
  buckets: {
    current: number;
    d30: number;
    d60: number;
    d90: number;
    d90plus: number;
    total: number;
  };
  tone: "ar" | "ap";
}) {
  const cells = [
    { label: "Current", value: buckets.current, cls: "text-emerald-400" },
    { label: "1–30", value: buckets.d30, cls: "text-slate-200" },
    { label: "31–60", value: buckets.d60, cls: "text-amber-400" },
    { label: "61–90", value: buckets.d90, cls: "text-orange-400" },
    { label: "90+", value: buckets.d90plus, cls: "text-rose-400" },
  ];
  const total = buckets.total || 1;
  const barTone =
    tone === "ar"
      ? ["bg-emerald-500", "bg-teal-500", "bg-amber-500", "bg-orange-500", "bg-rose-500"]
      : ["bg-emerald-500", "bg-sky-500", "bg-amber-500", "bg-orange-500", "bg-rose-500"];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {title}
          <span className="ml-2 text-xs font-normal text-slate-500">
            {formatCurrency(buckets.total)} open
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Stacked proportion bar */}
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
          {cells.map((c, i) => (
            <div
              key={c.label}
              className={barTone[i]}
              style={{ width: `${(c.value / total) * 100}%` }}
              title={`${c.label}: ${formatCurrency(c.value)}`}
            />
          ))}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {cells.map((c) => (
            <div
              key={c.label}
              className="rounded-lg border border-slate-800 bg-slate-900/40 px-2 py-1.5"
            >
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                {c.label}
              </p>
              <p className={`text-sm font-semibold tabular-nums ${c.cls}`}>
                {formatCurrency(c.value)}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CfRow({
  label,
  code,
  value,
  strong,
}: {
  label: string;
  code?: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between border-b border-slate-900/50 py-0.5 ${
        strong ? "font-medium text-slate-200" : "text-slate-400"
      }`}
    >
      <span>
        {code && <span className="mr-1 font-mono text-teal-500/80">{code}</span>}
        {label}
      </span>
      <span className="tabular-nums text-slate-300">{formatCurrency(value)}</span>
    </div>
  );
}

function CfTotal({ label, value }: { label: string; value: number }) {
  return (
    <div className="mt-1 flex justify-between border-t border-slate-800 pt-1.5 font-semibold">
      <span>{label}</span>
      <span
        className={`tabular-nums ${value >= 0 ? "text-emerald-400" : "text-red-400"}`}
      >
        {formatCurrency(value)}
      </span>
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
