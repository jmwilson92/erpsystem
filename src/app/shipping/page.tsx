import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  actionQueueShipment,
  actionCreateManualShipment,
} from "@/app/actions";
import Link from "next/link";
import { ActionLoadingForm } from "@/components/layout/action-loading";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function ShippingPage() {
  const [shipments, readyOrders, customers, parts, openSalesOrders] =
    await Promise.all([
      prisma.shipment.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          salesOrder: { include: { customer: true } },
          mrbCase: { select: { number: true } },
          lines: true,
        },
      }),
      prisma.salesOrder.findMany({
        where: { status: { in: ["READY_TO_SHIP", "IN_PRODUCTION"] } },
        orderBy: { requiredDate: "asc" },
        include: { customer: true, lines: true },
      }),
      prisma.customer.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true },
      }),
      prisma.part.findMany({
        where: { isActive: true },
        orderBy: { partNumber: "asc" },
        take: 200,
        select: { id: true, partNumber: true, description: true },
      }),
      prisma.salesOrder.findMany({
        where: {
          status: {
            notIn: ["CANCELLED", "CLOSED", "SHIPPED"],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 80,
        select: {
          id: true,
          number: true,
          customer: { select: { name: true } },
        },
      }),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipping"
        description="SO packing queue plus manual shipments to a customer or ship-to address"
      />

      <Card className="border-sky-900/40">
        <CardHeader>
          <CardTitle className="text-base">Create shipping order</CardTitle>
          <p className="text-xs text-slate-500">
            Use when you need to ship inventory to a customer or place outside
            the automatic ready-to-ship pull. Link a sales order when you have
            one; otherwise enter ship-to and lines.
          </p>
        </CardHeader>
        <CardContent>
          <ActionLoadingForm
            theme="creating"
            title="Creating shipment"
            action={actionCreateManualShipment}
            className="space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Sales order (optional)
                </label>
                <select name="salesOrderId" className={`${selectClass} mt-1`}>
                  <option value="">— None / ad-hoc —</option>
                  {openSalesOrders.map((so) => (
                    <option key={so.id} value={so.id}>
                      {so.number} · {so.customer.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Customer (optional)
                </label>
                <select name="customerId" className={`${selectClass} mt-1`}>
                  <option value="">— Select —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Ship to address *
                </label>
                <textarea
                  name="shipToAddress"
                  required
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
                  placeholder="Name / street / city / state / zip"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Carrier
                </label>
                <Input name="carrier" className="mt-1" placeholder="UPS / FedEx / …" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Notes
                </label>
                <Input name="notes" className="mt-1" />
              </div>
            </div>
            <div className="space-y-2 rounded border border-slate-800 p-3">
              <p className="text-[10px] font-semibold uppercase text-slate-500">
                Lines (up to 4)
              </p>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="grid gap-2 sm:grid-cols-[1fr_2fr_5rem_6rem]"
                >
                  <select
                    name={`line_part_${i}`}
                    className={selectClass}
                    defaultValue=""
                  >
                    <option value="">Part (optional)</option>
                    {parts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.partNumber}
                      </option>
                    ))}
                  </select>
                  <Input
                    name={`line_desc_${i}`}
                    placeholder={i === 0 ? "Description *" : "Description"}
                    className="text-sm"
                  />
                  <Input
                    name={`line_qty_${i}`}
                    type="number"
                    step="any"
                    placeholder="Qty"
                    className="text-sm"
                    defaultValue={i === 0 ? 1 : undefined}
                  />
                  <Input
                    name={`line_lot_${i}`}
                    placeholder="Lot"
                    className="font-mono text-sm"
                  />
                </div>
              ))}
            </div>
            <Button type="submit" size="sm">
              Create shipping order
            </Button>
          </ActionLoadingForm>
        </CardContent>
      </Card>

      {readyOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ready / in production (pull queue)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {readyOrders.map((so) => {
              const gate = so.shipNotBefore || so.requiredDate;
              const depositBlocked =
                so.depositRequired &&
                !["RECEIVED", "WAIVED"].includes(
                  (so.depositStatus || "").toUpperCase()
                );
              const dateBlocked =
                !so.allowEarlyShip &&
                gate &&
                new Date() < gate &&
                so.status === "READY_TO_SHIP";
              return (
                <div
                  key={so.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${
                    depositBlocked
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-slate-800"
                  }`}
                >
                  <div>
                    <Link href={`/sales/${so.id}`} className="font-mono text-sky-400">
                      {so.number}
                    </Link>
                    <StatusBadge status={so.status} className="ml-2" />
                    {depositBlocked && (
                      <span className="ml-2 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300">
                        Deposit hold
                      </span>
                    )}
                    <p className="text-sm text-slate-300">{so.customer.name}</p>
                    <p className="text-xs text-slate-500">
                      Required {formatDate(so.requiredDate)} ·{" "}
                      {formatCurrency(so.totalAmount)}
                      {depositBlocked
                        ? ` · Deposit ${formatCurrency(so.depositAmount)} ${so.depositStatus || "PENDING"} — ship blocked`
                        : dateBlocked
                          ? ` · Held until ${formatDate(gate)}`
                          : so.allowEarlyShip
                            ? " · Early ship OK"
                            : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {depositBlocked ? (
                      <Link href={`/sales/${so.id}`}>
                        <Button size="sm" variant="secondary">
                          Resolve deposit
                        </Button>
                      </Link>
                    ) : (
                      <ActionLoadingForm theme="shipping" action={actionQueueShipment}>
                        <input type="hidden" name="salesOrderId" value={so.id} />
                        <Button type="submit" size="sm" variant="outline">
                          Queue packing list
                        </Button>
                      </ActionLoadingForm>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Shipments
        </h2>
        {shipments.map((s) => (
          <Card
            key={s.id}
            className="transition-colors hover:border-teal-500/30"
          >
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link href={`/shipping/${s.id}`}>
                    <CardTitle className="font-mono text-teal-400 hover:underline">
                      {s.number}
                    </CardTitle>
                  </Link>
                  <StatusBadge status={s.status} />
                </div>
                <Link href={`/shipping/${s.id}`}>
                  <Button size="sm" variant="outline">
                    Open packing list
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="text-slate-300">
                {s.salesOrder?.customer.name ||
                  (s.mrbCase ? `Return to supplier · ${s.mrbCase.number}` : "—")}{" "}
                · SO{" "}
                {s.salesOrder ? (
                  <Link href={`/sales/${s.salesOrder.id}`} className="text-sky-400">
                    {s.salesOrder.number}
                  </Link>
                ) : (
                  "—"
                )}
              </p>
              <p className="text-xs text-slate-500">
                {s.shipToAddress} · {s.carrier || "Carrier TBD"}
                {s.packingListVerified ? " · List verified" : ""}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-slate-400">
                {s.lines.map((l) => (
                  <li key={l.id}>
                    {l.description} × {l.quantity}
                    {l.lotNumber ? ` · Lot ${l.lotNumber}` : ""}
                  </li>
                ))}
              </ul>
              {s.trackingNumber && (
                <p className="mt-2 font-mono text-xs text-sky-400">
                  Tracking: {s.trackingNumber}
                </p>
              )}
              {!["SHIPPED", "DELIVERED"].includes(s.status) && (
                <div className="mt-3">
                  <Link href={`/shipping/${s.id}`}>
                    <Button size="sm" variant="outline">
                      Open to verify &amp; ship →
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {shipments.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-slate-500">
              No shipments yet.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
