import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ActivityTimeline } from "@/components/shared/activity-timeline";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-sm text-slate-200">{value || "—"}</p>
    </div>
  );
}

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      assignedToUser: { select: { id: true, name: true } },
      workOrder: { select: { id: true, number: true } },
      engTask: { select: { id: true, number: true } },
      checkouts: {
        orderBy: { checkedOutAt: "desc" },
        include: { user: { select: { name: true } } },
      },
    },
  });
  if (!asset) notFound();

  const openOut = asset.checkouts.find((c) => !c.checkedInAt);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${asset.assetTag} · ${asset.name}`}
        description={[asset.manufacturer, asset.model, asset.serialNumber]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Link href="/assets">
            <Button size="sm" variant="outline">
              All assets
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={asset.status} />
        <StatusBadge status={asset.category} />
        <StatusBadge status={asset.locationScope} />
        {openOut && (
          <span className="text-xs text-amber-300">
            Checked out to {openOut.user?.name || "—"}
            {openOut.offsite ? ` · offsite (${openOut.destination || "field"})` : ""}
          </span>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Home location" value={asset.homeLocation} />
          <Field label="Purchase value" value={formatCurrency(asset.purchaseValue)} />
          <Field
            label="Current holder"
            value={
              asset.assignedToUser ? (
                <Link href={`/hr/person/${asset.assignedToUser.id}`} className="text-teal-400 hover:underline">
                  {asset.assignedToUser.name}
                </Link>
              ) : (
                "In-house / available"
              )
            }
          />
          <Field
            label="Work order"
            value={
              asset.workOrder ? (
                <Link href={`/work-orders/${asset.workOrder.id}`} className="text-teal-400 hover:underline">
                  {asset.workOrder.number}
                </Link>
              ) : null
            }
          />
          <Field
            label="Engineering task"
            value={
              asset.engTask ? (
                <Link href={`/engineering/tasks/${asset.engTask.id}`} className="text-teal-400 hover:underline">
                  {asset.engTask.number}
                </Link>
              ) : null
            }
          />
          <Field label="Added" value={formatDate(asset.createdAt)} />
          {asset.notes && (
            <div className="sm:col-span-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Notes</p>
              <p className="whitespace-pre-wrap text-sm text-slate-300">{asset.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Check-out history
            <span className="ml-2 text-xs font-normal text-slate-500">
              {asset.checkouts.length} record{asset.checkouts.length === 1 ? "" : "s"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {asset.checkouts.length === 0 && (
            <p className="text-sm text-slate-500">No check-outs on record.</p>
          )}
          {asset.checkouts.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm"
            >
              <div>
                <span className="text-slate-200">{c.user?.name || "—"}</span>
                {c.purpose && <span className="ml-2 text-xs text-slate-500">{c.purpose}</span>}
                {c.offsite && (
                  <span className="ml-2 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300">
                    Offsite{c.destination ? ` · ${c.destination}` : ""}
                  </span>
                )}
                {c.returnNote && (
                  <p className="text-[11px] text-slate-500">Return: {c.returnNote}</p>
                )}
              </div>
              <div className="text-right text-xs text-slate-500">
                <p>Out {formatDate(c.checkedOutAt)}</p>
                <p>
                  {c.checkedInAt ? `In ${formatDate(c.checkedInAt)}` : (
                    <span className="text-amber-300">
                      Out{c.dueAt ? ` · due ${formatDate(c.dueAt)}` : ""}
                    </span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <ActivityTimeline entityType="Asset" entityId={asset.id} />
    </div>
  );
}
