import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
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
} from "lucide-react";
import Link from "next/link";
import { DashboardCharts } from "@/components/dashboard/charts";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const setupDone = (
    await prisma.companySettings.findUnique({ where: { id: "default" } })
  )?.setupCompleted ?? false;
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
  ]);

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

  const chartData = {
    woByStatus: woCounts.map((w) => ({ name: w.status.replace(/_/g, " "), value: w._count })),
    suppliers: suppliers.map((s) => ({
      name: s.code,
      score: s.overallScore,
      otd: s.onTimeDeliveryPct,
    })),
  };

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
      <PageHeader
        title="Operations Command Center"
        description="Cross-module snapshot — production, quality, supply chain, and program health"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Work Orders"
          value={activeWos}
          subtitle={`${statusMap["ON_HOLD"] || 0} on hold`}
          icon={Factory}
          accent="teal"
        />
        <StatCard
          title="Open MRB / NCR"
          value={`${openMrb} / ${openNcr}`}
          subtitle="Material review · non-conformances"
          icon={FlaskConical}
          accent={openMrb > 0 ? "amber" : "emerald"}
        />
        <StatCard
          title="Open Purchase Orders"
          value={openPos}
          subtitle="In supply pipeline"
          icon={ShoppingCart}
          accent="sky"
        />
        <StatCard
          title="Incoming Yield"
          value={`${yieldPct}%`}
          subtitle={`${inspFailed} failed inspections`}
          icon={TrendingUp}
          accent={yieldPct >= 95 ? "emerald" : "amber"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Work Order & Supplier Pulse</CardTitle>
          </CardHeader>
          <CardContent>
            <DashboardCharts data={chartData} />
          </CardContent>
        </Card>

        <Card>
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
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

        <Card>
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
              {recentNcrs.map((ncr) => (
                <div
                  key={ncr.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800/80 px-3 py-2.5"
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
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <Card>
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
