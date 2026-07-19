import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { getPayrollRun, FICA_RATE } from "@/lib/services/timesheets";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  actionProcessTimesheet,
  actionRunPayroll,
  actionSaveWithholding,
} from "@/app/actions";
import { Wallet, Users2, CheckCircle2, Landmark, FileText } from "lucide-react";

/** Payroll run center — rendered as a tab inside Accounting. */
export async function PayrollTab() {
  const user = await getCurrentUser();
  if (!user) return null;
  const canRun = await userHasPermission(user.id, "accounting.journal.post");

  const [{ ready, recent, totalReadyGross, totalReadyNet }, employees] =
    await Promise.all([
      getPayrollRun(),
      prisma.user.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          department: true,
          fedWithholdingPct: true,
          stateWithholdingPct: true,
        },
      }),
    ]);

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
          subtitle={`Net after withholding ≈ ${formatCurrency(totalReadyNet)}`}
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
              Each run posts the full payroll journal: gross wages + employer
              FICA match against federal/state withholding, FICA payable, and
              net Wages Payable. Payroll is only processed here.
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
                <div className="col-span-1 text-right">Hours</div>
                <div className="col-span-2 text-right">Gross</div>
                <div className="col-span-2 text-right">Est. net</div>
                <div className="col-span-1 text-right">Run</div>
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
                  <div className="col-span-1 text-right tabular-nums text-slate-300">
                    {r.hours}h
                  </div>
                  <div className="col-span-2 text-right tabular-nums text-teal-400">
                    {formatCurrency(r.grossPay)}
                  </div>
                  <div className="col-span-2 text-right tabular-nums text-slate-300">
                    {formatCurrency(r.netPay)}
                  </div>
                  <div className="col-span-1 flex justify-end">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent payroll runs</CardTitle>
            <p className="text-xs text-slate-500">
              Open a run for its printable pay stub.
            </p>
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
                      {r.netPay != null && (
                        <span className="tabular-nums text-slate-300">
                          net {formatCurrency(r.netPay)}
                        </span>
                      )}
                      {r.journalEntryId && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Landmark className="h-3 w-3" /> JE
                        </span>
                      )}
                      <Link
                        href={`/accounting/paystub/${r.id}`}
                        className="flex items-center gap-1 text-sky-400 hover:underline"
                      >
                        <FileText className="h-3 w-3" /> Stub
                      </Link>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Withholding profiles</CardTitle>
            <p className="text-xs text-slate-500">
              Simple flat percentages per employee. FICA is fixed at{" "}
              {(FICA_RATE * 100).toFixed(2)}% (withheld) with an equal employer
              match. Rates apply to future runs only.
            </p>
          </CardHeader>
          <CardContent className="max-h-96 space-y-1 overflow-y-auto">
            {employees.map((e) => (
              <form
                key={e.id}
                action={actionSaveWithholding}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-900 py-1.5 text-sm"
              >
                <input type="hidden" name="userId" value={e.id} />
                <span className="min-w-0 flex-1 truncate text-slate-300">
                  {e.name}
                  <span className="ml-2 text-[11px] text-slate-600">
                    {e.department || ""}
                  </span>
                </span>
                <label className="flex items-center gap-1 text-[11px] text-slate-500">
                  Fed %
                  <Input
                    name="fedPct"
                    type="number"
                    min="0"
                    max="60"
                    step="0.1"
                    defaultValue={((e.fedWithholdingPct ?? 0.12) * 100).toFixed(1)}
                    className="h-7 w-16 text-xs"
                  />
                </label>
                <label className="flex items-center gap-1 text-[11px] text-slate-500">
                  State %
                  <Input
                    name="statePct"
                    type="number"
                    min="0"
                    max="30"
                    step="0.1"
                    defaultValue={((e.stateWithholdingPct ?? 0.04) * 100).toFixed(1)}
                    className="h-7 w-16 text-xs"
                  />
                </label>
                {canRun && (
                  <Button type="submit" size="sm" variant="outline" className="h-7 text-[10px]">
                    Save
                  </Button>
                )}
              </form>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
