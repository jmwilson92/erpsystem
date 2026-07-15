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

export default async function GovPropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const gp = await prisma.governmentProperty.findUnique({
    where: { id },
    include: {
      checkedOutTo: { select: { id: true, name: true } },
      inventoryItem: { select: { id: true } },
      checkouts: {
        orderBy: { checkedOutAt: "desc" },
        include: {
          checkedOutBy: { select: { name: true } },
          checkedInBy: { select: { name: true } },
        },
      },
      auditRecords: { orderBy: { createdAt: "desc" }, take: 10 },
      consumptions: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!gp) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${gp.assetTag} · ${gp.description}`}
        description={[gp.propertyType, gp.partNumber, gp.serialNumber, gp.uid ? `UID ${gp.uid}` : null]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Link href="/government-property">
            <Button size="sm" variant="outline">
              All gov property
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={gp.status} />
        <StatusBadge status={gp.propertyType} />
        <StatusBadge status={gp.condition} />
        {gp.dfarsCompliant ? (
          <span className="text-xs text-emerald-400">DFARS compliant</span>
        ) : (
          <span className="text-xs text-rose-400">DFARS exception</span>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Accountability</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Contract" value={gp.contractNumber} />
          <Field label="Custodial code" value={gp.custodialCode} />
          <Field label="Location" value={gp.location} />
          <Field label="Acquisition cost" value={formatCurrency(gp.acquisitionCost)} />
          <Field label="Acquired" value={gp.acquisitionDate ? formatDate(gp.acquisitionDate) : null} />
          <Field label="Classification" value={gp.classification} />
          <Field
            label="Checked out to"
            value={
              gp.checkedOutTo ? (
                <Link href={`/hr/person/${gp.checkedOutTo.id}`} className="text-teal-400 hover:underline">
                  {gp.checkedOutTo.name}
                </Link>
              ) : "In storage / available"
            }
          />
          <Field label="Last inventory" value={gp.lastInventoryDate ? formatDate(gp.lastInventoryDate) : null} />
          <Field label="Next audit due" value={gp.nextAuditDue ? formatDate(gp.nextAuditDue) : null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Custody history
            <span className="ml-2 text-xs font-normal text-slate-500">
              {gp.checkouts.length} record{gp.checkouts.length === 1 ? "" : "s"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {gp.checkouts.length === 0 && (
            <p className="text-sm text-slate-500">No custody events on record.</p>
          )}
          {gp.checkouts.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm"
            >
              <div>
                <span className="text-slate-200">{c.checkedOutBy.name}</span>
                {c.purpose && <span className="ml-2 text-xs text-slate-500">{c.purpose}</span>}
                <StatusBadge status={c.status} className="ml-2 text-[9px]" />
                {c.checkedInNotes && (
                  <p className="text-[11px] text-slate-500">Return: {c.checkedInNotes}</p>
                )}
              </div>
              <div className="text-right text-xs text-slate-500">
                <p>Out {formatDate(c.checkedOutAt)}</p>
                <p>
                  {c.checkedInAt
                    ? `In ${formatDate(c.checkedInAt)}${c.checkedInBy ? ` · ${c.checkedInBy.name}` : ""}`
                    : `Open${c.expectedReturn ? ` · due ${formatDate(c.expectedReturn)}` : ""}`}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {(gp.auditRecords.length > 0 || gp.consumptions.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Audit records</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {gp.auditRecords.length === 0 && (
                <p className="text-slate-500">None.</p>
              )}
              {gp.auditRecords.map((a) => (
                <div key={a.id} className="flex justify-between border-b border-slate-800/60 py-1">
                  <StatusBadge status={a.result || a.status || "AUDIT"} className="text-[9px]" />
                  <span className="text-xs text-slate-500">{formatDate(a.createdAt)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Consumptions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {gp.consumptions.length === 0 && <p className="text-slate-500">None.</p>}
              {gp.consumptions.map((c) => (
                <div key={c.id} className="flex justify-between border-b border-slate-800/60 py-1">
                  <span className="text-slate-300">{c.quantity ?? ""} consumed</span>
                  <span className="text-xs text-slate-500">{formatDate(c.createdAt)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <ActivityTimeline entityType="GovernmentProperty" entityId={gp.id} />
    </div>
  );
}
