import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CompleteInspectionForm } from "@/components/quality/complete-inspection-form";
import { WorkcenterPanel } from "@/components/workcenters/workcenter-panel";
import { getQaInspectionQueue } from "@/lib/services/test-center";
import { formatDate, cn } from "@/lib/utils";
import Link from "next/link";
import { ClipboardCheck, Factory, Ruler } from "lucide-react";
import { SignOffStepForm } from "@/components/work-orders/sign-off-form";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function QaModulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = pick(sp, "tab") || "queue";
  const qaQueue = await getQaInspectionQueue();

  return (
    <div className="space-y-6">
      <PageHeader
        title="QA"
        description="Visual / GD&T / continuity — separate from NCR. Powered functional is Test Center."
        actions={
          <div className="flex gap-2">
            <Link href="/quality">
              <Button size="sm" variant="outline">
                NCR / Quality
              </Button>
            </Link>
            <Link href="/test-center">
              <Button size="sm" variant="outline">
                Test Center
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Open inspections"
          value={qaQueue.stats.openInspections}
          icon={Ruler}
          accent="sky"
        />
        <StatCard
          title="WOs at QA stations"
          value={qaQueue.stats.openWos}
          icon={Factory}
          accent="teal"
        />
        <StatCard
          title="QA steps ready"
          value={qaQueue.stats.readySteps}
          icon={ClipboardCheck}
          accent="teal"
        />
        <StatCard
          title="Upcoming on traveler"
          value={qaQueue.stats.upcomingSteps}
          icon={ClipboardCheck}
          accent="amber"
        />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        <Link
          href="/qa"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm",
            tab !== "stations"
              ? "bg-slate-800 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          Queue ({qaQueue.stats.total})
        </Link>
        <Link
          href="/qa?tab=stations"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm",
            tab === "stations"
              ? "bg-slate-800 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          Workcenters &amp; scan
        </Link>
      </div>

      {tab === "stations" ? (
        <WorkcenterPanel area="QA" returnPath="/qa" />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Shows receiving inspections, WOs scanned into QA, and traveler steps
            routed to QA — including <strong className="text-slate-400">upcoming</strong>{" "}
            steps that are not yet &quot;up&quot; on the work instruction. A step
            is ready when prior steps are done, or the WO is scanned into a QA
            station. Functional power tests are on{" "}
            <Link href="/test-center" className="text-violet-400 hover:underline">
              Test Center
            </Link>
            .
          </p>

          {qaQueue.stats.total === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-sm text-slate-500">
                No open QA work. WOs with QA steps on the traveler appear here
                (even before the step is reached). You can also scan a WO into a
                QA station or receive material flagged for visual / GD&amp;T.
              </CardContent>
            </Card>
          )}

          {qaQueue.qaWos.map((wo) => (
            <Card key={wo.id} className="border-sky-900/40">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/work-orders/${wo.id}`}
                      className="font-mono font-semibold text-teal-400 hover:underline"
                    >
                      {wo.number}
                    </Link>
                    <StatusBadge status={wo.status} />
                    <span className="font-mono text-[10px] text-sky-400">
                      @ {wo.workCenter || "QA"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-sm text-slate-300">
                    {wo.part?.partNumber || "—"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {wo.part?.description || wo.description || ""}
                  </p>
                </div>
                <Link href={`/work-orders/${wo.id}`}>
                  <Button size="sm" variant="outline">
                    Open WO
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}

          {qaQueue.qaInspections.map((insp) => {
            const part = insp.partId ? qaQueue.partMap[insp.partId] : null;
            return (
              <Card key={insp.id} className="border-sky-900/30">
                <CardContent className="grid gap-4 p-4 lg:grid-cols-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-sky-300">
                        {insp.number}
                      </span>
                      <StatusBadge status={insp.type} />
                      <StatusBadge status={insp.status} />
                      <span className="font-mono text-[10px] text-slate-500">
                        {insp.workCenter || "QA-01"}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-teal-400">
                      {part?.partNumber || "—"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {part?.description || ""}
                      {insp.lotNumber ? ` · Lot ${insp.lotNumber}` : ""}
                    </p>
                    {insp.workOrder && (
                      <Link
                        href={`/work-orders/${insp.workOrder.id}`}
                        className="mt-1 inline-block font-mono text-xs text-sky-400 hover:underline"
                      >
                        {insp.workOrder.number}
                      </Link>
                    )}
                    <p className="mt-1 text-[10px] text-slate-600">
                      Opened {formatDate(insp.createdAt)}
                    </p>
                  </div>
                  <CompleteInspectionForm
                    inspectionId={insp.id}
                    typeLabel={insp.type}
                    requireDocs
                  />
                </CardContent>
              </Card>
            );
          })}

          {qaQueue.continuitySteps.map((sc) => {
            const ready =
              sc.readiness === "STEP_READY" || sc.readiness === "AT_STATION";
            return (
            <Card
              key={sc.id}
              className={
                sc.readiness === "UPCOMING"
                  ? "border-amber-900/30 bg-amber-500/5"
                  : "border-sky-900/20"
              }
            >
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/work-orders/${sc.workOrder.id}`}
                      className="font-mono font-medium text-teal-400 hover:underline"
                    >
                      {sc.workOrder.number}
                    </Link>
                    <StatusBadge status="QA_STEP" />
                    <StatusBadge
                      status={
                        sc.readiness === "AT_STATION"
                          ? "AT_STATION"
                          : sc.readiness === "STEP_READY"
                            ? "READY"
                            : "UPCOMING"
                      }
                    />
                    <span className="font-mono text-[10px] text-slate-500">
                      {sc.assignedWorkCenter ||
                        sc.step.workCenter ||
                        "QA-01"}
                    </span>
                    {sc.workOrder.workCenter && (
                      <span className="text-[10px] text-slate-600">
                        WO @ {sc.workOrder.workCenter}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-300">
                    Step {sc.step.stepNumber}: {sc.step.title}
                  </p>
                  <p className="text-xs text-slate-500">
                    {sc.workOrder.part?.partNumber || "—"}
                    {sc.step.testCriteria
                      ? ` · ${sc.step.testCriteria}`
                      : ""}
                    {sc.readiness === "UPCOMING"
                      ? " · Waiting on prior traveler steps (or scan WO into QA)"
                      : ""}
                  </p>
                </div>
                <div className="min-w-[12rem]">
                  {ready ? (
                    <SignOffStepForm
                      workOrderId={sc.workOrderId}
                      stepId={sc.stepId}
                      isTestStep={!!sc.step.isTestStep}
                      passFailRequired={
                        !!sc.step.passFailRequired || !!sc.step.isTestStep
                      }
                      measureUom={sc.step.measureUom}
                      expectedValue={sc.step.expectedValue}
                    />
                  ) : (
                    <Link href={`/work-orders/${sc.workOrder.id}`}>
                      <Button size="sm" variant="outline">
                        View traveler
                      </Button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
