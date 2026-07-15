import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getTestProcedureDetail } from "@/lib/services/test-procedures";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import {
  actionAddTestProcedureStep,
  actionReleaseTestProcedure,
  actionSubmitTestProcedureToCm,
} from "@/app/actions";
import { TestStepRecord } from "@/components/test-procedures/test-step-record";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-sm text-slate-200">{value || "—"}</p>
    </div>
  );
}

export default async function TestProcedureDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const tp = await getTestProcedureDetail(id);
  if (!tp) notFound();

  const released = tp.status === "RELEASED";
  const byStep = new Map<string, typeof tp.signOffs>();
  for (const s of tp.signOffs) {
    if (!s.stepId) continue;
    const list = byStep.get(s.stepId) || [];
    list.push(s);
    byStep.set(s.stepId, list);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${tp.number} Rev ${tp.revision}`}
        description={tp.title}
        actions={
          <div className="flex gap-2">
            <Link href="/test-procedures">
              <Button size="sm" variant="outline">
                All procedures
              </Button>
            </Link>
            {tp.status !== "RELEASED" && tp.status !== "CM_REVIEW" && (
              <form action={actionSubmitTestProcedureToCm}>
                <input type="hidden" name="testProcedureId" value={tp.id} />
                <Button type="submit" size="sm">
                  Submit to CM
                </Button>
              </form>
            )}
            {tp.status === "CM_REVIEW" && (
              <>
                <Link href="/cm">
                  <Button size="sm" variant="secondary">
                    Open CM board
                  </Button>
                </Link>
                <form action={actionReleaseTestProcedure}>
                  <input type="hidden" name="testProcedureId" value={tp.id} />
                  <Button type="submit" size="sm">
                    Release (CM)
                  </Button>
                </form>
              </>
            )}
          </div>
        }
      />

      {/* Controlled-document header */}
      <div className="overflow-hidden rounded-2xl border border-teal-800/50 bg-slate-950/60">
        <div className="flex items-center justify-between border-b border-teal-800/40 bg-teal-500/5 px-5 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-300">
            CM-Controlled Test Procedure
          </span>
          <span className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
            {tp.category.replace(/_/g, " ")}
            <StatusBadge status={tp.status} />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 p-5 sm:grid-cols-4">
          <Field label="Document" value={tp.number} />
          <Field label="Revision" value={tp.revision} />
          <Field label="Part" value={tp.part?.partNumber} />
          <Field label="Prepared by" value={tp.createdBy?.name} />
          <Field label="Equipment" value={tp.equipment} />
          <Field label="Released" value={tp.releasedAt ? formatDate(tp.releasedAt) : "—"} />
          <div className="sm:col-span-2">
            <Field label="Purpose" value={tp.purpose} />
          </div>
          {tp.acceptanceCriteria && (
            <div className="sm:col-span-4">
              <Field label="Acceptance criteria" value={tp.acceptanceCriteria} />
            </div>
          )}
        </div>
      </div>

      {released && (
        <p className="text-xs text-slate-500">
          Released &amp; locked. Follow the steps below, record measurements, and
          PIN-verify each result. PASS/FAIL grades automatically against the
          min/max spec.
        </p>
      )}

      {/* Steps */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Steps ({tp.steps.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tp.steps.map((step) => {
            const results = byStep.get(step.id) || [];
            const hasSpec = step.minValue != null || step.maxValue != null;
            return (
              <div
                key={step.id}
                className="rounded-xl border border-slate-800 bg-slate-900/40 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 font-mono text-xs text-teal-400">
                    {step.stepNumber}
                  </span>
                  <span className="font-medium text-slate-100">{step.parameter}</span>
                  {step.spec && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                      Spec {step.spec}
                    </span>
                  )}
                  {hasSpec && (
                    <span className="font-mono text-[10px] text-sky-400">
                      {step.minValue ?? "−∞"} … {step.maxValue ?? "∞"}
                      {step.units ? ` ${step.units}` : ""}
                    </span>
                  )}
                </div>
                {step.method && (
                  <p className="mt-1 text-xs text-slate-400">{step.method}</p>
                )}

                {released && user && (
                  <div className="mt-2 border-t border-slate-800 pt-2">
                    <TestStepRecord
                      testProcedureId={tp.id}
                      stepId={step.id}
                      hasSpec={hasSpec}
                      units={step.units}
                    />
                  </div>
                )}

                {results.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {results.slice(0, 5).map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500"
                      >
                        <StatusBadge status={r.result || "NA"} className="text-[9px]" />
                        {r.measuredValue && (
                          <span className="font-mono text-slate-300">
                            {r.measuredValue}
                            {r.units ? ` ${r.units}` : ""}
                          </span>
                        )}
                        {r.unitSerial && <span>S/N {r.unitSerial}</span>}
                        <span>{r.user.name}</span>
                        {r.pinVerified && <span className="text-emerald-500">PIN ✓</span>}
                        <span>{formatDate(r.signedAt)}</span>
                        {r.photoUrl && (
                          <a href={r.photoUrl} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">
                            photo
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {tp.steps.length === 0 && (
            <p className="text-sm text-slate-500">No steps yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Author steps while in-work */}
      {!released && (
        <Card className="border-teal-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Add test step</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={actionAddTestProcedureStep}
              className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-7"
            >
              <input type="hidden" name="testProcedureId" value={tp.id} />
              <Input name="parameter" required placeholder="Parameter" className="h-8 text-xs lg:col-span-2" />
              <Input name="method" placeholder="Method" className="h-8 text-xs lg:col-span-2" />
              <Input name="spec" placeholder="Spec" className="h-8 text-xs" />
              <Input name="minValue" type="number" step="any" placeholder="Min" className="h-8 text-xs" />
              <Input name="maxValue" type="number" step="any" placeholder="Max" className="h-8 text-xs" />
              <Input name="units" placeholder="Units" className="h-8 text-xs" />
              <Button type="submit" size="sm" variant="outline" className="h-8 lg:col-span-7 lg:w-fit">
                Add test step
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
