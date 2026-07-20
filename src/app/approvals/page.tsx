import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getPendingApprovals } from "@/lib/services/hr";
import { getTimecardReviewQueue } from "@/lib/services/timesheets";
import { listPrApprovalsForUser } from "@/lib/services/pr-approval";
import { listPoAmendmentsForUser } from "@/lib/services/po-amend";
import { TimecardReviewQueue } from "@/components/hr/timecard-review-queue";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import { actionDecidePto, actionAdvanceExpense } from "@/app/actions";
import { CalendarCheck, Clock, Receipt, ShoppingCart } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [{ persona, ptoRequests, timesheetApprovals, expenses }, prsWaiting, timecardQueue] =
    await Promise.all([
      getPendingApprovals(user),
      listPrApprovalsForUser({ userId: user.id, userRole: user.role }),
      getTimecardReviewQueue(user),
    ]);
  const poAmendments = await listPoAmendmentsForUser({
    userId: user.id,
    userRole: user.role,
  });
  const openPrs = prsWaiting.length + poAmendments.length;

  // Serialize dates for the client queue component.
  const queueForClient = timecardQueue.map((i) => ({
    ...i,
    periodStart: i.periodStart.toISOString(),
    periodEnd: i.periodEnd.toISOString(),
  }));

  const scopeLabel = persona.isHrAdmin
    ? "all employees (HR administration)"
    : persona.isManager
      ? "your direct reports"
      : "your direct reports — none assigned to you";

  const empty =
    ptoRequests.length === 0 &&
    queueForClient.length === 0 &&
    expenses.length === 0 &&
    prsWaiting.length === 0 &&
    poAmendments.length === 0;

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
              <p className="text-xl font-bold tabular-nums">
                {queueForClient.length}
              </p>
              <p className="text-xs text-slate-500">Timecards to review</p>
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
                <Link href="/purchasing?tab=prs" className="hover:text-teal-400">
                  Purchase requests →
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {prsWaiting.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Purchase requests waiting on your decision</CardTitle>
            <p className="text-xs text-slate-500">
              Open the PR to review the package and approve or reject there —
              decisions are made on the request itself, never from this queue.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {prsWaiting.map((pr) => (
              <Link
                key={pr.id}
                href={`/purchasing/pr/${pr.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 hover:border-teal-800"
              >
                <span>
                  <span className="font-mono text-xs text-teal-400">
                    {pr.number}
                  </span>
                  <span className="ml-2 text-xs text-slate-400">
                    {pr.justification || "Purchase request"}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-xs text-slate-500">
                  {pr.supplier && <span>{pr.supplier}</span>}
                  <span className="tabular-nums">
                    {formatCurrency(pr.totalEstimate)}
                  </span>
                  <span className="max-w-[220px] truncate text-[10px]">
                    {pr.stage}
                  </span>
                  <span className="text-teal-500">Review →</span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {poAmendments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>PO amendments waiting on your sign-off</CardTitle>
            <p className="text-xs text-slate-500">
              A purchase order was edited after approval — review the change on
              the PO and approve or reject it there.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {poAmendments.map((po) => (
              <Link
                key={po.id}
                href={`/purchasing/po/${po.id}`}
                className="flex items-center justify-between rounded-lg border border-amber-900/40 bg-amber-950/10 px-3 py-2 hover:border-amber-600"
              >
                <span>
                  <span className="font-mono text-xs text-amber-300">
                    {po.number}
                  </span>
                  <span className="ml-2 text-xs text-slate-400">
                    {po.supplier}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="tabular-nums">
                    {formatCurrency(po.totalAmount)}
                  </span>
                  <span className="max-w-[220px] truncate text-[10px]">
                    {po.stage}
                  </span>
                  <span className="text-amber-400">Review →</span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

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
              <details
                key={p.id}
                className="rounded-lg border border-slate-800 px-4 py-2.5"
              >
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
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
                  <form action={actionDecidePto} className="flex gap-1">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="decision" value="REJECTED" />
                    <Input
                      name="decisionNotes"
                      required
                      placeholder="Reason (required)"
                      className="h-8 w-40 text-xs"
                    />
                    <Button type="submit" size="sm" variant="outline">
                      Reject
                    </Button>
                  </form>
                </div>
                </summary>
                <div className="mt-2 grid gap-1 border-t border-slate-800/60 pt-2 text-xs text-slate-400 sm:grid-cols-2">
                  <p>
                    Employee:{" "}
                    <span className="text-slate-300">
                      {p.user.name} · {p.user.title || p.user.role}
                    </span>
                  </p>
                  <p>
                    Department:{" "}
                    <span className="text-slate-300">
                      {p.user.department || "—"}
                    </span>
                  </p>
                  <p>
                    Type / hours:{" "}
                    <span className="text-slate-300">
                      {p.type} · {p.hours}h
                    </span>
                  </p>
                  <p>
                    Requested: <span className="text-slate-300">{formatDate(p.createdAt)}</span>
                  </p>
                  <p className="sm:col-span-2">
                    Reason:{" "}
                    <span className="text-slate-300">{p.reason || "—"}</span>
                  </p>
                  <p className="sm:col-span-2">
                    Approving files the time onto their timesheet for the
                    period(s) it covers.
                  </p>
                </div>
              </details>
            ))}
          </CardContent>
        </Card>
      )}

      {queueForClient.length > 0 && (
        <div className="space-y-2">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Timecards to review
            </h2>
            <p className="text-xs text-slate-500">
              One row per direct report&apos;s submitted timecard. Click a name
              to open the full sheet. Approve or reject right here — rejection
              needs a reason. Clear the whole queue for a little surprise.
            </p>
          </div>
          <TimecardReviewQueue items={queueForClient} />
        </div>
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
                <details className="min-w-0 flex-1">
                  <summary className="cursor-pointer [&::-webkit-details-marker]:hidden">
                    <p className="text-sm text-slate-200">
                      <span className="font-mono text-sky-400">{e.number}</span>{" "}
                      {e.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {e.user.name} · {e.lines.length} line
                      {e.lines.length === 1 ? "" : "s"} ·{" "}
                      {formatCurrency(e.totalAmount)} · click for detail
                    </p>
                  </summary>
                  <div className="mt-2 space-y-1 border-t border-slate-800/60 pt-2">
                    {e.lines.map((l) => (
                      <p
                        key={l.id}
                        className="flex justify-between text-xs text-slate-400"
                      >
                        <span>
                          <span className="font-mono text-slate-500">
                            {formatDate(l.date)}
                          </span>{" "}
                          {l.category} · {l.description}
                          {l.receiptUrl ? " · receipt attached" : ""}
                        </span>
                        <span className="tabular-nums">
                          {formatCurrency(l.amount)}
                        </span>
                      </p>
                    ))}
                  </div>
                </details>
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
                      <form action={actionAdvanceExpense} className="flex gap-1">
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="status" value="REJECTED" />
                        <Input
                          name="decisionNotes"
                          required
                          placeholder="Reason (required)"
                          className="h-8 w-36 text-xs"
                        />
                        <Button type="submit" size="sm" variant="outline">
                          Reject
                        </Button>
                      </form>
                    </>
                  )}
                  {e.status === "APPROVED" && (
                    <span className="text-[11px] text-slate-500">
                      Approved — accounting records payment
                    </span>
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
