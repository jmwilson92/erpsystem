import Link from "next/link";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { getPayrollRun } from "@/lib/services/timesheets";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { actionProcessTimesheet, actionRunPayroll } from "@/app/actions";
import { Wallet, Users2, CheckCircle2, Landmark } from "lucide-react";

/** Payroll run center — rendered as a tab inside Accounting. */
export async function PayrollTab() {
  const user = await getCurrentUser();
  if (!user) return null;
  const canRun = await userHasPermission(user.id, "accounting.journal.post");

  const { ready, recent, totalReadyGross } = await getPayrollRun();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Timecards ready"
          value={ready.length}
          subtitle="Approved, awaiting payroll"
          icon={Users2}
          accent="sky"
        />
        <StatCard
          title="Gross this run"
          value={formatCurrency(totalReadyGross)}
          subtitle="Blended OT included"
          icon={Wallet}
          accent="teal"
        />
        <StatCard
          title="Processed (recent)"
          value={recent.length}
          subtitle="Last 25 runs"
          icon={CheckCircle2}
          accent="emerald"
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-base">Ready to run</CardTitle>
            <p className="text-xs text-slate-500">
              Each row posts Dr Salaries &amp; Wages (6000) / Cr Accrued Payroll
              (2100). Payroll is only processed here.
            </p>
          </div>
          {canRun && ready.length > 0 && (
            <form action={actionRunPayroll}>
              <Button type="submit" size="sm">
                Run payroll — all {ready.length} ({formatCurrency(totalReadyGross)})
              </Button>
            </form>
          )}
        </CardHeader>
        <CardContent>
          {ready.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No approved timecards waiting. Payroll is caught up. 🎉
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-800">
              <div className="grid grid-cols-12 gap-2 border-b border-slate-800 bg-slate-900/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <div className="col-span-3">Employee</div>
                <div className="col-span-3">Period</div>
                <div className="col-span-2 text-right">Hours</div>
                <div className="col-span-2 text-right">Gross pay</div>
                <div className="col-span-2 text-right">Run</div>
              </div>
              {ready.map((r) => (
                <div
                  key={r.id}
                  className="grid grid-cols-12 items-center gap-2 border-b border-slate-800/60 px-4 py-2.5 text-sm last:border-0 hover:bg-slate-900/40"
                >
                  <div className="col-span-3 min-w-0">
                    <Link
                      href={`/hr/timesheet/${r.id}`}
                      className="truncate text-slate-200 hover:text-teal-300"
                    >
                      {r.employee}
                    </Link>
                    <p className="truncate text-[11px] text-slate-600">
                      {r.department || "—"}
                    </p>
                  </div>
                  <div className="col-span-3 text-xs text-slate-400">
                    {formatDate(r.periodStart)} → {formatDate(r.periodEnd)}
                  </div>
                  <div className="col-span-2 text-right tabular-nums text-slate-300">
                    {r.hours}h
                  </div>
                  <div className="col-span-2 text-right tabular-nums text-teal-400">
                    {formatCurrency(r.grossPay)}
                  </div>
                  <div className="col-span-2 flex justify-end">
                    {canRun && (
                      <form action={actionProcessTimesheet}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" size="sm" variant="outline">
                          Process
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent payroll runs</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No payroll processed yet.
            </p>
          ) : (
            <div className="space-y-1">
              {recent.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between border-b border-slate-900 py-1.5 text-sm"
                >
                  <Link
                    href={`/hr/timesheet/${r.id}`}
                    className="text-slate-300 hover:text-teal-300"
                  >
                    {r.employee}
                    <span className="ml-2 text-xs text-slate-500">
                      {formatDate(r.periodStart)} → {formatDate(r.periodEnd)}
                    </span>
                  </Link>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {r.processedAt ? formatDate(r.processedAt) : ""}
                    {r.journalEntryId && (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Landmark className="h-3 w-3" /> JE posted
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
