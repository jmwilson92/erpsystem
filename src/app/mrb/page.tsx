import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import { actionDispositionMrb } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function MrbPage() {
  const cases = await prisma.mrbCase.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      ncr: { include: { part: true, supplier: true, inspection: true } },
      dispositions: { include: { decidedBy: true } },
      inventoryHolds: true,
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Material Review Board"
        description="Formal disposition of non-conforming material — quarantine, board, scorecard impact"
      />

      <div className="grid gap-4">
        {cases.map((mrb) => (
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
                    <CardTitle className="font-mono text-amber-400">{mrb.number}</CardTitle>
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
                      <div className="flex items-center gap-2">
                        <StatusBadge status={d.disposition} />
                        <span className="text-slate-400">qty {d.quantity}</span>
                        {d.carNumber && (
                          <span className="text-xs text-sky-400">
                            CAR {d.carNumber} ({d.carStatus})
                          </span>
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
                <form action={actionDispositionMrb} className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                  <p className="text-sm font-medium text-slate-200">
                    Board Disposition
                  </p>
                  <input type="hidden" name="mrbCaseId" value={mrb.id} />
                  <input type="hidden" name="quantity" value={String(mrb.ncr.quantity)} />
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
                    <input type="checkbox" name="createCar" value="true" defaultChecked className="accent-teal-500" />
                    Create Corrective Action Request (CAR) for supplier
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
