import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PrintFrame } from "@/components/print/print-frame";
import { DocHeader, DocTable, SignatureRow } from "@/components/print/doc-parts";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PrintPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [po, company] = await Promise.all([
    prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        project: { select: { number: true, name: true } },
        lines: { orderBy: { lineNumber: "asc" }, include: { part: true } },
      },
    }),
    prisma.companySettings.findUnique({ where: { id: "default" } }),
  ]);
  if (!po) notFound();

  const total = po.lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);

  return (
    <PrintFrame>
      <DocHeader
        company={company?.name || "ForgeERP"}
        tagline={company?.tagline}
        title="Purchase Order"
        number={po.number}
        meta={[
          { label: "Order date", value: formatDate(po.orderDate) },
          ...(po.promisedDate
            ? [{ label: "Delivery due", value: formatDate(po.promisedDate) }]
            : []),
          { label: "Terms", value: po.paymentTerms },
          { label: "Status", value: po.status.replace(/_/g, " ") },
        ]}
      />

      <div className="mt-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Supplier
          </p>
          <p className="mt-1 font-semibold">{po.supplier.name}</p>
          <p className="text-neutral-600">Code: {po.supplier.code}</p>
          {po.supplier.contactEmail ? (
            <p className="text-neutral-600">{po.supplier.contactEmail}</p>
          ) : null}
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Ship to
          </p>
          <p className="mt-1 whitespace-pre-line">
            {po.shipToAddress || `${company?.name || "ForgeERP"} Receiving Dock`}
          </p>
          {po.project ? (
            <p className="mt-2 text-neutral-600">
              Project: {po.project.number} — {po.project.name}
            </p>
          ) : null}
          {po.clin ? <p className="text-neutral-600">CLIN: {po.clin}</p> : null}
          {po.isGovernmentProperty ? (
            <p className="mt-1 font-semibold">
              Government property — DD Form 1149 required at receipt
            </p>
          ) : null}
        </div>
      </div>

      <DocTable
        columns={["Ln", "Part / Description", "Qty", "UOM", "Unit cost", "Extended"]}
        align={["", "", "r", "", "r", "r"]}
        rows={po.lines.map((l) => [
          l.lineNumber,
          l.part ? `${l.part.partNumber} — ${l.description}` : l.description,
          l.quantity,
          l.uom,
          formatCurrency(l.unitCost),
          formatCurrency(l.quantity * l.unitCost),
        ])}
      />

      <div className="mt-4 flex justify-end text-sm">
        <div className="w-56 border-t-2 border-neutral-900 pt-2">
          <div className="flex justify-between font-bold">
            <span>PO total</span>
            <span className="tabular-nums">{formatCurrency(total)}</span>
          </div>
        </div>
      </div>

      {po.notes ? (
        <p className="mt-6 text-sm text-neutral-600">Notes: {po.notes}</p>
      ) : null}

      <SignatureRow labels={["Buyer", "Authorized approver"]} />
    </PrintFrame>
  );
}
