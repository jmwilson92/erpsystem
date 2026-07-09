import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import { actionDispositionMrb } from "@/app/actions";
import { CarUpdateForm } from "@/components/mrb/car-update-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function MrbPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const highlightCar = pick(sp, "car");
  const filter = pick(sp, "filter") || "open"; // open | cars | all

  const cases = await prisma.mrbCase.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      ncr: { include: { part: true, supplier: true, inspection: true } },
      dispositions: { include: { decidedBy: true }, orderBy: { decidedAt: "desc" } },
      inventoryHolds: true,
    },
  });

  const openCases = cases.filter((c) =>
    ["OPEN", "IN_REVIEW"].includes(c.status)
  );
  const cars = cases.flatMap((c) =>
    c.dispositions
      .filter((d) => d.carNumber)
      .map((d) => ({ disposition: d, mrb: c }))
  );
  const openCars = cars.filter(
    (c) => !["CLOSED", "VERIFIED"].includes(c.disposition.carStatus || "")
  );

  const shown =
    filter === "cars"
      ? cases.filter((c) => c.dispositions.some((d) => d.carNumber))
      : filter === "all"
        ? cases
        : openCases.length
          ? openCases
          : cases.slice(0, 5);

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Material Review Board"
        description="Disposition non-conforming material · track CARs · release / scrap / rework"
        actions={
          <Link href="/quality">
            <Button size="sm" variant="outline">
              NCR list
            </Button>
          </Link>
        }
      />

      {highlightCar && (
        <Card className="border-sky-500/40 bg-sky-500/10">
          <CardContent className="p-4 text-sm text-sky-100">
            CAR <span className="font-mono font-semibold">{highlightCar}</span>{" "}
            created. Update status and supplier response in the CAR panel below.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/mrb?filter=open"
          className={`rounded border px-3 py-1.5 ${
            filter === "open"
              ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
              : "border-slate-700 text-slate-400"
          }`}
        >
          Open MRB ({openCases.length})
        </Link>
        <Link
          href="/mrb?filter=cars"
          className={`rounded border px-3 py-1.5 ${
            filter === "cars"
              ? "border-sky-500/50 bg-sky-500/10 text-sky-200"
              : "border-slate-700 text-slate-400"
          }`}
        >
          CARs ({openCars.length} open / {cars.length} total)
        </Link>
        <Link
          href="/mrb?filter=all"
          className={`rounded border px-3 py-1.5 ${
            filter === "all"
              ? "border-slate-500 bg-slate-800 text-slate-200"
              : "border-slate-700 text-slate-400"
          }`}
        >
          All cases ({cases.length})
        </Link>
      </div>

      {openCars.length > 0 && (
        <Card className="border-sky-900/40">
          <CardHeader>
            <CardTitle className="text-base">Open Corrective Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {openCars.map(({ disposition: d, mrb }) => (
              <div
                key={d.id}
                className={`rounded-lg border p-4 ${
                  highlightCar === d.carNumber
                    ? "border-sky-500/50 bg-sky-500/5"
                    : "border-slate-800 bg-slate-950/40"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-lg font-semibold text-sky-400">
                        {d.carNumber}
                      </span>
                      <StatusBadge status={d.carStatus || "OPEN"} />
                      <StatusBadge status={d.disposition} />
                    </div>
                    <p className="mt-1 text-sm text-slate-300">
                      {d.carTitle || mrb.ncr.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {mrb.number} · NCR {mrb.ncr.number} ·{" "}
                      {mrb.ncr.part?.partNumber || "—"}
                      {mrb.ncr.supplier
                        ? ` · ${mrb.ncr.supplier.name}`
                        : ""}
                      {d.carDueDate
                        ? ` · Due ${formatDate(d.carDueDate)}`
                        : ""}
                    </p>
                    {d.carNotes && (
                      <p className="mt-2 text-xs text-slate-400">{d.carNotes}</p>
                    )}
                    {d.carResponse && (
                      <p className="mt-1 text-xs text-emerald-400/90">
                        Response: {d.carResponse}
                      </p>
                    )}
                    {d.reworkWorkOrderId && (
                      <Link
                        href={`/work-orders/${d.reworkWorkOrderId}`}
                        className="mt-1 inline-block text-xs text-teal-400 hover:underline"
                      >
                        Rework WO →
                      </Link>
                    )}
                  </div>
                </div>

                <CarUpdateForm
                  dispositionId={d.id}
                  carStatus={d.carStatus || "OPEN"}
                  carResponse={d.carResponse || ""}
                  carNotes={d.carNotes || ""}
                  existingAttachments={
                    d.carAttachments
                      ? (JSON.parse(d.carAttachments) as {
                          url: string;
                          fileName?: string;
                          caption?: string;
                        }[])
                      : []
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {shown.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-slate-500">
              No MRB cases match this filter.
            </CardContent>
          </Card>
        )}

        {shown.map((mrb) => (
          <Card
            key={mrb.id}
            className={
              mrb.status === "OPEN" || mrb.status === "IN_REVIEW"
                ? "border-amber-500/30"
                : ""
            }
          >
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="font-mono text-amber-400">
                      {mrb.number}
                    </CardTitle>
                    <StatusBadge status={mrb.status} />
                    <StatusBadge status={mrb.ncr.severity} />
                  </div>
                  <p className="mt-1 text-sm text-slate-300">{mrb.ncr.title}</p>
                  <p className="text-xs text-slate-500">
                    NCR {mrb.ncr.number} · {mrb.ncr.part?.partNumber} · Qty{" "}
                    {mrb.ncr.quantity}
                    {mrb.ncr.lotNumber ? ` · Lot ${mrb.ncr.lotNumber}` : ""}
                    {mrb.ncr.supplier
                      ? ` · ${mrb.ncr.supplier.name} (${mrb.ncr.supplier.rating})`
                      : ""}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p>Opened {formatDate(mrb.createdAt)}</p>
                  {mrb.boardDate && <p>Board {formatDate(mrb.boardDate)}</p>}
                  {mrb.inventoryHolds.length > 0 && (
                    <p className="text-orange-400">
                      {mrb.inventoryHolds.length} inventory hold(s)
                    </p>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-400">{mrb.ncr.description}</p>
              {mrb.notes && (
                <p className="text-xs text-slate-500">Notes: {mrb.notes}</p>
              )}

              {mrb.dispositions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase text-slate-500">
                    Dispositions
                  </p>
                  {mrb.dispositions.map((d) => (
                    <div
                      key={d.id}
                      className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={d.disposition} />
                        <span className="text-slate-400">qty {d.quantity}</span>
                        {d.carNumber && (
                          <span className="font-mono text-xs text-sky-400">
                            {d.carNumber}
                            {d.carStatus ? ` · ${d.carStatus}` : ""}
                          </span>
                        )}
                        {d.reworkWorkOrderId && (
                          <Link
                            href={`/work-orders/${d.reworkWorkOrderId}`}
                            className="text-xs text-teal-400 hover:underline"
                          >
                            Rework WO
                          </Link>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {d.justification} · {d.decidedBy?.name} ·{" "}
                        {formatDate(d.decidedAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {["OPEN", "IN_REVIEW"].includes(mrb.status) && (
                <form
                  action={actionDispositionMrb}
                  className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4"
                >
                  <p className="text-sm font-medium text-slate-200">
                    Board Disposition
                  </p>
                  <input type="hidden" name="mrbCaseId" value={mrb.id} />
                  <input
                    type="hidden"
                    name="quantity"
                    value={String(mrb.ncr.quantity)}
                  />
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        "USE_AS_IS",
                        "REWORK",
                        "SCRAP",
                        "RETURN_TO_SUPPLIER",
                        "REPAIR",
                      ] as const
                    ).map((d) => (
                      <label
                        key={d}
                        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-700 px-2 py-1.5 text-xs hover:border-teal-500/50 has-[:checked]:border-teal-500 has-[:checked]:bg-teal-500/10"
                      >
                        <input
                          type="radio"
                          name="disposition"
                          value={d}
                          defaultChecked={d === "RETURN_TO_SUPPLIER"}
                          className="accent-teal-500"
                        />
                        {d.replace(/_/g, " ")}
                      </label>
                    ))}
                  </div>
                  <Textarea
                    name="justification"
                    placeholder="Justification / root cause notes..."
                    required
                    defaultValue="Board disposition after review of inspection data and supplier history."
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      name="createCar"
                      value="true"
                      defaultChecked
                      className="accent-teal-500"
                    />
                    Create Corrective Action Request (CAR) — appears in CAR
                    panel for follow-up
                  </label>
                  <Button type="submit" size="sm">
                    Record Disposition
                  </Button>
                </form>
              )}

              {mrb.ncr.supplier && (
                <Link
                  href={`/suppliers/${mrb.ncr.supplierId}`}
                  className="text-xs text-teal-400 hover:underline"
                >
                  View supplier scorecard →
                </Link>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
