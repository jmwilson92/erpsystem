import type { ReactNode } from "react";
import { getFloorBoardData } from "@/lib/services/work-orders";
import { getCurrentUser, userCanSeeFinancials, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { workOrderHoldProvenance } from "@/lib/provenance";
import { compactCurrency, cn } from "@/lib/utils";
import Link from "next/link";
import { FloorAutoRefresh } from "@/components/floor/auto-refresh";
import { FloorFlow } from "@/components/floor/floor-flow";
import { WorkcenterPanel } from "@/components/workcenters/workcenter-panel";
import { Zap, AlertTriangle, TrendingUp, OctagonAlert } from "lucide-react";

export const dynamic = "force-dynamic";

// Roof color by work-area, so each "house" reads as its discipline.
const areaRoof: Record<string, string> = {
  MANUFACTURING: "#14b8a6",
  ASSEMBLY: "#14b8a6",
  QA: "#f59e0b",
  TEST: "#0ea5e9",
  INSPECTION: "#f59e0b",
  PAINT: "#a78bfa",
  SHIPPING: "#38bdf8",
};

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function FloorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = pick(sp, "tab") || "board";
  const [data, user] = await Promise.all([
    getFloorBoardData(),
    getCurrentUser(),
  ]);
  // WIP Value is hidden by default; only users who can see financials
  // (managers+) get it, and even then behind a "?wip=1" reveal.
  const canSeeWip = user ? await userCanSeeFinancials(user.id) : false;
  const canReorder = user
    ? await userHasPermission(user.id, "workorders.create")
    : false;
  const showWip = canSeeWip && pick(sp, "wip") === "1";
  const progressMap = Object.fromEntries(data.signOffProgress.map((s) => [s.id, s.pct]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production Floor"
        description="Live visual management — work orders, capacity, WIP, and sign-off progress"
        actions={<FloorAutoRefresh />}
      />

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        <Link
          href="/floor"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm",
            tab !== "stations"
              ? "bg-slate-800 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          Board
        </Link>
        <Link
          href="/floor?tab=stations"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm",
            tab === "stations"
              ? "bg-slate-800 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          Workcenters &amp; scan
        </Link>
      </div>

      {tab === "stations" ? (
        <WorkcenterPanel area="MANUFACTURING" returnPath="/floor" />
      ) : (
        <>

      {/* Over-capacity pulsing alert */}
      {data.kpis.overCapacity && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 animate-cap-alert">
          <OctagonAlert className="h-5 w-5 shrink-0 text-rose-400 animate-pulse-soft" />
          <p className="text-sm text-rose-100">
            <span className="font-semibold">Plant is over capacity</span> —{" "}
            {data.kpis.utilization}% load across all work centers. Re-balance
            work or add a shift.
          </p>
        </div>
      )}

      {/* Plant KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <KpiTile
          label="First-pass yield"
          value={`${data.kpis.fpy}%`}
          icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
          tone={data.kpis.fpy >= 95 ? "text-emerald-400" : "text-amber-400"}
        />
        <KpiTile
          label="Efficiency"
          value={`${data.kpis.efficiency}%`}
          icon={
            <Zap
              className={cn(
                "h-4 w-4 text-yellow-400",
                data.kpis.efficiency >= 90 && "animate-bolt"
              )}
            />
          }
          tone={data.kpis.efficiency >= 90 ? "text-yellow-300" : "text-amber-400"}
        />
        <KpiTile
          label="Holds / stoppages"
          value={data.kpis.holds}
          icon={
            <AlertTriangle
              className={cn(
                "h-4 w-4 text-amber-400",
                data.kpis.holds > 0 && "animate-pulse-soft"
              )}
            />
          }
          tone={data.kpis.holds > 0 ? "text-amber-400" : "text-emerald-400"}
        />
        <KpiTile label="In progress" value={data.counts.inProgress} tone="text-teal-400" />
        <KpiTile label="Released" value={data.counts.released} tone="text-sky-400" />
        {showWip ? (
          <KpiTile
            label={
              <span className="flex items-center justify-between">
                WIP value
                <Link href="/floor" className="text-[9px] text-slate-500 hover:text-slate-300">
                  hide
                </Link>
              </span>
            }
            value={compactCurrency(data.wipValue)}
            tone="text-emerald-400"
          />
        ) : canSeeWip ? (
          <Link
            href="/floor?wip=1"
            className="flex flex-col justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 px-4 py-3 text-center text-xs text-slate-500 transition-colors hover:border-slate-600 hover:text-slate-300"
          >
            + Show WIP value
          </Link>
        ) : (
          <KpiTile label="Planned" value={data.counts.planned} tone="text-slate-400" />
        )}
      </div>

      {/* Animated flow lane — stations joined by arrows, WOs gliding through */}
      <FloorFlow
        canReorder={canReorder}
        stations={data.byCenter.map((c) => ({
          code: c.center,
          name: c.name,
          area: c.area,
          wos: c.orders.map((wo) => ({
            id: wo.id,
            number: wo.number,
            status: wo.status,
            pct: progressMap[wo.id] || 0,
          })),
        }))}
      />

      {/* House-shaped work-center tiles */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {data.byCenter.map((center) => {
          const util =
            center.capacity > 0
              ? Math.round((center.loadHours / center.capacity) * 100)
              : 0;
          const over = util > 100;
          const roof = areaRoof[center.area] || "#64748b";
          return (
            <div key={center.center} className="flex flex-col">
              {/* Roof peak */}
              <div className="flex justify-center">
                <div
                  style={{
                    width: 0,
                    height: 0,
                    borderLeft: "70px solid transparent",
                    borderRight: "70px solid transparent",
                    borderBottom: `20px solid ${roof}`,
                  }}
                />
              </div>
              {/* House body */}
              <div
                className={cn(
                  "-mt-px flex-1 rounded-b-2xl rounded-t-md border border-slate-800 bg-slate-900/40",
                  over && "border-rose-500/50 animate-cap-alert"
                )}
                style={{ borderTop: `3px solid ${roof}` }}
              >
                <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
                  <div>
                    <p className="font-mono text-sm font-semibold text-slate-100">
                      {center.center}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">
                      {center.area}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
                      over
                        ? "border-rose-500/50 text-rose-300"
                        : util > 80
                          ? "border-amber-500/40 text-amber-300"
                          : "border-emerald-500/40 text-emerald-300"
                    )}
                  >
                    {util}%
                  </span>
                </div>

                <div className="space-y-2 p-3">
                  {center.orders.length === 0 && (
                    <p className="py-6 text-center text-xs text-slate-600">
                      Idle — no active work
                    </p>
                  )}
                  {center.orders.map((wo) => {
                    const pct = progressMap[wo.id] || 0;
                    return (
                      <Link
                        key={wo.id}
                        href={`/work-orders/${wo.id}`}
                        title={`${wo.number} — ${pct}% signed off`}
                        className={cn(
                          "relative block overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 transition-all hover:border-teal-500/40",
                          wo.status === "ON_HOLD" && "ring-1 ring-amber-500/40",
                          wo.priority === "CRITICAL" && "ring-1 ring-rose-500/40 animate-pulse-soft"
                        )}
                      >
                        {/* Green fill by sign-off progress */}
                        <div
                          className="absolute inset-y-0 left-0 bg-emerald-500/15"
                          style={{ width: `${pct}%` }}
                          aria-hidden
                        />
                        <div className="relative flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-slate-100">
                            {wo.number}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="text-[10px] tabular-nums text-emerald-300">
                              {pct}%
                            </span>
                            <StatusBadge
                              status={wo.status}
                              className="text-[8px]"
                              {...workOrderHoldProvenance(wo)}
                            />
                          </span>
                        </div>
                        <p className="relative mt-0.5 truncate text-[10px] text-slate-500">
                          {wo.part?.partNumber || wo.type.replace(/_/g, " ")}
                          {wo.quantity > 1 ? ` × ${wo.quantity}` : ""}
                          {wo.assignee ? ` · ${wo.assignee.name}` : ""}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
        </>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  icon,
  tone,
}: {
  label: ReactNode;
  value: string | number;
  icon?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-[11px] uppercase tracking-wider text-slate-500">
          {label}
        </div>
        {icon}
      </div>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone || "text-slate-200")}>
        {value}
      </p>
    </div>
  );
}
