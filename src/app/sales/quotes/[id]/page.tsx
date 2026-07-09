import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CompanyLetterhead } from "@/components/sales/document-header";
import { formatCurrency, formatDate } from "@/lib/utils";
import { actionAcceptQuote, actionSendQuote } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      customer: true,
      lines: { include: { part: true }, orderBy: { lineNumber: "asc" } },
      salesOrder: true,
    },
  });
  if (!quote) notFound();

  const canAccept = ["DRAFT", "SENT", "ACCEPTED"].includes(quote.status) && !quote.salesOrder;
  const canSend = quote.status === "DRAFT";

  return (
    <div className="space-y-6">
      <PageHeader
        title={quote.number}
        description={`${quote.customer.name}${quote.customerPo ? ` · ${quote.customerPo}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/sales/quotes">
              <Button variant="outline" size="sm">
                All quotes
              </Button>
            </Link>
            {canSend && (
              <form action={actionSendQuote}>
                <input type="hidden" name="quoteId" value={quote.id} />
                <Button type="submit" size="sm" variant="secondary">
                  Mark sent
                </Button>
              </form>
            )}
            {canAccept && (
              <form action={actionAcceptQuote} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="quoteId" value={quote.id} />
                <input type="hidden" name="autoPlan" value="true" />
                <label className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900/80 px-2 py-1 text-[11px] text-slate-400">
                  <input
                    type="checkbox"
                    name="bypassStockCheck"
                    className="rounded border-slate-600"
                  />
                  Bypass stock on plan
                </label>
                <Button type="submit" size="sm">
                  Accept → create sales order
                </Button>
              </form>
            )}
            {quote.salesOrder && (
              <Link href={`/sales/${quote.salesOrder.id}`}>
                <Button size="sm" variant="secondary">
                  Open {quote.salesOrder.number}
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={quote.status} />
        {quote.isFob && (
          <span className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
            FOB {quote.fobPoint || ""}
          </span>
        )}
      </div>

      <Card className="border-slate-700 bg-slate-950/80">
        <CardContent className="space-y-6 p-6 md:p-8">
          <CompanyLetterhead
            docTitle="Quotation"
            docNumber={quote.number}
            docDate={formatDate(quote.quoteDate)}
          />

          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase text-slate-500">Valid until</p>
              <p className="text-slate-200">{formatDate(quote.validUntil)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Due date</p>
              <p className="text-slate-200">{formatDate(quote.requiredDate)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Ship date</p>
              <p className="text-slate-200">{formatDate(quote.shipDate)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-slate-500">Terms</p>
              <p className="text-slate-200">{quote.paymentTerms}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-800 p-4 text-sm">
              <p className="mb-2 text-[10px] font-semibold uppercase text-teal-500">Customer</p>
              <p className="font-medium text-slate-100">{quote.customer.name}</p>
              <p className="text-xs text-slate-500">{quote.customer.code}</p>
              {quote.contactName && (
                <p className="mt-2 text-xs text-slate-400">{quote.contactName}</p>
              )}
              {quote.contactEmail && (
                <p className="text-xs text-slate-500">{quote.contactEmail}</p>
              )}
              {quote.customerPo && (
                <p className="mt-2 text-xs text-slate-400">Ref: {quote.customerPo}</p>
              )}
            </div>
            <div className="rounded-lg border border-slate-800 p-4 text-sm">
              <p className="mb-2 text-[10px] font-semibold uppercase text-teal-500">Bill to</p>
              <p className="text-slate-200">{quote.billToName || quote.customer.name}</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-slate-400">
                {quote.billToAddress || "—"}
              </pre>
            </div>
            <div className="rounded-lg border border-slate-800 p-4 text-sm">
              <p className="mb-2 text-[10px] font-semibold uppercase text-teal-500">Ship to</p>
              <p className="text-slate-200">{quote.shipToName || quote.customer.name}</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-slate-400">
                {quote.shipToAddress || "—"}
              </pre>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs uppercase text-slate-500">
                <th className="pb-2">#</th>
                <th className="pb-2">Part</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Unit</th>
                <th className="pb-2 text-right">Ext</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-800/60">
                  <td className="py-2 text-slate-500">{l.lineNumber}</td>
                  <td className="py-2">
                    <span className="font-mono text-teal-400">
                      {l.part?.partNumber || "—"}
                    </span>
                    <p className="text-xs text-slate-500">{l.description}</p>
                  </td>
                  <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(l.unitPrice)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(l.quantity * l.unitPrice)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="pt-4 text-right text-sm font-medium text-slate-400">
                  Total
                </td>
                <td className="pt-4 text-right text-lg font-semibold tabular-nums text-slate-100">
                  {formatCurrency(quote.totalAmount)}
                </td>
              </tr>
            </tfoot>
          </table>

          {quote.notes && (
            <p className="text-xs text-slate-500">Notes: {quote.notes}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
