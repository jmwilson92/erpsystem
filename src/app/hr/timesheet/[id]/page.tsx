import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { getTimesheetDetail } from "@/lib/services/timesheets";
import { canDecideFor } from "@/lib/services/hr";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import { actionDecideTimesheetApproval } from "@/app/actions";
import { ActivityTimeline } from "@/components/shared/activity-timeline";

export const dynamic = "force-dynamic";

export default async function TimesheetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me) return null;

  const sheet = await getTimesheetDetail(id);
  if (!sheet) notFound();

  const isOwner = sheet.userId === me.id;
  const canDecide = await canDecideFor(
    { id: me.id, role: me.role },
    sheet.userId,
    "hr.time.decide"
  );
  const canProcess = await userHasPermission(me.id, "accounting.journal.post");
  if (!isOwner && !canDecide && !canProcess) notFound();

  const total = sheet.entries.reduce((s, e) => s + e.hours, 0);
  const cost = sheet.entries.reduce((s, e) => s + e.hours * (e.laborRate || 65), 0);
  const byType = sheet.entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + e.hours;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Timesheet — ${sheet.user.name}`}
        description={`${formatDate(sheet.periodStart)} → ${formatDate(sheet.periodEnd)}${sheet.user.manager ? ` · Manager: ${sheet.user.manager.name}` : ""}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/print/timesheet/${sheet.id}`}>
              <Button size="sm" variant="outline">
                Print view
              </Button>
            </Link>
            <Link href={isOwner ? "/hr/timesheet" : "/approvals"}>
              <Button size="sm" variant="outline">
                Back
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={sheet.status} />
        <span className="text-sm text-slate-400">
          {total}h ·{" "}
          {Object.entries(byType)
            .map(([t, h]) => `${t.replace(/_/g, " ")} ${h}h`)
            .join(" · ")}
        </span>
        {canProcess && (
          <span className="text-xs tabular-nums text-slate-500">
            Labor value {formatCurrency(cost)}
          </span>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Entries</CardTitle>
        </CardHeader>
        <CardContent>
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
                  {e.workOrder ? (
                    <Link
                      href={`/work-orders/${e.workOrder.id}`}
                      className="text-teal-400 hover:underline"
                    >
                      {e.workOrder.number}
                    </Link>
                  ) : (
                    e.project?.number || e.description || "—"
                  )}
                  {e.workOrder && e.description ? (
                    <span className="text-xs text-slate-500">
                      {" "}
                      · {e.description}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="tabular-nums text-teal-400">{e.hours}h</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {sheet.approvals.length > 0 && sheet.status !== "OPEN" && (
        <Card className={sheet.status === "SUBMITTED" ? "border-amber-500/30" : undefined}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Approval routing</CardTitle>
            <p className="text-xs text-slate-500">
              Project/WBS charges route to the PM, direct charges to the
              department manager, HR time to HR. All buckets must approve.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {sheet.approvals.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 px-1 py-1.5 text-sm"
              >
                <span>
                  <span className="text-slate-200">{a.label}</span>{" "}
                  <span className="tabular-nums text-xs text-slate-500">
                    {a.hours}h
                  </span>
                  <span className="ml-2 text-xs text-slate-500">
                    → {a.approver?.name || "unassigned"}
                  </span>
                  {a.notes && (
                    <span className="ml-2 text-xs text-rose-400">
                      {a.notes}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1.5">
                  <StatusBadge status={a.status} />
                  {a.status === "PENDING" &&
                    sheet.status === "SUBMITTED" &&
                    (a.approverId === me.id || canDecide) && (
                      <>
                        <form action={actionDecideTimesheetApproval}>
                          <input type="hidden" name="approvalId" value={a.id} />
                          <input type="hidden" name="decision" value="APPROVED" />
                          <Button type="submit" size="sm" className="h-7">
                            Approve
                          </Button>
                        </form>
                        <form
                          action={actionDecideTimesheetApproval}
                          className="flex items-center gap-1"
                        >
                          <input type="hidden" name="approvalId" value={a.id} />
                          <input type="hidden" name="decision" value="REJECTED" />
                          <Input
                            name="notes"
                            placeholder="Reason…"
                            className="h-7 w-32 text-xs"
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            className="h-7"
                          >
                            Reject
                          </Button>
                        </form>
                      </>
                    )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {canProcess && sheet.status === "APPROVED" && (
        <Card className="border-emerald-500/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
            <p className="text-sm text-slate-400">
              Approved and ready for payroll
              <span className="ml-2 tabular-nums text-slate-300">
                {formatCurrency(cost)}
              </span>
              . Payroll is processed as a run in the Payroll module — not from
              here.
            </p>
            <Link href="/accounting?tab=payroll">
              <Button size="sm">Go to Payroll →</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {sheet.status === "PROCESSED" && (
        <p className="text-xs text-slate-500">
          Processed {sheet.processedAt ? formatDate(sheet.processedAt) : ""}
          {sheet.journalEntryId ? " · payroll accrual JE posted" : ""} — see
          Accounting → Journals.
        </p>
      )}

      <ActivityTimeline entityType="Timesheet" entityId={id} />
    </div>
  );
}
