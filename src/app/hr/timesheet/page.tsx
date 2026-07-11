import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  getPayrollPolicy,
  getOrCreateTimesheet,
  listMyTimesheets,
  parseHolidays,
} from "@/lib/services/timesheets";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import {
  actionAddTimesheetEntry,
  actionRemoveTimesheetEntry,
  actionSubmitTimesheet,
} from "@/app/actions";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

const FREQ_LABEL: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  SEMIMONTHLY: "Semimonthly (1st–15th / 16th–EOM)",
};

export default async function MyTimesheetPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const policy = await getPayrollPolicy();
  const current = await getOrCreateTimesheet(user.id, new Date());
  const [sheet, history, workOrders, projects] = await Promise.all([
    prisma.timesheet.findUniqueOrThrow({
      where: { id: current.id },
      include: {
        entries: {
          orderBy: { date: "asc" },
          include: {
            workOrder: { select: { number: true } },
            project: { select: { number: true } },
          },
        },
      },
    }),
    listMyTimesheets(user.id),
    prisma.workOrder.findMany({
      where: { status: { in: ["RELEASED", "IN_PROGRESS", "KITTED"] } },
      select: { id: true, number: true, description: true },
      orderBy: { number: "asc" },
      take: 50,
    }),
    prisma.project.findMany({
      where: { status: { in: ["ACTIVE", "PLANNING"] } },
      select: { id: true, number: true, name: true },
      orderBy: { number: "asc" },
    }),
  ]);

  const editable = ["OPEN", "REJECTED"].includes(sheet.status);
  const totals = sheet.entries.reduce(
    (acc, e) => {
      acc.total += e.hours;
      acc.byType[e.type] = (acc.byType[e.type] || 0) + e.hours;
      return acc;
    },
    { total: 0, byType: {} as Record<string, number> }
  );
  const holidays = parseHolidays(policy);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Timesheet"
        description={`${FREQ_LABEL[policy.timesheetFrequency] || policy.timesheetFrequency} periods · ${formatDate(sheet.periodStart)} → ${formatDate(sheet.periodEnd)}`}
        actions={
          <Link href="/hr">
            <Button size="sm" variant="outline">
              My HR profile
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={sheet.status} />
        <span className="text-sm text-slate-400">
          {totals.total}h logged
          {Object.entries(totals.byType).length > 0 && (
            <span className="text-xs text-slate-500">
              {" "}
              ·{" "}
              {Object.entries(totals.byType)
                .map(([t, h]) => `${t.replace(/_/g, " ")} ${h}h`)
                .join(" · ")}
            </span>
          )}
        </span>
        {sheet.status === "REJECTED" && sheet.notes && (
          <span className="text-xs text-rose-400">
            Rejected: {sheet.notes}
          </span>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Period entries</CardTitle>
          <p className="text-xs text-slate-500">
            Scanning into a job files time here automatically. Add manual
            lines for overhead, sick, holiday, or PTO. Work time can&apos;t be
            future-dated; PTO/holiday can (within this period).
          </p>
        </CardHeader>
        <CardContent className="space-y-1">
          {sheet.entries.length === 0 && (
            <p className="py-3 text-sm text-slate-500">
              No entries yet this period.
            </p>
          )}
          {sheet.entries.map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 px-1 py-1.5 text-sm"
            >
              <span className="flex items-center gap-3">
                <span className="w-24 font-mono text-xs text-slate-500">
                  {formatDate(e.date)}
                </span>
                <StatusBadge status={e.type} className="text-[10px]" />
                <span className="text-slate-300">
                  {e.workOrder?.number ||
                    e.project?.number ||
                    e.description ||
                    "—"}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-teal-400">{e.hours}h</span>
                {editable && (
                  <form action={actionRemoveTimesheetEntry}>
                    <input type="hidden" name="entryId" value={e.id} />
                    <button
                      type="submit"
                      className="text-xs text-slate-600 hover:text-rose-400"
                      title="Remove entry"
                    >
                      ✕
                    </button>
                  </form>
                )}
              </span>
            </div>
          ))}

          {editable && (
            <form
              action={actionAddTimesheetEntry}
              className="mt-3 grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-3 lg:grid-cols-6"
            >
              <Input
                name="date"
                type="date"
                required
                min={sheet.periodStart.toISOString().slice(0, 10)}
                max={sheet.periodEnd.toISOString().slice(0, 10)}
              />
              <select name="type" className={selectClass} defaultValue="REGULAR">
                <option value="REGULAR">Regular (direct)</option>
                <option value="OVERHEAD">Overhead</option>
                <option value="OT">Overtime</option>
                <option value="SICK">Sick</option>
                <option value="HOLIDAY">Holiday</option>
                <option value="PTO">PTO</option>
              </select>
              <select name="workOrderId" className={selectClass} defaultValue="">
                <option value="">No work order</option>
                {workOrders.map((wo) => (
                  <option key={wo.id} value={wo.id}>
                    {wo.number}
                  </option>
                ))}
              </select>
              <select name="projectId" className={selectClass} defaultValue="">
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number}
                  </option>
                ))}
              </select>
              <Input
                name="hours"
                type="number"
                min={0.25}
                max={24}
                step={0.25}
                required
                placeholder="Hours"
              />
              <Button type="submit" size="sm">
                Add line
              </Button>
              <Input
                name="description"
                placeholder="Notes (e.g. shop cleanup, training)…"
                className="sm:col-span-3 lg:col-span-6"
              />
            </form>
          )}

          {editable && sheet.entries.length > 0 && (
            <form action={actionSubmitTimesheet} className="pt-3">
              <input type="hidden" name="id" value={sheet.id} />
              <Button type="submit" size="sm">
                Submit timesheet for approval
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Past timesheets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {history
              .filter((h) => h.id !== sheet.id)
              .map((h) => (
                <Link
                  key={h.id}
                  href={`/hr/timesheet/${h.id}`}
                  className="flex items-center justify-between border-b border-slate-800/60 px-1 py-1.5 text-sm hover:bg-slate-900/40"
                >
                  <span className="font-mono text-xs text-slate-400">
                    {formatDate(h.periodStart)} → {formatDate(h.periodEnd)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-slate-400">
                      {h.entries.reduce((s, e) => s + e.hours, 0)}h
                    </span>
                    <StatusBadge status={h.status} />
                  </span>
                </Link>
              ))}
            {history.length <= 1 && (
              <p className="py-2 text-sm text-slate-500">No prior periods.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Company policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm text-slate-400">
            <p>
              Pay period:{" "}
              <span className="text-slate-200">
                {FREQ_LABEL[policy.timesheetFrequency] || policy.timesheetFrequency}
              </span>
            </p>
            <p>
              PTO accrual:{" "}
              <span className="text-slate-200">
                {policy.ptoAccrualHoursPerPeriod}h / period
              </span>
            </p>
            <p>
              Sick time:{" "}
              <span className="text-slate-200">
                {policy.sickHoursPerYear}h / year
              </span>
            </p>
            {holidays.length > 0 && (
              <div className="pt-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Company holidays
                </p>
                {holidays.map((h) => (
                  <p key={h.date} className="text-xs">
                    <span className="font-mono text-slate-500">{h.date}</span>{" "}
                    {h.name}
                  </p>
                ))}
              </div>
            )}
            <p className="pt-1 text-[11px] text-slate-600">
              Set by Accounting under Accounting → Payroll.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
