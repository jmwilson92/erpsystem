import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getPendingApprovals } from "@/lib/services/hr";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  actionDecidePto,
  actionDecideTimeEntry,
  actionAdvanceExpense,
} from "@/app/actions";
import { CalendarCheck, Clock, Receipt, ShoppingCart } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [{ persona, ptoRequests, timeEntries, expenses }, openPrs] =
    await Promise.all([
      getPendingApprovals(user),
      prisma.purchaseRequest.count({ where: { status: "SUBMITTED" } }),
    ]);

  const scopeLabel = persona.isHrAdmin
    ? "all employees (HR administration)"
    : persona.isManager
      ? "your direct reports"
      : "your direct reports — none assigned to you";

  const empty =
    ptoRequests.length === 0 && timeEntries.length === 0 && expenses.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Approvals"
        description={`Pending decisions for ${scopeLabel}`}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CalendarCheck className="h-5 w-5 text-amber-400" />
            <div>
              <p className="text-xl font-bold tabular-nums">{ptoRequests.length}</p>
              <p className="text-xs text-slate-500">PTO requests</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-5 w-5 text-sky-400" />
            <div>
              <p className="text-xl font-bold tabular-nums">{timeEntries.length}</p>
              <p className="text-xs text-slate-500">Timesheet entries</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Receipt className="h-5 w-5 text-emerald-400" />
            <div>
              <p className="text-xl font-bold tabular-nums">{expenses.length}</p>
              <p className="text-xs text-slate-500">Expense reports</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ShoppingCart className="h-5 w-5 text-violet-400" />
            <div>
              <p className="text-xl font-bold tabular-nums">{openPrs}</p>
              <p className="text-xs text-slate-500">
                <Link href="/purchasing?tab=pr" className="hover:text-teal-400">
                  Purchase requests →
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {empty && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-500">
            Nothing waiting on you. 🎉
          </CardContent>
        </Card>
      )}

      {ptoRequests.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Time-off requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ptoRequests.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-4 py-2.5"
              >
                <div>
                  <p className="text-sm text-slate-200">{p.user.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.type} · {formatDate(p.startDate)} → {formatDate(p.endDate)}{" "}
                    · {p.hours}h{p.reason ? ` · ${p.reason}` : ""}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <form action={actionDecidePto}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="decision" value="APPROVED" />
                    <Button type="submit" size="sm">
                      Approve
                    </Button>
                  </form>
                  <form action={actionDecidePto}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="decision" value="REJECTED" />
                    <Button type="submit" size="sm" variant="outline">
                      Reject
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {timeEntries.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Timesheets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {timeEntries.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-4 py-2.5"
              >
                <div>
                  <p className="text-sm text-slate-200">
                    {t.user.name}{" "}
                    <span className="tabular-nums text-teal-400">{t.hours}h</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(t.date)} ·{" "}
                    {t.workOrder?.number || t.project?.number || t.description || t.type}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <form action={actionDecideTimeEntry}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="decision" value="APPROVED" />
                    <Button type="submit" size="sm">
                      Approve
                    </Button>
                  </form>
                  <form action={actionDecideTimeEntry}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="decision" value="REJECTED" />
                    <Button type="submit" size="sm" variant="outline">
                      Reject
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {expenses.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Expense reports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {expenses.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-4 py-2.5"
              >
                <div>
                  <p className="text-sm text-slate-200">
                    <span className="font-mono text-sky-400">{e.number}</span>{" "}
                    {e.title}
                  </p>
                  <p className="text-xs text-slate-500">
                    {e.user.name} · {e.lines.length} line
                    {e.lines.length === 1 ? "" : "s"} ·{" "}
                    {formatCurrency(e.totalAmount)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={e.status} />
                  {e.status === "SUBMITTED" && (
                    <>
                      <form action={actionAdvanceExpense}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="status" value="APPROVED" />
                        <Button type="submit" size="sm">
                          Approve
                        </Button>
                      </form>
                      <form action={actionAdvanceExpense}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="status" value="REJECTED" />
                        <Button type="submit" size="sm" variant="outline">
                          Reject
                        </Button>
                      </form>
                    </>
                  )}
                  {e.status === "APPROVED" && (
                    <form action={actionAdvanceExpense}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="status" value="PAID" />
                      <Button type="submit" size="sm" variant="amber">
                        Mark paid
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
