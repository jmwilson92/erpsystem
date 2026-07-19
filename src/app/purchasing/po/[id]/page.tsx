import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CompanyLetterhead } from "@/components/sales/document-header";
import { PoPdfActions } from "@/components/purchasing/po-pdf-button";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  actionClosePurchaseOrder,
  actionAmendPo,
  actionDecidePoAmendment,
} from "@/app/actions";
import { getCurrentUser } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import type { PurchaseOrderPdfData } from "@/lib/pdf";
import { ActivityTimeline } from "@/components/shared/activity-timeline";
import { EmailComposeCard } from "@/components/shared/email-compose-card";
import { composePoEmail } from "@/lib/services/email";

export const dynamic = "force-dynamic";

export default async function PoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      lines: { include: { part: true }, orderBy: { lineNumber: "asc" } },
      project: true,
      wbsElement: true,
      purchaseRequest: true,
      receivingTravelers: { orderBy: { createdAt: "desc" } },
      receipts: { orderBy: { receivedAt: "desc" }, take: 5 },
    },
  });
  if (!po) notFound();

  const emailDraft = await composePoEmail(po.id);
  const currentUser = await getCurrentUser();
  const canAmend =
    !!currentUser &&
    ["ADMIN", "PURCHASING"].includes(currentUser.role) &&
    !["CLOSED", "CANCELLED"].includes(po.status);
  const amendApprovals =
    po.status === "PENDING_REAPPROVAL"
      ? await prisma.approval.findMany({
          where: { entityType: "PurchaseOrder", entityId: po.id },
          include: { approver: { select: { id: true, name: true } } },
          orderBy: { stepOrder: "asc" },
        })
      : [];
  const currentAmendStep = amendApprovals.find((a) => a.status === "PENDING");
  const amendRejected =
    po.status === "PENDING_REAPPROVAL" &&
    !currentAmendStep &&
    amendApprovals.some((a) => a.status === "REJECTED");
  const canDecideAmend =
    !!currentUser &&
    !!currentAmendStep &&
    (currentAmendStep.approverId === currentUser.id ||
      currentUser.role === "ADMIN" ||
      (!currentAmendStep.approverId &&
        ["EXECUTIVE", "ACCOUNTING"].includes(currentUser.role)));
  const buyer = po.buyerId
    ? await prisma.user.findUnique({ where: { id: po.buyerId } })
    : null;

  const pdfData: PurchaseOrderPdfData = {
    number: po.number,
    orderDate: formatDate(po.orderDate),
    promisedDate: formatDate(po.promisedDate),
    paymentTerms: po.paymentTerms,
    currency: po.currency,
    notes: po.notes || undefined,
    clin: po.clin || undefined,
    projectLabel: po.project ? `${po.project.number} — ${po.project.name}` : undefined,
    wbsLabel: po.wbsElement
      ? `${po.wbsElement.code} — ${po.wbsElement.name}`
      : undefined,
    supplier: {
      name: po.supplier.name,
      code: po.supplier.code,
      address: po.supplier.address || undefined,
      contactName: po.supplier.contactName || undefined,
      contactEmail: po.supplier.contactEmail || undefined,
    },
    shipTo: po.shipToAddress || undefined,
    buyerName: buyer?.name,
    lines: po.lines.map((l) => ({
      lineNumber: l.lineNumber,
      partNumber: l.part?.partNumber,
      description: l.description,
      quantity: l.quantity,
      uom: l.uom,
      unitCost: l.unitCost,
      promisedDate: formatDate(l.promisedDate),
    })),
  };

  const traveler = po.receivingTravelers[0];
  const allLinesReceived =
    po.lines.length > 0 &&
    po.lines.every((l) => l.quantityReceived >= l.quantity);
  const canClosePo =
    allLinesReceived &&
    !["CLOSED", "CANCELLED"].includes(po.status) &&
    ["RECEIVED", "PARTIAL_RECEIPT", "INVOICED", "ISSUED", "ACKNOWLEDGED"].includes(
      po.status
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={po.number}
        description={`${po.supplier.name} · ${formatCurrency(po.totalAmount)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/purchasing">
              <Button variant="outline" size="sm">
                All POs
              </Button>
            </Link>
            {traveler && (
              <Link href={`/receiving/${traveler.id}`}>
                <Button
                  size="sm"
                  variant={
                    ["IN_INSPECTION", "READY_TO_STOCK", "WAITING", "PARTIAL"].includes(
                      traveler.status
                    )
                      ? "default"
                      : "secondary"
                  }
                >
                  {traveler.status === "READY_TO_STOCK"
                    ? `Put away ${traveler.number}`
                    : traveler.status === "IN_INSPECTION"
                      ? `Finish receiving ${traveler.number}`
                      : ["WAITING", "PARTIAL"].includes(traveler.status)
                        ? `Receive ${traveler.number}`
                        : `Receiving ${traveler.number}`}
                </Button>
              </Link>
            )}
            {canClosePo && (
              <form action={actionClosePurchaseOrder}>
                <input type="hidden" name="purchaseOrderId" value={po.id} />
                <Button type="submit" size="sm">
                  Close PO
                </Button>
              </form>
            )}
            <Link href={`/print/po/${po.id}`}>
              <Button size="sm" variant="outline">
                Print view
              </Button>
            </Link>
            <PoPdfActions data={pdfData} />
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={po.status} />
        {po.purchaseRequest && (
          <span className="text-xs text-slate-500">from {po.purchaseRequest.number}</span>
        )}
      </div>

      {po.status === "PENDING_REAPPROVAL" && (
        <Card className="border-amber-900/50 bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-200">
              {amendRejected
                ? "Amendment rejected — revise and resubmit"
                : "Amended — awaiting re-approval"}
            </CardTitle>
            <p className="text-xs text-amber-200/70">
              Receiving is blocked until every approver signs off on the
              amended PO.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1 text-xs">
              {amendApprovals.map((a) => (
                <p key={a.id} className="flex items-center gap-2">
                  <span
                    className={
                      a.status === "APPROVED"
                        ? "text-emerald-400"
                        : a.status === "REJECTED"
                          ? "text-rose-400"
                          : "text-slate-400"
                    }
                  >
                    {a.status === "APPROVED"
                      ? "✓"
                      : a.status === "REJECTED"
                        ? "✕"
                        : "○"}
                  </span>
                  <span className="text-slate-300">{a.stage}</span>
                  {a.approver && (
                    <span className="text-slate-500">· {a.approver.name}</span>
                  )}
                  {a.comments && (
                    <span className="text-rose-300/90">— {a.comments}</span>
                  )}
                </p>
              ))}
            </div>
            {canDecideAmend && (
              <div className="grid gap-2 sm:grid-cols-2">
                <form action={actionDecidePoAmendment}>
                  <input type="hidden" name="poId" value={po.id} />
                  <input type="hidden" name="decision" value="APPROVED" />
                  <Button type="submit" size="sm" className="w-full">
                    Approve amendment
                  </Button>
                </form>
                <form action={actionDecidePoAmendment} className="space-y-2">
                  <input type="hidden" name="poId" value={po.id} />
                  <input type="hidden" name="decision" value="REJECTED" />
                  <Textarea
                    name="comments"
                    rows={1}
                    required
                    placeholder="Rejection reason (required)"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    className="w-full border-rose-900/50 text-rose-300"
                  >
                    Reject
                  </Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canAmend && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Amend PO</CardTitle>
            <p className="text-xs text-slate-500">
              Purchasing edits only. Saving an amendment holds the PO from
              receiving and sends it back through the same round of approvers.
            </p>
          </CardHeader>
          <CardContent>
            <form action={actionAmendPo} className="space-y-3">
              <input type="hidden" name="poId" value={po.id} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase text-slate-500">
                      <th className="pb-1">Line</th>
                      <th className="pb-1 text-right">Qty</th>
                      <th className="pb-1 pl-4 text-right">Unit cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.lines.map((l) => (
                      <tr key={l.id} className="border-t border-slate-800/60">
                        <td className="py-1.5 pr-3 text-xs">
                          <span className="font-mono text-teal-400">
                            {l.part?.partNumber || "—"}
                          </span>
                          <span className="ml-2 text-slate-500">
                            {l.description}
                          </span>
                        </td>
                        <td className="py-1.5 text-right">
                          <Input
                            name={`qty_${l.id}`}
                            type="number"
                            min="0.01"
                            step="any"
                            defaultValue={l.quantity}
                            className="ml-auto h-8 w-24 text-right"
                          />
                        </td>
                        <td className="py-1.5 pl-4 text-right">
                          <Input
                            name={`cost_${l.id}`}
                            type="number"
                            min="0"
                            step="any"
                            defaultValue={l.unitCost}
                            className="ml-auto h-8 w-28 text-right"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-400">
                  Promised date (EDD)
                  <Input
                    name="promisedDate"
                    type="date"
                    defaultValue={
                      po.promisedDate
                        ? po.promisedDate.toISOString().slice(0, 10)
                        : ""
                    }
                    className="mt-1 h-9"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Notes
                  <Input
                    name="notes"
                    defaultValue={po.notes || ""}
                    className="mt-1 h-9"
                  />
                </label>
              </div>
              <Button type="submit" size="sm" variant="secondary">
                Save amendment → re-approval
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Printable document body */}
      <Card className="border-slate-700 bg-slate-950/80 print:border-0 print:bg-white print:shadow-none">
        <CardContent className="space-y-6 p-6 md:p-10">
          <CompanyLetterhead
            docTitle="Purchase Order"
            docNumber={po.number}
            docDate={formatDate(po.orderDate)}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-800 p-4 text-sm">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-teal-500">
                Vendor
              </p>
              <p className="font-medium text-slate-100">{po.supplier.name}</p>
              <p className="font-mono text-xs text-slate-500">{po.supplier.code}</p>
              {po.supplier.address && (
                <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-slate-400">
                  {po.supplier.address}
                </pre>
              )}
              {(po.supplier.contactName || po.supplier.contactEmail) && (
                <p className="mt-2 text-xs text-slate-400">
                  {[po.supplier.contactName, po.supplier.contactEmail]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
            <div className="rounded-lg border border-slate-800 p-4 text-sm">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-teal-500">
                Ship to
              </p>
              <pre className="whitespace-pre-wrap font-sans text-xs text-slate-300">
                {po.shipToAddress ||
                  "Forge Dynamics LLC\nReceiving Dock\n1200 Precision Way\nHuntsville, AL 35806"}
              </pre>
            </div>
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase text-slate-500">PO date</p>
              <p className="text-slate-200">{formatDate(po.orderDate)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">EDD / promise</p>
              <p className="text-slate-200">{formatDate(po.promisedDate)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Terms</p>
              <p className="text-slate-200">{po.paymentTerms}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Buyer</p>
              <p className="text-slate-200">{buyer?.name || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Project</p>
              <p className="font-mono text-xs text-slate-200">
                {po.project ? `${po.project.number}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">WBS</p>
              <p className="font-mono text-xs text-slate-200">
                {po.wbsElement?.code || "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">CLIN</p>
              <p className="font-mono text-xs text-slate-200">{po.clin || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Currency</p>
              <p className="text-slate-200">{po.currency}</p>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-[10px] uppercase text-slate-500">
                <th className="pb-2">#</th>
                <th className="pb-2">Part / description</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 pl-4">UOM</th>
                <th className="pb-2 text-right">Unit</th>
                <th className="pb-2 text-right">Ext</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-800/60">
                  <td className="py-2.5 text-slate-500">{l.lineNumber}</td>
                  <td className="py-2.5">
                    <span className="font-mono text-teal-400">
                      {l.part?.partNumber || "—"}
                    </span>
                    <span className="ml-2 text-slate-400">{l.description}</span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2.5 pl-4 text-slate-500">{l.uom}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    {formatCurrency(l.unitCost)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {formatCurrency(l.quantity * l.unitCost)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="pt-4 text-right text-sm font-medium text-slate-400">
                  Total
                </td>
                <td className="pt-4 text-right text-lg font-semibold tabular-nums text-slate-50">
                  {formatCurrency(po.totalAmount)}
                </td>
              </tr>
            </tfoot>
          </table>

          {po.notes && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-400">
              <p className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                Notes
              </p>
              {po.notes}
            </div>
          )}

          <p className="text-[11px] text-slate-600">
            Please acknowledge this purchase order and confirm the delivery date. Receiving is
            performed against traveler{" "}
            {traveler ? (
              <Link href={`/receiving/${traveler.id}`} className="text-sky-400">
                {traveler.number}
              </Link>
            ) : (
              "(pending)"
            )}
            . Closing the PO is a purchasing action and is done from this page, not the
            receiving dock.
          </p>
        </CardContent>
      </Card>

      {(() => {
        const quoteUrl = po.quoteFileUrl || po.purchaseRequest?.quoteFileUrl;
        const quoteName =
          po.quoteFileName || po.purchaseRequest?.quoteFileName || "Quote file";
        if (!quoteUrl) return null;
        return (
          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Supplier quote
              </p>
              <a
                href={quoteUrl}
                download={quoteName}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm hover:border-teal-500/30"
              >
                <span className="truncate text-slate-200">{quoteName}</span>
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  Open
                </span>
              </a>
              {!po.quoteFileUrl && po.purchaseRequest?.quoteFileUrl && (
                <p className="text-[11px] text-slate-600">
                  Carried from {po.purchaseRequest.number}.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {po.receivingTravelers.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Receiving travelers
            </p>
            {po.receivingTravelers.map((t) => (
              <Link
                key={t.id}
                href={`/receiving/${t.id}`}
                className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm hover:border-teal-700"
              >
                <span className="font-mono text-teal-400">{t.number}</span>
                <StatusBadge status={t.status} />
              </Link>
            ))}
            {canClosePo && (
              <p className="pt-1 text-xs text-emerald-400/90">
                All lines fully received — you can close this PO when purchasing is done
                (invoice match, etc.).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <EmailComposeCard
        draft={emailDraft}
        returnTo={`/purchasing/po/${id}`}
        title="Email PO to supplier"
      />

      <ActivityTimeline entityType="PurchaseOrder" entityId={id} />
    </div>
  );
}
