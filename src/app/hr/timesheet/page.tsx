import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  getPayrollPolicy,
  getOrCreateTimesheet,
  listMyTimesheets,
  parseHolidays,
  periodDays,
  classifyHours,
} from "@/lib/services/timesheets";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TimecardGrid } from "@/components/hr/timecard-grid";
import { formatDate } from "@/lib/utils";
import { actionSubmitTimesheet } from "@/app/actions";

export const dynamic = "force-dynamic";

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
  const [sheet, history, workOrders, projects, wbsElements, engTasks, chargeCodeAccounts] =
    await Promise.all([
      prisma.timesheet.findUniqueOrThrow({
        where: { id: current.id },
        include: {
          entries: { orderBy: { date: "asc" } },
          approvals: { include: { approver: { select: { name: true } } } },
        },
      }),
      listMyTimesheets(user.id),
      prisma.workOrder.findMany({
        where: {
          status: {
            in: ["PLANNED", "RELEASED", "IN_PROGRESS", "KITTED", "READY_TO_KIT"],
          },
        },
        select: { id: true, number: true, department: true },
        orderBy: { number: "asc" },
        take: 60,
      }),
      prisma.project.findMany({
        where: { status: { in: ["ACTIVE", "PLANNING"] } },
        select: { id: true, number: true, name: true },
        orderBy: { number: "asc" },
      }),
      prisma.wbsElement.findMany({
        where: { project: { status: { in: ["ACTIVE", "PLANNING"] } } },
        select: { id: true, code: true, name: true, projectId: true },
        orderBy: { code: "asc" },
      }),
      // Engineering tasks you can charge to when there's no work order
      prisma.engTask.findMany({
        where: {
          status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED"] },
        },
        select: { id: true, number: true, name: true },
        orderBy: { number: "asc" },
        take: 100,
      }),
      // Named charge codes from GL (indirect + direct)
      prisma.account.findMany({
        where: {
          isActive: true,
          chargeCode: { not: null },
          chargeCodeType: { in: ["INDIRECT", "DIRECT"] },
        },
        select: { chargeCode: true, name: true, chargeCodeType: true },
        orderBy: { chargeCode: "asc" },
      }),
    ]);

  const { getEnactedChargeCodes } = await import("@/lib/services/budgets");
  const budgetCodes = await getEnactedChargeCodes();
  const fromAccounts = chargeCodeAccounts
    .filter((a): a is { chargeCode: string; name: string; chargeCodeType: string | null } => !!a.chargeCode)
    .map((a) => ({
      code: a.chargeCode,
      name: a.name + (a.chargeCodeType ? ` [${a.chargeCodeType}]` : ""),
    }));
  // Prefer budget codes; merge unique
  const seen = new Set<string>();
  const chargeCodes: { code: string; name: string }[] = [];
  for (const c of [...budgetCodes.map((b) => ({ code: b.code, name: b.name })), ...fromAccounts]) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    chargeCodes.push(c);
  }

  const editable = ["OPEN", "REJECTED"].includes(sheet.status);
  const days = periodDays(sheet.periodStart, sheet.periodEnd).map((d) =>
    d.toISOString().slice(0, 10)
  );
  const cls = classifyHours(policy, sheet.entries);
  const total = sheet.entries.reduce((s, e) => s + e.hours, 0);
  const holidays = parseHolidays(policy);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Timecard"
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
          {total}h ·{" "}
          <span className="tabular-nums">
            {cls.regular} reg
            {cls.overtime > 0 && (
              <span className="text-amber-400"> · {cls.overtime} OT</span>
            )}
            {cls.doubletime > 0 && (
              <span className="text-rose-400"> · {cls.doubletime} DT</span>
            )}
            {cls.nonWorked > 0 && ` · ${cls.nonWorked} PTO/hol/sick`}
          </span>
        </span>
        {sheet.status === "REJECTED" && sheet.notes && (
          <span className="text-xs text-rose-400">Rejected: {sheet.notes}</span>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Timecard</CardTitle>
          <p className="text-xs text-slate-500">
            One row per charge code — work order (direct), project / WBS,
            engineering task (when there&apos;s no work order), an overhead
            charge code like OH, or PTO / sick / holiday. Job scans add time
            here automatically; approved PTO and company holidays pre-fill.
          </p>
        </CardHeader>
        <CardContent>
          <TimecardGrid
            sheetId={sheet.id}
            days={days}
            editable={editable}
            entries={sheet.entries.map((e) => ({
              id: e.id,
              date: e.date.toISOString().slice(0, 10),
              hours: e.hours,
              type: e.type,
              workOrderId: e.workOrderId,
              projectId: e.projectId,
              wbsElementId: e.wbsElementId,
              engTaskId: e.engTaskId,
              chargeCode: e.chargeCode,
            }))}
            options={{ workOrders, projects, wbsElements, engTasks, chargeCodes }}
            policy={{
              maxHoursPerDay: policy.maxHoursPerDay,
              otAfterDailyHours: policy.otAfterDailyHours,
              dtAfterDailyHours: policy.dtAfterDailyHours,
            }}
          />
          {editable && sheet.entries.length > 0 && (
            (() => {
              const periodEnded =
                new Date().toISOString().slice(0, 10) >=
                sheet.periodEnd.toISOString().slice(0, 10);
              if (!periodEnded) {
                return (
                  <p className="pt-3 text-[11px] text-slate-500">
                    Keep entering time — this timecard can be submitted for
                    approval once the pay period ends on{" "}
                    <span className="text-slate-300">
                      {formatDate(sheet.periodEnd)}
                    </span>
                    .
                  </p>
                );
              }
              return (
                <form action={actionSubmitTimesheet} className="pt-3">
                  <input type="hidden" name="id" value={sheet.id} />
                  <Button type="submit" size="sm">
                    Submit timecard for approval
                  </Button>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Submitting routes each charge type to its approver: project
                    time → the PM, direct charges → the department manager,
                    PTO/sick/holiday/overhead → HR.
                  </p>
                </form>
              );
            })()
          )}
          {sheet.approvals.length > 0 && sheet.status !== "OPEN" && (
            <div className="mt-4 border-t border-slate-800 pt-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Approval routing
              </p>
              {sheet.approvals.map((a) => (
                <p
                  key={a.id}
                  className="flex items-center justify-between py-0.5 text-xs text-slate-400"
                >
                  <span>
                    {a.label} · {a.hours}h → {a.approver?.name || "unassigned"}
                    {a.notes ? (
                      <span className="text-rose-400"> — {a.notes}</span>
                    ) : null}
                  </span>
                  <StatusBadge status={a.status} className="text-[9px]" />
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Past timecards</CardTitle>
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
            <CardTitle className="text-base">Company time policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm text-slate-400">
            <p>
              Pay period:{" "}
              <span className="text-slate-200">
                {FREQ_LABEL[policy.timesheetFrequency] || policy.timesheetFrequency}
              </span>
            </p>
            <p>
              Overtime after{" "}
              <span className="text-slate-200">{policy.otAfterDailyHours}h/day</span>{" "}
              or{" "}
              <span className="text-slate-200">
                {policy.otAfterWeeklyHours}h/week
              </span>{" "}
              ({policy.otMultiplier}×) · double time after{" "}
              <span className="text-slate-200">{policy.dtAfterDailyHours}h/day</span>{" "}
              ({policy.dtMultiplier}×) · hard cap{" "}
              <span className="text-slate-200">{policy.maxHoursPerDay}h/day</span>
            </p>
            <p>
              PTO accrual:{" "}
              <span className="text-slate-200">
                {policy.ptoAccrualHoursPerPeriod}h / period
              </span>{" "}
              · sick:{" "}
              <span className="text-slate-200">{policy.sickHoursPerYear}h / year</span>
            </p>
            {holidays.length > 0 && (
              <div className="pt-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Company holidays
                </p>
                {holidays.map((h, i) => (
                  <p key={`${h.date}-${i}`} className="text-xs">
                    <span className="font-mono text-slate-500">{h.date}</span>{" "}
                    {h.name}
                  </p>
                ))}
              </div>
            )}
            <p className="pt-1 text-[11px] text-slate-600">
              Configured by Accounting / HR under Accounting → Payroll.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
