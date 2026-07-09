import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { actionShipSalesOrder, actionQueueShipment } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ShippingPage() {
  const [shipments, readyOrders] = await Promise.all([
    prisma.shipment.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        salesOrder: { include: { customer: true } },
        lines: true,
      },
    }),
    prisma.salesOrder.findMany({
      where: { status: { in: ["READY_TO_SHIP", "IN_PRODUCTION"] } },
      orderBy: { requiredDate: "asc" },
      include: { customer: true, lines: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipping"
        description="Pull ready sales orders after FG stock — respects early-ship gates"
      />

      {readyOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ready / in production (pull queue)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {readyOrders.map((so) => {
              const gate = so.shipNotBefore || so.requiredDate;
              const blocked =
                !so.allowEarlyShip && gate && new Date() < gate && so.status === "READY_TO_SHIP";
              return (
                <div
                  key={so.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 p-3"
                >
                  <div>
                    <Link href={`/sales/${so.id}`} className="font-mono text-sky-400">
                      {so.number}
                    </Link>
                    <StatusBadge status={so.status} className="ml-2" />
                    <p className="text-sm text-slate-300">{so.customer.name}</p>
                    <p className="text-xs text-slate-500">
                      Required {formatDate(so.requiredDate)} ·{" "}
                      {formatCurrency(so.totalAmount)}
                      {blocked
                        ? ` · Held until ${formatDate(gate)}`
                        : so.allowEarlyShip
                          ? " · Early ship OK"
                          : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <form action={actionQueueShipment}>
                      <input type="hidden" name="salesOrderId" value={so.id} />
                      <Button type="submit" size="sm" variant="outline">
                        Queue
                      </Button>
                    </form>
                    {so.status === "READY_TO_SHIP" && (
                      <form action={actionShipSalesOrder}>
                        <input type="hidden" name="salesOrderId" value={so.id} />
                        {blocked && <input type="hidden" name="force" value="true" />}
                        <Button type="submit" size="sm" variant={blocked ? "amber" : "default"}>
                          {blocked ? "Force ship" : "Ship"}
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Shipments
        </h2>
        {shipments.map((s) => (
          <Card key={s.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="font-mono text-teal-400">{s.number}</CardTitle>
                <StatusBadge status={s.status} />
              </div>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="text-slate-300">
                {s.salesOrder?.customer.name || "—"} · SO{" "}
                {s.salesOrder ? (
                  <Link href={`/sales/${s.salesOrder.id}`} className="text-sky-400">
                    {s.salesOrder.number}
                  </Link>
                ) : (
                  "—"
                )}
              </p>
              <p className="text-xs text-slate-500">
                {s.shipToAddress} · {s.carrier || "Carrier TBD"}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-slate-400">
                {s.lines.map((l) => (
                  <li key={l.id}>
                    {l.description} × {l.quantity}
                    {l.lotNumber ? ` · Lot ${l.lotNumber}` : ""}
                  </li>
                ))}
              </ul>
              {s.trackingNumber && (
                <p className="mt-2 font-mono text-xs text-sky-400">
                  Tracking: {s.trackingNumber}
                </p>
              )}
              {s.salesOrder && s.status !== "SHIPPED" && s.salesOrder.status === "READY_TO_SHIP" && (
                <form action={actionShipSalesOrder} className="mt-3">
                  <input type="hidden" name="salesOrderId" value={s.salesOrder.id} />
                  <Button type="submit" size="sm">
                    Confirm ship
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        ))}
        {shipments.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-slate-500">
              No shipments yet.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
