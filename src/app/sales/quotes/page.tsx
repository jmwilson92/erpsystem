import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import { actionMarkQuoteSent, actionRecordCustomerPo } from "@/app/actions";
import Link from "next/link";
import { Plus, Send, Inbox } from "lucide-react";

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
  const awaitingPo = quotes.filter(
    (q) => q.status === "SENT" && !q.salesOrder
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotes"
        description="Draft → send to customer → record their PO → sales order"
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

      {/* Sent queue — quotes with the customer, waiting on their PO */}
      {awaitingPo.length > 0 && (
        <div className="rounded-xl border border-sky-900/50 bg-sky-950/20 p-4">
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-sky-300">
            <Inbox className="h-4 w-4" />
            Sent — awaiting customer PO ({awaitingPo.length})
          </p>
          <p className="mb-3 text-xs text-slate-500">
            When the customer sends their purchase order, record its number
            here — the quote converts to a sales order carrying that PO.
          </p>
          <div className="space-y-2">
            {awaitingPo.map((q) => (
              <div
                key={q.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2"
              >
                <Link
                  href={`/sales/quotes/${q.id}`}
                  className="font-mono text-sm text-sky-400 hover:underline"
                >
                  {q.number}
                </Link>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-300">
                  {q.customer.name}
                  <span className="ml-2 text-xs text-slate-500">
                    {formatCurrency(q.totalAmount)} · sent for{" "}
                    {formatDate(q.quoteDate)}
                  </span>
                </span>
                <form
                  action={actionRecordCustomerPo}
                  className="flex items-center gap-2"
                >
                  <input type="hidden" name="quoteId" value={q.id} />
                  <Input
                    name="customerPo"
                    required
                    placeholder="Customer PO #"
                    defaultValue={q.customerPo || ""}
                    className="h-8 w-40 text-xs"
                  />
                  <Button type="submit" size="sm" className="h-8">
                    Record PO → SO
                  </Button>
                </form>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Quote</th>
              <th className="px-3 py-2.5 text-left">Customer</th>
              <th className="px-3 py-2.5 text-left">Valid until</th>
              <th className="px-3 py-2.5 text-left">Customer PO</th>
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
                <td className="px-3 py-3 font-mono text-xs text-slate-300">
                  {q.customerPo || <span className="text-slate-600">—</span>}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={q.status} />
                    {q.status === "DRAFT" && (
                      <form action={actionMarkQuoteSent}>
                        <input type="hidden" name="quoteId" value={q.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                        >
                          <Send className="mr-1 h-3 w-3" />
                          Mark sent
                        </Button>
                      </form>
                    )}
                  </div>
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
