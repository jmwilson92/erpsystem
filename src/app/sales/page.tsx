import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { actionPlanSalesOrder } from "@/app/actions";
import Link from "next/link";
import { ShoppingBag, Factory, Truck, PackageCheck, Plus, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SalesOrdersPage() {
  const [orders, quoteCounts, counts] = await Promise.all([
    prisma.salesOrder.findMany({
      orderBy: { orderDate: "desc" },
      include: {
        customer: true,
        lines: { include: { part: true } },
        workOrders: { select: { id: true, number: true, status: true } },
        shipments: { select: { id: true, number: true, status: true } },
        quote: { select: { number: true } },
      },
    }),
    prisma.quote.groupBy({ by: ["status"], _count: true }),
    prisma.salesOrder.groupBy({ by: ["status"], _count: true }),
  ]);

  const statusMap = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const openQuotes = quoteCounts
    .filter((q) => ["DRAFT", "SENT", "ACCEPTED"].includes(q.status))
    .reduce((s, q) => s + q._count, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Orders"
        description="Customer orders and fulfillment status"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/customers">
              <Button variant="ghost" size="sm">
                Customers
              </Button>
            </Link>
            <Link href="/sales/quotes">
              <Button variant="outline" size="sm">
                <FileText className="h-4 w-4" />
                Quotes {openQuotes > 0 ? `(${openQuotes})` : ""}
              </Button>
            </Link>
            <Link href="/sales/quotes/new">
              <Button variant="secondary" size="sm">
                New quote
              </Button>
            </Link>
            <Link href="/sales/new">
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Create sales order
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Open / Planned"
          value={(statusMap["OPEN"] || 0) + (statusMap["PLANNED"] || 0)}
          icon={ShoppingBag}
        />
        <StatCard
          title="In Production"
          value={statusMap["IN_PRODUCTION"] || 0}
          icon={Factory}
        />
        <StatCard
          title="Ready to Ship"
          value={statusMap["READY_TO_SHIP"] || 0}
          icon={PackageCheck}
        />
        <StatCard title="Shipped" value={statusMap["SHIPPED"] || 0} icon={Truck} />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Order</th>
              <th className="px-3 py-2.5 text-left">Customer</th>
              <th className="px-3 py-2.5 text-left">Cust PO</th>
              <th className="px-3 py-2.5 text-left">Terms</th>
              <th className="px-3 py-2.5 text-left">Due</th>
              <th className="px-3 py-2.5 text-left">Ship</th>
              <th className="px-3 py-2.5 text-left">Status</th>
              <th className="px-3 py-2.5 text-right">Total</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((so) => (
              <tr key={so.id} className="border-t border-slate-800/60 hover:bg-slate-900/40">
                <td className="px-3 py-3">
                  <Link
                    href={`/sales/${so.id}`}
                    className="font-mono font-medium text-sky-400 hover:underline"
                  >
                    {so.number}
                  </Link>
                  {so.quote && (
                    <p className="text-[10px] text-slate-500">from {so.quote.number}</p>
                  )}
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {so.lines.map((l) => l.part?.partNumber || "—").join(", ")}
                  </p>
                </td>
                <td className="px-3 py-3 text-slate-300">{so.customer.name}</td>
                <td className="px-3 py-3 font-mono text-xs text-slate-400">
                  {so.customerPo || "—"}
                </td>
                <td className="px-3 py-3 text-xs text-slate-400">{so.paymentTerms}</td>
                <td className="px-3 py-3 text-xs text-slate-400">{formatDate(so.requiredDate)}</td>
                <td className="px-3 py-3 text-xs text-slate-400">{formatDate(so.shipDate)}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={so.status} />
                  {so.isFob && (
                    <span className="ml-1 text-[10px] text-slate-500">FOB</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right font-medium tabular-nums">
                  {formatCurrency(so.totalAmount)}
                </td>
                <td className="px-3 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    {["OPEN", "PLANNED"].includes(so.status) && (
                      <form action={actionPlanSalesOrder}>
                        <input type="hidden" name="salesOrderId" value={so.id} />
                        <Button type="submit" size="sm" variant="secondary">
                          Plan
                        </Button>
                      </form>
                    )}
                    <Link href={`/sales/${so.id}`}>
                      <Button size="sm" variant="outline">
                        Open
                      </Button>
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && (
          <div className="py-12 text-center text-slate-500">
            No sales orders yet.{" "}
            <Link href="/sales/new" className="text-teal-400 hover:underline">
              Create one
            </Link>{" "}
            or convert an accepted quote.
          </div>
        )}
      </div>
    </div>
  );
}
