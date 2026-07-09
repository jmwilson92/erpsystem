import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { Plus, Users, Building2, FileText, ShoppingBag } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { salesOrders: true, quotes: true, invoices: true },
      },
      salesOrders: {
        select: { totalAmount: true, status: true },
        take: 50,
        orderBy: { orderDate: "desc" },
      },
    },
  });

  const active = customers.filter((c) => c.isActive).length;
  const openSo = customers.reduce(
    (s, c) =>
      s +
      c.salesOrders.filter((o) =>
        ["OPEN", "PLANNED", "IN_PRODUCTION", "READY_TO_SHIP"].includes(o.status)
      ).length,
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Accounts, bill-to / ship-to, terms — used by quotes and sales orders"
        actions={
          <Link href="/customers/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              New customer
            </Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Customers" value={customers.length} icon={Building2} />
        <StatCard title="Active" value={active} icon={Users} accent="teal" />
        <StatCard title="Open sales orders" value={openSo} icon={ShoppingBag} accent="sky" />
        <StatCard
          title="With quotes"
          value={customers.filter((c) => c._count.quotes > 0).length}
          icon={FileText}
          accent="amber"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Code</th>
              <th className="px-3 py-2.5 text-left">Name</th>
              <th className="px-3 py-2.5 text-left">Contact</th>
              <th className="px-3 py-2.5 text-left">Terms</th>
              <th className="px-3 py-2.5 text-right">Credit</th>
              <th className="px-3 py-2.5 text-right">SOs</th>
              <th className="px-3 py-2.5 text-right">Quotes</th>
              <th className="px-3 py-2.5 text-left">Status</th>
              <th className="px-3 py-2.5 text-right" />
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-slate-800/60 hover:bg-slate-900/40">
                <td className="px-3 py-3 font-mono text-xs text-teal-400">{c.code}</td>
                <td className="px-3 py-3">
                  <Link
                    href={`/customers/${c.id}`}
                    className="font-medium text-slate-100 hover:text-sky-400"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="px-3 py-3 text-xs text-slate-400">
                  <div>{c.contactName || "—"}</div>
                  <div className="text-slate-600">{c.contactEmail || ""}</div>
                </td>
                <td className="px-3 py-3 text-xs text-slate-400">{c.paymentTerms}</td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-400">
                  {formatCurrency(c.creditLimit)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{c._count.salesOrders}</td>
                <td className="px-3 py-3 text-right tabular-nums">{c._count.quotes}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={c.isActive ? "ACTIVE" : "INACTIVE"} />
                </td>
                <td className="px-3 py-3 text-right">
                  <Link href={`/customers/${c.id}`}>
                    <Button size="sm" variant="outline">
                      Open
                    </Button>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers.length === 0 && (
          <div className="py-12 text-center text-slate-500">
            No customers yet.{" "}
            <Link href="/customers/new" className="text-teal-400 hover:underline">
              Create one
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
