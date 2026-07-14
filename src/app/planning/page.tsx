import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { Plus, LineChart, ClipboardList, Factory, Gauge, AlertTriangle } from "lucide-react";
import { getCapacityAndWorkload } from "@/lib/services/capacity";
import { actionRemoveWorkCenterStaff } from "@/app/actions";
import { listUsers } from "@/lib/auth";
import { AssignStaffForm } from "@/components/planning/assign-staff-form";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = pick(sp, "tab") || "forecast";

  const [forecasts, mrsList, mwoCount, capacity, users] = await Promise.all([
    prisma.forecast.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { lines: true, materialRequisitions: true } },
      },
      take: 30,
    }),
    prisma.materialRequisition.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        forecast: { select: { number: true, name: true } },
        _count: { select: { lines: true, workOrders: true } },
      },
      take: 30,
    }),
    prisma.workOrder.count({ where: { sourceType: "MATERIAL_REQ" } }),
    getCapacityAndWorkload(),
    listUsers(),
  ]);

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planning"
        actions={
          <Link href="/planning/forecasts/new">
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" />
              New forecast
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        {(
          [
            { id: "forecast", label: "Forecast / MRS" },
            { id: "capacity", label: "Capacity planning" },
            { id: "workload", label: "Workload (week)" },
          ] as const
        ).map((t) => (
          <Link
            key={t.id}
            href={`/planning?tab=${t.id}`}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === t.id
                ? "bg-slate-800 text-slate-50"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "forecast" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              title="Forecasts"
              value={forecasts.length}
              icon={LineChart}
              accent="sky"
            />
            <StatCard
              title="Material req sheets"
              value={mrsList.length}
              icon={ClipboardList}
              accent="teal"
            />
            <StatCard
              title="MWO work orders"
              value={mwoCount}
              icon={Factory}
              accent="violet"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  Forecasts
                </h2>
              </div>
              {forecasts.map((f) => (
                <Link key={f.id} href={`/planning/forecasts/${f.id}`}>
                  <Card className="mb-2 transition-colors hover:border-sky-500/30">
                    <CardContent className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-mono text-sky-400">{f.number}</p>
                        <p className="text-sm text-slate-300">{f.name}</p>
                        <p className="text-xs text-slate-500">
                          {f._count.lines} lines · {f._count.materialRequisitions}{" "}
                          MRS
                        </p>
                      </div>
                      <StatusBadge status={f.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
              {!forecasts.length && (
                <p className="text-sm text-slate-500">No forecasts yet.</p>
              )}
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Material requisitions
              </h2>
              {mrsList.map((m) => (
                <Link key={m.id} href={`/planning/mrs/${m.id}`}>
                  <Card className="mb-2 transition-colors hover:border-violet-500/30">
                    <CardContent className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-mono text-violet-400">{m.number}</p>
                        <p className="text-sm text-slate-300">
                          {m.name || m.forecast?.name || "—"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {m._count.lines} lines · {m._count.workOrders} MWOs
                          {m.forecast ? ` · ${m.forecast.number}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={m.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
              {!mrsList.length && (
                <p className="text-sm text-slate-500">No MRS yet.</p>
              )}
            </div>
          </div>
        </>
      )}

      {(tab === "capacity" || tab === "workload") && (
        <>
          {/* Whole-plant production capacity utilization */}
          <div
            className={`rounded-2xl border p-5 ${
              capacity.totals.alert === "OVER"
                ? "border-rose-500/40 bg-rose-500/5"
                : capacity.totals.alert === "NEAR"
                  ? "border-amber-500/40 bg-amber-500/5"
                  : "border-teal-500/30 bg-teal-500/5"
            }`}
          >
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Total production capacity
                </p>
                <p
                  className={`mt-1 text-4xl font-bold tabular-nums ${
                    capacity.totals.alert === "OVER"
                      ? "text-rose-400"
                      : capacity.totals.alert === "NEAR"
                        ? "text-amber-400"
                        : "text-teal-400"
                  }`}
                >
                  {capacity.totals.totalCapacityPct}%
                </p>
              </div>
              <p className="text-right text-xs text-slate-500">
                {capacity.totals.projectedHours}h projected /{" "}
                {capacity.totals.availableHours}h available
                <br />
                {capacity.totals.alert === "OVER"
                  ? "Plant is over capacity"
                  : capacity.totals.alert === "NEAR"
                    ? "Plant is near capacity"
                    : "Plant has headroom"}
              </p>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full ${
                  capacity.totals.alert === "OVER"
                    ? "bg-rose-500"
                    : capacity.totals.alert === "NEAR"
                      ? "bg-amber-500"
                      : "bg-teal-500"
                }`}
                style={{
                  width: `${Math.min(100, capacity.totals.totalCapacityPct)}%`,
                }}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Available hrs (week)"
              value={capacity.totals.availableHours}
              icon={Gauge}
              accent="teal"
            />
            <StatCard
              title="Projected load (hrs)"
              value={capacity.totals.projectedHours}
              icon={Factory}
              accent="sky"
            />
            <StatCard
              title="Near capacity"
              value={capacity.totals.nearCapacityCount}
              icon={AlertTriangle}
              accent="amber"
            />
            <StatCard
              title="Over capacity"
              value={capacity.totals.overCapacityCount}
              icon={AlertTriangle}
              accent="red"
            />
          </div>
          <p className="text-xs text-slate-500">
            Week of {formatDate(capacity.weekStart)} –{" "}
            {formatDate(capacity.weekEnd)} · Capacity = staffed hours ×
            efficiency − approved/pending PTO · Alerts at ≥85% (near) and
            &gt;100% (over)
          </p>
        </>
      )}

      {tab === "capacity" && (() => {
        // userId → current center (for dropdown labels / move UX)
        const assignmentsByUser: Record<
          string,
          { workCenterId: string; code: string; name: string }
        > = {};
        for (const c of capacity.centers) {
          for (const s of c.staff) {
            assignmentsByUser[s.userId] = {
              workCenterId: c.workCenterId,
              code: c.code,
              name: c.name,
            };
          }
        }
        return (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Each person can only be staffed on one work center. Choosing someone
            already on another center will <strong className="text-slate-300">move</strong> them
            here.
          </p>
          {capacity.centers.map((c) => (
            <Card
              key={c.workCenterId}
              className={
                c.alert === "OVER"
                  ? "border-rose-500/40"
                  : c.alert === "NEAR"
                    ? "border-amber-500/40"
                    : "border-slate-800"
              }
            >
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="font-mono text-teal-400">
                    {c.code}
                  </CardTitle>
                  <StatusBadge status={c.area} />
                  <StatusBadge
                    status={
                      c.alert === "OVER"
                        ? "OVER_CAPACITY"
                        : c.alert === "NEAR"
                          ? "NEAR_CAPACITY"
                          : "OK"
                    }
                  />
                  <span className="text-sm text-slate-300">{c.name}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <Metric label="Staff" value={String(c.staffCount)} />
                  <Metric
                    label="Hrs/day"
                    value={String(c.hoursPerDayTotal)}
                  />
                  <Metric
                    label="PTO hrs"
                    value={String(c.ptoHoursThisWeek)}
                  />
                  <Metric
                    label="Available"
                    value={`${c.availableHoursThisWeek}h`}
                  />
                  <Metric
                    label="Projected"
                    value={`${c.projectedHoursThisWeek}h (${c.utilizationPct}%)`}
                  />
                </div>
                {/* Utilization bar */}
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${
                      c.alert === "OVER"
                        ? "bg-rose-500"
                        : c.alert === "NEAR"
                          ? "bg-amber-500"
                          : "bg-teal-500"
                    }`}
                    style={{
                      width: `${Math.min(100, c.utilizationPct)}%`,
                    }}
                  />
                </div>
                <div className="rounded border border-slate-800 bg-slate-950/40 p-2">
                  <p className="mb-1 text-[10px] uppercase text-slate-500">
                    Assigned people
                  </p>
                  {c.staff.length === 0 ? (
                    <p className="text-xs text-slate-600">
                      No staff assigned (using station capacity hours)
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {c.staff.map((s) => (
                        <li
                          key={s.userId}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-slate-200">
                            {s.name}{" "}
                            <span className="text-slate-500">
                              · {s.hoursPerDay}h/day
                            </span>
                          </span>
                          <form action={actionRemoveWorkCenterStaff}>
                            <input
                              type="hidden"
                              name="workCenterId"
                              value={c.workCenterId}
                            />
                            <input type="hidden" name="userId" value={s.userId} />
                            <Button type="submit" size="sm" variant="ghost">
                              Remove
                            </Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {c.workOrders.length > 0 && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {c.workOrders.slice(0, 8).map((wo) => (
                      <Link
                        key={wo.id}
                        href={`/work-orders/${wo.id}`}
                        className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:border-teal-500/40"
                      >
                        {wo.number}
                        <span className="ml-1 text-slate-500">
                          {wo.estimatedHours}h · {wo.priorityLabel}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
                <AssignStaffForm
                  workCenterId={c.workCenterId}
                  workCenterCode={c.code}
                  users={users.map((u) => ({ id: u.id, name: u.name }))}
                  assignmentsByUser={assignmentsByUser}
                  selectClass={selectClass}
                />
              </CardContent>
            </Card>
          ))}
        </div>
        );
      })()}

      {tab === "workload" && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Workload by work center (this week)
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {capacity.centers.map((c) => {
              const maxH = Math.max(
                1,
                ...c.workloadByDay.map((d) => d.hours),
                c.availableHoursThisWeek / 5
              );
              return (
                <Card key={c.workCenterId}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="font-mono text-base text-teal-400">
                        {c.code}
                      </CardTitle>
                      <StatusBadge status={c.area} />
                      {c.alert !== "OK" && (
                        <StatusBadge
                          status={
                            c.alert === "OVER" ? "OVER_CAPACITY" : "NEAR_CAPACITY"
                          }
                        />
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {c.projectedHoursThisWeek}h projected ·{" "}
                      {c.availableHoursThisWeek}h available
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-2 h-28">
                      {c.workloadByDay.map((d) => (
                        <div
                          key={d.date}
                          className="flex flex-1 flex-col items-center gap-1"
                        >
                          <span className="text-[10px] tabular-nums text-slate-500">
                            {d.hours}
                          </span>
                          <div
                            className={`w-full rounded-t ${
                              c.alert === "OVER"
                                ? "bg-rose-500/80"
                                : c.alert === "NEAR"
                                  ? "bg-amber-500/80"
                                  : "bg-teal-500/80"
                            }`}
                            style={{
                              height: `${Math.max(4, (d.hours / maxH) * 80)}px`,
                            }}
                            title={`${d.label}: ${d.hours}h`}
                          />
                          <span className="text-[10px] text-slate-500">
                            {d.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-slate-600">{label}</p>
      <p className="font-mono text-slate-200">{value}</p>
    </div>
  );
}
