import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import {
  Package,
  Clock,
  CheckCircle2,
  Shield,
  FlaskConical,
  MapPin,
  Split,
} from "lucide-react";
import { travelerPurpose } from "@/lib/services/receiving";
import { listNextLabel } from "@/lib/services/receiving-ui";

export const dynamic = "force-dynamic";

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const showComplete =
    (Array.isArray(sp.show) ? sp.show[0] : sp.show) === "all";

  const travelers = await prisma.receivingTraveler.findMany({
    orderBy: [{ status: "asc" }, { expectedDate: "asc" }],
    include: {
      parent: { select: { number: true } },
      children: { select: { id: true, number: true, status: true } },
      customer: { select: { name: true, code: true } },
      lines: true,
      purchaseOrder: {
        include: {
          supplier: true,
          lines: true,
          project: { select: { number: true } },
        },
      },
      receipts: {
        select: {
          id: true,
          lines: { select: { id: true } },
        },
        take: 5,
      },
    },
  });

  // Open inspections for "At QA" vs "At Test" next labels
  const receiptIds = travelers.flatMap((t) => t.receipts.map((r) => r.id));
  const openInsps =
    receiptIds.length > 0
      ? await prisma.inspection.findMany({
          where: {
            receiptId: { in: receiptIds },
            status: { in: ["PENDING", "IN_PROGRESS"] },
          },
          select: { receiptId: true, type: true },
        })
      : [];
  const inspByReceipt = new Map<string, string[]>();
  for (const i of openInsps) {
    if (!i.receiptId) continue;
    const arr = inspByReceipt.get(i.receiptId) || [];
    arr.push(i.type);
    inspByReceipt.set(i.receiptId, arr);
  }

  const waiting = travelers.filter((t) => t.status === "WAITING").length;
  const partial = travelers.filter((t) => t.status === "PARTIAL").length;
  const atInspect = travelers.filter((t) => t.status === "IN_INSPECTION").length;
  const readyStock = travelers.filter(
    (t) => t.status === "READY_TO_STOCK"
  ).length;
  const complete = travelers.filter((t) =>
    ["COMPLETE", "CLOSED"].includes(t.status)
  ).length;
  const gfpCount = travelers.filter((t) => t.isGovernmentProperty).length;

  const ACTIONABLE = new Set([
    "WAITING",
    "PARTIAL",
    "IN_INSPECTION",
    "READY_TO_STOCK",
  ]);

  const statusRank: Record<string, number> = {
    READY_TO_STOCK: 0,
    IN_INSPECTION: 1,
    WAITING: 2,
    PARTIAL: 3,
    COMPLETE: 4,
    CLOSED: 5,
  };

  let rows = travelers.filter((t) =>
    showComplete ? true : ACTIONABLE.has(t.status)
  );

  // Sort: putaway & inspection first, then dock; children after parents in group
  rows = [...rows].sort((a, b) => {
    const ra = statusRank[a.status] ?? 9;
    const rb = statusRank[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    // Group family: root number then child
    const an = a.parentId ? a.number : a.number;
    const bn = b.parentId ? b.number : b.number;
    return an.localeCompare(bn);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receiving travelers"
        description="Dock queue — one next action per traveler. Children are -01, -02… per line (not QA/Test silos)."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={showComplete ? "/receiving" : "/receiving?show=all"}>
              <Button size="sm" variant="outline">
                {showComplete ? "Hide complete" : "Show complete"}
              </Button>
            </Link>
            <Link href="/receiving/new-gfp">
              <Button size="sm">
                <Shield className="mr-1.5 h-3.5 w-3.5" />
                New GFP traveler
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Waiting dock" value={waiting} icon={Clock} accent="amber" />
        <StatCard title="Partial" value={partial} icon={Package} accent="sky" />
        <StatCard
          title="At QA / Test"
          value={atInspect}
          icon={FlaskConical}
          accent="violet"
        />
        <StatCard
          title="Ready to put away"
          value={readyStock}
          icon={MapPin}
          accent="teal"
        />
        <StatCard
          title={showComplete ? "Complete" : "GFP"}
          value={showComplete ? complete : gfpCount}
          icon={showComplete ? CheckCircle2 : Shield}
          accent={showComplete ? "teal" : "violet"}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-slate-900/90 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Traveler</th>
              <th className="px-3 py-2 text-left">Next</th>
              <th className="px-3 py-2 text-left">PO #</th>
              <th className="px-3 py-2 text-left">Vendor</th>
              <th className="px-3 py-2 text-right">PO amount</th>
              <th className="px-3 py-2 text-left">EDD</th>
              <th className="px-3 py-2 text-left">Lines open</th>
              <th className="px-3 py-2 text-left">Split</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const purpose = travelerPurpose(t);
              const lines =
                purpose === "REMAINDER" ||
                purpose === "CHILD" ||
                t.parentId ||
                !t.purchaseOrder
                  ? t.lines.length
                    ? t.lines
                    : t.purchaseOrder?.lines || []
                  : t.purchaseOrder?.lines || t.lines;
              const openLines = lines.filter(
                (l) => l.quantityReceived < l.quantity
              ).length;
              const types = t.receipts.flatMap(
                (r) => inspByReceipt.get(r.id) || []
              );
              const hasQa = types.some((x) => ["VISUAL", "GDT"].includes(x));
              const hasTest = types.some((x) => x === "FUNCTIONAL");
              const next = listNextLabel({
                status: t.status,
                purpose,
                hasQaPending: hasQa,
                hasTestPending: hasTest,
              });
              const isChild = !!t.parentId;

              return (
                <tr
                  key={t.id}
                  className={`border-t border-slate-800/70 hover:bg-slate-900/50 ${
                    isChild ? "bg-slate-950/40" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/receiving/${t.id}`}
                      className={`font-mono font-medium text-teal-400 hover:underline ${
                        isChild ? "pl-3" : ""
                      }`}
                    >
                      {t.number}
                    </Link>
                    {t.isGovernmentProperty && (
                      <span className="ml-1 text-[10px] text-violet-400">
                        GFP
                      </span>
                    )}
                    {t.parent && (
                      <p className="text-[10px] text-slate-600">
                        child of {t.parent.number}
                      </p>
                    )}
                    {t.notes && (
                      <p className="mt-0.5 max-w-xs truncate text-[10px] text-slate-500">
                        {t.notes}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        next === "Put away"
                          ? "border-teal-500/40 bg-teal-500/10 text-teal-300"
                          : next.startsWith("At ")
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                            : next === "Done"
                              ? "border-slate-700 text-slate-500"
                              : "border-sky-500/40 bg-sky-500/10 text-sky-300"
                      }`}
                    >
                      {next}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {t.purchaseOrderId && t.purchaseOrder ? (
                      <Link
                        href={`/purchasing/po/${t.purchaseOrderId}`}
                        className="font-mono text-sky-400 hover:underline"
                      >
                        {t.purchaseOrder.number}
                      </Link>
                    ) : (
                      <span className="text-xs text-violet-400">No PO · GFP</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    {t.purchaseOrder?.supplier.name ||
                      t.customer?.name ||
                      t.contractNumber ||
                      "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.purchaseOrder
                      ? formatCurrency(t.purchaseOrder.totalAmount)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {formatDate(
                      t.expectedDate || t.purchaseOrder?.promisedDate
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {openLines} / {lines.length || "—"}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-slate-500">
                    {t.children.length > 0 ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Split className="h-3 w-3" />
                        {t.children.length} child
                      </span>
                    ) : t.parent ? (
                      "child"
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={t.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-500">
            {showComplete
              ? "No receiving travelers. Issue a PO from Purchasing to create one."
              : "Nothing in the dock queue. Toggle “Show complete” for history."}
          </div>
        )}
      </div>
    </div>
  );
}
