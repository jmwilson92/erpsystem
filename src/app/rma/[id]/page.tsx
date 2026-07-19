import Link from "next/link";
import { notFound } from "next/navigation";
import { getRmaDetail } from "@/lib/services/rma";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import {
  actionIssueRma,
  actionAcceptRepairQuote,
  actionAdjustRmaQuotePrice,
  actionCreateRepairQuoteForRma,
  actionUpdateRepairQuote,
} from "@/app/actions";
import { ActionLoadingForm } from "@/components/layout/action-loading";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function RmaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rma = await getRmaDetail(id);
  if (!rma) notFound();

  const serialInRegistry = Boolean(rma.topSerialId);
  const canIssue = ["REQUESTED", "EVALUATING", "QUOTE_PENDING"].includes(
    rma.status
  );
  const canAcceptQuote =
    rma.quote &&
    ["DRAFT", "SENT", "QUOTE_PENDING", "ACCEPTED"].includes(rma.quote.status) &&
    !rma.workOrders.some((w) => !["CANCELLED", "CLOSED"].includes(w.status));
  const canEditQuote =
    rma.quote &&
    !["SHIPPED", "CANCELLED", "COMPLETE"].includes(rma.status) &&
    rma.quote.status !== "CONVERTED";
  const canAdjust =
    rma.quote && !["SHIPPED", "CANCELLED"].includes(rma.status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={rma.number}
        description={`${rma.customer.code} · ${rma.customer.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/print/rma-packing-list/${rma.id}`} target="_blank">
              <Button size="sm" variant="secondary">
                Customer packing list
              </Button>
            </Link>
            {rma.topSerial && (
              <Link
                href={`/trace/serials/${encodeURIComponent(rma.topSerial.serial)}`}
              >
                <Button size="sm" variant="outline">
                  As-built tree
                </Button>
              </Link>
            )}
            <Link href="/rma">
              <Button size="sm" variant="ghost">
                All RMAs
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={rma.status} />
        <StatusBadge status={rma.coverage} />
      </div>

      {!serialInRegistry && (
        <div className="rounded-md border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          <p className="font-medium">Serial not in registry</p>
          <p className="mt-1 text-xs text-amber-200/80">
            Customer reported SN{" "}
            <span className="font-mono">{rma.customerSn}</span> was not found
            when this RMA was opened. Verify the physical unit before issuing
            warranty coverage. You can still send the packing list so the
            customer can ship it in.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Return unit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-slate-500">Serial: </span>
              <span className="font-mono text-teal-400">{rma.customerSn}</span>
              {!serialInRegistry && (
                <span className="ml-2 text-[10px] uppercase text-amber-400">
                  unregistered
                </span>
              )}
            </p>
            <p>
              <span className="text-slate-500">Part: </span>
              {rma.topPart.partNumber} · {rma.topPart.description}
            </p>
            {rma.customerPartNumber &&
              rma.customerPartNumber !== rma.topPart.partNumber && (
                <p className="text-xs text-slate-500">
                  Customer wrote PN: {rma.customerPartNumber}
                </p>
              )}
            <p className="text-xs text-slate-400">
              Warranty: {rma.warrantyEligible ? "Eligible" : "Not eligible"} —{" "}
              {rma.warrantyReason}
            </p>
            {rma.symptom && (
              <p className="rounded border border-slate-800 bg-slate-950/40 p-2 text-slate-300">
                {rma.symptom}
              </p>
            )}
            {rma.notes && (
              <pre className="whitespace-pre-wrap text-[11px] text-slate-500">
                {rma.notes}
              </pre>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pricing & packing list</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm tabular-nums">
            <p>Quoted: {formatCurrency(rma.quotedPrice)}</p>
            <p>Final: {formatCurrency(rma.finalPrice)}</p>
            <p className="text-xs text-slate-500">
              Actual cost (tracked): {formatCurrency(rma.actualCost)}
            </p>
            {rma.priceAdjustmentNotes && (
              <pre className="mt-2 whitespace-pre-wrap text-[11px] text-slate-500">
                {rma.priceAdjustmentNotes}
              </pre>
            )}
            <div className="border-t border-slate-800 pt-3">
              <p className="text-xs text-slate-400">
                Send this to the customer so they can ship the unit back with
                the RMA number on the carton.
              </p>
              <Link
                href={`/print/rma-packing-list/${rma.id}`}
                target="_blank"
                className="mt-2 inline-block"
              >
                <Button size="sm" variant="secondary">
                  Open / print packing list
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {canIssue && (
        <Card className="border-teal-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Issue RMA</CardTitle>
            <p className="text-xs text-slate-500">
              <strong className="text-slate-400">Warranty / Goodwill</strong>{" "}
              creates a repair work order immediately (no quote).{" "}
              <strong className="text-slate-400">Chargeable</strong> creates a
              repair quote first; edit lines → accept → WO (skips sales order).
            </p>
          </CardHeader>
          <CardContent>
            <ActionLoadingForm
              theme="planning"
              action={actionIssueRma}
              className="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="rmaId" value={rma.id} />
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Coverage
                </label>
                <select
                  name="coverage"
                  className={`${selectClass} mt-1`}
                  defaultValue={
                    rma.warrantyEligible ? "WARRANTY" : "CHARGEABLE"
                  }
                >
                  <option value="WARRANTY">Warranty → repair WO</option>
                  <option value="GOODWILL">Goodwill → repair WO</option>
                  <option value="CHARGEABLE">Chargeable → repair quote</option>
                  <option value="MIXED">Mixed</option>
                </select>
              </div>
              <div className="min-w-[200px] flex-1">
                <label className="text-[10px] uppercase text-slate-500">
                  Notes
                </label>
                <Input name="notes" className="mt-1" />
              </div>
              <Button type="submit" size="sm">
                Issue
              </Button>
            </ActionLoadingForm>
          </CardContent>
        </Card>
      )}

      {rma.quote && (
        <Card className="border-violet-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Repair quote{" "}
              <Link
                href={`/sales/quotes/${rma.quote.id}`}
                className="font-mono text-violet-300 hover:underline"
              >
                {rma.quote.number}
              </Link>
            </CardTitle>
            <p className="text-xs text-slate-500">
              Edit labor, evaluation, and parts lines. Totals update
              automatically. Accept only when the customer has agreed.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {canEditQuote ? (
              <ActionLoadingForm
                action={actionUpdateRepairQuote}
                className="space-y-3"
              >
                <input type="hidden" name="rmaId" value={rma.id} />
                <input
                  type="hidden"
                  name="lineCount"
                  value={rma.quote.lines.length}
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
                        <th className="py-1 pr-2">Description</th>
                        <th className="w-20 py-1 pr-2">Qty</th>
                        <th className="w-28 py-1 pr-2">Unit $</th>
                        <th className="w-24 py-1 text-right">Ext</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rma.quote.lines.map((l, i) => (
                        <tr key={l.id} className="border-b border-slate-900">
                          <td className="py-1.5 pr-2">
                            <Input
                              name={`desc_${i}`}
                              defaultValue={l.description}
                              className="h-8 text-sm"
                              required
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <Input
                              name={`qty_${i}`}
                              type="number"
                              step="0.01"
                              min={0}
                              defaultValue={l.quantity}
                              className="h-8 w-20 text-sm tabular-nums"
                              required
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <Input
                              name={`price_${i}`}
                              type="number"
                              step="0.01"
                              min={0}
                              defaultValue={l.unitPrice}
                              className="h-8 w-28 text-sm tabular-nums"
                              required
                            />
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-slate-400">
                            {formatCurrency(l.quantity * l.unitPrice)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rounded border border-dashed border-slate-700 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase text-slate-500">
                    Add line (optional)
                  </p>
                  <div className="grid gap-2 sm:grid-cols-[1fr_5rem_7rem]">
                    <Input
                      name="add_desc"
                      placeholder="e.g. Labor — board rework"
                      className="h-8 text-sm"
                    />
                    <Input
                      name="add_qty"
                      type="number"
                      step="0.01"
                      min={0}
                      defaultValue={1}
                      className="h-8 text-sm tabular-nums"
                    />
                    <Input
                      name="add_price"
                      type="number"
                      step="0.01"
                      min={0}
                      defaultValue={0}
                      placeholder="Unit $"
                      className="h-8 text-sm tabular-nums"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Quote notes
                  </label>
                  <Textarea
                    name="quoteNotes"
                    rows={2}
                    className="mt-1"
                    defaultValue={rma.quote.notes || ""}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    Total {formatCurrency(rma.quote.totalAmount)} ·{" "}
                    <StatusBadge status={rma.quote.status} />
                  </p>
                  <Button type="submit" size="sm" variant="secondary">
                    Save quote lines
                  </Button>
                </div>
              </ActionLoadingForm>
            ) : (
              <>
                <ul className="text-sm text-slate-300">
                  {rma.quote.lines.map((l) => (
                    <li key={l.id}>
                      {l.description} — {l.quantity} ×{" "}
                      {formatCurrency(l.unitPrice)}
                    </li>
                  ))}
                </ul>
                <p className="text-sm font-medium">
                  Total {formatCurrency(rma.quote.totalAmount)} ·{" "}
                  <StatusBadge status={rma.quote.status} />
                </p>
              </>
            )}

            {canAcceptQuote && (
              <ActionLoadingForm action={actionAcceptRepairQuote}>
                <input type="hidden" name="quoteId" value={rma.quote.id} />
                <Button type="submit" size="sm">
                  Accept quote → create repair WO
                </Button>
              </ActionLoadingForm>
            )}
            {canAdjust && (
              <ActionLoadingForm
                action={actionAdjustRmaQuotePrice}
                className="flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3"
              >
                <input type="hidden" name="rmaId" value={rma.id} />
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    New total
                  </label>
                  <Input
                    name="newTotal"
                    type="number"
                    step="0.01"
                    min={0}
                    required
                    className="mt-1 w-32"
                    defaultValue={rma.quotedPrice}
                  />
                </div>
                <div className="min-w-[180px] flex-1">
                  <label className="text-[10px] uppercase text-slate-500">
                    Reason
                  </label>
                  <Input name="reason" required className="mt-1" />
                </div>
                <Button type="submit" size="sm" variant="outline">
                  Quick adjust total
                </Button>
              </ActionLoadingForm>
            )}
          </CardContent>
        </Card>
      )}

      {rma.status === "QUOTE_PENDING" && !rma.quote && (
        <ActionLoadingForm action={actionCreateRepairQuoteForRma}>
          <input type="hidden" name="rmaId" value={rma.id} />
          <Button type="submit" size="sm" variant="secondary">
            Create repair quote shell
          </Button>
        </ActionLoadingForm>
      )}

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Repair work orders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rma.workOrders.map((w) => (
            <Link
              key={w.id}
              href={`/work-orders/${w.id}`}
              className="flex items-center gap-2 text-sm text-sky-400 hover:underline"
            >
              <span className="font-mono">{w.number}</span>
              <StatusBadge status={w.status} />
            </Link>
          ))}
          {!rma.workOrders.length && (
            <p className="text-sm text-slate-500">
              No WO yet — issue as warranty or accept chargeable quote
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">MRB cases (torn-down parts)</CardTitle>
          <p className="text-xs text-slate-500">
            Failed serialized components go to MRB — scrap (order/pull
            replacement) or repair/rework (return to this RMA when done)
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {rma.mrbCases.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span className="font-mono text-amber-300">{m.number}</span>
              <StatusBadge status={m.status} />
              <Link
                href="/mrb?view=mrb&filter=open"
                className="text-xs text-sky-400 hover:underline"
              >
                Open on MRB board
              </Link>
            </div>
          ))}
          {!rma.mrbCases.length && (
            <p className="text-sm text-slate-500">
              No MRB yet — remove a serialized component on the repair WO with
              quarantine to open one
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Install / remove log (as-built changes)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          {rma.serialInstalls.map((i) => (
            <div key={i.id} className="flex flex-wrap gap-2 text-slate-400">
              <StatusBadge status={i.status} />
              <span className="font-mono text-teal-400">
                {i.childSerial?.serial || i.childLotNumber || "—"}
              </span>
              <span>{i.childPart.partNumber}</span>
              <span>← {i.parentSerial.serial}</span>
            </div>
          ))}
          {!rma.serialInstalls.length && (
            <p className="text-slate-500">
              Tear-down and rebuild on the repair WO traveler (as-built panel)
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
