import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { actionCompleteKit, actionCreateKit } from "@/app/actions";
import { getAvailableInventory } from "@/lib/services/order-fulfillment";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function KittingPage() {
  const [kits, readyWos] = await Promise.all([
    prisma.kitOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        workOrder: {
          include: { part: true, salesOrder: true, project: true },
        },
        lines: { include: { part: true } },
      },
    }),
    prisma.workOrder.findMany({
      where: {
        OR: [
          { status: "READY_TO_KIT" },
          {
            kitStatus: "READY_TO_KIT",
            status: { notIn: ["COMPLETED", "CLOSED", "CANCELLED"] },
          },
        ],
      },
      include: { part: true, salesOrder: true },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  // Prefetch bin locations for open kit lines
  const openPartIds = [
    ...new Set(
      kits
        .filter((k) => ["OPEN", "PICKING", "SHORT"].includes(k.status))
        .flatMap((k) => k.lines.map((l) => l.partId))
    ),
  ];
  const binsByPart: Record<
    string,
    Awaited<ReturnType<typeof getAvailableInventory>>
  > = {};
  await Promise.all(
    openPartIds.map(async (pid) => {
      binsByPart[pid] = await getAvailableInventory(pid);
    })
  );

  const selectClass =
    "flex h-8 w-full max-w-xs rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kitting"
        description="Pick from shown locations · multi-bin choose one · GFP requires project charge match"
      />

      {readyWos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ready to kit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {readyWos.map((wo) => (
              <div
                key={wo.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 p-3"
              >
                <div>
                  <Link
                    href={`/work-orders/${wo.id}`}
                    className="font-mono text-teal-400"
                  >
                    {wo.number}
                  </Link>
                  <span className="ml-2 text-sm text-slate-300">
                    {wo.part?.partNumber} × {wo.quantity}
                  </span>
                  {wo.salesOrder && (
                    <span className="ml-2 text-xs text-slate-500">
                      for{" "}
                      <Link
                        href={`/sales/${wo.salesOrder.id}`}
                        className="text-sky-400"
                      >
                        {wo.salesOrder.number}
                      </Link>
                    </span>
                  )}
                  <p className="text-xs text-slate-500">
                    Due {formatDate(wo.dueDate)}
                  </p>
                </div>
                <form action={actionCreateKit}>
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <Button type="submit" size="sm">
                    Create kit order
                  </Button>
                </form>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Kit orders
        </h2>
        {kits.map((kit) => {
          const open = ["OPEN", "PICKING", "SHORT"].includes(kit.status);
          return (
            <Card key={kit.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="font-mono text-teal-400">
                    {kit.number}
                  </CardTitle>
                  <StatusBadge status={kit.status} />
                  <Link
                    href={`/work-orders/${kit.workOrderId}`}
                    className="text-xs text-sky-400 hover:underline"
                  >
                    Traveler {kit.workOrder.number}
                  </Link>
                  {kit.workOrder.project && (
                    <span className="text-xs text-slate-500">
                      Charge {kit.workOrder.project.number}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  {kit.workOrder.part?.partNumber} · Created{" "}
                  {formatDate(kit.createdAt)}
                </p>
              </CardHeader>
              <CardContent>
                <form action={actionCompleteKit}>
                  <input type="hidden" name="kitOrderId" value={kit.id} />
                  <table className="mb-3 w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500">
                        <th className="pb-1">Part</th>
                        <th className="pb-1 text-right">Req</th>
                        <th className="pb-1">Pick from location</th>
                        <th className="pb-1">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kit.lines.map((l) => {
                        const bins = binsByPart[l.partId] || [];
                        const gfpBins = bins.filter(
                          (b) =>
                            b.ownership === "GOVERNMENT" ||
                            b.location.type === "GFP"
                        );
                        return (
                          <tr
                            key={l.id}
                            className="border-t border-slate-800/50 align-top"
                          >
                            <td className="py-2">
                              <span className="font-mono text-xs text-slate-300">
                                {l.part.partNumber}
                              </span>
                              <p className="text-[10px] text-slate-600">
                                {l.part.description}
                              </p>
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {l.quantityRequired}
                            </td>
                            <td className="py-2">
                              {open ? (
                                bins.length === 0 ? (
                                  <span className="text-xs text-rose-400">
                                    No stock locations
                                  </span>
                                ) : (
                                  <select
                                    name={`pick_${l.id}`}
                                    className={selectClass}
                                    defaultValue={bins[0]?.id || ""}
                                  >
                                    {bins.map((b) => (
                                      <option key={b.id} value={b.id}>
                                        {b.location.code}
                                        {b.location.name
                                          ? ` — ${b.location.name}`
                                          : ""}{" "}
                                        · qty {b.quantityAvailable}
                                        {b.lotNumber
                                          ? ` · lot ${b.lotNumber}`
                                          : ""}
                                        {b.ownership === "GOVERNMENT" ||
                                        b.location.type === "GFP"
                                          ? " · GFP"
                                          : ""}
                                      </option>
                                    ))}
                                  </select>
                                )
                              ) : (
                                <span className="text-xs text-slate-500">
                                  {l.lotNumber || "—"}
                                </span>
                              )}
                              {gfpBins.length > 0 &&
                                !kit.workOrder.projectId &&
                                open && (
                                  <p className="mt-0.5 text-[10px] text-amber-400">
                                    GFP present — WO needs project charge number
                                    match
                                  </p>
                                )}
                            </td>
                            <td className="py-2">
                              <StatusBadge status={l.status} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {open && (
                    <Button type="submit" size="sm">
                      Pick complete kit → traveler
                    </Button>
                  )}
                </form>
              </CardContent>
            </Card>
          );
        })}
        {kits.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-slate-500">
              No kit orders yet.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
