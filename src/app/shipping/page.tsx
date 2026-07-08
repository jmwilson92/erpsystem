import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ShippingPage() {
  const [shipments, salesOrders] = await Promise.all([
    prisma.shipment.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        salesOrder: { include: { customer: true } },
        lines: true,
      },
    }),
    prisma.salesOrder.findMany({
      orderBy: { orderDate: "desc" },
      include: { customer: true, lines: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipping"
        description="Pick, pack, ship — linked to sales orders and inventory relief"
      />

      <div className="grid gap-4 lg:grid-cols-2">
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
                  {s.salesOrder?.number || "—"}
                </p>
                <p className="text-xs text-slate-500">
                  {s.shipToAddress} · {s.carrier || "Carrier TBD"}
                </p>
                <ul className="mt-2 space-y-1 text-xs text-slate-400">
                  {s.lines.map((l) => (
                    <li key={l.id}>
                      {l.description} × {l.quantity}
                    </li>
                  ))}
                </ul>
                {s.trackingNumber && (
                  <p className="mt-2 font-mono text-xs text-sky-400">
                    Tracking: {s.trackingNumber}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Sales Orders
          </h2>
          {salesOrders.map((so) => (
            <Card key={so.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-sky-400">{so.number}</span>
                    <StatusBadge status={so.status} className="ml-2" />
                    <p className="text-sm text-slate-300">{so.customer.name}</p>
                    <p className="text-xs text-slate-500">
                      Required {formatDate(so.requiredDate)} ·{" "}
                      {so.lines.length} line(s)
                    </p>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCurrency(so.totalAmount)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
