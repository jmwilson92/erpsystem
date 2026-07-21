import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ActivityTimeline } from "@/components/shared/activity-timeline";
import { Input } from "@/components/ui/input";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { actionConsumeVirtualAsset } from "@/app/actions";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-sm text-slate-200">{value || "—"}</p>
    </div>
  );
}

export default async function VirtualAssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const va = await prisma.virtualAsset.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, name: true } },
      checkedOutTo: { select: { id: true, name: true } },
      product: { select: { id: true, name: true } },
      project: { select: { id: true, number: true } },
      salesOrder: { select: { id: true, number: true } },
      workOrder: { select: { id: true, number: true } },
      assignments: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true } } },
      },
    },
  });
  if (!va) notFound();

  const user = await getCurrentUser();
  const canManage = await userHasPermission(user?.id, "va.manage");
  const consumable = !["CONSUMED", "RETIRED"].includes(va.status);
  const openWos = consumable
    ? await prisma.workOrder.findMany({
        where: { status: { notIn: ["COMPLETE", "CLOSED", "CANCELLED"] } },
        orderBy: { number: "asc" },
        select: { id: true, number: true, description: true },
        take: 100,
      })
    : [];

  const expiring =
    va.expiresAt && va.expiresAt.getTime() - Date.now() < 30 * 86_400_000;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${va.assetTag} · ${va.name}`}
        description={[va.vendor, va.assetType, va.usageType].filter(Boolean).join(" · ")}
        actions={
          <Link href="/virtual-assets">
            <Button size="sm" variant="outline">
              All virtual assets
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={va.status} />
        <StatusBadge status={va.assetType} />
        <StatusBadge status={va.usageType} />
        {va.expiresAt && (
          <span className={`text-xs ${expiring ? "text-amber-300" : "text-slate-500"}`}>
            Expires {formatDate(va.expiresAt)}
          </span>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Seats" value={va.seats != null ? `${va.seatsUsed}/${va.seats} used` : null} />
          <Field label="Cost" value={formatCurrency(va.cost)} />
          <Field label="Purchased" value={va.purchasedAt ? formatDate(va.purchasedAt) : null} />
          <Field label="Computer / host" value={va.computerName} />
          <Field label="License key" value={va.licenseKey ? "•••• stored" : null} />
          <Field
            label="Assigned to"
            value={
              va.assignedTo ? (
                <Link href={`/hr/person/${va.assignedTo.id}`} className="text-teal-400 hover:underline">
                  {va.assignedTo.name}
                </Link>
              ) : null
            }
          />
          <Field
            label="Product"
            value={
              va.product ? (
                <Link href={`/products/${va.product.id}`} className="text-teal-400 hover:underline">
                  {va.product.name}
                </Link>
              ) : null
            }
          />
          <Field
            label="Project"
            value={
              va.project ? (
                <Link href={`/projects/${va.project.id}`} className="text-teal-400 hover:underline">
                  {va.project.number}
                </Link>
              ) : null
            }
          />
          <Field
            label="Sales order"
            value={
              va.salesOrder ? (
                <Link href={`/sales/${va.salesOrder.id}`} className="text-teal-400 hover:underline">
                  {va.salesOrder.number}
                </Link>
              ) : null
            }
          />
          {va.workOrder && (
            <Field
              label="Consumed into"
              value={
                <Link href={`/work-orders/${va.workOrder.id}`} className="text-teal-400 hover:underline">
                  {va.workOrder.number}
                  {va.consumedAt ? ` · ${formatDate(va.consumedAt)}` : ""}
                </Link>
              }
            />
          )}
          {va.renewalUrl && (
            <Field
              label="Renewal"
              value={
                <a href={va.renewalUrl} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">
                  Renew ↗
                </a>
              }
            />
          )}
          {va.notes && (
            <div className="sm:col-span-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Notes</p>
              <p className="whitespace-pre-wrap text-sm text-slate-300">{va.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && consumable && (
        <Card className="border-violet-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Consume into an assembly</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={actionConsumeVirtualAsset}
              className="grid gap-2 sm:grid-cols-4"
            >
              <input type="hidden" name="assetId" value={va.id} />
              <select
                name="workOrderId"
                required
                className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200 sm:col-span-2"
                defaultValue=""
              >
                <option value="" disabled>
                  Work order / assembly…
                </option>
                {openWos.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.number} — {(w.description || "").slice(0, 50)}
                  </option>
                ))}
              </select>
              <Input name="notes" placeholder="Notes (e.g. installed on SN)" className="h-9" />
              <Button type="submit" size="sm" className="h-9">
                Consume into build
              </Button>
            </form>
            <p className="mt-2 text-[11px] text-slate-500">
              Marks this license/digital asset as consumed by the build — it ships
              with the assembly and leaves the available pool.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Assignment history
            <span className="ml-2 text-xs font-normal text-slate-500">
              {va.assignments.length} event{va.assignments.length === 1 ? "" : "s"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {va.assignments.length === 0 && (
            <p className="text-sm text-slate-500">No assignment events on record.</p>
          )}
          {va.assignments.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm"
            >
              <div>
                <StatusBadge status={a.action} className="text-[9px]" />
                <span className="ml-2 text-slate-200">{a.user.name}</span>
                {a.notes && <span className="ml-2 text-xs text-slate-500">{a.notes}</span>}
              </div>
              <span className="text-xs text-slate-500">{formatDate(a.createdAt)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <ActivityTimeline entityType="VirtualAsset" entityId={va.id} />
    </div>
  );
}
