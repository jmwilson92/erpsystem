import { prisma } from "@/lib/db";
import { getFloorBoardData } from "@/lib/services/work-orders";
import { getValueStreamMetrics } from "@/lib/services/supply-chain";
import { FloorAutoRefresh } from "@/components/floor/auto-refresh";
import { computeEvm, formatCurrency, cn } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/status-badge";

export const dynamic = "force-dynamic";

export default async function RadiatorsPage() {
  const [floor, vsm, mrb, projects, suppliers] = await Promise.all([
    getFloorBoardData(),
    getValueStreamMetrics(),
    prisma.mrbCase.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    prisma.project.findMany({ where: { status: "ACTIVE" } }),
    prisma.supplier.findMany({ orderBy: { overallScore: "asc" }, take: 3 }),
  ]);

  return (
    <div className="min-h-[calc(100vh-8rem)] space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50 md:text-4xl">
            ForgeRP Live Board
          </h1>
          <p className="text-slate-500">Plant information radiator · auto-refresh</p>
        </div>
        <FloorAutoRefresh intervalSec={20} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "IN PROGRESS",
            value: floor.counts.inProgress,
            color: "text-teal-400 border-teal-500/40",
          },
          {
            label: "ON HOLD",
            value: floor.counts.onHold,
            color: "text-amber-400 border-amber-500/40",
          },
          {
            label: "OPEN MRB",
            value: mrb,
            color: mrb > 0 ? "text-red-400 border-red-500/40" : "text-emerald-400 border-emerald-500/40",
          },
          {
            label: "WIP VALUE",
            value: formatCurrency(floor.wipValue),
            color: "text-emerald-400 border-emerald-500/40",
          },
        ].map((k) => (
          <div
            key={k.label}
            className={cn(
              "rounded-2xl border-2 bg-slate-900/60 p-6 text-center",
              k.color
            )}
          >
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              {k.label}
            </p>
            <p className={cn("mt-2 text-5xl font-bold tabular-nums radiator-text md:text-6xl", k.color.split(" ")[0])}>
              {k.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold uppercase tracking-wider text-slate-400">
            Active Work Orders
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {floor.workOrders.slice(0, 8).map((wo) => {
              const prog = floor.signOffProgress.find((s) => s.id === wo.id);
              return (
                <div
                  key={wo.id}
                  className={cn(
                    "rounded-xl border-l-4 border border-slate-800 bg-slate-950/60 p-4",
                    wo.status === "IN_PROGRESS" && "border-l-teal-500",
                    wo.status === "ON_HOLD" && "border-l-amber-500",
                    wo.status === "RELEASED" && "border-l-sky-500",
                    wo.priority === "CRITICAL" && "animate-pulse-soft"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xl font-bold text-slate-50">
                      {wo.number}
                    </span>
                    <StatusBadge status={wo.status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    {wo.part?.partNumber || wo.type} · {wo.workCenter}
                  </p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-teal-400">
                    {prog?.pct ?? 0}%
                  </p>
                  <p className="text-xs text-slate-600">sign-off complete</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="mb-3 text-lg font-semibold uppercase tracking-wider text-slate-400">
              Value Stream
            </h2>
            <div className="space-y-2">
              {vsm.stages.map((s) => (
                <div
                  key={s.key}
                  className="flex items-center justify-between rounded-lg bg-slate-950/60 px-3 py-2"
                >
                  <span className="text-sm text-slate-300">{s.label}</span>
                  <span
                    className={cn(
                      "text-xs font-bold uppercase",
                      s.status === "constraint"
                        ? "text-red-400"
                        : s.status === "watch"
                          ? "text-amber-400"
                          : "text-emerald-400"
                    )}
                  >
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="mb-3 text-lg font-semibold uppercase tracking-wider text-slate-400">
              Program EVM
            </h2>
            {projects.map((p) => {
              const { spi, cpi } = computeEvm(p.plannedValue, p.earnedValue, p.actualCost);
              return (
                <div key={p.id} className="mb-3 last:mb-0">
                  <p className="text-sm font-medium text-slate-200">{p.name}</p>
                  <div className="mt-1 flex gap-4 text-2xl font-bold tabular-nums">
                    <span className={spi >= 1 ? "text-emerald-400" : "text-amber-400"}>
                      SPI {spi.toFixed(2)}
                    </span>
                    <span className={cpi >= 1 ? "text-emerald-400" : "text-amber-400"}>
                      CPI {cpi.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="mb-3 text-lg font-semibold uppercase tracking-wider text-slate-400">
              Supplier Watch
            </h2>
            {suppliers.map((s) => (
              <div key={s.id} className="mb-2 flex justify-between text-sm">
                <span className="text-slate-300">{s.name}</span>
                <span className="font-bold text-amber-400">
                  {s.rating} · {s.overallScore}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
