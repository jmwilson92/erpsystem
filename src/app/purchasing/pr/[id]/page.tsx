import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDate } from "@/lib/utils";
import { actionApprovePr } from "@/app/actions";
import { getPrApprovals } from "@/lib/services/pr-approval";
import { ActivityTimeline } from "@/components/shared/activity-timeline";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  CircleDashed,
  FileText,
  Factory,
  ClipboardList,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PrDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [pr, currentUser] = await Promise.all([
    prisma.purchaseRequest.findUnique({
      where: { id },
      include: {
        lines: true,
        supplier: true,
        workOrder: { select: { id: true, number: true, status: true } },
        workInstruction: {
          select: { id: true, documentNumber: true, title: true },
        },
        materialRequisition: {
          select: { id: true, number: true, name: true, status: true },
        },
        mrbCase: { select: { id: true, number: true } },
        project: { select: { id: true, number: true, name: true } },
        purchaseOrders: {
          select: {
            id: true,
            number: true,
            status: true,
            totalAmount: true,
            promisedDate: true,
          },
          orderBy: { createdAt: "desc" },
        },
        approvalPolicy: true,
      },
    }),
    getCurrentUser(),
  ]);
  if (!pr) notFound();

  const [approvals, requester, lineParts] = await Promise.all([
    getPrApprovals(pr.id),
    pr.requestedById
      ? prisma.user.findUnique({
          where: { id: pr.requestedById },
          select: { name: true, title: true },
        })
      : Promise.resolve(null),
    prisma.part.findMany({
      where: {
        id: { in: pr.lines.map((l) => l.partId).filter(Boolean) as string[] },
      },
      select: { id: true, partNumber: true },
    }),
  ]);
  const partMap = new Map(lineParts.map((p) => [p.id, p.partNumber]));

  const currentStep = approvals.find(
    (a) => a.stepOrder === pr.currentStepOrder && a.status === "PENDING"
  );
  const roleOk =
    currentUser?.role === "ADMIN" ||
    !currentStep?.policyStep?.approverRole ||
    currentUser?.role === currentStep.policyStep.approverRole ||
    (currentStep?.policyStep?.approverUserId &&
      currentStep.policyStep.approverUserId === currentUser?.id);
  // A requester can never approve their own PR (segregation of duties)
  const isRequester =
    !!currentUser?.id && currentUser.id === pr.requestedById;
  const canDecide =
    pr.status === "SUBMITTED" && !!currentStep && !!roleOk && !isRequester;

  const lineTotal = pr.lines.reduce(
    (s, l) => s + l.quantity * l.estimatedUnitCost,
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Purchase Request ${pr.number}`}
        description={pr.justification || "Purchase request"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/purchasing?tab=prs">
              <Button size="sm" variant="outline">
                All PRs
              </Button>
            </Link>
            {pr.status === "APPROVED" && (
              <Link href="/purchasing?tab=prs">
                <Button size="sm">Convert on buyer workbench →</Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={pr.status} />
        {pr.triggerSource && <StatusBadge status={pr.triggerSource} />}
        <span className="text-xs text-slate-500">
          Requested {formatDate(pr.createdAt)}
          {requester ? ` by ${requester.name}` : ""}
          {pr.neededBy ? ` · needed by ${formatDate(pr.neededBy)}` : ""}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Lines ({pr.lines.length})
              <span className="ml-2 text-xs font-normal text-slate-500">
                Estimated {formatCurrency(lineTotal || pr.totalEstimate)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-xl border border-slate-800">
              <div className="grid grid-cols-12 gap-2 border-b border-slate-800 bg-slate-900/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <div className="col-span-5">Item</div>
                <div className="col-span-2 text-right">Qty</div>
                <div className="col-span-1">UOM</div>
                <div className="col-span-2 text-right">Est. unit</div>
                <div className="col-span-2 text-right">Ext.</div>
              </div>
              {pr.lines.map((l) => (
                <div
                  key={l.id}
                  className="grid grid-cols-12 items-center gap-2 border-b border-slate-800/60 px-3 py-2 text-sm last:border-0"
                >
                  <div className="col-span-5 min-w-0">
                    {l.partId && partMap.get(l.partId) ? (
                      <Link
                        href={`/items/${l.partId}`}
                        className="font-mono text-teal-400 hover:underline"
                      >
                        {partMap.get(l.partId)}
                      </Link>
                    ) : null}
                    <p className="truncate text-xs text-slate-400">
                      {l.description}
                    </p>
                    {l.notes && (
                      <p className="truncate text-[11px] text-slate-600">
                        {l.notes}
                      </p>
                    )}
                  </div>
                  <div className="col-span-2 text-right tabular-nums">
                    {l.quantity}
                  </div>
                  <div className="col-span-1 text-xs text-slate-500">
                    {l.uom}
                  </div>
                  <div className="col-span-2 text-right tabular-nums text-slate-400">
                    {formatCurrency(l.estimatedUnitCost)}
                  </div>
                  <div className="col-span-2 text-right tabular-nums text-slate-200">
                    {formatCurrency(l.quantity * l.estimatedUnitCost)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card
            className={
              canDecide ? "border-amber-900/50" : "border-slate-800"
            }
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Approval chain</CardTitle>
              {pr.approvalPolicy && (
                <p className="text-xs text-slate-500">
                  Policy: {pr.approvalPolicy.name}
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {approvals.length === 0 && (
                <p className="text-sm text-slate-500">
                  No approval steps recorded.
                </p>
              )}
              {approvals.map((a) => (
                <div
                  key={a.id}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                    a.status === "PENDING" &&
                    a.stepOrder === pr.currentStepOrder
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-slate-800"
                  }`}
                >
                  {a.status === "APPROVED" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  ) : a.status === "REJECTED" ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  ) : (
                    <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                  )}
                  <div className="min-w-0">
                    <p className="text-slate-200">
                      {a.stepOrder}. {a.stage}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {a.policyStep?.approverRole
                        ? `Needs ${a.policyStep.approverRole}`
                        : "Any approver"}
                      {a.minAmount > 0 &&
                        ` · ≥ ${formatCurrency(a.minAmount)}`}
                      {a.approver && ` · ${a.approver.name}`}
                      {a.decidedAt && ` · ${formatDate(a.decidedAt)}`}
                    </p>
                    {a.comments && (
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        “{a.comments}”
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {isRequester && pr.status === "SUBMITTED" && (
                <p className="border-t border-slate-800 pt-3 text-[11px] text-slate-500">
                  You submitted this request — it must be approved by someone
                  else.
                </p>
              )}
              {canDecide && (
                <div className="space-y-2 border-t border-slate-800 pt-3">
                  <form action={actionApprovePr} className="space-y-2">
                    <input type="hidden" name="id" value={pr.id} />
                    <input type="hidden" name="decision" value="APPROVED" />
                    <Textarea
                      name="comments"
                      rows={2}
                      placeholder="Comment (optional)"
                    />
                    <Button type="submit" size="sm" className="w-full">
                      Approve — {currentStep?.stage || "current step"}
                    </Button>
                  </form>
                  <form action={actionApprovePr} className="space-y-2">
                    <input type="hidden" name="id" value={pr.id} />
                    <input type="hidden" name="decision" value="REJECTED" />
                    <Textarea
                      name="comments"
                      rows={2}
                      required
                      placeholder="Rejection reason (required)"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="w-full border-rose-900/50 text-rose-300 hover:border-rose-500/40"
                    >
                      Reject
                    </Button>
                  </form>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sources & results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {pr.materialRequisition && (
                <Link
                  href={`/planning/mrs/${pr.materialRequisition.id}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 hover:border-teal-500/30"
                >
                  <ClipboardList className="h-4 w-4 text-teal-400" />
                  <span>
                    MRS{" "}
                    <span className="font-mono text-teal-400">
                      {pr.materialRequisition.number}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {pr.materialRequisition.name || ""}
                    </span>
                  </span>
                </Link>
              )}
              {pr.workOrder && (
                <Link
                  href={`/work-orders/${pr.workOrder.id}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 hover:border-violet-500/30"
                >
                  <Factory className="h-4 w-4 text-violet-400" />
                  <span>
                    WO{" "}
                    <span className="font-mono text-violet-400">
                      {pr.workOrder.number}
                    </span>
                    <StatusBadge
                      status={pr.workOrder.status}
                      className="ml-2"
                    />
                  </span>
                </Link>
              )}
              {pr.workInstruction && (
                <Link
                  href={`/work-instructions/${pr.workInstruction.id}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 hover:border-sky-500/30"
                >
                  <FileText className="h-4 w-4 text-sky-400" />
                  <span>
                    WI{" "}
                    <span className="font-mono text-sky-400">
                      {pr.workInstruction.documentNumber}
                    </span>
                  </span>
                </Link>
              )}
              {pr.mrbCase && (
                <Link
                  href={`/mrb`}
                  className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 hover:border-rose-500/30"
                >
                  <FileText className="h-4 w-4 text-rose-400" />
                  <span>
                    MRB{" "}
                    <span className="font-mono text-rose-400">
                      {pr.mrbCase.number}
                    </span>
                  </span>
                </Link>
              )}
              {pr.project && (
                <p className="px-1 text-xs text-slate-500">
                  Program: {pr.project.number} — {pr.project.name}
                </p>
              )}
              {pr.supplier && (
                <p className="px-1 text-xs text-slate-500">
                  Suggested supplier:{" "}
                  <span className="text-slate-300">{pr.supplier.name}</span>
                </p>
              )}

              <div className="border-t border-slate-800 pt-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Purchase orders
                </p>
                {pr.purchaseOrders.length === 0 && (
                  <p className="text-xs text-slate-600">
                    None yet — created when the buyer converts this PR.
                  </p>
                )}
                {pr.purchaseOrders.map((po) => (
                  <Link
                    key={po.id}
                    href={`/purchasing/po/${po.id}`}
                    className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm hover:border-sky-500/30"
                  >
                    <span className="font-mono text-sky-400">{po.number}</span>
                    <span className="flex items-center gap-2 text-xs text-slate-500">
                      {formatCurrency(po.totalAmount)}
                      <StatusBadge status={po.status} />
                    </span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ActivityTimeline entityType="PurchaseRequest" entityId={pr.id} />
    </div>
  );
}
