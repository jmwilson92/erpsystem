import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { Plus, Users, Building2, FileText, ShoppingBag, AlertTriangle } from "lucide-react";

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
        orderBy: { orderDate: "desc" },
      },
      invoices: {
        where: { status: { in: ["OPEN", "PARTIAL"] } },
        select: { total: true, amountPaid: true },
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

  const rows = customers.map((c) => {
    const arBalance = c.invoices.reduce(
      (s, inv) => s + Math.max(0, inv.total - inv.amountPaid),
      0
    );
    const openSoBalance = c.salesOrders
      .filter((o) =>
        ["OPEN", "PLANNED", "IN_PRODUCTION", "READY_TO_SHIP"].includes(o.status)
      )
      .reduce((s, o) => s + o.totalAmount, 0);
    const exposure = arBalance + openSoBalance;
    const hasLimit = c.creditLimit > 0;
    const isOverLimit = hasLimit && exposure >= c.creditLimit;
    const utilizationPct = hasLimit
      ? Math.round((exposure / c.creditLimit) * 1000) / 10
      : 0;
    return { c, arBalance, openSoBalance, exposure, hasLimit, isOverLimit, utilizationPct };
  });

  const overLimitCount = rows.filter((r) => r.isOverLimit).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Accounts, credit limits, terms — used by quotes and sales orders"
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
          title="Over credit limit"
          value={overLimitCount}
          icon={overLimitCount > 0 ? AlertTriangle : FileText}
          accent={overLimitCount > 0 ? "amber" : "sky"}
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
              <th className="px-3 py-2.5 text-right">Credit limit</th>
              <th className="px-3 py-2.5 text-right">Exposure</th>
              <th className="px-3 py-2.5 text-right">SOs</th>
              <th className="px-3 py-2.5 text-right">Quotes</th>
              <th className="px-3 py-2.5 text-left">Status</th>
              <th className="px-3 py-2.5 text-right" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, exposure, hasLimit, isOverLimit, utilizationPct }) => (
              <tr
                key={c.id}
                className={`border-t border-slate-800/60 hover:bg-slate-900/40 ${
                  isOverLimit ? "bg-amber-500/5" : ""
                }`}
              >
                <td className="px-3 py-3 font-mono text-xs text-teal-400">{c.code}</td>
                <td className="px-3 py-3">
                  <Link
                    href={`/customers/${c.id}`}
                    className="font-medium text-slate-100 hover:text-sky-400"
                  >
                    {c.name}
                  </Link>
                  {isOverLimit && (
                    <p className="mt-0.5 text-[10px] font-medium text-amber-400">
                      Over limit — deposit required on new POs
                    </p>
                  )}
                </td>
                <td className="px-3 py-3 text-xs text-slate-400">
                  <div>{c.contactName || "—"}</div>
                  <div className="text-slate-600">{c.contactEmail || ""}</div>
                </td>
                <td className="px-3 py-3 text-xs text-slate-400">{c.paymentTerms}</td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-400">
                  {hasLimit ? formatCurrency(c.creditLimit) : "—"}
                </td>
                <td className="px-3 py-3 text-right">
                  {hasLimit ? (
                    <div>
                      <span
                        className={`tabular-nums ${
                          isOverLimit ? "font-semibold text-amber-400" : "text-slate-300"
                        }`}
                      >
                        {formatCurrency(exposure)}
                      </span>
                      <p
                        className={`text-[10px] ${
                          isOverLimit ? "text-amber-500" : "text-slate-600"
                        }`}
                      >
                        {utilizationPct}% used
                      </p>
                    </div>
                  ) : (
                    <span className="text-slate-600">No limit</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{c._count.salesOrders}</td>
                <td className="px-3 py-3 text-right tabular-nums">{c._count.quotes}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={c.isActive ? "ACTIVE" : "INACTIVE"} />
                    {isOverLimit && <StatusBadge status="OVER_LIMIT" />}
                  </div>
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
