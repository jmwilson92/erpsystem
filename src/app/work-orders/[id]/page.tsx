import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { workOrderHoldProvenance, workOrderMrbProvenance } from "@/lib/provenance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatCurrency } from "@/lib/utils";
import {
  actionUpdateWoStatus,
  actionPlanWoMaterials,
  actionCreateKit,
  actionCompleteKit,
  actionStartProduction,
  actionCompleteWoToStock,
  actionReassignStepStation,
  actionCreateProductionEngIssue,
  actionAlignBusinessPriority,
} from "@/app/actions";
import { checkBomMaterialAvailability } from "@/lib/services/order-fulfillment";
import { listWorkCenters } from "@/lib/services/workcenters";
import { SignOffStepForm } from "@/components/work-orders/sign-off-form";
import { WorkOrderQrLabel } from "@/components/work-orders/qr-label";
import {
  StationReassignForm,
  MoveMaterialFromQuery,
} from "@/components/work-orders/station-reassign-form";
import { generateQrDataUrl, workOrderQrPayload } from "@/lib/qr";
import { CheckCircle2, Circle, FlaskConical } from "lucide-react";
import Link from "next/link";
import { Textarea } from "@/components/ui/textarea";
import { ActivityTimeline } from "@/components/shared/activity-timeline";
import {
  MaterialGenealogyCard,
  TraceChainCard,
} from "@/components/shared/trace-chain";
import {
  getWoMaterialGenealogy,
  getTraceChain,
} from "@/lib/services/traceability";

export const dynamic = "force-dynamic";

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [wo, workCenters, priorities] = await Promise.all([
    prisma.workOrder.findUnique({
      where: { id },
      include: {
        part: true,
        bomHeader: { include: { lines: { include: { componentPart: true } } } },
        assignee: true,
        createdBy: true,
        project: true,
        salesOrder: true,
        materialRequisition: true,
        businessPriority: true,
        instructions: {
          include: {
            workInstruction: {
              include: { steps: { orderBy: { stepNumber: "asc" } } },
            },
          },
        },
        stepCompletions: true,
        statusHistory: { orderBy: { createdAt: "asc" } },
        mrbCase: { select: { id: true, number: true } },
        ncrs: true,
        kitOrders: {
          include: { lines: { include: { part: true } } },
          orderBy: { createdAt: "desc" },
        },
        purchaseRequests: {
          include: { lines: true },
          orderBy: { createdAt: "desc" },
        },
        materialIssues: { orderBy: { createdAt: "desc" }, take: 30 },
        traceEvents: { orderBy: { createdAt: "desc" }, take: 40 },
      },
    }),
    listWorkCenters({ activeOnly: true }),
    prisma.businessPriority.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { priority: "asc" },
    }),
  ]);
  if (!wo) notFound();

  const qrPayload = workOrderQrPayload(wo.id, wo.number);
  const qrDataUrl = await generateQrDataUrl(qrPayload);

  const genealogy = await getWoMaterialGenealogy(wo.id);
  const traceChain = await getTraceChain({
    workOrderId: wo.id,
    lotNumbers: [
      ...new Set(
        genealogy.map((g) => g.lotNumber).filter((x): x is string => !!x)
      ),
    ],
  });

  const selectClass =
    "flex h-8 w-full min-w-0 max-w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200";

  const material = await checkBomMaterialAvailability(wo.id);
  const openKit = wo.kitOrders.find((k) =>
    ["OPEN", "PICKING", "SHORT"].includes(k.status)
  );
  const completeKit = wo.kitOrders.find((k) => k.status === "COMPLETE");

  const completionMap = Object.fromEntries(
    wo.stepCompletions.map((c) => [c.stepId, c])
  );
  const total = wo.stepCompletions.length;
  const done = wo.stepCompletions.filter((s) =>
    ["SIGNED", "PASSED", "SKIPPED"].includes(s.status)
  ).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const canSign = ["IN_PROGRESS", "RELEASED", "KITTED"].includes(wo.status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={wo.number}
        description={wo.description || wo.part?.description || "Digital traveler"}
        actions={
          <div className="flex flex-wrap gap-2">
            <WorkOrderQrLabel
              workOrderId={wo.id}
              number={wo.number}
              description={wo.description || wo.part?.description}
              partNumber={wo.part?.partNumber}
              lotHint={
                wo.salesOrder?.number ||
                wo.materialRequisition?.number ||
                wo.project?.number ||
                null
              }
              qrDataUrl={qrDataUrl}
              qrPayload={qrPayload}
            />
            <Link href={`/print/labels?kind=wo&ids=${wo.id}`}>
              <Button size="sm" variant="outline">
                Barcode label
              </Button>
            </Link>
            {wo.bomHeader && (
              <form
                action={actionPlanWoMaterials}
                className="flex flex-wrap items-center gap-2"
              >
                <input type="hidden" name="workOrderId" value={wo.id} />
                <label className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900/80 px-2 py-1 text-[11px] text-slate-400">
                  <input
                    type="checkbox"
                    name="bypassStockCheck"
                    className="rounded border-slate-600"
                  />
                  Bypass stock — PR full BOM
                </label>
                <Button type="submit" size="sm" variant="outline">
                  Check material / create PRs
                </Button>
              </form>
            )}
            {(wo.status === "READY_TO_KIT" || wo.kitStatus === "READY_TO_KIT") &&
              !openKit && (
                <form action={actionCreateKit}>
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <Button type="submit" size="sm">
                    Create kit
                  </Button>
                </form>
              )}
            {openKit && (
              <form action={actionCompleteKit}>
                <input type="hidden" name="kitOrderId" value={openKit.id} />
                <Button type="submit" size="sm">
                  Complete kit pick
                </Button>
              </form>
            )}
            {(wo.status === "KITTED" ||
              (completeKit && wo.status !== "IN_PROGRESS" && wo.status !== "COMPLETED")) &&
              wo.status !== "COMPLETED" && (
                <form action={actionStartProduction}>
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <Button type="submit" size="sm">
                    Start production
                  </Button>
                </form>
              )}
            {wo.status === "BACKLOG" && (
              <form action={actionUpdateWoStatus}>
                <input type="hidden" name="workOrderId" value={wo.id} />
                <input type="hidden" name="toStatus" value="PLANNED" />
                <Button type="submit" size="sm" variant="outline">
                  Move to Planned
                </Button>
              </form>
            )}
            {(wo.status === "PLANNED" || wo.status === "BACKLOG") && (
              <form action={actionUpdateWoStatus}>
                <input type="hidden" name="workOrderId" value={wo.id} />
                <input type="hidden" name="toStatus" value="RELEASED" />
                <Button type="submit" size="sm" variant="secondary">
                  Release
                </Button>
              </form>
            )}
            {wo.status === "RELEASED" && (
              <form action={actionUpdateWoStatus}>
                <input type="hidden" name="workOrderId" value={wo.id} />
                <input type="hidden" name="toStatus" value="IN_PROGRESS" />
                <Button type="submit" size="sm">
                  Start
                </Button>
              </form>
            )}
            {wo.status === "IN_PROGRESS" && (
              <>
                <form action={actionUpdateWoStatus}>
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <input type="hidden" name="toStatus" value="ON_HOLD" />
                  <Button type="submit" size="sm" variant="amber">
                    Hold
                  </Button>
                </form>
                <form action={actionCompleteWoToStock}>
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <Button type="submit" size="sm">
                    Complete → stock
                  </Button>
                </form>
              </>
            )}
            {wo.status === "ON_HOLD" && (
              <form action={actionUpdateWoStatus}>
                <input type="hidden" name="workOrderId" value={wo.id} />
                <input type="hidden" name="toStatus" value="IN_PROGRESS" />
                <Button type="submit" size="sm">
                  Resume
                </Button>
              </form>
            )}
          </div>
        }
      />

      <MoveMaterialFromQuery
        workOrderNumber={wo.number}
        currentWorkCenter={wo.workCenter}
        stations={workCenters.map((c) => ({
          code: c.code,
          name: c.name,
          area: c.area,
        }))}
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={wo.status} {...workOrderHoldProvenance(wo)} />
        {wo.mrbCase && (
          <StatusBadge
            status={`FROM ${wo.mrbCase.number}`}
            {...workOrderMrbProvenance(wo)}
          />
        )}
        <StatusBadge status={wo.kitStatus} />
        <StatusBadge status={wo.type} />
        <StatusBadge status={wo.sourceType || "OTHER"} />
        <StatusBadge status={wo.priority} />
        <StatusBadge
          status={
            wo.businessPriority
              ? wo.businessPriority.number
              : "UNRATED"
          }
        />
        {wo.bomHeader?.isPrototype && <StatusBadge status="PROTOTYPE" />}
        {wo.salesOrder && (
          <Link
            href={`/sales/${wo.salesOrder.id}`}
            className="rounded border border-sky-500/40 px-2 py-0.5 text-xs font-medium text-sky-300 hover:bg-sky-500/10"
          >
            Sales order {wo.salesOrder.number}
          </Link>
        )}
        {wo.materialRequisition && (
          <Link
            href={`/planning/mrs/${wo.materialRequisition.id}`}
            className="rounded border border-violet-500/40 px-2 py-0.5 text-xs font-medium text-violet-300 hover:bg-violet-500/10"
          >
            MRS {wo.materialRequisition.number}
          </Link>
        )}
      </div>

      <Card className="border-slate-800">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <form
            action={actionAlignBusinessPriority}
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="entityType" value="WorkOrder" />
            <input type="hidden" name="entityId" value={wo.id} />
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Business priority
              </label>
              <select
                name="businessPriorityId"
                defaultValue={wo.businessPriorityId || "UNRATED"}
                className={`${selectClass} mt-1 min-w-[14rem]`}
              >
                <option value="UNRATED">Unrated</option>
                {priorities.map((p) => (
                  <option key={p.id} value={p.id}>
                    P{p.priority} · {p.number} — {p.title}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" variant="outline">
              Align priority
            </Button>
          </form>
          {wo.businessPriority && (
            <p className="text-xs text-slate-400">
              Aligned to{" "}
              <span className="text-slate-200">
                {wo.businessPriority.number}: {wo.businessPriority.title}
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Origin banner — SO vs MRS vs project */}
      {wo.salesOrder && !wo.projectId && (
        <Card className="border-sky-900/40 bg-sky-500/5">
          <CardContent className="p-3 text-sm text-sky-100">
            <p className="font-medium">
              Sales-order work order ({wo.number})
            </p>
            <p className="mt-0.5 text-xs text-sky-200/80">
              Referenced to{" "}
              <Link
                href={`/sales/${wo.salesOrder.id}`}
                className="font-mono underline"
              >
                {wo.salesOrder.number}
              </Link>
              {wo.salesOrderRef && wo.salesOrderRef !== wo.salesOrder.number
                ? ` (${wo.salesOrderRef})`
                : ""}
              . Project / WBS not applied — this is commercial demand, not
              project work.
            </p>
          </CardContent>
        </Card>
      )}
      {wo.materialRequisition && (
        <Card className="border-violet-900/40 bg-violet-500/5">
          <CardContent className="p-3 text-sm text-violet-100">
            <p className="font-medium">
              Material-requisition work order ({wo.number})
            </p>
            <p className="mt-0.5 text-xs text-violet-200/80">
              Created from forecast planning via{" "}
              <Link
                href={`/planning/mrs/${wo.materialRequisition.id}`}
                className="font-mono underline"
              >
                {wo.materialRequisition.number}
              </Link>
              . Traveler references this MRS unique number.
            </p>
          </CardContent>
        </Card>
      )}

      {wo.travelerNotes && (
        <Card className="border-teal-900/40 bg-teal-950/20">
          <CardContent className="p-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-teal-500">
              Digital traveler
            </p>
            <pre className="whitespace-pre-wrap font-sans text-sm text-slate-300">
              {wo.travelerNotes}
            </pre>
          </CardContent>
        </Card>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-4">
        <Card className="min-w-0">
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">Part / BOM</p>
            <p className="font-medium text-slate-200">
              {wo.part?.partNumber || "—"}
              {wo.bomHeader ? ` Rev ${wo.bomHeader.revision}` : ""}
            </p>
            {wo.bomHeader && (
              <Link href={`/bom/${wo.bomHeader.id}`} className="text-xs text-teal-400">
                View BOM ({wo.bomHeader.status})
              </Link>
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0 overflow-hidden">
          <CardContent className="space-y-2 p-4">
            <p className="text-xs text-slate-500">Qty / Station</p>
            <p className="font-medium text-slate-200">
              {wo.quantityCompleted}/{wo.quantity} ·{" "}
              <span className="font-mono text-teal-400">
                {wo.workCenter || "—"}
              </span>
            </p>
            <p className="truncate text-xs text-slate-500">
              {wo.assignee?.name || "Unassigned"}
            </p>
            <StationReassignForm
              workOrderId={wo.id}
              workOrderNumber={wo.number}
              currentWorkCenter={wo.workCenter}
              selectClass={selectClass}
              stations={workCenters.map((c) => ({
                code: c.code,
                name: c.name,
                area: c.area,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">Due / schedule</p>
            <p className="font-medium text-slate-200">{formatDate(wo.dueDate)}</p>
            <p className="text-xs text-slate-500">
              Plan {formatDate(wo.plannedStart)} → {formatDate(wo.plannedEnd)}
              {wo.estimatedMinutes ? ` · ${wo.estimatedMinutes} min est` : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">Origin / reference</p>
            {wo.salesOrder ? (
              <>
                <p className="font-medium text-sky-300">Sales order</p>
                <Link
                  href={`/sales/${wo.salesOrder.id}`}
                  className="font-mono text-sm text-sky-400 hover:underline"
                >
                  {wo.salesOrder.number}
                </Link>
              </>
            ) : wo.materialRequisition ? (
              <>
                <p className="font-medium text-violet-300">Material requisition</p>
                <Link
                  href={`/planning/mrs/${wo.materialRequisition.id}`}
                  className="font-mono text-sm text-violet-400 hover:underline"
                >
                  {wo.materialRequisition.number}
                </Link>
              </>
            ) : wo.projectId && wo.project ? (
              <>
                <p className="font-medium text-slate-200">Project</p>
                <Link
                  href={`/projects/${wo.project.id}`}
                  className="font-mono text-sm text-teal-400 hover:underline"
                >
                  {wo.project.number}
                </Link>
                {wo.wbsElementId && (
                  <p className="text-[11px] text-slate-500">WBS linked</p>
                )}
              </>
            ) : (
              <>
                <p className="font-medium text-slate-200">
                  {wo.sourceType === "BOM" ? "BOM production" : "Standalone"}
                </p>
                <p className="text-xs text-slate-500">No SO / MRS / project</p>
              </>
            )}
            {wo.type !== "TASK_ONLY" && total > 0 && (
              <>
                <p className="mt-3 text-xs text-slate-500">WI sign-off</p>
                <p className="font-medium text-teal-400">{pct}%</p>
                <Progress value={pct} className="mt-1 h-1.5" />
                <p className="mt-1 text-[10px] text-slate-600">
                  {done}/{total} steps
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {wo.type !== "TASK_ONLY" && (
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-slate-500">Standard cost (BOM roll-up)</p>
              <p className="font-medium text-slate-200">
                {formatCurrency(wo.standardCost || 0)}
              </p>
              {(wo.actualCost || 0) > 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  Actual labor/material {formatCurrency(wo.actualCost)}
                </p>
              ) : (
                <p className="mt-1 text-[10px] text-slate-600">
                  Actual cost updates as time &amp; materials post
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Material readiness */}
      {material.requirements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Material for kitting</span>
              {material.allAvailable ? (
                <StatusBadge status="READY_TO_KIT" />
              ) : (
                <StatusBadge status="WAITING_MATERIAL" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-2">Part</th>
                  <th className="pb-2 text-right">Required</th>
                  <th className="pb-2 text-right">Available</th>
                  <th className="pb-2 text-right">Short</th>
                </tr>
              </thead>
              <tbody>
                {material.requirements.map((r) => (
                  <tr key={r.bomLineId} className="border-t border-slate-800/60">
                    <td className="py-2">
                      <span className="font-mono text-xs text-teal-400">{r.partNumber}</span>
                      <span className="ml-2 text-xs text-slate-500">{r.description}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.required}</td>
                    <td className="py-2 text-right tabular-nums text-emerald-400">
                      {r.available}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${
                        r.short > 0 ? "text-amber-400" : "text-slate-600"
                      }`}
                    >
                      {r.short || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {wo.purchaseRequests.length > 0 && (
              <div className="mt-3 border-t border-slate-800 pt-3">
                <p className="mb-1 text-xs font-medium text-amber-400">Linked purchase requests</p>
                {wo.purchaseRequests.map((pr) => (
                  <Link
                    key={pr.id}
                    href="/purchasing"
                    className="mr-3 text-sm text-sky-400 hover:underline"
                  >
                    {pr.number} ({pr.status}) — {pr.lines.length} line(s)
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Kit */}
      {wo.kitOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Kit orders (travel with WO)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {wo.kitOrders.map((kit) => (
              <div key={kit.id} className="rounded border border-slate-800 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-teal-400">{kit.number}</span>
                  <StatusBadge status={kit.status} />
                  <Link href="/kitting" className="text-xs text-sky-400">
                    Kitting board
                  </Link>
                </div>
                <ul className="text-xs text-slate-400">
                  {kit.lines.map((l) => (
                    <li key={l.id}>
                      {l.part.partNumber}: {l.quantityPicked}/{l.quantityRequired}
                      {l.lotNumber ? ` · Lot ${l.lotNumber}` : ""}{" "}
                      <StatusBadge status={l.status} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Traveler / Work Instruction steps */}
      {wo.instructions.map((link) => (
        <Card key={link.id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>
                Traveler steps: {link.workInstruction.documentNumber} Rev{" "}
                {link.workInstruction.revision}
              </span>
              <Link
                href={`/work-instructions/${link.workInstruction.id}`}
                className="text-xs font-normal text-teal-400"
              >
                Open WI
              </Link>
            </CardTitle>
            <p className="text-sm text-slate-500">{link.workInstruction.title}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {link.workInstruction.steps.map((step) => {
              const comp = completionMap[step.id];
              const signed =
                comp && ["SIGNED", "PASSED", "SKIPPED"].includes(comp.status);
              const failed = comp?.status === "FAILED";
              return (
                <div
                  key={step.id}
                  className={`rounded-lg border p-4 ${
                    failed
                      ? "border-red-500/40 bg-red-500/5"
                      : signed
                        ? "border-emerald-500/20 bg-emerald-500/5"
                        : "border-slate-800 bg-slate-900/40"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {signed ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                    ) : failed ? (
                      <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                    ) : (
                      <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-slate-500">
                          Step {step.stepNumber}
                        </span>
                        <span className="font-medium text-slate-200">{step.title}</span>
                        {step.isTestStep && <StatusBadge status="TEST" />}
                        {step.requiredArea && (
                          <StatusBadge status={step.requiredArea} />
                        )}
                        {step.routeLock && (
                          <span className="text-[10px] text-amber-500">locked</span>
                        )}
                        {comp && <StatusBadge status={comp.status} />}
                      </div>
                      <p className="mt-1 text-sm text-slate-400">{step.instructions}</p>
                      {step.isTestStep && (
                        <p className="mt-1 text-xs text-amber-400/80">
                          Criteria: {step.testCriteria} · Expected: {step.expectedValue}
                        </p>
                      )}
                      {comp && (
                        <form
                          action={actionReassignStepStation}
                          className="mt-2 flex flex-wrap items-center gap-1"
                        >
                          <input type="hidden" name="workOrderId" value={wo.id} />
                          <input type="hidden" name="stepId" value={step.id} />
                          <span className="text-[10px] uppercase text-slate-600">
                            Station
                          </span>
                          <select
                            name="workCenterCode"
                            className={selectClass}
                            defaultValue={
                              comp.assignedWorkCenter ||
                              step.workCenter ||
                              wo.workCenter ||
                              ""
                            }
                            required
                          >
                            {workCenters.map((c) => (
                              <option key={c.id} value={c.code}>
                                {c.code} ({c.area})
                              </option>
                            ))}
                          </select>
                          <label className="flex items-center gap-1 text-[10px] text-slate-500">
                            <input
                              type="checkbox"
                              name="force"
                              className="rounded border-slate-600"
                            />
                            Force
                          </label>
                          <Button type="submit" size="sm" variant="ghost">
                            Route step
                          </Button>
                        </form>
                      )}
                      {signed && (
                        <p className="mt-1 text-xs text-emerald-500/80">
                          Signed {formatDate(comp.signedAt, "MMM d HH:mm")}
                          {comp.measuredValue ? ` · Measured: ${comp.measuredValue}` : ""}
                        </p>
                      )}

                      {!signed && !failed && canSign && (
                        <div className="mt-3 max-w-sm">
                          <SignOffStepForm
                            workOrderId={wo.id}
                            stepId={step.id}
                            isTestStep={step.isTestStep}
                            passFailRequired={step.passFailRequired}
                            measureUom={step.measureUom}
                            expectedValue={step.expectedValue}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {wo.instructions.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-slate-500">
            No work instructions attached. Task-only or manual WO.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Material transactions (trace)</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="max-h-80 space-y-2 overflow-y-auto">
              {wo.materialIssues.map((t) => (
                <li key={t.id} className="text-xs text-slate-400">
                  <span className="font-mono text-teal-500">{t.type}</span> qty {t.quantity}
                  {t.lotNumber ? ` lot ${t.lotNumber}` : ""}
                  {t.fromLocation || t.toLocation
                    ? ` · ${t.fromLocation || "?"}→${t.toLocation || "?"}`
                    : ""}
                  <span className="text-slate-600">
                    {" "}
                    · {formatDate(t.createdAt, "MMM d HH:mm")}
                  </span>
                </li>
              ))}
              {wo.materialIssues.length === 0 && (
                <p className="text-sm text-slate-500">No material txns yet.</p>
              )}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status + process trail</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="mb-4 space-y-3">
              {wo.statusHistory.map((h) => (
                <li key={h.id} className="flex gap-3 text-sm">
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-500" />
                  <div>
                    <p className="text-slate-300">
                      {h.fromStatus ? `${h.fromStatus} → ` : ""}
                      <span className="font-medium text-teal-400">{h.toStatus}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(h.createdAt, "MMM d, yyyy HH:mm")}
                      {h.notes ? ` · ${h.notes}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            {wo.traceEvents.length > 0 && (
              <div className="border-t border-slate-800 pt-3">
                <p className="mb-2 text-xs font-medium text-slate-500">Trace events</p>
                <ol className="max-h-48 space-y-1 overflow-y-auto">
                  {wo.traceEvents.map((e) => (
                    <li key={e.id} className="text-xs text-slate-400">
                      <span className="font-mono text-sky-500">{e.eventType}</span>
                      {e.notes ? ` — ${e.notes}` : ""}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {wo.ncrs.length > 0 && (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <p className="mb-2 text-xs font-medium text-amber-400">Linked NCRs</p>
                {wo.ncrs.map((n) => (
                  <Link
                    key={n.id}
                    href="/quality"
                    className="block text-sm text-slate-300 hover:text-teal-400"
                  >
                    {n.number}: {n.title}
                  </Link>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-slate-800 pt-4">
              <p className="mb-2 text-xs font-medium text-orange-400">
                Request Manufacturing Engineering help
              </p>
              <p className="mb-2 text-[11px] text-slate-500">
                Hardware, process, or document issue? ME picks this up on the{" "}
                <Link
                  href="/engineering/mfg_eng?tab=prod"
                  className="text-teal-400 underline"
                >
                  MFG_ENG board
                </Link>
                .
              </p>
              <form
                action={actionCreateProductionEngIssue}
                className="space-y-2"
              >
                <input type="hidden" name="workOrderId" value={wo.id} />
                {wo.partId && (
                  <input type="hidden" name="partId" value={wo.partId} />
                )}
                {wo.projectId && (
                  <input type="hidden" name="projectId" value={wo.projectId} />
                )}
                {wo.workCenter && (
                  <input type="hidden" name="workCenter" value={wo.workCenter} />
                )}
                <input type="hidden" name="sourceArea" value="STATION" />
                <input
                  type="hidden"
                  name="returnTo"
                  value={`/work-orders/${wo.id}`}
                />
                <Input
                  name="title"
                  required
                  placeholder="Short description of the problem"
                  className="text-sm"
                />
                <Textarea
                  name="description"
                  rows={2}
                  placeholder="What you need ME to clarify or fix…"
                  className="text-sm"
                />
                <select
                  name="category"
                  className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
                  defaultValue="PROCESS"
                >
                  <option value="HARDWARE">Hardware</option>
                  <option value="PROCESS">Process</option>
                  <option value="DOCUMENT">Document / drawing</option>
                  <option value="BOM">BOM</option>
                  <option value="TOOLING">Tooling</option>
                  <option value="OTHER">Other</option>
                </select>
                <select
                  name="priority"
                  className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
                  defaultValue="NORMAL"
                >
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
                <Button type="submit" size="sm" variant="outline">
                  Send to MFG_ENG
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>

      <MaterialGenealogyCard rows={genealogy} />

      <TraceChainCard events={traceChain} title="Everything that touched this WO" />

      <ActivityTimeline entityType="WorkOrder" entityId={id} />
    </div>
  );
}
