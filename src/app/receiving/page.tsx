import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
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
import { ReceivingQueueSearch } from "@/components/receiving/receiving-queue-search";
import { StationNextGuideBanner } from "@/components/receiving/station-next-guide";
import { actionCompleteWoToStock } from "@/app/actions";
import { ActionLoadingForm } from "@/components/layout/action-loading";

export const dynamic = "force-dynamic";

function pick(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string {
  const v = sp[key];
  return Array.isArray(v) ? v[0] || "" : v || "";
}

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tabRaw = pick(sp, "tab");
  const tab =
    tabRaw === "complete"
      ? "complete"
      : tabRaw === "putaway"
        ? "putaway"
        : "active";
  const q = pick(sp, "q").trim().toLowerCase();

  const woPutaways = await prisma.workOrder.findMany({
    where: { status: "READY_FOR_PUTAWAY" },
    include: {
      part: { select: { partNumber: true, description: true } },
      salesOrder: { select: { id: true, number: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  const travelers = await prisma.receivingTraveler.findMany({
    orderBy: [{ updatedAt: "desc" }],
    include: {
      parent: { select: { number: true } },
      children: {
        select: {
          id: true,
          number: true,
          status: true,
          currentWorkCenter: true,
        },
      },
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
  const atInspect = travelers.filter((t) => t.status === "IN_INSPECTION")
    .length;
  const readyStock = travelers.filter(
    (t) => t.status === "READY_TO_STOCK"
  ).length;
  const completeCount = travelers.filter((t) =>
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
    tab === "complete"
      ? ["COMPLETE", "CLOSED"].includes(t.status)
      : ACTIONABLE.has(t.status)
  );

  if (q) {
    rows = rows.filter((t) => {
      const hay = [
        t.number,
        t.notes,
        t.contractNumber,
        t.parent?.number,
        t.purchaseOrder?.number,
        t.purchaseOrder?.supplier.name,
        t.purchaseOrder?.project?.number,
        t.customer?.name,
        t.customer?.code,
        ...t.children.map((c) => c.number),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  // Sort: putaway & inspection first on active; complete by updated
  rows = [...rows].sort((a, b) => {
    if (tab === "complete") {
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    }
    const ra = statusRank[a.status] ?? 9;
    const rb = statusRank[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return a.number.localeCompare(b.number);
  });

  const activeCount = travelers.filter((t) => ACTIONABLE.has(t.status)).length;

  function tabHref(nextTab: "active" | "complete" | "putaway") {
    const p = new URLSearchParams();
    if (nextTab === "complete") p.set("tab", "complete");
    if (nextTab === "putaway") p.set("tab", "putaway");
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/receiving?${s}` : "/receiving";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receiving"
        description="Dock RCV travelers and finished-work-order putaway at the Receiving workcenter."
        actions={
          <div className="flex flex-wrap gap-2">
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
        <StatCard
          title="Waiting dock"
          value={waiting}
          icon={Clock}
          accent="amber"
        />
        <StatCard title="Partial" value={partial} icon={Package} accent="sky" />
        <StatCard
          title="At QA / Test"
          value={atInspect}
          icon={FlaskConical}
          accent="violet"
        />
        <StatCard
          title="WO putaway"
          value={woPutaways.length}
          icon={MapPin}
          accent="teal"
        />
        <StatCard
          title={tab === "complete" ? "Complete" : "RCV ready putaway"}
          value={tab === "complete" ? completeCount : readyStock}
          icon={tab === "complete" ? CheckCircle2 : Package}
          accent={tab === "complete" ? "teal" : "sky"}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-0">
          <Link
            href={tabHref("active")}
            className={cn(
              "rounded-t-md px-3 py-1.5 text-sm",
              tab === "active"
                ? "border border-b-0 border-slate-700 bg-slate-900 text-slate-50"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            RCV travelers ({activeCount})
          </Link>
          <Link
            href={tabHref("putaway")}
            className={cn(
              "rounded-t-md px-3 py-1.5 text-sm",
              tab === "putaway"
                ? "border border-b-0 border-slate-700 bg-slate-900 text-slate-50"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            WO putaway ({woPutaways.length})
          </Link>
          <Link
            href={tabHref("complete")}
            className={cn(
              "rounded-t-md px-3 py-1.5 text-sm",
              tab === "complete"
                ? "border border-b-0 border-slate-700 bg-slate-900 text-slate-50"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            Completed ({completeCount})
          </Link>
        </div>
        {tab !== "putaway" && (
          <Suspense
            fallback={
              <div className="h-9 min-w-[200px] max-w-md flex-1 rounded-md border border-slate-800 bg-slate-950" />
            }
          >
            <ReceivingQueueSearch defaultValue={pick(sp, "q")} />
          </Suspense>
        )}
      </div>

      {tab === "putaway" && (
        <div className="space-y-3">
          <StationNextGuideBanner
            guide={{
              kind: "PUTAWAY",
              title: "Finished work orders — put away at Receiving",
              detail:
                "These travelers finished all build / QA / Test steps. Put finished goods into stock here. Material handlers bring units from the line to this workcenter.",
              href: "/floor",
              label: "Floor board",
            }}
          />
          {woPutaways.length === 0 ? (
            <div className="rounded-xl border border-slate-800 py-10 text-center text-sm text-slate-500">
              No work orders waiting for putaway.
            </div>
          ) : (
            woPutaways.map((wo) => (
              <div
                key={wo.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-900/40 bg-teal-500/5 p-4"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/work-orders/${wo.id}`}
                      className="font-mono text-base font-semibold text-teal-400 hover:underline"
                    >
                      {wo.number}
                    </Link>
                    <StatusBadge status={wo.status} />
                    {wo.workCenter && (
                      <span className="font-mono text-[10px] text-slate-500">
                        @ {wo.workCenter}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-sm text-slate-300">
                    {wo.part?.partNumber || "—"} × {wo.quantity}
                  </p>
                  <p className="text-xs text-slate-500">
                    {wo.part?.description || wo.description || ""}
                    {wo.salesOrder ? ` · ${wo.salesOrder.number}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-teal-200/90">
                    What to do next: put away to stock, then the unit is available
                    for shipping / kitting demand.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/work-orders/${wo.id}`}>
                    <Button size="sm" variant="outline">
                      Open traveler
                    </Button>
                  </Link>
                  <ActionLoadingForm
                    theme="receiving"
                    action={actionCompleteWoToStock}
                  >
                    <input type="hidden" name="workOrderId" value={wo.id} />
                    <Button type="submit" size="sm">
                      Put away @ {wo.workCenter || "RCV-01"} → stock
                    </Button>
                  </ActionLoadingForm>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab !== "putaway" && (
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
              // Parent: surface putaway / deliver child in Next column
              let next = listNextLabel({
                status: t.status,
                purpose,
                hasQaPending: hasQa,
                hasTestPending: hasTest,
              });
              if (!t.parentId && t.children.length > 0) {
                const ready = t.children.find(
                  (c) => c.status === "READY_TO_STOCK"
                );
                const undelivered = t.children.find(
                  (c) => c.status === "IN_INSPECTION" && !c.currentWorkCenter
                );
                const waiting = t.children.find(
                  (c) => c.status === "IN_INSPECTION" && !!c.currentWorkCenter
                );
                if (ready) next = `Put away ${ready.number}`;
                else if (undelivered) next = `Deliver ${undelivered.number}`;
                else if (waiting) next = `Waiting ${waiting.number}`;
                else if (["COMPLETE", "CLOSED"].includes(t.status))
                  next = "Done";
              }
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
                    {t.currentWorkCenter && (
                      <p className="font-mono text-[10px] text-amber-400/80">
                        @ {t.currentWorkCenter}
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
                        next.startsWith("Put away")
                          ? "border-teal-500/40 bg-teal-500/10 text-teal-300"
                          : next.startsWith("Deliver")
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                            : next.startsWith("Waiting") || next.startsWith("At ")
                              ? "border-slate-600 bg-slate-800/50 text-slate-300"
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
                      <span className="text-xs text-violet-400">
                        No PO · GFP
                      </span>
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
            {q
              ? `No travelers match “${pick(sp, "q")}”.`
              : tab === "complete"
                ? "No completed travelers yet."
                : "Nothing in the active dock queue. Check the Completed tab for history."}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
