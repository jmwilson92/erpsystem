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
import {
  actionDecideTimesheet,
  actionProcessTimesheet,
} from "@/app/actions";

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
          <Link href={isOwner ? "/hr/timesheet" : "/approvals"}>
            <Button size="sm" variant="outline">
              Back
            </Button>
          </Link>
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

      {canDecide && sheet.status === "SUBMITTED" && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Manager decision</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <form action={actionDecideTimesheet}>
              <input type="hidden" name="id" value={sheet.id} />
              <input type="hidden" name="decision" value="APPROVED" />
              <Button type="submit" size="sm">
                Approve timesheet
              </Button>
            </form>
            <form
              action={actionDecideTimesheet}
              className="flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="id" value={sheet.id} />
              <input type="hidden" name="decision" value="REJECTED" />
              <Input
                name="notes"
                placeholder="Rejection reason…"
                className="max-w-xs"
              />
              <Button type="submit" size="sm" variant="outline">
                Reject
              </Button>
            </form>
            <p className="w-full text-[11px] text-slate-500">
              Approval posts labor cost to work orders / projects and queues
              the sheet for payroll processing in Accounting.
            </p>
          </CardContent>
        </Card>
      )}

      {canProcess && sheet.status === "APPROVED" && (
        <Card className="border-emerald-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payroll processing</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={actionProcessTimesheet}>
              <input type="hidden" name="id" value={sheet.id} />
              <Button type="submit" size="sm">
                Process for payroll ({formatCurrency(cost)})
              </Button>
            </form>
            <p className="mt-2 text-[11px] text-slate-500">
              Posts a payroll accrual journal entry (Dr Salaries &amp; Wages /
              Cr Accrued Expenses) and marks the sheet processed.
            </p>
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
    </div>
  );
}
