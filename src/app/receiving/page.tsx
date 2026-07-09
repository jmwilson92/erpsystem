import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { Package, Clock, CheckCircle2, Shield } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReceivingPage() {
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
    },
  });

  const waiting = travelers.filter((t) => t.status === "WAITING").length;
  const partial = travelers.filter((t) => t.status === "PARTIAL").length;
  const complete = travelers.filter((t) => t.status === "COMPLETE").length;
  const gfpCount = travelers.filter((t) => t.isGovernmentProperty).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receiving travelers"
        description="PO dock queue and GFP travelers"
        actions={
          <Link href="/receiving/new-gfp">
            <Button size="sm">
              <Shield className="mr-1.5 h-3.5 w-3.5" />
              New GFP traveler
            </Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Waiting" value={waiting} icon={Clock} accent="amber" />
        <StatCard title="Partial" value={partial} icon={Package} accent="sky" />
        <StatCard title="Complete" value={complete} icon={CheckCircle2} accent="teal" />
        <StatCard title="GFP travelers" value={gfpCount} icon={Shield} accent="violet" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-900/90 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Traveler</th>
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
            {travelers.map((t) => {
              const lines = t.purchaseOrder?.lines || t.lines;
              const openLines = lines.filter(
                (l) => l.quantityReceived < l.quantity
              ).length;
              return (
                <tr
                  key={t.id}
                  className="border-t border-slate-800/70 hover:bg-slate-900/50"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/receiving/${t.id}`}
                      className="font-mono font-medium text-teal-400 hover:underline"
                    >
                      {t.number}
                    </Link>
                    {t.isGovernmentProperty && (
                      <span className="ml-1 text-[10px] text-violet-400">GFP</span>
                    )}
                    {t.parent && (
                      <p className="text-[10px] text-slate-600">
                        child of {t.parent.number}
                      </p>
                    )}
                    {t.travelerType !== "PO" && (
                      <p className="text-[10px] text-slate-600">{t.travelerType}</p>
                    )}
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
                    {openLines} / {lines.length}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-slate-500">
                    {t.children.length > 0
                      ? `${t.children.length} child`
                      : t.parent
                        ? "remainder"
                        : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={t.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {travelers.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-500">
            No receiving travelers. Issue a PO from Purchasing to create one.
          </div>
        )}
      </div>
    </div>
  );
}
