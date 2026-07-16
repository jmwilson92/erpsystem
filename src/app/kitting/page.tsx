import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { actionCompleteKit, actionCreateKit } from "@/app/actions";
import {
  getAvailableInventory,
  checkBomMaterialAvailability,
} from "@/lib/services/order-fulfillment";
import {
  getUpcomingKits,
  sweepKitReadiness,
  KIT_PREP_WINDOW_DAYS,
} from "@/lib/services/kitting";
import Link from "next/link";
import { CalendarClock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function KittingPage() {
  // Auto-open travelers for WOs inside the prep window with material ready
  await sweepKitReadiness().catch(() => []);

  const upcoming = await getUpcomingKits();
  const [kits, readyWosRaw] = await Promise.all([
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
        // Exclude WOs that already have an open kit traveler
        kitOrders: { none: { status: { in: ["OPEN", "PICKING"] } } },
      },
      include: { part: true, salesOrder: true },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  // Live availability — don't offer Create kit when stock is short
  const readyChecks = await Promise.all(
    readyWosRaw.map(async (wo) => {
      const check = await checkBomMaterialAvailability(wo.id);
      return {
        wo,
        allAvailable: check.allAvailable,
        shorts: check.requirements
          .filter((r) => r.short > 0)
          .map((r) => ({
            partNumber: r.partNumber,
            short: r.short,
          })),
      };
    })
  );
  const readyWos = readyChecks.filter((r) => r.allAvailable);
  const falseReady = readyChecks.filter((r) => !r.allAvailable);

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
        description={`Pick from shown locations · travelers auto-open ${KIT_PREP_WINDOW_DAYS} days before WO start once material lands · early kit allowed when everything's in stock`}
      />

      {upcoming.length > 0 && (
        <Card className="border-sky-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-sky-400" />
              Upcoming kits ({upcoming.length})
            </CardTitle>
            <p className="text-xs text-slate-500">
              Ordered by WO start date. Inside the {KIT_PREP_WINDOW_DAYS}-day
              window with material on hand, the traveler opens automatically —
              material already here means you can kit early.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.map((u) => (
              <div
                key={u.workOrderId}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 ${
                  u.ready
                    ? "border-emerald-900/50"
                    : "border-slate-800"
                }`}
              >
                <div className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/work-orders/${u.workOrderId}`}
                      className="font-mono text-teal-400 hover:underline"
                    >
                      {u.woNumber}
                    </Link>
                    {u.partNumber && (
                      <span className="text-sm text-slate-300">
                        {u.partNumber} × {u.quantity}
                      </span>
                    )}
                    <StatusBadge status={u.status} />
                    {u.daysToStart !== null && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          u.inWindow
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {u.daysToStart <= 0
                          ? "Start date reached"
                          : `Starts in ${u.daysToStart}d`}
                      </span>
                    )}
                  </span>
                  {u.shorts.length > 0 && (
                    <p className="mt-1 text-[11px] text-rose-300">
                      Short:{" "}
                      {u.shorts
                        .map((s) => `${s.partNumber} (−${s.short})`)
                        .join(", ")}
                    </p>
                  )}
                </div>
                {u.ready ? (
                  <form action={actionCreateKit}>
                    <input
                      type="hidden"
                      name="workOrderId"
                      value={u.workOrderId}
                    />
                    <Button type="submit" size="sm">
                      {u.inWindow ? "Open kit traveler" : "Kit early"}
                    </Button>
                  </form>
                ) : (
                  <span className="text-xs text-slate-500">
                    Awaiting material
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {readyWos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ready to kit</CardTitle>
            <p className="text-xs text-slate-500">
              Material covers the full BOM — open a kit traveler to pick.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {readyWos.map(({ wo }) => (
              <div
                key={wo.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-900/40 p-3"
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

      {falseReady.length > 0 && (
        <Card className="border-amber-900/40">
          <CardHeader>
            <CardTitle className="text-base text-amber-200">
              Marked ready but material short
            </CardTitle>
            <p className="text-xs text-slate-500">
              These WOs show READY TO KIT but stock no longer covers the BOM.
              Receive / put away the short parts — or open the traveler for
              details.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {falseReady.map(({ wo, shorts }) => (
              <div
                key={wo.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 p-3"
              >
                <div>
                  <Link
                    href={`/work-orders/${wo.id}`}
                    className="font-mono text-teal-400 hover:underline"
                  >
                    {wo.number}
                  </Link>
                  <span className="ml-2 text-sm text-slate-300">
                    {wo.part?.partNumber} × {wo.quantity}
                  </span>
                  <p className="mt-1 text-[11px] text-rose-300">
                    Short:{" "}
                    {shorts
                      .map((s) => `${s.partNumber} (−${s.short})`)
                      .join(", ")}
                  </p>
                </div>
                <span className="text-xs text-slate-500">Awaiting material</span>
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
