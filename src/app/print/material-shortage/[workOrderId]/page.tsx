import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PrintFrame } from "@/components/print/print-frame";
import { DocHeader, DocTable, SignatureRow } from "@/components/print/doc-parts";
import { checkBomMaterialAvailability } from "@/lib/services/order-fulfillment";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PrintMaterialShortagePage({
  params,
}: {
  params: Promise<{ workOrderId: string }>;
}) {
  const { workOrderId } = await params;
  const [check, company] = await Promise.all([
    checkBomMaterialAvailability(workOrderId),
    prisma.companySettings.findUnique({ where: { id: "default" } }),
  ]);
  if (!check.wo) notFound();

  const wo = check.wo;
  const shortages = check.requirements.filter((r) => r.short > 0);
  const printedAt = new Date();

  return (
    <PrintFrame>
      <DocHeader
        company={company?.name || "ForgeRP"}
        tagline={company?.tagline}
        title="Material Shortage Report"
        number={wo.number}
        meta={[
          { label: "Printed", value: formatDate(printedAt, "MMM d, yyyy HH:mm") },
          {
            label: "Part",
            value: wo.part
              ? `${wo.part.partNumber} — ${wo.part.description || ""}`
              : "—",
          },
          { label: "Qty", value: String(wo.quantity) },
          {
            label: "Due",
            value: wo.dueDate ? formatDate(wo.dueDate) : "—",
          },
          {
            label: "Status",
            value: `${wo.status.replace(/_/g, " ")} · kit ${wo.kitStatus?.replace(/_/g, " ") || "—"}`,
          },
        ]}
      />

      <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {check.allAvailable ? (
          <p>
            <strong>No shortages</strong> — all BOM components are available for
            this work order.
          </p>
        ) : (
          <p>
            <strong>{shortages.length} line(s) short</strong> for traveler{" "}
            <span className="font-mono">{wo.number}</span>. Purchase requests are
            planned from the sales order (or MRS), not from this printout.
          </p>
        )}
      </div>

      <div className="mt-6">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          BOM material check
        </p>
        <DocTable
          columns={[
            "Part",
            "Description",
            "Required",
            "Available",
            "Short",
            "UOM",
          ]}
          rows={check.requirements.map((r) => [
            r.partNumber,
            r.description || "—",
            String(r.required),
            String(r.available),
            r.short > 0 ? String(r.short) : "—",
            r.uom || "EA",
          ])}
        />
      </div>

      {shortages.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-rose-700">
            Action list — shortages only
          </p>
          <DocTable
            columns={["Part", "Short qty", "UOM", "Notes"]}
            rows={shortages.map((r) => [
              r.partNumber,
              String(r.short),
              r.uom || "EA",
              "Receive / put away or plan PR from sales order",
            ])}
          />
        </div>
      )}

      <div className="mt-10">
        <SignatureRow
          labels={["Material handler", "Production lead", "Date"]}
        />
      </div>

      <p className="mt-8 text-[10px] text-neutral-500">
        Generated from work order material check. Use Print / Save PDF in the
        toolbar.
      </p>
    </PrintFrame>
  );
}
