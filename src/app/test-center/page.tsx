import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CompleteInspectionForm } from "@/components/quality/complete-inspection-form";
import { WorkcenterPanel } from "@/components/workcenters/workcenter-panel";
import { getTestCenterQueue } from "@/lib/services/test-center";
import { formatDate, cn } from "@/lib/utils";
import Link from "next/link";
import {
  FlaskConical,
  ClipboardList,
  PackageCheck,
  AlertTriangle,
  Gauge,
} from "lucide-react";
import { SignOffStepForm } from "@/components/work-orders/sign-off-form";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function TestCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = pick(sp, "tab") || "queue";
  const data = await getTestCenterQueue();
  const { stats } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Test Center"
        description="Test module — powered functional work (stations under area TEST)"
        actions={
          <Link href="/qa">
            <Button size="sm" variant="outline">
              QA module
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        <Link
          href="/test-center"
          className={cn(
            "rounded-md px-3 py-1.5 text-sm",
            tab !== "stations"
              ? "bg-slate-800 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          Queue
        </Link>
        <Link
          href="/test-center?tab=stations"
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
        <WorkcenterPanel area="TEST" returnPath="/test-center" />
      ) : (
        <>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Queue total"
          value={stats.totalQueue}
          icon={Gauge}
          accent="violet"
        />
        <StatCard
          title="Functional receiving"
          value={stats.openReceiving}
          icon={PackageCheck}
          accent="sky"
        />
        <StatCard
          title="Inspection WOs"
          value={stats.openInspectionWos}
          icon={FlaskConical}
          accent="teal"
        />
        <StatCard
          title="Production tests"
          value={stats.openProductionTests}
          icon={ClipboardList}
          accent="amber"
        />
        <StatCard
          title="Upcoming / ready"
          value={`${stats.upcomingTests ?? 0} / ${stats.readyTests ?? 0}`}
          icon={AlertTriangle}
          accent="amber"
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-mono text-violet-400">TEST-01 load</span>
            <span
              className={cn(
                "text-xs font-medium",
                stats.utilPct > 90
                  ? "text-red-400"
                  : stats.utilPct > 70
                    ? "text-amber-400"
                    : "text-emerald-400"
              )}
            >
              {stats.loadHours}h / {stats.capacity}h · {stats.utilPct}%
            </span>
          </div>
          <Progress
            value={stats.utilPct}
            className="h-2"
            indicatorClassName={
              stats.utilPct > 90
                ? "bg-red-500"
                : stats.utilPct > 70
                  ? "bg-amber-500"
                  : "bg-violet-500"
            }
          />
        </CardContent>
      </Card>

      {/* ── Receiving tests ───────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          <PackageCheck className="h-4 w-4 text-sky-400" />
          Receiving functional (power)
          <span className="font-normal normal-case text-slate-600">
            ({stats.openReceiving} open)
          </span>
        </h2>

        {data.receivingByWo.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-slate-500">
              No powered functional receiving tests. Continuity / visual / GD&amp;T
              queue under Quality (QA-01).
            </CardContent>
          </Card>
        )}

        {data.receivingByWo.map((group) => {
          const first = group.inspections[0];
          const part = first.partId ? data.partMap[first.partId] : null;
          const receipt = first.receiptId
            ? data.receiptMap[first.receiptId]
            : null;
          const key = group.workOrder?.id || first.id;

          return (
            <Card key={key} className="border-sky-900/40">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {group.workOrder ? (
                        <Link
                          href={`/work-orders/${group.workOrder.id}`}
                          className="font-mono text-base font-semibold text-violet-300 hover:underline"
                        >
                          {group.workOrder.number}
                        </Link>
                      ) : (
                        <span className="font-mono text-violet-300">
                          {first.number}
                        </span>
                      )}
                      <StatusBadge status="RECEIVING" />
                      {group.workOrder && (
                        <StatusBadge status={group.workOrder.status} />
                      )}
                    </div>
                    <p className="mt-1 font-mono text-sm text-teal-400">
                      {part?.partNumber || "—"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {part?.description || group.workOrder?.description || ""}
                      {first.lotNumber ? ` · Lot ${first.lotNumber}` : ""}
                      {` · Qty ${first.quantity}`}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      {receipt?.traveler && (
                        <Link
                          href={`/receiving/${receipt.traveler.id}`}
                          className="font-mono text-sky-400 hover:underline"
                        >
                          {receipt.traveler.number}
                        </Link>
                      )}
                      {receipt?.purchaseOrder && (
                        <Link
                          href={`/purchasing/po/${receipt.purchaseOrder.id}`}
                          className="font-mono text-sky-400 hover:underline"
                        >
                          {receipt.purchaseOrder.number}
                        </Link>
                      )}
                      {receipt && (
                        <span className="font-mono text-slate-600">
                          {receipt.number}
                        </span>
                      )}
                      {first.plannedPutawayCode && (
                        <span className="text-slate-600">
                          → {first.plannedPutawayCode}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {group.inspections.map((insp) => (
                  <div
                    key={insp.id}
                    className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 lg:grid-cols-2"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-slate-400">
                          {insp.number}
                        </span>
                        <StatusBadge status={insp.type} />
                        <StatusBadge status={insp.status} />
                      </div>
                      {insp.notes && (
                        <p className="mt-1 text-xs text-slate-500">{insp.notes}</p>
                      )}
                      {insp.documents.length > 0 && (
                        <p className="mt-1 text-[11px] text-teal-600/80">
                          {insp.documents.length} document(s)
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-slate-600">
                        Opened {formatDate(insp.createdAt)}
                      </p>
                    </div>
                    <CompleteInspectionForm
                      inspectionId={insp.id}
                      typeLabel={insp.type}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* ── Inspection / TEST-01 work orders ─────────────────── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          <FlaskConical className="h-4 w-4 text-violet-400" />
          Work orders at TEST-01
          <span className="font-normal normal-case text-slate-600">
            ({data.testCenterWos.length})
          </span>
        </h2>

        {data.testCenterWos.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-slate-500">
              No work orders parked on TEST-01.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          {data.testCenterWos.map((wo) => {
            const pendingSteps = wo.stepCompletions.filter((s) =>
              ["PENDING", "IN_PROGRESS"].includes(s.status)
            );
            // Functional / power only — continuity is QA-01
            const testSteps = wo.stepCompletions.filter(
              (s) =>
                s.step.workCenter === "TEST-01" ||
                (s.step.isTestStep &&
                  s.step.workCenter !== "QA-01" &&
                  /functional|power|bit|voltage|boot/i.test(s.step.title))
            );
            return (
              <Card
                key={wo.id}
                className={cn(
                  "border-l-4",
                  wo.status === "ON_HOLD"
                    ? "border-l-amber-500"
                    : wo.type === "INSPECTION"
                      ? "border-l-violet-500"
                      : "border-l-teal-500"
                )}
              >
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/work-orders/${wo.id}`}
                          className="font-mono text-base font-semibold text-teal-400 hover:underline"
                        >
                          {wo.number}
                        </Link>
                        <StatusBadge status={wo.status} />
                        <StatusBadge status={wo.type} />
                        {wo.priority === "HIGH" || wo.priority === "CRITICAL" ? (
                          <StatusBadge status={wo.priority} />
                        ) : null}
                      </div>
                      <p className="mt-1 font-mono text-sm text-slate-300">
                        {wo.part?.partNumber || "—"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {wo.description || wo.part?.description || ""}
                      </p>
                      {wo.salesOrder && (
                        <Link
                          href={`/sales/${wo.salesOrder.id}`}
                          className="text-xs text-sky-400 hover:underline"
                        >
                          {wo.salesOrder.number}
                        </Link>
                      )}
                    </div>
                    <Link href={`/work-orders/${wo.id}`}>
                      <Button size="sm" variant="outline">
                        Open traveler
                      </Button>
                    </Link>
                  </div>

                  {wo.inspections.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {wo.inspections.map((i) => (
                        <span
                          key={i.id}
                          className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                        >
                          {i.number} · {i.type}
                        </span>
                      ))}
                    </div>
                  )}

                  {testSteps.length > 0 && (
                    <div className="space-y-2 border-t border-slate-800 pt-2">
                      {testSteps
                        .filter((s) =>
                          ["PENDING", "IN_PROGRESS"].includes(s.status)
                        )
                        .map((sc) => (
                          <div
                            key={sc.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <span className="text-slate-300">
                              Step {sc.step.stepNumber}: {sc.step.title}
                              {sc.step.isTestStep && (
                                <StatusBadge
                                  status="TEST"
                                  className="ml-1"
                                />
                              )}
                            </span>
                            <SignOffStepForm
                              workOrderId={wo.id}
                              stepId={sc.stepId}
                              isTestStep={!!sc.step.isTestStep}
                              passFailRequired={
                                !!sc.step.passFailRequired || !!sc.step.isTestStep
                              }
                              measureUom={sc.step.measureUom}
                              expectedValue={sc.step.expectedValue}
                            />
                          </div>
                        ))}
                      {pendingSteps.length === 0 && testSteps.length > 0 && (
                        <p className="text-[11px] text-slate-600">
                          Test steps complete — finish traveler on WO
                        </p>
                      )}
                    </div>
                  )}

                  {wo.type === "INSPECTION" &&
                    wo.inspections.length === 0 &&
                    testSteps.length === 0 && (
                      <p className="text-xs text-slate-500">
                        Inspection WO — complete linked receiving tests above or
                        open traveler.
                      </p>
                    )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ── Production WOs with open test steps ─────────────── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          <ClipboardList className="h-4 w-4 text-amber-400" />
          Production test steps (traveler)
          <span className="font-normal normal-case text-slate-600">
            ({data.productionTestGroups.length})
          </span>
        </h2>
        <p className="text-xs text-slate-500">
          Includes test steps that are not yet &quot;up&quot; on the work
          instruction (prior build steps unfinished). They stay in this queue
          until the step is ready or the WO is scanned into a Test station.
        </p>

        {data.productionTestGroups.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-slate-500">
              No open production test steps. WOs with TEST / is-test-step on the
              WI appear here even before scan-in.
            </CardContent>
          </Card>
        )}

        {data.productionTestGroups.map(({ workOrder: wo, steps, readiness }) => (
          <Card
            key={wo.id}
            className={
              readiness === "UPCOMING"
                ? "border-amber-900/40 bg-amber-500/5"
                : "border-amber-900/30"
            }
          >
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/work-orders/${wo.id}`}
                      className="font-mono font-semibold text-teal-400 hover:underline"
                    >
                      {wo.number}
                    </Link>
                    <StatusBadge status={wo.status} />
                    <StatusBadge
                      status={
                        readiness === "AT_STATION"
                          ? "AT_STATION"
                          : readiness === "STEP_READY"
                            ? "READY"
                            : "UPCOMING"
                      }
                    />
                    {wo.workCenter && (
                      <span className="font-mono text-[10px] text-slate-500">
                        WO @ {wo.workCenter}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-sm text-slate-300">
                    {wo.part?.partNumber || "—"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {wo.part?.description || wo.description || ""}
                    {readiness === "UPCOMING"
                      ? " · Waiting on prior traveler steps (or scan into Test)"
                      : ""}
                  </p>
                </div>
                <Link href={`/work-orders/${wo.id}`}>
                  <Button size="sm" variant="outline">
                    Open traveler
                  </Button>
                </Link>
              </div>

              <div className="space-y-2">
                {steps.map((sc) => {
                  const stepReady =
                    sc.readiness === "STEP_READY" ||
                    sc.readiness === "AT_STATION";
                  return (
                  <div
                    key={sc.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="text-slate-200">
                        Step {sc.step.stepNumber}: {sc.step.title}
                      </span>
                      <StatusBadge
                        status={
                          sc.readiness === "AT_STATION"
                            ? "AT_STATION"
                            : sc.readiness === "STEP_READY"
                              ? "READY"
                              : "UPCOMING"
                        }
                        className="ml-2"
                      />
                      {sc.step.testCriteria && (
                        <p className="text-[11px] text-slate-500">
                          {sc.step.testCriteria}
                          {sc.step.expectedValue
                            ? ` · expect ${sc.step.expectedValue}`
                            : ""}
                        </p>
                      )}
                    </div>
                    <div className="min-w-[12rem]">
                      {stepReady ? (
                        <SignOffStepForm
                          workOrderId={wo.id}
                          stepId={sc.stepId}
                          isTestStep={!!sc.step.isTestStep}
                          passFailRequired={
                            !!sc.step.passFailRequired || !!sc.step.isTestStep
                          }
                          measureUom={sc.step.measureUom}
                          expectedValue={sc.step.expectedValue}
                        />
                      ) : (
                        <span className="text-[11px] text-amber-400/90">
                          Not ready yet
                        </span>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
        </>
      )}
    </div>
  );
}
