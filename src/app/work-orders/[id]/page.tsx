import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatCurrency } from "@/lib/utils";
import { actionSignOffStep, actionUpdateWoStatus } from "@/app/actions";
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
    },
  });
  if (!wo) notFound();

  const completionMap = Object.fromEntries(
    wo.stepCompletions.map((c) => [c.stepId, c])
  );
  const total = wo.stepCompletions.length;
  const done = wo.stepCompletions.filter((s) =>
    ["SIGNED", "PASSED", "SKIPPED"].includes(s.status)
  ).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={wo.number}
        description={wo.description || wo.part?.description || ""}
        actions={
          <div className="flex flex-wrap gap-2">
            {wo.status === "PLANNED" && (
              <form action={actionUpdateWoStatus}>
                <input type="hidden" name="workOrderId" value={wo.id} />
                <input type="hidden" name="toStatus" value="RELEASED" />
                <Button type="submit" size="sm">Release</Button>
              </form>
            )}
            {wo.status === "RELEASED" && (
              <form action={actionUpdateWoStatus}>
                <input type="hidden" name="workOrderId" value={wo.id} />
                <input type="hidden" name="toStatus" value="IN_PROGRESS" />
                <Button type="submit" size="sm">Start</Button>
              </form>
            )}
            {wo.status === "IN_PROGRESS" && (
              <>
                <form action={actionUpdateWoStatus}>
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <input type="hidden" name="toStatus" value="ON_HOLD" />
                  <Button type="submit" size="sm" variant="amber">Hold</Button>
                </form>
                <form action={actionUpdateWoStatus}>
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <input type="hidden" name="toStatus" value="COMPLETED" />
                  <Button type="submit" size="sm">Complete</Button>
                </form>
              </>
            )}
            {wo.status === "ON_HOLD" && (
              <form action={actionUpdateWoStatus}>
                <input type="hidden" name="workOrderId" value={wo.id} />
                <input type="hidden" name="toStatus" value="IN_PROGRESS" />
                <Button type="submit" size="sm">Resume</Button>
              </form>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={wo.status} />
        <StatusBadge status={wo.type} />
        <StatusBadge status={wo.priority} />
        {wo.bomHeader?.isPrototype && <StatusBadge status="PROTOTYPE" />}
      </div>

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
            <p className="text-xs text-slate-500">Cost (actual / std)</p>
            <p className="font-medium text-slate-200">
              {formatCurrency(wo.actualCost)} / {formatCurrency(wo.standardCost)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">WI Sign-off Progress</p>
            <p className="font-medium text-teal-400">{pct}%</p>
            <Progress value={pct} className="mt-2 h-1.5" />
          </CardContent>
        </Card>
      </div>

      {/* Traveler / Work Instruction steps */}
      {wo.instructions.map((link) => (
        <Card key={link.id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>
                Traveler: {link.workInstruction.documentNumber} Rev{" "}
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
              const signed = comp && ["SIGNED", "PASSED", "SKIPPED"].includes(comp.status);
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

                      {!signed &&
                        !failed &&
                        ["IN_PROGRESS", "RELEASED"].includes(wo.status) && (
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
        {wo.bomHeader && (
          <Card>
            <CardHeader>
              <CardTitle>BOM Material List</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pb-2">Find</th>
                    <th className="pb-2">Part</th>
                    <th className="pb-2 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {wo.bomHeader.lines.map((l) => (
                    <tr key={l.id} className="border-t border-slate-800/60">
                      <td className="py-2 font-mono text-xs text-slate-500">{l.findNumber}</td>
                      <td className="py-2">
                        <span className="text-slate-200">{l.componentPart.partNumber}</span>
                        <span className="ml-2 text-xs text-slate-500">
                          {l.componentPart.description}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {l.quantity * wo.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Status Audit Trail</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
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
