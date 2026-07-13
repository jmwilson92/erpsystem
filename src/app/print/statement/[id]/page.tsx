import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PrintFrame } from "@/components/print/print-frame";
import { DocHeader, DocTable } from "@/components/print/doc-parts";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const BUCKETS = ["Current", "1-30 past due", "31-60", "61-90", "90+"] as const;

function bucketFor(daysPast: number): (typeof BUCKETS)[number] {
  if (daysPast <= 0) return "Current";
  if (daysPast <= 30) return "1-30 past due";
  if (daysPast <= 60) return "31-60";
  if (daysPast <= 90) return "61-90";
  return "90+";
}

export default async function PrintStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [customer, company] = await Promise.all([
    prisma.customer.findUnique({
      where: { id },
      include: {
        invoices: {
          where: { status: { in: ["OPEN", "PARTIAL"] } },
          orderBy: { invoiceDate: "asc" },
        },
      },
    }),
    prisma.companySettings.findUnique({ where: { id: "default" } }),
  ]);
  if (!customer) notFound();

  // ArInvoice stores salesOrderId as a scalar — resolve numbers separately
  const soIds = customer.invoices
    .map((i) => i.salesOrderId)
    .filter((v): v is string => Boolean(v));
  const soNumbers = new Map(
    (
      await prisma.salesOrder.findMany({
        where: { id: { in: soIds } },
        select: { id: true, number: true },
      })
    ).map((s) => [s.id, s.number])
  );

  const now = Date.now();
  const rows = customer.invoices.map((i) => {
    const due = i.dueDate ?? i.invoiceDate;
    const daysPast = Math.floor((now - due.getTime()) / 86_400_000);
    const open = i.total - i.amountPaid;
    return { invoice: i, due, daysPast, open, bucket: bucketFor(daysPast) };
  });
  const totalDue = rows.reduce((s, r) => s + r.open, 0);
  const bucketTotals = BUCKETS.map((b) => ({
    bucket: b,
    amount: rows.filter((r) => r.bucket === b).reduce((s, r) => s + r.open, 0),
  }));

  return (
    <PrintFrame>
      <DocHeader
        company={company?.name || "ForgeRP"}
        tagline={company?.tagline}
        title="Statement of Account"
        number={customer.code}
        meta={[
          { label: "Statement date", value: formatDate(new Date()) },
          { label: "Customer", value: customer.name },
          { label: "Terms", value: customer.paymentTerms },
        ]}
      />

      <div className="mt-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Bill to
          </p>
          <p className="mt-1 font-semibold">{customer.name}</p>
          {customer.billToAddress ? (
            <p className="whitespace-pre-line text-neutral-600">
              {customer.billToAddress}
            </p>
          ) : null}
          {customer.contactEmail ? (
            <p className="text-neutral-600">{customer.contactEmail}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Total amount due
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {formatCurrency(totalDue)}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-600">
          No open invoices — account is current. Thank you!
        </p>
      ) : (
        <>
          <DocTable
            columns={["Invoice", "Order", "Invoice date", "Due date", "Days past due", "Invoice total", "Paid", "Balance"]}
            align={["", "", "", "", "r", "r", "r", "r"]}
            rows={rows.map((r) => [
              r.invoice.number,
              (r.invoice.salesOrderId && soNumbers.get(r.invoice.salesOrderId)) || "—",
              formatDate(r.invoice.invoiceDate),
              formatDate(r.due),
              Math.max(0, r.daysPast),
              formatCurrency(r.invoice.total),
              formatCurrency(r.invoice.amountPaid),
              formatCurrency(r.open),
            ])}
          />

          <div className="mt-6">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Aging summary
            </p>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {bucketTotals.map((b) => (
                <div
                  key={b.bucket}
                  className="rounded border border-neutral-300 p-2 text-center"
                >
                  <p className="text-[10px] uppercase tracking-wide text-neutral-500">
                    {b.bucket}
                  </p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">
                    {formatCurrency(b.amount)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <p className="mt-10 text-xs text-neutral-500">
        Please reference invoice numbers with your remittance. Questions about
        this statement? Contact accounts receivable.
      </p>
    </PrintFrame>
  );
}
