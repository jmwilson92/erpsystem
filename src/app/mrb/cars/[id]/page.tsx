import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { CarUpdateForm } from "@/components/mrb/car-update-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CarDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const disposition = await prisma.mrbDisposition.findUnique({
    where: { id },
    include: {
      decidedBy: true,
      mrbCase: {
        include: {
          ncr: { include: { part: true, supplier: true } },
        },
      },
      activityLog: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!disposition || !disposition.carNumber) notFound();

  const d = disposition;
  const mrb = d.mrbCase;

  // Return-to-supplier CARs auto-pull the linked return shipment so the
  // corrective action carries the logistics record with it.
  const returnShipment =
    d.disposition === "RETURN_TO_SUPPLIER"
      ? await prisma.shipment.findFirst({
          where: { mrbCaseId: mrb.id },
          orderBy: { createdAt: "desc" },
        })
      : null;
  const closed = ["CLOSED", "VERIFIED"].includes(
    (d.carStatus || "").toUpperCase()
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={d.carNumber!}
        description={d.carTitle || mrb.ncr.title || undefined}
        actions={
          <div className="flex gap-2">
            <Link href="/mrb?view=cars&filter=open">
              <Button size="sm" variant="outline">
                All CARs
              </Button>
            </Link>
            <Link href="/mrb?view=mrb">
              <Button size="sm" variant="outline">
                MRB
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={d.carStatus || "OPEN"} />
        <StatusBadge status={d.disposition} />
        <StatusBadge status={mrb.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">CAR details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Title" value={d.carTitle || "—"} />
            <Row label="Status" value={d.carStatus || "OPEN"} />
            <Row
              label="Due"
              value={d.carDueDate ? formatDate(d.carDueDate) : "—"}
            />
            <Row
              label="Closed"
              value={d.carClosedAt ? formatDate(d.carClosedAt) : "—"}
            />
            <Row
              label="MRB"
              value={mrb.number}
              href={`/mrb?view=mrb&filter=all`}
            />
            <Row label="NCR" value={mrb.ncr.number} />
            <Row
              label="Part"
              value={mrb.ncr.part?.partNumber || "—"}
            />
            <Row
              label="Supplier"
              value={mrb.ncr.supplier?.name || "—"}
              href={
                mrb.ncr.supplierId
                  ? `/suppliers/${mrb.ncr.supplierId}`
                  : undefined
              }
            />
            <Row
              label="Disposition"
              value={`${d.disposition} × ${d.quantity}`}
            />
            <Row
              label="Decided by"
              value={d.decidedBy?.name || "—"}
            />
            {d.justification && (
              <div>
                <p className="text-[10px] uppercase text-slate-600">
                  Justification
                </p>
                <p className="text-slate-300">{d.justification}</p>
              </div>
            )}
            {d.carNotes && (
              <div>
                <p className="text-[10px] uppercase text-slate-600">Notes</p>
                <p className="text-slate-300">{d.carNotes}</p>
              </div>
            )}
            {d.carResponse && (
              <div>
                <p className="text-[10px] uppercase text-slate-600">
                  Supplier response
                </p>
                <p className="text-emerald-400/90">{d.carResponse}</p>
              </div>
            )}
            {d.reworkWorkOrderId && (
              <Link
                href={`/work-orders/${d.reworkWorkOrderId}`}
                className="inline-block text-teal-400 hover:underline"
              >
                Rework work order →
              </Link>
            )}
          </CardContent>
        </Card>

        {d.disposition === "RETURN_TO_SUPPLIER" && (
          <Card className="border-sky-900/40">
            <CardHeader>
              <CardTitle className="text-base">Return shipment</CardTitle>
              <p className="text-xs text-slate-500">
                Auto-pulled from Shipping for this return-to-supplier CAR.
              </p>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {returnShipment ? (
                <>
                  <Row
                    label="Shipment #"
                    value={returnShipment.number}
                    href={`/shipping/${returnShipment.id}`}
                  />
                  <Row label="Status" value={returnShipment.status} />
                  <Row
                    label="Date packed"
                    value={
                      returnShipment.packedAt
                        ? formatDate(returnShipment.packedAt)
                        : returnShipment.packingListVerified
                          ? "Packing list verified"
                          : "Not yet packed"
                    }
                  />
                  <Row
                    label="Date shipped"
                    value={
                      returnShipment.shipDate
                        ? formatDate(returnShipment.shipDate)
                        : "Not yet shipped"
                    }
                  />
                  <Row
                    label="Carrier / method"
                    value={returnShipment.carrier || "—"}
                  />
                  <Row
                    label="Tracking #"
                    value={returnShipment.trackingNumber || "—"}
                  />
                  <div className="pt-1">
                    <Link
                      href={`/print/packing-list/${returnShipment.id}`}
                      className="text-teal-400 hover:underline"
                    >
                      Print return packing list →
                    </Link>
                  </div>
                </>
              ) : (
                <p className="text-slate-500">
                  No return shipment found yet. It is created automatically
                  when the disposition is recorded — check the Shipping module.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {closed ? "CAR closed" : "Update CAR"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {closed ? (
              <p className="text-sm text-slate-500">
                This CAR is {d.carStatus}. Open the activity log for history.
              </p>
            ) : (
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
            )}
          </CardContent>
        </Card>
      </div>

      <Card id="activity-log">
        <CardHeader>
          <CardTitle className="text-base">
            Activity log
            {d.activityLog.length ? ` · ${d.activityLog.length} events` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!d.activityLog.length ? (
            <p className="text-sm text-slate-600">No activity yet.</p>
          ) : (
            <ol className="relative space-y-0 border-l border-slate-800 pl-4">
              {d.activityLog.map((evt) => (
                <li key={evt.id} className="relative pb-4 last:pb-0">
                  <span className="absolute -left-[1.3rem] top-1 h-2.5 w-2.5 rounded-full border border-slate-500 bg-slate-700" />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm text-slate-200">{evt.summary}</p>
                    <span className="font-mono text-[10px] text-slate-600">
                      {formatDate(evt.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    <StatusBadge status={evt.action} />
                    {evt.user ? ` · ${evt.user.name}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase text-slate-600">{label}</p>
      {href ? (
        <Link href={href} className="text-sky-400 hover:underline">
          {value}
        </Link>
      ) : (
        <p className="text-slate-200">{value}</p>
      )}
    </div>
  );
}
