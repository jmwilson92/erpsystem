import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/utils";
import {
  CARRIER_MODES,
  getFreightSummary,
  getUnappliedCharges,
  listCarriers,
  listFreight,
  trackingLink,
} from "@/lib/services/logistics";
import { checkModuleHealth } from "@/lib/services/module-health";
import { ModuleNotMigrated } from "@/components/shared/module-not-migrated";
import {
  actionCreateCarrier,
  actionRecordFreight,
  actionToggleCarrier,
} from "./actions";
import { Truck, DollarSign, PackageCheck, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

export default async function LogisticsPage() {
  const health = await checkModuleHealth(() => listCarriers());
  if (!health.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Logistics" description="Carriers, freight, and landed cost." />
        <ModuleNotMigrated module="Logistics" health={health} />
      </div>
    );
  }

  const [carriers, freight, summary, unapplied, receipts, shipments] =
    await Promise.all([
      listCarriers(),
      listFreight({ days: 90 }),
      getFreightSummary(90),
      getUnappliedCharges(20),
      prisma.receipt
        .findMany({
          orderBy: { receivedAt: "desc" },
          take: 50,
          select: { id: true, number: true },
        })
        .catch(() => []),
      prisma.shipment
        .findMany({
          where: { status: { in: ["PACKED", "SHIPPED", "DELIVERED"] } },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, number: true },
        })
        .catch(() => []),
    ]);

  const receiptNumber = new Map(receipts.map((r) => [r.id, r.number]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logistics"
        description="Carriers, what freight actually costs, and landed cost — the duty, freight, and brokerage that never make it into a part's unit cost unless something puts them there."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={PackageCheck}
          label="Outbound shipments"
          value={summary.shipments}
          sub="last 90 days"
        />
        <Stat
          icon={DollarSign}
          label="Outbound freight"
          value={formatCurrency(summary.outboundCost)}
          sub={`billed ${formatCurrency(summary.billed)}`}
        />
        <Stat
          icon={Truck}
          label="Freight recovery"
          value={`${summary.recovery}%`}
          sub="billed vs. cost"
          tone={
            summary.recovery >= 100
              ? "text-emerald-400"
              : summary.recovery > 0
                ? "text-amber-400"
                : "text-slate-500"
          }
        />
        <Stat
          icon={AlertTriangle}
          label="Unapplied charges"
          value={unapplied.length}
          sub="not yet in part cost"
          tone={unapplied.length > 0 ? "text-rose-400" : "text-teal-400"}
        />
      </div>

      {unapplied.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Landed cost waiting to be applied
            </CardTitle>
            <p className="text-xs text-slate-500">
              Until these are applied, the parts on those receipts are costed below what
              they actually cost to land.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {unapplied.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <Link
                    href={`/logistics/landed/${c.receiptId}`}
                    className="truncate hover:text-teal-300"
                  >
                    <span className="font-mono text-xs text-slate-400">
                      {receiptNumber.get(c.receiptId) || c.receiptId.slice(0, 8)}
                    </span>{" "}
                    {c.type}
                    {c.description ? ` · ${c.description}` : ""}
                  </Link>
                  <span className="shrink-0 text-xs tabular-nums text-amber-300">
                    {formatCurrency(c.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {receipts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Add landed cost to a receipt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {receipts.slice(0, 20).map((r) => (
                <Link
                  key={r.id}
                  href={`/logistics/landed/${r.id}`}
                  className="rounded-md border border-slate-800 px-2 py-1 font-mono text-[11px] text-slate-300 hover:border-teal-600/50 hover:text-teal-300"
                >
                  {receiptNumber.get(r.id)}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Carriers ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Carriers <span className="text-xs font-normal text-slate-500">({carriers.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {carriers.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 py-8 text-center text-sm text-slate-500">
              No carriers yet — add one below.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Code</th>
                    <th className="pb-2 pr-3 font-medium">Name</th>
                    <th className="pb-2 pr-3 font-medium">Mode</th>
                    <th className="pb-2 pr-3 font-medium">Account</th>
                    <th className="pb-2 font-medium">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {carriers.map((c) => (
                    <tr key={c.id} className="text-slate-300">
                      <td className="py-2 pr-3 font-mono text-xs text-teal-300">{c.code}</td>
                      <td className="py-2 pr-3 text-xs">{c.name}</td>
                      <td className="py-2 pr-3 text-xs">{c.mode}</td>
                      <td className="py-2 pr-3 text-xs">{c.accountNumber || "—"}</td>
                      <td className="py-2 text-xs">
                        <form action={actionToggleCarrier} className="flex items-center gap-1.5">
                          <input type="hidden" name="id" value={c.id} />
                          <input
                            type="hidden"
                            name="isActive"
                            value={c.isActive ? "no" : "yes"}
                          />
                          <button
                            type="submit"
                            className={`rounded border px-1.5 py-0.5 text-[10px] ${
                              c.isActive
                                ? "border-emerald-600/40 text-emerald-300"
                                : "border-slate-700 text-slate-500"
                            }`}
                          >
                            {c.isActive ? "Active" : "Inactive"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form
            action={actionCreateCarrier}
            className="mt-4 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-3"
          >
            <label className="text-xs text-slate-500">
              Code *
              <Input name="code" required placeholder="UPS" />
            </label>
            <label className="text-xs text-slate-500">
              Name *
              <Input name="name" required placeholder="United Parcel Service" />
            </label>
            <label className="text-xs text-slate-500">
              Mode
              <select name="mode" className={selectClass} defaultValue="PARCEL">
                {CARRIER_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Account number
              <Input name="accountNumber" />
            </label>
            <label className="text-xs text-slate-500">
              Contact
              <Input name="contactName" />
            </label>
            <label className="text-xs text-slate-500">
              Phone
              <Input name="contactPhone" />
            </label>
            <label className="text-xs text-slate-500 sm:col-span-3">
              Tracking URL
              <Input
                name="trackingUrl"
                placeholder="https://www.ups.com/track?tracknum={tracking}"
              />
              <span className="mt-0.5 block text-[10px] text-slate-600">
                {"{tracking}"} is replaced with the tracking number; otherwise it&apos;s
                appended.
              </span>
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                Add carrier
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── Freight log ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Freight <span className="text-xs font-normal text-slate-500">last 90 days</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {freight.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 py-8 text-center text-sm text-slate-500">
              No freight recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Direction</th>
                    <th className="pb-2 pr-3 font-medium">Carrier</th>
                    <th className="pb-2 pr-3 font-medium">Tracking</th>
                    <th className="pb-2 pr-3 font-medium">Weight</th>
                    <th className="pb-2 pr-3 font-medium">Cost</th>
                    <th className="pb-2 pr-3 font-medium">Billed</th>
                    <th className="pb-2 font-medium">Shipped</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {freight.map((f) => {
                    const link = trackingLink(f.carrier?.trackingUrl, f.trackingNumber);
                    const under =
                      f.billedAmount != null && f.billedAmount < f.cost;
                    return (
                      <tr key={f.id} className="text-slate-300">
                        <td className="py-2 pr-3 text-xs">
                          <span
                            className={
                              f.direction === "INBOUND" ? "text-sky-300" : "text-teal-300"
                            }
                          >
                            {f.direction}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-xs">{f.carrier?.name || "—"}</td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {link ? (
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-teal-300 hover:underline"
                            >
                              {f.trackingNumber}
                            </a>
                          ) : (
                            f.trackingNumber || "—"
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs tabular-nums">
                          {f.weight ? `${f.weight} ${f.weightUnit}` : "—"}
                        </td>
                        <td className="py-2 pr-3 text-xs tabular-nums">
                          {formatCurrency(f.cost)}
                        </td>
                        <td
                          className={`py-2 pr-3 text-xs tabular-nums ${
                            under ? "text-amber-300" : ""
                          }`}
                        >
                          {f.billedAmount != null ? formatCurrency(f.billedAmount) : "—"}
                        </td>
                        <td className="py-2 text-xs">{fmtDate(f.shippedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <form
            action={actionRecordFreight}
            className="mt-4 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-4"
          >
            <label className="text-xs text-slate-500">
              Direction
              <select name="direction" className={selectClass} defaultValue="OUTBOUND">
                <option value="OUTBOUND">Outbound</option>
                <option value="INBOUND">Inbound</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Carrier
              <select name="carrierId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {carriers
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Shipment
              <select name="shipmentId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {shipments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Receipt
              <select name="receiptId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {receipts.slice(0, 30).map((r) => (
                  <option key={r.id} value={r.id}>
                    {receiptNumber.get(r.id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Tracking number
              <Input name="trackingNumber" />
            </label>
            <label className="text-xs text-slate-500">
              Service
              <Input name="service" placeholder="Ground, 2-day" />
            </label>
            <label className="text-xs text-slate-500">
              Weight
              <Input name="weight" type="number" step="0.01" />
            </label>
            <label className="text-xs text-slate-500">
              Shipped
              <Input name="shippedAt" type="date" />
            </label>
            <label className="text-xs text-slate-500">
              Cost *
              <Input name="cost" type="number" step="0.01" required />
            </label>
            <label className="text-xs text-slate-500">
              Billed to customer
              <Input name="billedAmount" type="number" step="0.01" />
            </label>
            <div className="flex items-end sm:col-span-2">
              <Button type="submit" size="sm">
                Record freight
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone = "text-teal-400",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <Icon className={`h-5 w-5 ${tone}`} />
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-100">{value}</p>
      <p className="text-xs font-medium text-slate-300">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}
