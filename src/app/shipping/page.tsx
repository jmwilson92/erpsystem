import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { actionQueueShipment } from "@/app/actions";
import { PackShipPanel } from "@/components/shipping/pack-ship-panel";
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
      <PageHeader title="Shipping" />

      {readyOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ready / in production (pull queue)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {readyOrders.map((so) => {
              const gate = so.shipNotBefore || so.requiredDate;
              const depositBlocked =
                so.depositRequired &&
                !["RECEIVED", "WAIVED"].includes(
                  (so.depositStatus || "").toUpperCase()
                );
              const dateBlocked =
                !so.allowEarlyShip &&
                gate &&
                new Date() < gate &&
                so.status === "READY_TO_SHIP";
              return (
                <div
                  key={so.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${
                    depositBlocked
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-slate-800"
                  }`}
                >
                  <div>
                    <Link href={`/sales/${so.id}`} className="font-mono text-sky-400">
                      {so.number}
                    </Link>
                    <StatusBadge status={so.status} className="ml-2" />
                    {depositBlocked && (
                      <span className="ml-2 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300">
                        Deposit hold
                      </span>
                    )}
                    <p className="text-sm text-slate-300">{so.customer.name}</p>
                    <p className="text-xs text-slate-500">
                      Required {formatDate(so.requiredDate)} ·{" "}
                      {formatCurrency(so.totalAmount)}
                      {depositBlocked
                        ? ` · Deposit ${formatCurrency(so.depositAmount)} ${so.depositStatus || "PENDING"} — ship blocked`
                        : dateBlocked
                          ? ` · Held until ${formatDate(gate)}`
                          : so.allowEarlyShip
                            ? " · Early ship OK"
                            : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {depositBlocked ? (
                      <Link href={`/sales/${so.id}`}>
                        <Button size="sm" variant="secondary">
                          Resolve deposit
                        </Button>
                      </Link>
                    ) : (
                      <form action={actionQueueShipment}>
                        <input type="hidden" name="salesOrderId" value={so.id} />
                        <Button type="submit" size="sm" variant="outline">
                          Queue packing list
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
          <Card
            key={s.id}
            className="transition-colors hover:border-teal-500/30"
          >
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link href={`/shipping/${s.id}`}>
                    <CardTitle className="font-mono text-teal-400 hover:underline">
                      {s.number}
                    </CardTitle>
                  </Link>
                  <StatusBadge status={s.status} />
                </div>
                <Link href={`/shipping/${s.id}`}>
                  <Button size="sm" variant="outline">
                    Open packing list
                  </Button>
                </Link>
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
                {s.packingListVerified ? " · List verified" : ""}
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
              {s.salesOrder && !["SHIPPED", "DELIVERED"].includes(s.status) && (
                <div className="mt-3">
                  <PackShipPanel
                    shipmentId={s.id}
                    salesOrderId={s.salesOrder.id}
                    packingListVerified={s.packingListVerified}
                    status={s.status}
                    shipToAddress={s.shipToAddress}
                    depositBlocked={
                      s.salesOrder.depositRequired &&
                      !["RECEIVED", "WAIVED"].includes(
                        (s.salesOrder.depositStatus || "").toUpperCase()
                      )
                    }
                    depositMessage={
                      s.salesOrder.depositRequired &&
                      !["RECEIVED", "WAIVED"].includes(
                        (s.salesOrder.depositStatus || "").toUpperCase()
                      )
                        ? `Deposit ${formatCurrency(s.salesOrder.depositAmount)} required (${s.salesOrder.depositStatus || "PENDING"}) — mark received or waive on SO ${s.salesOrder.number} before shipping.`
                        : null
                    }
                    lineSummary={s.lines.map(
                      (l) =>
                        `${l.description} × ${l.quantity}${
                          l.lotNumber ? ` · Lot ${l.lotNumber}` : ""
                        }`
                    )}
                  />
                </div>
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
