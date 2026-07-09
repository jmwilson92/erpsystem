import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatCurrency } from "@/lib/utils";
import {
  actionSignOffStep,
  actionUpdateWoStatus,
  actionPlanWoMaterials,
  actionCreateKit,
  actionCompleteKit,
  actionStartProduction,
  actionCompleteWoToStock,
} from "@/app/actions";
import { checkBomMaterialAvailability } from "@/lib/services/order-fulfillment";
import { CheckCircle2, Circle, FlaskConical } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const wo = await prisma.workOrder.findUnique({
    where: { id },
    include: {
      part: true,
      bomHeader: { include: { lines: { include: { componentPart: true } } } },
      assignee: true,
      createdBy: true,
      project: true,
      salesOrder: true,
      instructions: {
        include: {
          workInstruction: {
            include: { steps: { orderBy: { stepNumber: "asc" } } },
          },
        },
      },
      stepCompletions: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
      ncrs: true,
      kitOrders: {
        include: { lines: { include: { part: true } } },
        orderBy: { createdAt: "desc" },
      },
      purchaseRequests: { include: { lines: true }, orderBy: { createdAt: "desc" } },
      materialIssues: { orderBy: { createdAt: "desc" }, take: 30 },
      traceEvents: { orderBy: { createdAt: "desc" }, take: 40 },
    },
  });
  if (!wo) notFound();

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
            {wo.bomHeader && (
              <form action={actionPlanWoMaterials}>
                <input type="hidden" name="workOrderId" value={wo.id} />
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
            {wo.status === "PLANNED" && (
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

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={wo.status} />
        <StatusBadge status={wo.kitStatus} />
        <StatusBadge status={wo.type} />
        <StatusBadge status={wo.priority} />
        {wo.bomHeader?.isPrototype && <StatusBadge status="PROTOTYPE" />}
        {wo.salesOrder && (
          <Link href={`/sales/${wo.salesOrder.id}`} className="text-xs text-sky-400 underline">
            {wo.salesOrder.number}
          </Link>
        )}
      </div>

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

      <div className="grid gap-4 lg:grid-cols-4">
        <Card>
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
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">Qty / Center</p>
            <p className="font-medium text-slate-200">
              {wo.quantityCompleted}/{wo.quantity} · {wo.workCenter || "—"}
            </p>
            <p className="text-xs text-slate-500">{wo.assignee?.name || "Unassigned"}</p>
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
            <p className="text-xs text-slate-500">WI Sign-off Progress</p>
            <p className="font-medium text-teal-400">{pct}%</p>
            <Progress value={pct} className="mt-2 h-1.5" />
            <p className="mt-1 text-xs text-slate-500">
              Cost {formatCurrency(wo.actualCost)} / {formatCurrency(wo.standardCost)}
            </p>
          </CardContent>
        </Card>
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
                        {comp && <StatusBadge status={comp.status} />}
                      </div>
                      <p className="mt-1 text-sm text-slate-400">{step.instructions}</p>
                      {step.isTestStep && (
                        <p className="mt-1 text-xs text-amber-400/80">
                          Criteria: {step.testCriteria} · Expected: {step.expectedValue}
                        </p>
                      )}
                      {signed && (
                        <p className="mt-1 text-xs text-emerald-500/80">
                          Signed {formatDate(comp.signedAt, "MMM d HH:mm")}
                          {comp.measuredValue ? ` · Measured: ${comp.measuredValue}` : ""}
                        </p>
                      )}

                      {!signed && !failed && canSign && (
                        <form
                          action={actionSignOffStep}
                          className="mt-3 flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="workOrderId" value={wo.id} />
                          <input type="hidden" name="stepId" value={step.id} />
                          {step.isTestStep && (
                            <>
                              <div>
                                <label className="text-[10px] text-slate-500">Measured</label>
                                <Input
                                  name="measuredValue"
                                  placeholder="Value"
                                  className="h-8 w-28"
                                  defaultValue={step.expectedValue || ""}
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-500">Result</label>
                                <select
                                  name="result"
                                  className="flex h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                                  defaultValue="PASS"
                                >
                                  <option value="PASS">PASS</option>
                                  <option value="FAIL">FAIL</option>
                                </select>
                              </div>
                            </>
                          )}
                          {!step.isTestStep && (
                            <input type="hidden" name="result" value="PASS" />
                          )}
                          <Button type="submit" size="sm">
                            Sign Off
                          </Button>
                        </form>
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
