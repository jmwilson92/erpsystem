import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { ConvertPrToPoButton } from "@/components/purchasing/convert-pr-button";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  actionApprovePr,
  actionAssignPrBuyer,
  actionAttachPrQuote,
  actionConfirmBuyerPackage,
  actionSaveBuyerPackage,
} from "@/app/actions";
import {
  approvalActionLabel,
  canUserApproveStep,
  getPrApprovals,
} from "@/lib/services/pr-approval";
import {
  getPrChargeSnapshot,
  isBuyerPackageComplete,
} from "@/lib/services/pr-buyer";
import { QuoteFileField } from "@/components/purchasing/quote-file-field";
import { RunningClock } from "@/components/purchasing/running-clock";
import { ChargeCodingFields } from "@/components/purchasing/charge-coding-fields";
import { ActivityTimeline } from "@/components/shared/activity-timeline";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  CircleDashed,
  FileText,
  Factory,
  ClipboardList,
  UserPlus,
  AlertTriangle,
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
        project: {
          select: {
            id: true,
            number: true,
            name: true,
            program: { select: { code: true, name: true } },
          },
        },
        wbsElement: { select: { id: true, code: true, name: true } },
        assignedBuyer: { select: { id: true, name: true, role: true } },
        assignedBy: { select: { id: true, name: true } },
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

  // The assigned buyer opening their PR IS starting work — scan them in.
  // claim:false so anyone else just viewing never lands on the clock.
  if (
    currentUser?.id &&
    pr.status === "SUBMITTED" &&
    pr.assignedBuyerId === currentUser.id &&
    !pr.buyerWorkStartedAt
  ) {
    const { ensureBuyerScanIn } = await import("@/lib/services/pr-buyer");
    await ensureBuyerScanIn({
      purchaseRequestId: pr.id,
      userId: currentUser.id,
      claim: false,
    });
    pr.buyerWorkStartedAt = new Date();
    pr.buyerWorkStartedById = currentUser.id;
  }

  const [
    approvals,
    requester,
    lineParts,
    charge,
    suppliers,
    projects,
    wbsElements,
    buyers,
    budgets,
  ] = await Promise.all([
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
    getPrChargeSnapshot(pr.id),
    prisma.supplier.findMany({
      where: { status: { in: ["APPROVED", "CONDITIONAL", "ACTIVE"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
      take: 200,
    }),
    prisma.project.findMany({
      where: { status: { in: ["ACTIVE", "PLANNING"] } },
      orderBy: { number: "asc" },
      select: { id: true, number: true, name: true },
      take: 100,
    }),
    prisma.wbsElement.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, projectId: true },
      take: 400,
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: { in: ["PURCHASING", "ADMIN", "EXECUTIVE"] } },
          // Anyone individually granted purchasing permissions can buy too
          {
            userPermissions: {
              some: {
                allowed: true,
                permission: { code: { startsWith: "purchasing." } },
              },
            },
          },
        ],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, title: true },
    }),
    prisma.budget.findMany({
      where: { status: "ENACTED" },
      orderBy: { number: "asc" },
      select: { id: true, number: true, name: true, chargeCode: true },
      take: 200,
    }),
  ]);


  const partMap = new Map(lineParts.map((p) => [p.id, p.partNumber]));

  const currentStep = approvals.find(
    (a) => a.stepOrder === pr.currentStepOrder && a.status === "PENDING"
  );
  const isBuyerStep = currentStep?.policyStep?.routingKey === "BUYER_PACKAGE";
  const roleOk = currentStep
    ? await canUserApproveStep({
        userId: currentUser?.id,
        userRole: currentUser?.role,
        approvalId: currentStep.id,
      })
    : false;
  const isRequester =
    !!currentUser?.id && currentUser.id === pr.requestedById;
  const canDecide =
    pr.status === "SUBMITTED" && !!currentStep && roleOk && !isRequester;

  // Purchasing owns the package. Threshold/escalation approvers (execs)
  // deliberately CANNOT edit — they approve or reject with a reason, and
  // the purchasing team makes any changes.
  const canBuyerEdit =
    pr.status === "SUBMITTED" &&
    !["CONVERTED", "CANCELLED", "REJECTED"].includes(pr.status) &&
    (!!currentUser &&
      (["ADMIN", "PURCHASING"].includes(currentUser.role) ||
        pr.assignedBuyerId === currentUser.id));

  const canAssign =
    !!currentUser &&
    ["ADMIN", "PURCHASING", "EXECUTIVE"].includes(currentUser.role);

  const packageGate = isBuyerPackageComplete({
    buyerConfirmedPrices: pr.buyerConfirmedPrices,
    quoteFileUrl: pr.quoteFileUrl,
    buyerNotes: pr.buyerNotes,
    soleSource: pr.soleSource,
    soleSourceJustification: pr.soleSourceJustification,
  });

  const waitingOn =
    currentStep && !canDecide && pr.status === "SUBMITTED"
      ? currentStep.approver
        ? currentStep.approver.name
        : isBuyerStep
          ? pr.assignedBuyer?.name || "PURCHASING buyer"
          : currentStep.policyStep?.approverRole || "an authorized approver"
      : null;

  const lineTotal = pr.lines.reduce(
    (s, l) => s + l.quantity * l.estimatedUnitCost,
    0
  );

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

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
            {pr.status === "APPROVED" &&
              currentUser &&
              ["ADMIN", "PURCHASING"].includes(currentUser.role) &&
              (pr.supplier &&
              pr.supplier.isApprovedVendor &&
              ["APPROVED", "CONDITIONAL"].includes(pr.supplier.status) ? (
                <ConvertPrToPoButton prId={pr.id} />
              ) : (
                <span className="self-center text-[11px] text-amber-400">
                  Vendor not on ASL — cannot convert to PO
                </span>
              ))}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={pr.status} />
        {pr.triggerSource && <StatusBadge status={pr.triggerSource} />}
        {pr.chargeType && <StatusBadge status={pr.chargeType} />}
        {pr.assignedBuyer ? (
          <span className="rounded-full border border-sky-800/50 bg-sky-500/10 px-2.5 py-0.5 text-[11px] text-sky-300">
            Buyer: {pr.assignedBuyer.name}
          </span>
        ) : canAssign ? (
          <a
            href="#assign-buyer"
            className="rounded-full border border-amber-700/50 bg-amber-500/10 px-2.5 py-0.5 text-[11px] text-amber-300 hover:border-amber-500"
          >
            No buyer assigned — assign ↓
          </a>
        ) : (
          <span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-[11px] text-slate-500">
            No buyer assigned
          </span>
        )}
        <span className="text-xs text-slate-500">
          Requested {formatDate(pr.createdAt)}
          {requester ? ` by ${requester.name}` : ""}
          {pr.neededBy ? ` · needed by ${formatDate(pr.neededBy)}` : ""}
        </span>
      </div>

      {/* Charge coding — accounting tie-in */}
      <Card
        className={
          charge?.accountingReady
            ? "border-slate-800"
            : "border-amber-900/50 bg-amber-500/5"
        }
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Charge coding (accounting)</CardTitle>
          <p className="text-xs text-slate-500">
            Verify this buy hits the right program / SO / direct-indirect bucket
            before purchase.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-slate-200">{charge?.summary || "—"}</p>
          <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
            {charge?.program && (
              <span className="rounded border border-slate-800 px-2 py-0.5">
                Program {charge.program.code}
              </span>
            )}
            {charge?.project && (
              <span className="rounded border border-slate-800 px-2 py-0.5">
                Project {charge.project.number}
              </span>
            )}
            {charge?.wbs && (
              <span className="rounded border border-slate-800 px-2 py-0.5">
                WBS {charge.wbs.code}
              </span>
            )}
            {charge?.salesOrderNumber && (
              <span className="rounded border border-slate-800 px-2 py-0.5">
                SO {charge.salesOrderNumber}
              </span>
            )}
            <span className="rounded border border-slate-800 px-2 py-0.5 font-mono text-teal-400">
              type: {charge?.chargeType || "—"}
            </span>
          </div>
          {!charge?.accountingReady && (
            <p className="flex items-start gap-1.5 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Charge not fully linked — set charge type / project / SO in the
              buyer workbench.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Assign buyer */}
      {canAssign && (
        <Card id="assign-buyer" className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-teal-400" />
              Assign buyer
            </CardTitle>
            <p className="text-xs text-slate-500">
              Purchasing lead assigns who packages this PR. Assignment is audited.
            </p>
          </CardHeader>
          <CardContent>
            <form action={actionAssignPrBuyer} className="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={pr.id} />
              <select
                name="buyerUserId"
                className={`${selectClass} max-w-sm`}
                defaultValue={pr.assignedBuyerId || ""}
              >
                <option value="">— Unassigned —</option>
                {buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {b.role}
                    {b.title ? ` · ${b.title}` : ""}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" variant="secondary">
                Save assignment
              </Button>
              {pr.assignedBy && pr.assignedAt && (
                <span className="self-center text-[11px] text-slate-600">
                  by {pr.assignedBy.name} · {formatDate(pr.assignedAt)}
                </span>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Buyer workbench — edit lines / package */}
          {canBuyerEdit ? (
            <Card
              className={
                isBuyerStep ? "border-sky-900/50" : "border-slate-800"
              }
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Buyer workbench
                  {isBuyerStep && (
                    <span className="ml-2 text-xs font-normal text-sky-400">
                      · your step — edit prices, charge, quote, then confirm
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={actionSaveBuyerPackage} className="space-y-5">
                  <input type="hidden" name="id" value={pr.id} />

                  <div className="overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="bg-slate-900/80 text-[10px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">
                            Item / description
                          </th>
                          <th className="w-24 px-2 py-2 text-right font-semibold">
                            Qty
                          </th>
                          <th className="w-28 px-2 py-2 text-right font-semibold">
                            Unit $
                          </th>
                          <th className="w-24 px-2 py-2 text-right font-semibold">
                            Ext.
                          </th>
                          <th className="w-40 px-2 py-2 text-left font-semibold">
                            Notes
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pr.lines.map((l) => (
                          <tr
                            key={l.id}
                            className="border-t border-slate-800/70 align-bottom"
                          >
                            <td className="px-3 py-2">
                              {l.partId && partMap.get(l.partId) && (
                                <Link
                                  href={`/items/${l.partId}`}
                                  className="mb-1 block font-mono text-xs text-teal-400 hover:underline"
                                >
                                  {partMap.get(l.partId)}
                                </Link>
                              )}
                              <Input
                                name={`desc_${l.id}`}
                                defaultValue={l.description}
                                className="h-9 w-full min-w-[12rem] text-xs"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                name={`qty_${l.id}`}
                                type="number"
                                step="any"
                                min={0}
                                defaultValue={l.quantity}
                                className="h-9 w-full text-right tabular-nums"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                name={`cost_${l.id}`}
                                type="number"
                                step="0.01"
                                min={0}
                                defaultValue={l.estimatedUnitCost}
                                className="h-9 w-full text-right tabular-nums"
                              />
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-slate-300">
                              {formatCurrency(l.quantity * l.estimatedUnitCost)}
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                name={`notes_${l.id}`}
                                defaultValue={l.notes || ""}
                                placeholder="Line note"
                                className="h-9 w-full text-xs"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-800 bg-slate-950/50">
                          <td
                            colSpan={3}
                            className="px-3 py-2 text-right text-xs text-slate-500"
                          >
                            Total est.
                          </td>
                          <td className="px-2 py-2 text-right font-medium tabular-nums text-slate-100">
                            {formatCurrency(lineTotal || pr.totalEstimate)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Preferred supplier
                      </label>
                      <select
                        name="supplierId"
                        className={selectClass}
                        defaultValue={pr.supplierId || ""}
                      >
                        <option value="">— None —</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.code})
                          </option>
                        ))}
                      </select>
                    </div>
                    <ChargeCodingFields
                      defaults={{
                        chargeType:
                          pr.chargeType || charge?.chargeType || "DIRECT",
                        projectId: pr.projectId || "",
                        wbsElementId: pr.wbsElementId || "",
                        budgetId: pr.budgetId || "",
                      }}
                      projects={projects}
                      wbsElements={wbsElements}
                      budgets={budgets}
                    />
                  </div>

                  <div className="space-y-2 rounded-lg border border-slate-800 p-3">
                    <label className="flex items-start gap-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        name="buyerConfirmedPrices"
                        defaultChecked={pr.buyerConfirmedPrices}
                        className="mt-0.5 rounded border-slate-600"
                      />
                      <span>
                        I verified unit prices / quantities against quote or
                        catalog
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        name="buyerConfirmedShip"
                        defaultChecked={pr.buyerConfirmedShip}
                        className="mt-0.5 rounded border-slate-600"
                      />
                      <span>Ship / lead-time terms reviewed</span>
                    </label>
                    <label className="flex items-start gap-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        name="soleSource"
                        defaultChecked={pr.soleSource}
                        className="mt-0.5 rounded border-slate-600"
                      />
                      <span>Sole source (requires justification)</span>
                    </label>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500">
                        Sole-source justification
                      </label>
                      <Textarea
                        name="soleSourceJustification"
                        rows={2}
                        className="mt-0.5"
                        defaultValue={pr.soleSourceJustification || ""}
                        placeholder="Why only this source…"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500">
                        Buyer notes
                      </label>
                      <Textarea
                        name="buyerNotes"
                        rows={2}
                        className="mt-0.5"
                        defaultValue={pr.buyerNotes || ""}
                        placeholder="Packaging notes, bid summary, exceptions…"
                      />
                    </div>
                  </div>

                  {!packageGate.ok && isBuyerStep && (
                    <p className="text-xs text-amber-200">
                      Still needed: {packageGate.missing.join("; ")}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="submit" size="sm" variant="secondary">
                      Save package
                    </Button>
                    {pr.buyerWorkStartedAt && (
                      <RunningClock
                        startedAt={pr.buyerWorkStartedAt}
                        label={
                          pr.buyerWorkStartedById === currentUser?.id
                            ? "You're on the clock"
                            : `${
                                buyers.find(
                                  (b) => b.id === pr.buyerWorkStartedById
                                )?.name || "Buyer"
                              } on the clock`
                        }
                      />
                    )}
                  </div>
                </form>

                {/* Separate form so Confirm always hits the server (no submit-button name bugs) */}
                {isBuyerStep && (
                  <form
                    action={actionConfirmBuyerPackage}
                    className="mt-3 space-y-2 rounded-lg border border-teal-900/40 bg-teal-500/5 p-3"
                  >
                    <input type="hidden" name="id" value={pr.id} />
                    <p className="text-xs text-slate-400">
                      Save any price/charge edits first. Then confirm to close
                      the buyer step and send this PR to the charge owner for
                      purchase approval.
                    </p>
                    {!packageGate.ok && (
                      <p className="text-xs text-amber-200">
                        Still needed before confirm:{" "}
                        {packageGate.missing.join("; ")}
                      </p>
                    )}
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!packageGate.ok}
                    >
                      Confirm package — send to owner
                    </Button>
                  </form>
                )}

                <div className="mt-4 border-t border-slate-800 pt-3">
                  <p className="mb-2 text-[10px] uppercase text-slate-500">
                    Supplier quote file
                  </p>
                  {pr.quoteFileUrl ? (
                    <a
                      href={pr.quoteFileUrl}
                      download={pr.quoteFileName || "quote"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mb-2 flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm hover:border-teal-500/30"
                    >
                      <FileText className="h-4 w-4 text-teal-400" />
                      <span className="truncate">{pr.quoteFileName || "Quote"}</span>
                    </a>
                  ) : (
                    <p className="mb-2 text-xs text-slate-500">No quote yet.</p>
                  )}
                  <QuoteFileField
                    action={actionAttachPrQuote}
                    prId={pr.id}
                    currentName={pr.quoteFileName}
                  />
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
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
          )}

          {/* Procurement package — visible to every viewer once data exists,
              so approvers and auditors see the quote + sole-source basis
              without digging through the activity log. */}
          {(pr.quoteFileUrl || pr.soleSource) && (
            <Card className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Procurement package</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    Supplier quote
                  </span>
                  {pr.quoteFileUrl ? (
                    <a
                      href={pr.quoteFileUrl}
                      download={pr.quoteFileName || "quote"}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-teal-400 hover:border-teal-600"
                    >
                      📎 {pr.quoteFileName || "Download quote"}
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">none attached</span>
                  )}
                </div>
                <div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    Sole source
                  </span>
                  {pr.soleSource ? (
                    <p className="mt-1 rounded-lg border border-amber-900/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
                      <span className="font-semibold text-amber-300">
                        Sole source procurement.
                      </span>{" "}
                      {pr.soleSourceJustification || "No justification recorded."}
                    </p>
                  ) : (
                    <span className="ml-2 text-xs text-slate-500">
                      no — competed / catalog buy
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card
            className={canDecide ? "border-amber-900/50" : "border-slate-800"}
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
                      {a.status === "PENDING"
                        ? a.approver
                          ? `Needs ${a.approver.name}`
                          : a.policyStep?.routingKey === "BUYER_PACKAGE"
                            ? "Buyer confirms package (not an approval)"
                            : "Waiting"
                        : a.approver
                          ? a.approver.name
                          : a.status}
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
                  You submitted this request — others must confirm / approve.
                </p>
              )}
              {waitingOn && !isRequester && (
                <p className="border-t border-slate-800 pt-3 text-[11px] text-amber-200/90">
                  Waiting on <strong>{waitingOn}</strong>
                  {currentStep ? ` for “${currentStep.stage}”` : ""}.
                </p>
              )}

              {/* Non-buyer steps: confirm/approve here; buyer uses workbench CTA */}
              {canDecide && !isBuyerStep && (
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
                      {approvalActionLabel(
                        currentStep?.policyStep?.routingKey,
                        currentStep?.stage
                      )}
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
              {canDecide && isBuyerStep && (
                <p className="border-t border-slate-800 pt-3 text-[11px] text-sky-300/90">
                  Use <strong>Buyer workbench</strong> above — save prices /
                  quote, then <strong>Confirm package — send to owner</strong>.
                </p>
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
                  </span>
                </Link>
              )}
              {pr.workOrder && (
                <Link
                  href={`/work-orders/${pr.workOrder.id}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 hover:border-teal-500/30"
                >
                  <Factory className="h-4 w-4 text-teal-400" />
                  <span className="font-mono text-teal-400">
                    {pr.workOrder.number}
                  </span>
                </Link>
              )}
              {pr.purchaseOrders.map((po) => (
                <Link
                  key={po.id}
                  href={`/purchasing/po/${po.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 hover:border-teal-500/30"
                >
                  <span className="font-mono text-teal-400">{po.number}</span>
                  <StatusBadge status={po.status} />
                </Link>
              ))}
              {!pr.materialRequisition &&
                !pr.workOrder &&
                pr.purchaseOrders.length === 0 && (
                  <p className="text-xs text-slate-500">No linked docs yet.</p>
                )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ActivityTimeline entityType="PurchaseRequest" entityId={id} />
    </div>
  );
}
