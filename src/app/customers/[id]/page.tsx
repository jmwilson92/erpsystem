import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CustomerForm } from "@/components/customers/customer-form";
import { getCustomerCreditSnapshot } from "@/lib/services/credit";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      salesOrders: {
        orderBy: { orderDate: "desc" },
        take: 20,
        include: { lines: { include: { part: true }, take: 3 } },
      },
      quotes: {
        orderBy: { quoteDate: "desc" },
        take: 20,
        include: { salesOrder: { select: { id: true, number: true } } },
      },
      invoices: {
        orderBy: { invoiceDate: "desc" },
        take: 10,
      },
    },
  });
  if (!customer) notFound();

  const credit = await getCustomerCreditSnapshot(customer.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        description={`${customer.code} · ${customer.paymentTerms}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/customers">
              <Button variant="outline" size="sm">
                All customers
              </Button>
            </Link>
            <Link href={`/sales/new?customerId=${customer.id}`}>
              <Button size="sm" variant="secondary">
                New sales order
              </Button>
            </Link>
            <Link href={`/sales/quotes/new?customerId=${customer.id}`}>
              <Button size="sm">New quote</Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={customer.isActive ? "ACTIVE" : "INACTIVE"} />
        {credit.isOverLimit && <StatusBadge status="OVER_LIMIT" />}
        {customer.contactName && (
          <span className="text-xs text-slate-500">
            {customer.contactName}
            {customer.contactEmail ? ` · ${customer.contactEmail}` : ""}
            {customer.contactPhone ? ` · ${customer.contactPhone}` : ""}
          </span>
        )}
      </div>

      {credit.hasLimit && credit.isOverLimit && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="p-4 text-sm text-amber-100">
            <p className="font-medium">Credit limit exceeded</p>
            <p className="mt-1 text-xs text-amber-200/90">
              Exposure {formatCurrency(credit.exposure)} exceeds limit{" "}
              {formatCurrency(credit.creditLimit)}. New customer POs / sales
              orders will require a deposit covering the over-limit amount.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-700 lg:col-span-2">
          <CardHeader>
            <CardTitle>Edit customer</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerForm customer={customer} cancelHref="/customers" />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card
            className={
              credit.isOverLimit
                ? "border-amber-500/40"
                : credit.hasLimit && credit.utilizationPct >= 80
                  ? "border-amber-500/20"
                  : ""
            }
          >
            <CardHeader>
              <CardTitle>Credit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">Credit limit</p>
                <p className="text-lg font-semibold tabular-nums">
                  {credit.hasLimit
                    ? formatCurrency(credit.creditLimit)
                    : "No limit set"}
                </p>
              </div>
              {credit.hasLimit && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded border border-slate-800 bg-slate-950/50 p-2">
                      <p className="text-slate-500">Open AR</p>
                      <p className="tabular-nums text-slate-200">
                        {formatCurrency(credit.arBalance)}
                      </p>
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-950/50 p-2">
                      <p className="text-slate-500">Open SOs</p>
                      <p className="tabular-nums text-slate-200">
                        {formatCurrency(credit.openSoBalance)}
                      </p>
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-950/50 p-2">
                      <p className="text-slate-500">Exposure</p>
                      <p
                        className={`tabular-nums font-medium ${
                          credit.isOverLimit ? "text-amber-400" : "text-slate-100"
                        }`}
                      >
                        {formatCurrency(credit.exposure)}
                      </p>
                    </div>
                    <div className="rounded border border-slate-800 bg-slate-950/50 p-2">
                      <p className="text-slate-500">Available</p>
                      <p className="tabular-nums text-emerald-400">
                        {formatCurrency(credit.availableCredit)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[10px] text-slate-500">
                      <span>Utilization</span>
                      <span>{credit.utilizationPct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full ${
                          credit.isOverLimit
                            ? "bg-amber-500"
                            : credit.utilizationPct >= 80
                              ? "bg-amber-400"
                              : "bg-teal-500"
                        }`}
                        style={{
                          width: `${Math.min(100, credit.utilizationPct)}%`,
                        }}
                      />
                    </div>
                  </div>
                  {credit.isOverLimit && (
                    <p className="text-[11px] text-amber-400">
                      Deposit required on new orders
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Bill to</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-300">
                {customer.billToAddress || "—"}
              </pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Ship to</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-300">
                {customer.shipToAddress || customer.billToAddress || "—"}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sales orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {customer.salesOrders.length === 0 && (
              <p className="text-sm text-slate-500">No sales orders yet.</p>
            )}
            {customer.salesOrders.map((so) => (
              <Link
                key={so.id}
                href={`/sales/${so.id}`}
                className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 hover:bg-slate-900/50"
              >
                <div>
                  <span className="font-mono text-sky-400">{so.number}</span>
                  <StatusBadge status={so.status} className="ml-2" />
                  {so.depositRequired && (
                    <span className="ml-1 rounded border border-amber-500/40 px-1 text-[10px] text-amber-400">
                      Deposit
                    </span>
                  )}
                  <p className="text-[11px] text-slate-500">
                    {formatDate(so.orderDate)} · Due {formatDate(so.requiredDate)}
                  </p>
                </div>
                <span className="tabular-nums text-slate-300">
                  {formatCurrency(so.totalAmount)}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quotes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {customer.quotes.length === 0 && (
              <p className="text-sm text-slate-500">No quotes yet.</p>
            )}
            {customer.quotes.map((q) => (
              <Link
                key={q.id}
                href={`/sales/quotes/${q.id}`}
                className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 hover:bg-slate-900/50"
              >
                <div>
                  <span className="font-mono text-sky-400">{q.number}</span>
                  <StatusBadge status={q.status} className="ml-2" />
                  {q.salesOrder && (
                    <span className="ml-2 text-[11px] text-teal-500">
                      → {q.salesOrder.number}
                    </span>
                  )}
                </div>
                <span className="tabular-nums text-slate-300">
                  {formatCurrency(q.totalAmount)}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {customer.invoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>AR invoices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {customer.invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-mono text-slate-300">{inv.number}</span>
                  <StatusBadge status={inv.status} className="ml-2" />
                </div>
                <span className="tabular-nums">{formatCurrency(inv.total)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
