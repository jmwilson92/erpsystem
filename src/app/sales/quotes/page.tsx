import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  const quotes = await prisma.quote.findMany({
    orderBy: { quoteDate: "desc" },
    include: {
      customer: true,
      lines: { include: { part: true } },
      salesOrder: { select: { id: true, number: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotes"
        description="Issue quotes — accept to convert into a sales order"
        actions={
          <div className="flex gap-2">
            <Link href="/sales">
              <Button variant="outline" size="sm">
                Sales orders
              </Button>
            </Link>
            <Link href="/sales/quotes/new">
              <Button size="sm">
                <Plus className="h-4 w-4" />
                New quote
              </Button>
            </Link>
          </div>
        }
      />

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Quote</th>
              <th className="px-3 py-2.5 text-left">Customer</th>
              <th className="px-3 py-2.5 text-left">Valid until</th>
              <th className="px-3 py-2.5 text-left">Terms</th>
              <th className="px-3 py-2.5 text-left">Status</th>
              <th className="px-3 py-2.5 text-right">Total</th>
              <th className="px-3 py-2.5 text-right">SO</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id} className="border-t border-slate-800/60 hover:bg-slate-900/40">
                <td className="px-3 py-3">
                  <Link
                    href={`/sales/quotes/${q.id}`}
                    className="font-mono font-medium text-sky-400 hover:underline"
                  >
                    {q.number}
                  </Link>
                  <p className="text-[11px] text-slate-500">
                    {q.lines.map((l) => l.part?.partNumber || l.description).join(", ")}
                  </p>
                </td>
                <td className="px-3 py-3 text-slate-300">{q.customer.name}</td>
                <td className="px-3 py-3 text-xs text-slate-400">{formatDate(q.validUntil)}</td>
                <td className="px-3 py-3 text-xs text-slate-400">{q.paymentTerms}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={q.status} />
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatCurrency(q.totalAmount)}
                </td>
                <td className="px-3 py-3 text-right">
                  {q.salesOrder ? (
                    <Link
                      href={`/sales/${q.salesOrder.id}`}
                      className="font-mono text-xs text-teal-400"
                    >
                      {q.salesOrder.number}
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {quotes.length === 0 && (
          <div className="py-12 text-center text-slate-500">
            No quotes yet.{" "}
            <Link href="/sales/quotes/new" className="text-teal-400 hover:underline">
              Create a quote
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
