import { getValueStreamMetrics } from "@/lib/services/supply-chain";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { FloorAutoRefresh } from "@/components/floor/auto-refresh";
import { cn } from "@/lib/utils";
import {
  Truck,
  ShoppingCart,
  PackageCheck,
  ClipboardCheck,
  AlertTriangle,
  Warehouse,
  Factory,
  Package,
} from "lucide-react";

export const dynamic = "force-dynamic";

const icons: Record<string, typeof Truck> = {
  SUPPLIER: Truck,
  PO: ShoppingCart,
  RECEIVING: PackageCheck,
  INSPECTION: ClipboardCheck,
  MRB: AlertTriangle,
  INVENTORY: Warehouse,
  PRODUCTION: Factory,
  SHIPPING: Package,
};

const statusStyles = {
  healthy: "border-emerald-500/40 bg-emerald-500/5",
  watch: "border-amber-500/40 bg-amber-500/5",
  constraint: "border-red-500/40 bg-red-500/10 ring-1 ring-red-500/30",
};

export default async function ValueStreamPage() {
  const { stages } = await getValueStreamMetrics();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Value Stream Map"

        actions={<FloorAutoRefresh intervalSec={45} />}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-0">
        {stages.map((stage, idx) => {
          const Icon = icons[stage.key] || Package;
          return (
            <div key={stage.key} className="relative flex flex-1 flex-col">
              <Card
                className={cn(
                  "h-full",
                  statusStyles[stage.status as keyof typeof statusStyles] || statusStyles.healthy
                )}
              >
                <CardContent className="flex h-full flex-col p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="rounded-lg bg-slate-950/50 p-2">
                      <Icon className="h-4 w-4 text-teal-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{stage.label}</p>
                      <p
                        className={cn(
                          "text-[10px] uppercase tracking-wider",
                          stage.status === "constraint"
                            ? "text-red-400"
                            : stage.status === "watch"
                              ? "text-amber-400"
                              : "text-emerald-400"
                        )}
                      >
                        {stage.status}
                      </p>
                    </div>
                  </div>
                  <div className="mt-auto space-y-2">
                    {stage.metrics.map((m) => (
                      <div key={m.label} className="flex justify-between text-sm">
                        <span className="text-slate-500">{m.label}</span>
                        <span className="font-mono font-semibold tabular-nums text-slate-200">
                          {m.unit === "$" ? "$" : ""}
                          {typeof m.value === "number" && m.value > 999
                            ? m.value.toLocaleString()
                            : m.value}
                          {m.unit === "%" ? "%" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              {idx < stages.length - 1 && (
                <div className="hidden items-center justify-center py-1 text-slate-600 lg:absolute lg:-right-2 lg:top-1/2 lg:z-10 lg:flex lg:-translate-y-1/2 lg:py-0">
                  <span className="rounded-full bg-slate-950 px-1 text-lg text-slate-600">→</span>
                </div>
              )}
              {idx < stages.length - 1 && (
                <div className="flex justify-center py-1 text-slate-600 lg:hidden">↓</div>
              )}
            </div>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-5">
          <h3 className="mb-2 font-semibold text-slate-200">How to read this map</h3>
          <ul className="space-y-1 text-sm text-slate-400">
            <li>
              <span className="text-emerald-400">Healthy</span> — stage operating within
              normal parameters
            </li>
            <li>
              <span className="text-amber-400">Watch</span> — elevated load or aging; plan
              capacity or expedite
            </li>
            <li>
              <span className="text-red-400">Constraint</span> — bottleneck (e.g. open MRB
              holds) blocking flow; prioritize disposition
            </li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Metrics pull live from Purchase Orders, Inspections, MRB, Inventory aggregates,
            Work Orders (WIP $), and Supplier OTD averages. Improving MRB cycle time and
            supplier quality directly clears the red constraint and lifts scorecards.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
