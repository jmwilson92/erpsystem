import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function JournalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const journal = await prisma.journalEntry.findUnique({
    where: { id },
    include: {
      lines: { include: { account: true } },
      workOrder: { select: { id: true, number: true } },
      materialTransactions: {
        select: {
          id: true,
          type: true,
          quantity: true,
          unitCost: true,
          reference: true,
          partId: true,
        },
      },
    },
  });
  if (!journal) notFound();
  const [rmaReceipts, creditMemo] = await Promise.all([
    prisma.rmaReceipt.findMany({
      where: {
        OR: [
          { cogsJournalId: journal.id },
          { restockJournalId: journal.id },
          { scrapJournalId: journal.id },
        ],
      },
      include: { rma: { select: { id: true, number: true } } },
    }),
    prisma.arCreditMemo.findFirst({
      where: { OR: [{ journalEntryId: journal.id }, { id: journal.sourceId || "__none__" }] },
      include: { rma: { select: { id: true, number: true } } },
    }),
  ]);
  const debit = journal.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const credit = journal.lines.reduce((s, l) => s + (l.credit || 0), 0);
  const sourceHref =
    journal.source === "WO" && journal.workOrder
      ? `/work-orders/${journal.workOrder.id}`
      : journal.source === "RMA" && (rmaReceipts[0]?.rma || creditMemo?.rma)
        ? `/rma/${(rmaReceipts[0]?.rma || creditMemo?.rma)!.id}`
      : journal.source === "AR"
        ? "/accounting?tab=ar"
        : journal.source === "AP"
          ? "/accounting?tab=ap"
          : journal.source === "INVENTORY" || journal.source === "SCRAP"
            ? "/accounting/transactions"
            : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title={`${journal.number} · ${journal.description}`}
        description={`${journal.status} · ${formatDate(journal.date)}${journal.source ? ` · Source ${journal.source}` : ""}`}
        actions={
          <Link href="/accounting?tab=je">
            <Button size="sm" variant="outline">All journals</Button>
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lines</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  {["Account", "Memo", "Debit", "Credit"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {journal.lines.map((l) => (
                  <tr key={l.id} className="border-t border-slate-800">
                    <td className="px-3 py-2">
                      <Link href={`/accounting/account/${l.accountId}`} className="text-teal-400 hover:underline">
                        {l.account.code} {l.account.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{l.memo || l.costElement || "—"}</td>
                    <td className="px-3 py-2 font-mono">{l.debit ? formatCurrency(l.debit) : ""}</td>
                    <td className="px-3 py-2 font-mono">{l.credit ? formatCurrency(l.credit) : ""}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-700 font-medium">
                  <td className="px-3 py-2" colSpan={2}>Total</td>
                  <td className="px-3 py-2 font-mono">{formatCurrency(debit)}</td>
                  <td className="px-3 py-2 font-mono">{formatCurrency(credit)}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-300">
            <p>Status: {journal.status}</p>
            {(rmaReceipts[0]?.rma || creditMemo?.rma) && (
              <p>
                RMA:{" "}
                <Link
                  href={`/rma/${(rmaReceipts[0]?.rma || creditMemo?.rma)!.id}`}
                  className="text-teal-400 hover:underline"
                >
                  {(rmaReceipts[0]?.rma || creditMemo?.rma)!.number}
                </Link>
                {creditMemo ? ` · credit memo ${creditMemo.number}` : ""}
              </p>
            )}
            {journal.workOrder && (
              <p>
                Job:{" "}
                <Link href={`/work-orders/${journal.workOrder.id}`} className="text-teal-400 hover:underline">
                  {journal.workOrder.number}
                </Link>
              </p>
            )}
            {sourceHref && (
              <p>
                <Link href={sourceHref} className="text-teal-400 hover:underline">
                  Open the source document
                </Link>
              </p>
            )}
            {journal.idempotencyKey && (
              <p className="break-all text-xs text-slate-500">Idempotency key: {journal.idempotencyKey}</p>
            )}
            {journal.materialTransactions.length > 0 && (
              <div className="pt-2">
                <p className="text-xs uppercase text-slate-500">Inventory movements</p>
                <ul className="mt-1 space-y-1">
                  {journal.materialTransactions.map((m) => (
                    <li key={m.id}>
                      <Link href="/accounting/transactions" className="text-teal-400 hover:underline">
                        {m.type} · qty {m.quantity}
                      </Link>
                      {m.reference ? ` · ${m.reference}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
