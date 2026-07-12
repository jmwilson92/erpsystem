import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CompanyLetterhead } from "@/components/sales/document-header";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  actionPlanSalesOrder,
  actionShipSalesOrder,
  actionQueueShipment,
  actionUpdateDepositStatus,
} from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SalesOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const so = await prisma.salesOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      quote: true,
      lines: { include: { part: true } },
      workOrders: {
        include: {
          part: true,
          kitOrders: true,
          purchaseRequests: true,
        },
        orderBy: { createdAt: "desc" },
      },
      shipments: { include: { lines: true }, orderBy: { createdAt: "desc" } },
      traceEvents: { orderBy: { createdAt: "desc" }, take: 40 },
    },
  });
  if (!so) notFound();

  const now = new Date();
  const gate = so.shipNotBefore || so.requiredDate;
  const depositShipBlock =
    so.depositRequired &&
    !["RECEIVED", "WAIVED"].includes((so.depositStatus || "").toUpperCase());
  const dateShipBlock = !so.allowEarlyShip && !!gate && now < gate;
  const shipBlocked = depositShipBlock || dateShipBlock;

  return (
    <div className="space-y-6">
      <PageHeader
        title={so.number}
        description={`${so.customer.name}${so.customerPo ? ` · PO ${so.customerPo}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/sales">
              <Button variant="outline" size="sm">
                All orders
              </Button>
            </Link>
            {!["SHIPPED", "CLOSED", "CANCELLED"].includes(so.status) && (
              <form action={actionPlanSalesOrder} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="salesOrderId" value={so.id} />
                <label className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900/80 px-2 py-1 text-[11px] text-slate-400">
                  <input
                    type="checkbox"
                    name="bypassStockCheck"
                    className="rounded border-slate-600"
                  />
                  Bypass stock — order full BOM / demand
                </label>
                <Button type="submit" size="sm" variant="secondary">
                  Plan fulfillment
                </Button>
              </form>
            )}
            {so.status === "READY_TO_SHIP" && (
              <>
                <form action={actionQueueShipment}>
                  <input type="hidden" name="salesOrderId" value={so.id} />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={depositShipBlock}
                  >
                    Queue shipment
                  </Button>
                </form>
                <form action={actionShipSalesOrder}>
                  <input type="hidden" name="salesOrderId" value={so.id} />
                  <Button type="submit" size="sm" disabled={!!shipBlocked}>
                    Ship now
                  </Button>
                </form>
                {/* Force only bypasses date gate — never deposit */}
                {dateShipBlock && !depositShipBlock && (
                  <form action={actionShipSalesOrder}>
                    <input type="hidden" name="salesOrderId" value={so.id} />
                    <input type="hidden" name="force" value="true" />
                    <Button type="submit" size="sm" variant="amber">
                      Force ship (early)
                    </Button>
                  </form>
                )}
              </>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={so.status} />
        {so.depositRequired && (
          <StatusBadge
            status={
              so.depositStatus === "RECEIVED" || so.depositStatus === "WAIVED"
                ? `DEPOSIT ${so.depositStatus}`
                : "DEPOSIT REQUIRED"
            }
            hint={`This order pushed ${so.customer.name} over their credit limit — a ${formatCurrency(so.depositAmount)} deposit gates shipment. Click for the customer's credit profile.`}
            href={`/customers/${so.customerId}`}
          />
        )}
        {so.creditHold && (
          <StatusBadge
            status="CREDIT_HOLD"
            hint={`${so.customer.name} exceeded their credit limit including this order — deposit ${so.depositStatus || "PENDING"}. Click for the customer's credit profile.`}
            href={`/customers/${so.customerId}`}
          />
        )}
        {so.isFob && (
          <span className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
            FOB {so.fobPoint || ""}
          </span>
        )}
        {so.quote && (
          <Link href={`/sales/quotes/${so.quote.id}`} className="text-xs text-sky-400 underline">
            from {so.quote.number}
          </Link>
        )}
        {depositShipBlock && (
          <span className="rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
            Shipping blocked until deposit
          </span>
        )}
        {dateShipBlock && (
          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
            Ship held until {formatDate(gate)}
          </span>
        )}
      </div>

      {so.depositRequired && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium text-amber-100">
                {depositShipBlock
                  ? "Deposit required — shipping is blocked"
                  : "Deposit requirement on this order"}
              </p>
              <p className="mt-1 text-xs text-amber-200/80">
                Deposit amount:{" "}
                <span className="font-semibold tabular-nums">
                  {formatCurrency(so.depositAmount)}
                </span>
                {" · "}
                Status: {so.depositStatus}
                {depositShipBlock
                  ? " · Cannot ship until received or waived (no force override)"
                  : ""}
              </p>
            </div>
            {so.depositStatus === "PENDING" && (
              <div className="flex flex-wrap gap-2">
                <form action={actionUpdateDepositStatus}>
                  <input type="hidden" name="salesOrderId" value={so.id} />
                  <input type="hidden" name="depositStatus" value="RECEIVED" />
                  <Button type="submit" size="sm">
                    Mark deposit received
                  </Button>
                </form>
                <form action={actionUpdateDepositStatus}>
                  <input type="hidden" name="salesOrderId" value={so.id} />
                  <input type="hidden" name="depositStatus" value="WAIVED" />
                  <Button type="submit" size="sm" variant="outline">
                    Waive deposit
                  </Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Document view */}
      <Card className="border-slate-700 bg-slate-950/80">
        <CardContent className="space-y-6 p-6 md:p-8">
          <CompanyLetterhead
            docTitle="Sales Order"
            docNumber={so.number}
            docDate={formatDate(so.orderDate)}
          />

          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-[10px] uppercase text-slate-500">Customer PO</p>
              <p className="font-mono text-slate-200">{so.customerPo || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Terms</p>
              <p className="text-slate-200">{so.paymentTerms}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Due date</p>
              <p className="text-slate-200">{formatDate(so.requiredDate)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Ship date</p>
              <p className="text-slate-200">{formatDate(so.shipDate)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">FOB</p>
              <p className="text-slate-200">
                {so.isFob ? so.fobPoint || "Yes" : "No"}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-800 p-4 text-sm">
              <p className="mb-2 text-[10px] font-semibold uppercase text-teal-500">Customer</p>
              <p className="font-medium text-slate-100">{so.customer.name}</p>
              <p className="text-xs text-slate-500">{so.customer.code}</p>
              {(so.contactName || so.customer.contactName) && (
                <p className="mt-2 text-xs text-slate-400">
                  {so.contactName || so.customer.contactName}
                </p>
              )}
              {(so.contactEmail || so.customer.contactEmail) && (
                <p className="text-xs text-slate-500">
                  {so.contactEmail || so.customer.contactEmail}
                </p>
              )}
            </div>
            <div className="rounded-lg border border-slate-800 p-4 text-sm">
              <p className="mb-2 text-[10px] font-semibold uppercase text-teal-500">Bill to</p>
              <p className="text-slate-200">{so.billToName || so.customer.name}</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-slate-400">
                {so.billToAddress || so.customer.billToAddress || "—"}
              </pre>
            </div>
            <div className="rounded-lg border border-slate-800 p-4 text-sm">
              <p className="mb-2 text-[10px] font-semibold uppercase text-teal-500">Ship to</p>
              <p className="text-slate-200">{so.shipToName || so.customer.name}</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-slate-400">
                {so.shipToAddress || so.customer.shipToAddress || "—"}
              </pre>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs uppercase text-slate-500">
                <th className="pb-2">Part</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Alloc</th>
                <th className="pb-2 text-right">Ship</th>
                <th className="pb-2 text-right">Unit</th>
                <th className="pb-2 text-right">Ext</th>
                <th className="pb-2">Fulfillment</th>
              </tr>
            </thead>
            <tbody>
              {so.lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-800/60">
                  <td className="py-2">
                    <span className="font-mono text-teal-400">
                      {l.part?.partNumber || "—"}
                    </span>
                    <p className="text-xs text-slate-500">{l.description}</p>
                  </td>
                  <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2 text-right tabular-nums">{l.quantityAllocated}</td>
                  <td className="py-2 text-right tabular-nums">{l.quantityShipped}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(l.unitPrice)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(l.quantity * l.unitPrice)}
                  </td>
                  <td className="py-2">
                    <StatusBadge status={l.fulfillmentStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="pt-4 text-right text-sm text-slate-400">
                  Total
                </td>
                <td className="pt-4 text-right text-lg font-semibold tabular-nums">
                  {formatCurrency(so.totalAmount)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Linked work orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {so.workOrders.length === 0 && (
              <p className="text-sm text-slate-500">
                No WOs yet — plan fulfillment if stock is short.
              </p>
            )}
            {so.workOrders.map((wo) => (
              <div
                key={wo.id}
                className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/work-orders/${wo.id}`}
                    className="font-mono text-teal-400 hover:underline"
                  >
                    {wo.number}
                  </Link>
                  <StatusBadge status={wo.status} />
                  <StatusBadge status={wo.kitStatus} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Qty {wo.quantity} · Due {formatDate(wo.dueDate)}
                </p>
                {wo.purchaseRequests.length > 0 && (
                  <p className="mt-1 text-xs text-amber-400/90">
                    PRs:{" "}
                    {wo.purchaseRequests.map((pr) => (
                      <Link key={pr.id} href="/purchasing" className="mr-2 underline">
                        {pr.number} ({pr.status})
                      </Link>
                    ))}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shipments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {so.shipments.length === 0 && (
              <p className="text-sm text-slate-500">No shipments yet.</p>
            )}
            {so.shipments.map((s) => (
              <div
                key={s.id}
                className="flex items-start justify-between rounded border border-slate-800 p-3"
              >
                <div>
                  <span className="font-mono text-sky-400">{s.number}</span>
                  <StatusBadge status={s.status} className="ml-2" />
                  <p className="text-xs text-slate-500">
                    {s.carrier || "Carrier TBD"}
                    {s.trackingNumber ? ` · ${s.trackingNumber}` : ""}
                  </p>
                </div>
                <p className="text-xs text-slate-500">{formatDate(s.shipDate)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Traceability timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {so.traceEvents.map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-500" />
                <div>
                  <p className="text-slate-300">
                    <span className="font-mono text-xs text-teal-400">{e.eventType}</span>
                    {e.notes ? ` — ${e.notes}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(e.createdAt, "MMM d, yyyy HH:mm")}
                  </p>
                </div>
              </li>
            ))}
            {so.traceEvents.length === 0 && (
              <p className="text-sm text-slate-500">No trace events yet.</p>
            )}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
