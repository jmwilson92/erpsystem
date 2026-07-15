import { Fragment } from "react";
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
  Ban,
  Zap,
} from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Connector between two value-stream stages. Healthy flow shows an animated
 * green lightning streak; a downstream constraint shows a blinking red
 * blocker; anything else is a static amber arrow.
 */
function FlowConnector({ nextStatus }: { nextStatus: string }) {
  if (nextStatus === "constraint") {
    return (
      <div className="flex items-center justify-center lg:w-10">
        <Ban className="h-6 w-6 text-red-500 animate-blink" aria-label="Blocked flow" />
      </div>
    );
  }
  const healthy = nextStatus === "healthy";
  const color = healthy ? "text-emerald-400" : "text-amber-400";
  return (
    <div className="flex items-center justify-center lg:w-10">
      {/* Horizontal (desktop) */}
      <div className="relative hidden h-1.5 w-full overflow-hidden rounded-full bg-slate-800 lg:block">
        <div className={cn("absolute inset-0", color, healthy && "flow-track")} />
      </div>
      {/* Vertical (mobile) */}
      <div className="flex items-center lg:hidden">
        {healthy ? (
          <Zap className="h-5 w-5 text-emerald-400 animate-pulse-soft" />
        ) : (
          <span className="text-amber-400">↓</span>
        )}
      </div>
    </div>
  );
}

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

      <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-2">
        {stages.map((stage, idx) => {
          const Icon = icons[stage.key] || Package;
          const isConstraint = stage.status === "constraint";
          return (
            <Fragment key={stage.key}>
              <div className="flex flex-1 flex-col">
                <Card
                  className={cn(
                    "h-full transition-shadow",
                    statusStyles[stage.status as keyof typeof statusStyles] ||
                      statusStyles.healthy,
                    isConstraint && "animate-cap-alert"
                  )}
                >
                  <CardContent className="flex h-full flex-col p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="rounded-lg bg-slate-950/50 p-2">
                        <Icon className="h-4 w-4 text-teal-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-100">
                          {stage.label}
                        </p>
                        <p
                          className={cn(
                            "text-[10px] uppercase tracking-wider",
                            isConstraint
                              ? "text-red-400"
                              : stage.status === "watch"
                                ? "text-amber-400"
                                : "text-emerald-400"
                          )}
                        >
                          {stage.status}
                        </p>
                      </div>
                      {isConstraint && (
                        <AlertTriangle className="h-4 w-4 text-red-500 animate-blink" />
                      )}
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
              </div>
              {idx < stages.length - 1 && (
                <FlowConnector nextStatus={stages[idx + 1].status} />
              )}
            </Fragment>
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
