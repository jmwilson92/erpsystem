import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getCurrentUser, userCanSeeFinancials } from "@/lib/auth";
import { getNotificationSummary } from "@/lib/services/notifications";
import { getPtoBalances } from "@/lib/services/timesheets";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { computeEvm, formatPercent } from "@/lib/utils";
import {
  Factory,
  AlertTriangle,
  ShoppingCart,
  Package,
  TrendingUp,
  FlaskConical,
  FolderKanban,
  Shield,
  ClipboardCheck,
  Clock,
  Palmtree,
  Landmark,
} from "lucide-react";
import Link from "next/link";
import { DisciplinePulseCharts } from "@/components/dashboard/discipline-pulse";
import { getDisciplinePulse } from "@/lib/services/dashboard-pulse";
import { DashboardPersonalize } from "@/components/dashboard/dashboard-personalize";
import { Sparkline } from "@/components/dashboard/sparkline";
import { LandingPage } from "@/components/marketing/landing-page";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Marketing SEO for crawlers / signed-out visitors; app users get a private title. */
export async function generateMetadata(): Promise<Metadata> {
  const user = await getCurrentUser();
  if (user) {
    return {
      title: "Command center",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: {
      absolute: `${SITE_NAME} — ${SITE_TAGLINE}`,
    },
    description: SITE_DESCRIPTION,
    alternates: { canonical: "/" },
    openGraph: {
      title: `${SITE_NAME} — Manufacturing ERP for the whole shop`,
      description: SITE_DESCRIPTION,
      url: "/",
      type: "website",
    },
  };
}

const fmtMoney = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 10_000
      ? `$${Math.round(n / 1000).toLocaleString()}k`
      : `$${Math.round(n).toLocaleString()}`;

export default async function DashboardPage() {
  const user = await getCurrentUser();
  // Unauthenticated visitors get the public marketing landing page; signed-in
  // users get their dashboard. (Under DEMO_MODE, getCurrentUser resolves a
  // persona, so evaluators still see the app.)
  if (!user) return <LandingPage />;
  const canSeeMoney = await userCanSeeFinancials(user.id);
  const setupDone = (
    await prisma.companySettings.findUnique({ where: { id: "default" } })
  )?.setupCompleted ?? false;

  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const [
    woCounts,
    openMrb,
    openNcr,
    openPos,
    lowStock,
    projects,
    recentWos,
    recentNcrs,
    suppliers,
    gfpCount,
    inspections,
    arInvoices,
    apInvoices,
    recentSos,
    cashAccount,
    notif,
    balances,
    currentSheet,
    businessPriorities,
    disciplinePulse,
  ] = await Promise.all([
    prisma.workOrder.groupBy({ by: ["status"], _count: true }),
    prisma.mrbCase.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    prisma.nonConformance.count({
      where: { status: { in: ["OPEN", "UNDER_REVIEW", "MRB"] } },
    }),
    prisma.purchaseOrder.count({
      where: {
        status: { in: ["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT", "APPROVED"] },
      },
    }),
    prisma.inventoryItem.count({ where: { quantityAvailable: { lte: 5 } } }),
    prisma.project.findMany({ where: { status: "ACTIVE" }, take: 4 }),
    prisma.workOrder.findMany({
      take: 6,
      orderBy: { updatedAt: "desc" },
      include: { part: true, assignee: true },
    }),
    prisma.nonConformance.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { part: true, supplier: true },
    }),
    prisma.supplier.findMany({ orderBy: { overallScore: "desc" }, take: 5 }),
    prisma.governmentProperty.count({ where: { status: { not: "DISPOSED" } } }),
    prisma.inspection.groupBy({ by: ["status"], _count: true }),
    prisma.arInvoice.findMany({
      select: { invoiceDate: true, dueDate: true, total: true, amountPaid: true, status: true },
    }),
    prisma.apInvoice.findMany({
      select: { total: true, amountPaid: true, status: true },
    }),
    prisma.salesOrder.findMany({
      where: { orderDate: { gte: sixMonthsAgo } },
      include: { lines: true },
    }),
    prisma.account.findFirst({ where: { code: "1000" } }),
    getNotificationSummary(user),
    getPtoBalances(user.id),
    prisma.timesheet.findFirst({
      where: { userId: user.id, periodStart: { lte: now }, periodEnd: { gte: now } },
    }),
    prisma.businessPriority.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { priority: "asc" },
      take: 6,
      select: { id: true, number: true, title: true, category: true },
    }),
    getDisciplinePulse({ role: user.role, department: user.department }),
  ]);

  // ---- Financial pulse: 6-month sparklines + open balances ----
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleString("en-US", { month: "short" }),
    });
  }
  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const revenueByMonth = months.map((m) => ({
    label: m.label,
    value: Math.round(
      arInvoices
        .filter((i) => monthKey(i.invoiceDate) === m.key)
        .reduce((s, i) => s + i.total, 0)
    ),
  }));
  const bookingsByMonth = months.map((m) => ({
    label: m.label,
    value: Math.round(
      recentSos
        .filter((s) => monthKey(s.orderDate) === m.key)
        .reduce((s, so) => s + so.lines.reduce((t, l) => t + l.quantity * l.unitPrice, 0), 0)
    ),
  }));
  const openArList = arInvoices.filter((i) => i.status === "OPEN" || i.status === "PARTIAL");
  const openAr = openArList.reduce((s, i) => s + i.total - i.amountPaid, 0);
  const overdueAr = openArList
    .filter((i) => (i.dueDate ?? i.invoiceDate) < now)
    .reduce((s, i) => s + i.total - i.amountPaid, 0);
  const openAp = apInvoices
    .filter((i) => i.status === "OPEN" || i.status === "PARTIAL")
    .reduce((s, i) => s + i.total - i.amountPaid, 0);
  const revenue6mo = revenueByMonth.reduce((s, m) => s + m.value, 0);
  const bookings6mo = bookingsByMonth.reduce((s, m) => s + m.value, 0);

  // ---- Personal chips ----
  const firstName = user.name.split(" ")[0];
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const approvalsWaiting = notif.badges["/approvals"] || 0;
  const sheetStatus = currentSheet
    ? currentSheet.status.replace(/_/g, " ").toLowerCase()
    : "not started";

  // Personalizable dashboard views (EVM is gated behind financial visibility).
  const dashSections = [
    canSeeMoney && { id: "money", label: "Financial pulse" },
    { id: "pulse", label: `${disciplinePulse.discipline} pulse` },
    canSeeMoney && { id: "evm", label: "Project EVM" },
    { id: "recent-wos", label: "Recent work orders" },
    { id: "quality", label: "Quality alerts" },
    { id: "ops-stats", label: "Ops stat cards" },
    { id: "suppliers", label: "Supplier scorecard" },
  ].filter(Boolean) as { id: string; label: string }[];

  const statusMap = Object.fromEntries(woCounts.map((w) => [w.status, w._count]));
  const activeWos =
    (statusMap["IN_PROGRESS"] || 0) +
    (statusMap["RELEASED"] || 0) +
    (statusMap["ON_HOLD"] || 0);

  const inspPassed = inspections.find((i) => i.status === "PASSED")?._count || 0;
  const inspFailed = inspections.find((i) => i.status === "FAILED")?._count || 0;
  const yieldPct =
    inspPassed + inspFailed > 0
      ? Math.round((inspPassed / (inspPassed + inspFailed)) * 1000) / 10
      : 100;

  return (
    <div className="space-y-6">
      {!setupDone && (
        <a
          href="/setup"
          className="flex items-center justify-between rounded-xl border border-teal-500/40 bg-gradient-to-r from-teal-500/10 to-cyan-500/10 px-4 py-3 transition-colors hover:border-teal-400"
        >
          <span className="text-sm text-slate-200">
            🚀 <span className="font-semibold">Make it yours</span> — run the
            5-step setup wizard: company name, pay periods & overtime,
            review cycles, and your org chart. Takes about 3 minutes.
          </span>
          <span className="shrink-0 rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold text-white">
            Start setup →
          </span>
        </a>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">
            {now.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-50">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Production, quality, supply chain, and money — at a glance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/approvals"
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors ${
              approvalsWaiting > 0
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:border-amber-400"
                : "border-slate-800 text-slate-400 hover:border-slate-700"
            }`}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            {approvalsWaiting > 0
              ? `${approvalsWaiting} approval${approvalsWaiting === 1 ? "" : "s"} waiting`
              : "Approvals clear"}
          </Link>
          <Link
            href="/hr/timesheet"
            className="flex items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-xs text-slate-400 transition-colors hover:border-slate-700"
          >
            <Clock className="h-3.5 w-3.5 text-sky-400" />
            Timesheet: <span className="text-slate-200">{sheetStatus}</span>
          </Link>
          <Link
            href="/hr"
            className="flex items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-xs text-slate-400 transition-colors hover:border-slate-700"
          >
            <Palmtree className="h-3.5 w-3.5 text-teal-400" />
            <span className="text-slate-200">{balances.pto.available}h</span> PTO available
          </Link>
          <DashboardPersonalize sections={dashSections} />
        </div>
      </div>

      {businessPriorities.length > 0 && (
        <Link
          href="/leadership"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2.5 transition-colors hover:border-slate-700"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Company priorities
          </span>
          {businessPriorities.map((p, i) => (
            <span key={p.id} className="flex items-center gap-2">
              {i > 0 && <span className="text-slate-700">·</span>}
              <span className="text-xs text-slate-300">
                <span className="font-mono text-slate-600">{p.number}</span>{" "}
                {p.title}
              </span>
            </span>
          ))}
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Work Orders"
          value={activeWos}
          subtitle={`${statusMap["ON_HOLD"] || 0} on hold`}
          icon={Factory}
          accent="teal"
          href="/work-orders"
        />
        <StatCard
          title="Open MRB / NCR"
          value={`${openMrb} / ${openNcr}`}
          subtitle="Material review · non-conformances"
          icon={FlaskConical}
          accent={openMrb > 0 ? "amber" : "emerald"}
          href="/mrb"
        />
        <StatCard
          title="Open Purchase Orders"
          value={openPos}
          subtitle="In supply pipeline"
          icon={ShoppingCart}
          accent="sky"
          href="/purchasing"
        />
        <StatCard
          title="Incoming Yield"
          value={`${yieldPct}%`}
          subtitle={`${inspFailed} failed inspections`}
          icon={TrendingUp}
          accent={yieldPct >= 95 ? "emerald" : "amber"}
          href="/quality"
        />
      </div>

      {canSeeMoney && (
        <div data-dash="money" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Revenue billed · 6 mo
                </p>
                <Landmark className="h-4 w-4 text-teal-400" />
              </div>
              <p className="mt-1 text-xl font-bold tabular-nums text-slate-50">
                {fmtMoney(revenue6mo)}
              </p>
              <Sparkline data={revenueByMonth} color="#14b8a6" prefix="$" />
            </CardContent>
          </Card>
          <Card className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Bookings · 6 mo
                </p>
                <TrendingUp className="h-4 w-4 text-sky-400" />
              </div>
              <p className="mt-1 text-xl font-bold tabular-nums text-slate-50">
                {fmtMoney(bookings6mo)}
              </p>
              <Sparkline data={bookingsByMonth} color="#38bdf8" prefix="$" />
            </CardContent>
          </Card>
          <Link href="/accounting?tab=ar">
            <StatCard
              title="Open Receivables"
              value={fmtMoney(openAr)}
              subtitle={
                overdueAr > 0 ? `${fmtMoney(overdueAr)} past due` : "Nothing past due"
              }
              icon={Landmark}
              accent={overdueAr > 0 ? "amber" : "emerald"}
            />
          </Link>
          <Link href="/accounting?tab=ap">
            <StatCard
              title="Cash · Open Payables"
              value={fmtMoney(cashAccount?.balance || 0)}
              subtitle={`${fmtMoney(openAp)} owed to suppliers`}
              icon={ShoppingCart}
              accent="violet"
            />
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card data-dash="pulse" className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{disciplinePulse.discipline} Pulse</CardTitle>
            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">
              Your view
            </span>
          </CardHeader>
          <CardContent>
            <DisciplinePulseCharts pulse={disciplinePulse} />
          </CardContent>
        </Card>

        {canSeeMoney && (
        <Card data-dash="evm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-teal-400" />
              Project EVM
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {projects.map((p) => {
              const { spi, cpi } = computeEvm(p.plannedValue, p.earnedValue, p.actualCost);
              return (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="block rounded-lg border border-slate-800 p-3 transition-colors hover:border-teal-500/30 hover:bg-slate-900/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-slate-500">{p.number}</p>
                      <p className="text-sm font-medium text-slate-200">{p.name}</p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="mt-2 flex gap-3 text-xs">
                    <span className={spi >= 1 ? "text-emerald-400" : "text-amber-400"}>
                      SPI {spi.toFixed(2)}
                    </span>
                    <span className={cpi >= 1 ? "text-emerald-400" : "text-amber-400"}>
                      CPI {cpi.toFixed(2)}
                    </span>
                    <span className="text-slate-500">{formatPercent(p.percentComplete, 0)}</span>
                  </div>
                  <Progress value={p.percentComplete} className="mt-2 h-1.5" />
                </Link>
              );
            })}
            {projects.length === 0 && (
              <p className="text-sm text-slate-500">No active projects</p>
            )}
          </CardContent>
        </Card>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-dash="recent-wos">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Work Orders</CardTitle>
            <Link href="/work-orders" className="text-xs text-teal-400 hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentWos.map((wo) => (
                <Link
                  key={wo.id}
                  href={`/work-orders/${wo.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-800/80 px-3 py-2.5 transition-colors hover:bg-slate-900/60"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-teal-400">{wo.number}</span>
                      <StatusBadge status={wo.status} />
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {wo.part?.partNumber || wo.type} · {wo.assignee?.name || "Unassigned"}
                    </p>
                  </div>
                  <span className="text-xs text-slate-600">{wo.workCenter || "—"}</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card data-dash="quality">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Quality Alerts
            </CardTitle>
            <Link href="/quality" className="text-xs text-teal-400 hover:underline">
              Quality module
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentNcrs.length === 0 && (
                <p className="py-4 text-center text-sm text-slate-500">
                  No open quality alerts. 🎉
                </p>
              )}
              {recentNcrs.map((ncr) => (
                <Link
                  key={ncr.id}
                  href={`/quality?ncr=${ncr.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-800/80 px-3 py-2.5 transition-colors hover:border-amber-500/40"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-amber-400">{ncr.number}</span>
                      <StatusBadge status={ncr.status} />
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {ncr.title} · {ncr.part?.partNumber || ncr.source}
                    </p>
                  </div>
                  <StatusBadge status={ncr.severity} />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div data-dash="ops-stats" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/inventory">
          <StatCard
            title="Low / Watch Stock"
            value={lowStock}
            subtitle="Locations ≤ 5 available"
            icon={Package}
            accent="amber"
          />
        </Link>
        <Link href="/government-property">
          <StatCard
            title="Gov Property Assets"
            value={gfpCount}
            subtitle="GFP / CAP tracked"
            icon={Shield}
            accent="violet"
          />
        </Link>
        <Link href="/suppliers">
          <StatCard
            title="Top Supplier Score"
            value={suppliers[0] ? `${suppliers[0].rating} · ${suppliers[0].overallScore}` : "—"}
            subtitle={suppliers[0]?.name}
            icon={TrendingUp}
            accent="emerald"
          />
        </Link>
        <Link href="/mrb">
          <StatCard
            title="MRB Cycle"
            value={openMrb}
            subtitle="Cases awaiting disposition"
            icon={FlaskConical}
            accent={openMrb > 0 ? "red" : "teal"}
          />
        </Link>
      </div>

      <Card data-dash="suppliers">
        <CardHeader>
          <CardTitle>Supplier Scorecard Strip</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {suppliers.map((s) => (
              <Link
                key={s.id}
                href={`/suppliers/${s.id}`}
                className="rounded-lg border border-slate-800 p-3 hover:border-teal-500/30"
              >
                <p className="truncate text-sm font-medium text-slate-200">{s.name}</p>
                <p className="mt-1 text-2xl font-bold text-teal-400">{s.rating}</p>
                <p className="text-xs text-slate-500">
                  Score {s.overallScore} · OTD {s.onTimeDeliveryPct}%
                </p>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
