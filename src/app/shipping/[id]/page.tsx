import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { PackShipPanel } from "@/components/shipping/pack-ship-panel";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: {
      salesOrder: { include: { customer: true, lines: true } },
      lines: true,
      traceEvents: { orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
  if (!shipment) notFound();

  const packPhotos: { url: string; fileName?: string; caption?: string }[] =
    shipment.packPhotos
      ? (() => {
          try {
            return JSON.parse(shipment.packPhotos) as {
              url: string;
              fileName?: string;
              caption?: string;
            }[];
          } catch {
            return [];
          }
        })()
      : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={shipment.number}
        description={
          shipment.salesOrder
            ? `${shipment.salesOrder.customer.name} · SO ${shipment.salesOrder.number}`
            : "Shipment"
        }
        actions={
          <Link href="/shipping">
            <Button size="sm" variant="outline">
              All shipments
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={shipment.status} />
        {shipment.packingListVerified && (
          <StatusBadge status="LIST_VERIFIED" />
        )}
        {shipment.trackingNumber && (
          <span className="font-mono text-xs text-sky-400">
            {shipment.trackingNumber}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shipment info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label="Number" value={shipment.number} mono />
            <Field label="Status" value={shipment.status} />
            <Field label="Carrier" value={shipment.carrier || "—"} />
            <Field
              label="Tracking"
              value={shipment.trackingNumber || "—"}
              mono
            />
            <Field label="Ship to" value={shipment.shipToAddress || "—"} />
            <Field
              label="Ship date"
              value={shipment.shipDate ? formatDate(shipment.shipDate) : "—"}
            />
            <Field
              label="Created"
              value={formatDate(shipment.createdAt)}
            />
            {shipment.salesOrder && (
              <div>
                <p className="text-[10px] uppercase text-slate-600">
                  Sales order
                </p>
                <Link
                  href={`/sales/${shipment.salesOrder.id}`}
                  className="font-mono text-sky-400 hover:underline"
                >
                  {shipment.salesOrder.number}
                </Link>
                <p className="text-xs text-slate-500">
                  {shipment.salesOrder.customer.name}
                </p>
              </div>
            )}
            {shipment.notes && (
              <div>
                <p className="text-[10px] uppercase text-slate-600">Notes</p>
                <p className="text-slate-300">{shipment.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Packing list lines</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {shipment.lines.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap justify-between gap-2 rounded border border-slate-800 px-3 py-2"
                >
                  <span className="text-slate-200">{l.description}</span>
                  <span className="font-mono text-slate-400">
                    × {l.quantity}
                    {l.lotNumber ? ` · Lot ${l.lotNumber}` : ""}
                  </span>
                </li>
              ))}
              {!shipment.lines.length && (
                <li className="text-slate-500">No lines</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Pack photos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pack photos
            {packPhotos.length ? ` · ${packPhotos.length}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {packPhotos.length === 0 ? (
            <p className="text-sm text-slate-500">
              No photos yet. Attach during pack (mobile transfer is phase 2).
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {packPhotos.map((p, i) => (
                <div
                  key={i}
                  className="overflow-hidden rounded-lg border border-slate-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={p.caption || p.fileName || `Pack photo ${i + 1}`}
                    className="h-40 w-full object-cover bg-slate-900"
                  />
                  <div className="p-2 text-xs text-slate-400">
                    {p.fileName || p.caption || `Photo ${i + 1}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {shipment.salesOrder && !["SHIPPED", "DELIVERED"].includes(shipment.status) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pack &amp; ship</CardTitle>
          </CardHeader>
          <CardContent>
            <PackShipPanel
              shipmentId={shipment.id}
              salesOrderId={shipment.salesOrder.id}
              packingListVerified={shipment.packingListVerified}
              status={shipment.status}
              shipToAddress={shipment.shipToAddress}
              lineSummary={shipment.lines.map(
                (l) =>
                  `${l.description} × ${l.quantity}${
                    l.lotNumber ? ` · Lot ${l.lotNumber}` : ""
                  }`
              )}
              depositBlocked={
                !!shipment.salesOrder.depositRequired &&
                !["RECEIVED", "WAIVED"].includes(
                  (shipment.salesOrder.depositStatus || "").toUpperCase()
                )
              }
              depositMessage={
                shipment.salesOrder.depositRequired
                  ? `Deposit ${shipment.salesOrder.depositStatus || "PENDING"}`
                  : null
              }
            />
          </CardContent>
        </Card>
      )}

      {shipment.traceEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trace events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-slate-400">
            {shipment.traceEvents.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap justify-between gap-2 border-b border-slate-900 py-1"
              >
                <span>
                  <StatusBadge status={e.eventType} /> {e.notes || ""}
                </span>
                <span className="font-mono text-slate-600">
                  {formatDate(e.createdAt)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase text-slate-600">{label}</p>
      <p className={`text-slate-200 ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </p>
    </div>
  );
}
