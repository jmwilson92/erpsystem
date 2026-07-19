import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import {
  Plus,
  LineChart,
  ClipboardList,
  Factory,
  Gauge,
  AlertTriangle,
  CalendarRange,
  Settings2,
} from "lucide-react";
import { getCapacityAndWorkload } from "@/lib/services/capacity";
import { getPlanningExceptions } from "@/lib/services/planning-exceptions";
import {
  getPlanningSettings,
  type CalendarMode,
} from "@/lib/services/schedule";
import {
  actionRemoveWorkCenterStaff,
  actionSavePlanningSettings,
  actionRescheduleWorkOrder,
  actionBulkRescheduleUnscheduled,
} from "@/app/actions";
import { listUsers } from "@/lib/auth";
import { AssignStaffForm } from "@/components/planning/assign-staff-form";
import { ActionLoadingForm } from "@/components/layout/action-loading";
import { addWeeks, startOfWeek, endOfWeek } from "date-fns";

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
  const tab = pick(sp, "tab") || "overview";
  const weekOffset = Math.min(8, Math.max(0, Number(pick(sp, "week") || 0) || 0));
  const weekSpan = Math.min(4, Math.max(1, Number(pick(sp, "span") || 1) || 1));
  const horizonStart = startOfWeek(addWeeks(new Date(), weekOffset), {
    weekStartsOn: 1,
  });
  const horizonEnd = endOfWeek(
    addWeeks(horizonStart, weekSpan - 1),
    { weekStartsOn: 1 }
  );

  const [
    forecasts,
    mrsList,
    mwoCount,
    capacity,
    users,
    exceptionsPack,
    planningSettings,
    scheduleWos,
  ] = await Promise.all([
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
    getCapacityAndWorkload(horizonStart, {
      horizonStart,
      horizonEnd,
    }),
    listUsers(),
    getPlanningExceptions(),
    getPlanningSettings(),
    prisma.workOrder.findMany({
      where: {
        status: {
          notIn: ["COMPLETED", "CANCELLED", "CLOSED", "SCRAPPED"],
        },
      },
      orderBy: [{ plannedStart: "asc" }, { dueDate: "asc" }],
      take: 80,
      include: {
        part: { select: { partNumber: true } },
        businessPriority: { select: { number: true, title: true } },
      },
    }),
  ]);

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  const lateCount = exceptionsPack.counts.LATE_RISK || 0;
  const noDatesCount =
    (exceptionsPack.counts.NO_DATES || 0) +
    (exceptionsPack.counts.UNSCHEDULED || 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planning"
        description="Rough-cut capacity · working calendar · forecast → MRS → dated MWOs"
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
            { id: "overview", label: "Overview" },
            { id: "forecast", label: "Forecast / MRS" },
            { id: "schedule", label: "Schedule" },
            { id: "capacity", label: "Capacity" },
            { id: "workload", label: "Workload" },
            { id: "exceptions", label: "Exceptions" },
            { id: "settings", label: "Calendar" },
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
            {t.id === "exceptions" && exceptionsPack.exceptions.length > 0
              ? ` (${exceptionsPack.exceptions.length})`
              : ""}
          </Link>
        ))}
      </div>

      {(tab === "overview" ||
        tab === "capacity" ||
        tab === "workload") && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">Horizon:</span>
          {[
            { week: 0, span: 1, label: "This week" },
            { week: 1, span: 1, label: "Next week" },
            { week: 0, span: 2, label: "2 weeks" },
            { week: 0, span: 4, label: "4 weeks" },
          ].map((h) => (
            <Link
              key={`${h.week}-${h.span}`}
              href={`/planning?tab=${tab === "overview" ? "overview" : tab}&week=${h.week}&span=${h.span}`}
              className={`rounded-md px-2.5 py-1 ${
                weekOffset === h.week && weekSpan === h.span
                  ? "bg-teal-500/20 text-teal-300"
                  : "border border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {h.label}
            </Link>
          ))}
          {capacity.unscheduled.count > 0 && (
            <ActionLoadingForm
              theme="planning"
              action={actionBulkRescheduleUnscheduled}
              className="ml-auto"
            >
              <Button type="submit" size="sm" variant="secondary">
                Reschedule {capacity.unscheduled.count} unscheduled
              </Button>
            </ActionLoadingForm>
          )}
        </div>
      )}

      {tab === "overview" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Plant util (horizon)"
              value={`${capacity.totals.totalCapacityPct}%`}
              icon={Gauge}
              accent={
                capacity.totals.alert === "OVER"
                  ? "red"
                  : capacity.totals.alert === "NEAR"
                    ? "amber"
                    : "teal"
              }
            />
            <StatCard
              title="Scheduled load (h)"
              value={capacity.totals.projectedHours}
              icon={Factory}
              accent="sky"
            />
            <StatCard
              title="Unscheduled backlog (h)"
              value={capacity.totals.unscheduledHours}
              icon={CalendarRange}
              accent="amber"
            />
            <StatCard
              title="Late / no dates"
              value={lateCount + noDatesCount}
              icon={AlertTriangle}
              accent={lateCount + noDatesCount > 0 ? "red" : "teal"}
            />
          </div>
          <p className="text-xs text-slate-500">
            Horizon {formatDate(capacity.weekStart)} –{" "}
            {formatDate(capacity.weekEnd)} · Calendar mode{" "}
            <span className="font-mono text-slate-400">
              {planningSettings.calendarMode}
            </span>{" "}
            · Load only counts WOs with planned windows overlapping this
            horizon. Unscheduled hours are separate — they no longer fake-load
            Monday.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top exceptions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {exceptionsPack.exceptions.slice(0, 8).map((e, i) => (
                  <Link
                    key={`${e.code}-${e.entityId}-${i}`}
                    href={e.href}
                    className="block rounded border border-slate-800 px-3 py-2 text-sm hover:border-teal-500/30"
                  >
                    <span
                      className={
                        e.severity === "critical"
                          ? "text-rose-400"
                          : "text-amber-400"
                      }
                    >
                      {e.code}
                    </span>
                    <span className="ml-2 text-slate-300">{e.title}</span>
                    <p className="text-xs text-slate-500">{e.detail}</p>
                  </Link>
                ))}
                {!exceptionsPack.exceptions.length && (
                  <p className="text-sm text-slate-500">No exceptions — clean shop.</p>
                )}
                <Link
                  href="/planning?tab=exceptions"
                  className="text-xs text-teal-400 hover:underline"
                >
                  All exceptions →
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Forecast / MRS pulse</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-400">
                <p>
                  {forecasts.length} forecasts · {mrsList.length} MRS ·{" "}
                  {mwoCount} MWOs
                </p>
                <Link href="/planning?tab=forecast">
                  <Button size="sm" variant="outline">
                    Open forecast board
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </>
      )}

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

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              title="Available hrs (horizon)"
              value={capacity.totals.availableHours}
              icon={Gauge}
              accent="teal"
            />
            <StatCard
              title="Scheduled load (hrs)"
              value={capacity.totals.projectedHours}
              icon={Factory}
              accent="sky"
            />
            <StatCard
              title="Unscheduled (hrs)"
              value={capacity.totals.unscheduledHours}
              icon={CalendarRange}
              accent="amber"
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
            Horizon {formatDate(capacity.weekStart)} –{" "}
            {formatDate(capacity.weekEnd)} · Available = staffed hours ×
            efficiency − PTO (incl. pending) · Load = WO hours whose{" "}
            <strong className="font-medium text-slate-400">planned window</strong>{" "}
            overlaps this horizon (rough-cut, not finite sequencing) · Alerts ≥
            85% near / &gt;100% over
          </p>
          {capacity.unscheduled.count > 0 && (
            <Card className="border-amber-500/30">
              <CardHeader>
                <CardTitle className="text-base text-amber-200">
                  Unscheduled backlog ({capacity.unscheduled.count} WOs ·{" "}
                  {capacity.unscheduled.hours}h)
                </CardTitle>
                <p className="text-xs text-slate-500">
                  No planned start/end (and no due+estimate to synthesize). Open
                  the traveler and use Back from due or Forward from today.
                </p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {capacity.unscheduled.workOrders.map((w) => (
                  <Link
                    key={w.id}
                    href={`/work-orders/${w.id}`}
                    className="rounded border border-slate-700 px-2 py-1 font-mono text-xs text-sky-400"
                  >
                    {w.number}
                    <span className="ml-1 text-slate-500">{w.estimatedHours}h</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {tab === "schedule" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open work schedule</CardTitle>
            <p className="text-xs text-slate-500">
              Ordered by planned start. Use traveler actions to reschedule.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="pb-2">WO</th>
                  <th className="pb-2">Part</th>
                  <th className="pb-2">Station</th>
                  <th className="pb-2">Planned</th>
                  <th className="pb-2">Due</th>
                  <th className="pb-2">Est</th>
                  <th className="pb-2">Risk</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {scheduleWos.map((wo) => (
                  <tr key={wo.id} className="border-t border-slate-800/80">
                    <td className="py-2">
                      <Link
                        href={`/work-orders/${wo.id}`}
                        className="font-mono text-sky-400"
                      >
                        {wo.number}
                      </Link>
                      <StatusBadge status={wo.status} className="ml-1" />
                    </td>
                    <td className="py-2 text-slate-400">
                      {wo.part?.partNumber || "—"}
                    </td>
                    <td className="py-2 font-mono text-xs text-slate-400">
                      {wo.workCenter || "—"}
                    </td>
                    <td className="py-2 text-xs text-slate-400">
                      {formatDate(wo.plannedStart)} → {formatDate(wo.plannedEnd)}
                    </td>
                    <td className="py-2 text-xs">{formatDate(wo.dueDate)}</td>
                    <td className="py-2 tabular-nums text-slate-400">
                      {wo.estimatedMinutes != null
                        ? `${Math.round((wo.estimatedMinutes / 60) * 10) / 10}h`
                        : "—"}
                    </td>
                    <td className="py-2 text-xs">
                      {wo.scheduleRisk && wo.scheduleRisk !== "OK" ? (
                        <span className="text-amber-400">{wo.scheduleRisk}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <ActionLoadingForm
                        theme="planning"
                        action={actionRescheduleWorkOrder}
                        className="inline"
                      >
                        <input type="hidden" name="workOrderId" value={wo.id} />
                        <input
                          type="hidden"
                          name="mode"
                          value={wo.dueDate ? "BACK" : "FORWARD"}
                        />
                        <Button type="submit" size="sm" variant="outline">
                          Reschedule
                        </Button>
                      </ActionLoadingForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!scheduleWos.length && (
              <p className="py-8 text-center text-slate-500">No open work orders.</p>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "exceptions" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            Planner action queue — clear late risk and missing dates first.
          </p>
          {exceptionsPack.exceptions.map((e, i) => (
            <Link
              key={`${e.code}-${e.entityId}-${i}`}
              href={e.href}
              className={`block rounded-lg border px-4 py-3 ${
                e.severity === "critical"
                  ? "border-rose-500/30 bg-rose-500/5"
                  : "border-slate-800 bg-slate-950/40"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-teal-400">
                  {e.entityNumber}
                </span>
                <span
                  className={`text-xs font-semibold ${
                    e.severity === "critical" ? "text-rose-400" : "text-amber-400"
                  }`}
                >
                  {e.code}
                </span>
                <span className="text-sm text-slate-200">{e.title}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{e.detail}</p>
            </Link>
          ))}
          {!exceptionsPack.exceptions.length && (
            <p className="py-12 text-center text-slate-500">No exceptions.</p>
          )}
        </div>
      )}

      {tab === "settings" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4" />
              Working calendar
            </CardTitle>
            <p className="text-xs text-slate-500">
              How back/forward schedule walks days. Capacity available hours still
              use staffed hours − PTO; this only controls schedule advance rate.
            </p>
          </CardHeader>
          <CardContent>
            <ActionLoadingForm
              theme="planning"
              action={actionSavePlanningSettings}
              className="max-w-lg space-y-4"
            >
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Calendar mode
                </label>
                <select
                  name="calendarMode"
                  defaultValue={planningSettings.calendarMode}
                  className={`${selectClass} mt-1`}
                >
                  {(
                    [
                      ["FIXED_SHIFT", "Fixed shift hours / day"],
                      ["WORK_CENTER", "Work center capacityHoursPerDay"],
                      ["STAFFED", "Staffed hours at the station"],
                      ["CUSTOM_SHIFT", "Custom shift hours"],
                    ] as [CalendarMode, string][]
                  ).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Fixed shift hours
                  </label>
                  <Input
                    name="fixedShiftHours"
                    type="number"
                    step="0.5"
                    min={1}
                    defaultValue={planningSettings.fixedShiftHours}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Custom shift hours
                  </label>
                  <Input
                    name="customShiftHours"
                    type="number"
                    step="0.5"
                    min={1}
                    defaultValue={planningSettings.customShiftHours}
                    className="mt-1"
                  />
                </div>
              </div>
              <Button type="submit" size="sm">
                Save calendar settings
              </Button>
            </ActionLoadingForm>
          </CardContent>
        </Card>
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
