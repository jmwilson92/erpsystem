import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PrintFrame } from "@/components/print/print-frame";
import { DocHeader, DocTable, SignatureRow } from "@/components/print/doc-parts";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PrintPackingListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [shipment, company] = await Promise.all([
    prisma.shipment.findUnique({
      where: { id },
      include: {
        salesOrder: { include: { customer: true } },
        mrbCase: { select: { number: true } },
        lines: true,
      },
    }),
    prisma.companySettings.findUnique({ where: { id: "default" } }),
  ]);
  if (!shipment) notFound();

  const isRtv = Boolean(shipment.mrbCase);
  const totalQty = shipment.lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <PrintFrame>
      <DocHeader
        company={company?.name || "ForgeERP"}
        tagline={company?.tagline}
        title={isRtv ? "Return Packing List" : "Packing List"}
        number={shipment.number}
        meta={[
          {
            label: "Ship date",
            value: shipment.shipDate ? formatDate(shipment.shipDate) : "Pending",
          },
          ...(shipment.carrier
            ? [{ label: "Carrier", value: shipment.carrier }]
            : []),
          ...(shipment.trackingNumber
            ? [{ label: "Tracking", value: shipment.trackingNumber }]
            : []),
          { label: "Status", value: shipment.status.replace(/_/g, " ") },
        ]}
      />

      <div className="mt-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Ship to
          </p>
          <p className="mt-1 whitespace-pre-line">
            {shipment.shipToAddress ||
              shipment.salesOrder?.customer?.name ||
              "See order"}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            References
          </p>
          {shipment.salesOrder ? (
            <p className="mt-1">
              Sales order: <span className="font-mono">{shipment.salesOrder.number}</span>
            </p>
          ) : null}
          {shipment.mrbCase ? (
            <p className="mt-1">
              MRB case: <span className="font-mono">{shipment.mrbCase.number}</span>{" "}
              — return to supplier
            </p>
          ) : null}
          {shipment.packingListVerified ? (
            <p className="mt-1 text-neutral-600">Packing list verified</p>
          ) : null}
        </div>
      </div>

      <DocTable
        columns={["#", "Description", "Lot", "Serial number(s)", "Qty"]}
        align={["", "", "", "", "r"]}
        rows={shipment.lines.map((l, i) => [
          i + 1,
          l.description,
          l.lotNumber || "—",
          l.serialNumbers || "—",
          l.quantity,
        ])}
      />

      <div className="mt-4 flex justify-end text-sm">
        <div className="w-56 border-t-2 border-neutral-900 pt-2">
          <div className="flex justify-between font-bold">
            <span>Total pieces</span>
            <span className="tabular-nums">{totalQty}</span>
          </div>
        </div>
      </div>

      {shipment.notes ? (
        <p className="mt-6 text-sm text-neutral-600">Notes: {shipment.notes}</p>
      ) : null}

      <SignatureRow labels={["Packed by", "Received by (consignee)"]} />
    </PrintFrame>
  );
}
