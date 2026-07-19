import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PrintFrame } from "@/components/print/print-frame";
import { DocHeader, DocTable, SignatureRow } from "@/components/print/doc-parts";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Customer return packing list / RMA authorization.
 * Print or save-as-PDF and send to the customer so they can ship the unit back.
 */
export default async function PrintRmaPackingListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [rma, company] = await Promise.all([
    prisma.rma.findUnique({
      where: { id },
      include: {
        customer: true,
        topPart: true,
        topSerial: true,
        quote: { select: { number: true, totalAmount: true, status: true } },
      },
    }),
    prisma.companySettings.findUnique({ where: { id: "default" } }),
  ]);
  if (!rma) notFound();

  const companyName = company?.name || "ForgeRP";
  const issued = rma.approvedAt || rma.requestedAt;

  return (
    <PrintFrame>
      <DocHeader
        company={companyName}
        tagline={company?.tagline}
        title="RMA Return Authorization"
        number={rma.number}
        meta={[
          {
            label: "Issued",
            value: formatDate(issued),
          },
          {
            label: "Coverage",
            value: rma.coverage.replace(/_/g, " "),
          },
          {
            label: "Status",
            value: rma.status.replace(/_/g, " "),
          },
        ]}
      />

      <p className="mt-4 text-sm text-neutral-700">
        This document authorizes the customer to return the product listed below
        for evaluation / repair. Please include a copy of this packing list
        inside the carton and mark the RMA number clearly on the outside of the
        package.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Return from (customer)
          </p>
          <p className="mt-1 font-medium">{rma.customer.name}</p>
          <p className="font-mono text-xs text-neutral-600">{rma.customer.code}</p>
          {(rma.customer.shipToAddress || rma.customer.billToAddress) ? (
            <p className="mt-1 whitespace-pre-line text-neutral-700">
              {rma.customer.shipToAddress || rma.customer.billToAddress}
            </p>
          ) : null}
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Ship to (manufacturer)
          </p>
          <p className="mt-1 font-medium">{companyName}</p>
          <p className="mt-1 text-neutral-700">
            Receiving / RMA dock
            <br />
            Attn: RMA {rma.number}
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Reference RMA number on all labels and paperwork.
          </p>
        </div>
      </div>

      <DocTable
        columns={["#", "Part number", "Description", "Serial number", "Qty"]}
        align={["", "", "", "", "r"]}
        rows={[
          [
            1,
            rma.topPart.partNumber,
            rma.topPart.description,
            rma.customerSn || rma.topSerial?.serial || "—",
            1,
          ],
        ]}
      />

      <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
        <div className="rounded border border-neutral-300 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Symptom / reason for return
          </p>
          <p className="mt-1 whitespace-pre-wrap text-neutral-800">
            {rma.symptom || "— not specified —"}
          </p>
        </div>
        <div className="rounded border border-neutral-300 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Warranty / commercial
          </p>
          <p className="mt-1">
            {rma.warrantyEligible
              ? "Preliminary: may be covered under warranty"
              : "Preliminary: chargeable (subject to evaluation)"}
          </p>
          <p className="mt-1 text-xs text-neutral-600">{rma.warrantyReason}</p>
          {rma.quote ? (
            <p className="mt-2 text-xs">
              Repair quote {rma.quote.number}: $
              {rma.quote.totalAmount.toFixed(2)} ({rma.quote.status})
            </p>
          ) : null}
        </div>
      </div>

      {rma.notes ? (
        <p className="mt-4 text-sm text-neutral-600">
          Internal notes (do not share if sensitive): {rma.notes}
        </p>
      ) : null}

      <div className="mt-6 rounded border border-dashed border-neutral-400 p-3 text-xs text-neutral-600">
        <p className="font-semibold text-neutral-800">Shipping instructions</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>Use ESD-safe packaging for electronic assemblies.</li>
          <li>
            Write <span className="font-mono font-semibold">{rma.number}</span>{" "}
            on the outside of the carton.
          </li>
          <li>Include this packing list inside the box.</li>
          <li>Do not ship without an issued RMA number.</li>
        </ul>
      </div>

      <SignatureRow
        labels={[
          "Authorized by (manufacturer)",
          "Packed by (customer)",
          "Received by (manufacturer dock)",
        ]}
      />
    </PrintFrame>
  );
}
