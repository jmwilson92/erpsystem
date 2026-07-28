import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getExpiringLots, EXPIRY_WARNING_DAYS } from "@/lib/services/shelf-life";
import { actionQuarantineExpired } from "./actions";
import { AlertTriangle, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

const HORIZONS = [30, 60, 90, 180];

export default async function ExpiringStockPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days } = await searchParams;
  const withinDays = Number(days) > 0 ? Number(days) : EXPIRY_WARNING_DAYS;

  const lots = await getExpiringLots(withinDays);
  const expired = lots.filter((l) => l.expired);
  const soon = lots.filter((l) => !l.expired);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expiring stock"
        description="Lot-controlled material past — or close to — its shelf life. Adhesives, sealants, resins, and calibration standards live here."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/inventory" className="text-xs text-teal-300 hover:underline">
          ← Inventory
        </Link>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          Horizon:
          {HORIZONS.map((d) => (
            <Link
              key={d}
              href={`/inventory/expiring?days=${d}`}
              className={`rounded px-2 py-0.5 ${
                d === withinDays
                  ? "bg-teal-500/15 text-teal-300"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {d}d
            </Link>
          ))}
        </div>
        {expired.length > 0 && (
          <form action={actionQuarantineExpired} className="ml-auto">
            <Button type="submit" size="sm" variant="outline">
              Quarantine {expired.length} expired lot{expired.length === 1 ? "" : "s"}
            </Button>
          </form>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <AlertTriangle
            className={`h-5 w-5 ${expired.length > 0 ? "text-rose-400" : "text-teal-400"}`}
          />
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-100">
            {expired.length}
          </p>
          <p className="text-xs font-medium text-slate-300">Expired, still available</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Must not be issued to a job or loaded on a truck
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <Clock
            className={`h-5 w-5 ${soon.length > 0 ? "text-amber-400" : "text-teal-400"}`}
          />
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-100">{soon.length}</p>
          <p className="text-xs font-medium text-slate-300">
            Expiring within {withinDays} days
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">Use first or plan a replacement buy</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Lots <span className="text-xs font-normal text-slate-500">({lots.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lots.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 py-10 text-center text-sm text-slate-500">
              Nothing expiring in the next {withinDays} days.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Lot</th>
                    <th className="pb-2 pr-3 font-medium">Part</th>
                    <th className="pb-2 pr-3 font-medium">Qty</th>
                    <th className="pb-2 pr-3 font-medium">Expires</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {lots.map((l) => (
                    <tr key={l.id} className="text-slate-300">
                      <td className="py-2 pr-3 font-mono text-xs">{l.lotNumber}</td>
                      <td className="py-2 pr-3 text-xs">
                        <Link
                          href={`/items/${l.partId}?tab=inventory`}
                          className="text-teal-300 hover:underline"
                        >
                          {l.partNumber || "—"}
                        </Link>
                        {l.description && (
                          <div className="max-w-xs truncate text-slate-500">
                            {l.description}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs tabular-nums">{l.quantity}</td>
                      <td className="py-2 pr-3 text-xs tabular-nums">
                        {new Date(l.expiresAt).toLocaleDateString()}
                      </td>
                      <td
                        className={`py-2 text-xs font-medium ${
                          l.expired ? "text-rose-300" : "text-amber-300"
                        }`}
                      >
                        {l.expired
                          ? `expired ${-l.daysLeft}d ago`
                          : `${l.daysLeft}d left`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
