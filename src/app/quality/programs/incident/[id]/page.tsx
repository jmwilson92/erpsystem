import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChecklistEditor } from "@/components/quality/checklist-editor";
import { actionUpdateIncidentSteps, actionSetIncidentResult } from "@/app/actions";
import { parseJson } from "@/lib/services/tool-control";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await prisma.qualityEvent.findUnique({
    where: { id },
    include: {
      program: { select: { key: true, name: true } },
      performedBy: { select: { name: true } },
    },
  });
  if (!event) notFound();

  const user = await getCurrentUser();
  const canManage = await userHasPermission(user?.id, "quality.programs.manage");

  const source = event.sourceMrbId
    ? await prisma.mrbCase.findUnique({ where: { id: event.sourceMrbId }, include: { ncr: { select: { number: true } } } })
    : null;

  const steps = parseJson<{ step: string; done: boolean }[]>(event.steps, []).map((s) => ({
    label: s.step,
    checked: s.done,
  }));
  const closed = event.result === "CLOSED";
  const allDone = steps.length > 0 && steps.every((s) => s.checked);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${event.program.name} incident`}
        description={event.notes || undefined}
        actions={
          <Link href={`/quality/programs/${event.program.key}`}>
            <Button size="sm" variant="outline">← {event.program.name}</Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatusBadge status="INCIDENT" />
        <StatusBadge status={event.result || "OPEN"} />
        <span className="text-slate-500">Opened {formatDate(event.performedAt)}</span>
        {event.performedBy?.name && <span className="text-slate-500">· by {event.performedBy.name}</span>}
        {source && (
          <Link href="/mrb" className="text-teal-400 hover:underline">
            From MRB {source.number} (NCR {source.ncr.number}) →
          </Link>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Disposition process</CardTitle>
          <p className="text-xs text-slate-500">
            Customize the steps for this incident and check them off. Close it once corrective
            action is verified.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <ChecklistEditor
            action={actionUpdateIncidentSteps}
            hiddenFields={{ eventId: event.id }}
            fieldName="steps"
            labelKey="step"
            checkedKey="done"
            initial={steps}
            addPlaceholder="Add a disposition step…"
            checkedLabel="done"
            submitLabel="Save steps"
            readOnly={!canManage || closed}
          />
          {canManage && (
            <form action={actionSetIncidentResult} className="flex items-center gap-2 border-t border-slate-800 pt-3">
              <input type="hidden" name="eventId" value={event.id} />
              {closed ? (
                <>
                  <input type="hidden" name="result" value="OPEN" />
                  <Button type="submit" size="sm" variant="outline">Reopen incident</Button>
                </>
              ) : (
                <>
                  <input type="hidden" name="result" value="CLOSED" />
                  <Button type="submit" size="sm" disabled={!allDone} title={allDone ? undefined : "Complete all steps first"}>
                    Close incident
                  </Button>
                  {!allDone && <span className="text-xs text-slate-500">Complete all steps to close.</span>}
                </>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
