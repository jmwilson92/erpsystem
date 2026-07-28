import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getVehicle,
  getVehicleCost,
  MAINTENANCE_TYPES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
} from "@/lib/services/fleet";
import { listUsers } from "@/lib/auth";
import {
  actionAddFuel,
  actionAddMaintenance,
  actionCompleteMaintenance,
  actionUpdateVehicle,
} from "../actions";
import { ArrowLeft, Fuel, Wrench } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}
function forInput(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}
function money(n: number | null | undefined) {
  return n == null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default async function VehiclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [vehicle, cost, users] = await Promise.all([
    getVehicle(id),
    getVehicleCost(id),
    listUsers().catch(() => []),
  ]);
  if (!vehicle) notFound();

  const open = vehicle.maintenance.filter((m) => m.status === "SCHEDULED");
  const history = vehicle.maintenance.filter((m) => m.status === "COMPLETED");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${vehicle.unitNumber}${vehicle.name ? ` · ${vehicle.name}` : ""}`}
        description={[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Fleet unit"}
        actions={
          <Link href="/fleet">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Fleet
            </Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Odometer" value={`${Math.round(vehicle.odometer).toLocaleString()} ${vehicle.odometerUnit}`} />
        <Metric label="Fuel (12 mo)" value={money(cost.fuelCost)} sub={`${cost.gallons.toFixed(1)} gal`} />
        <Metric label="Maintenance (12 mo)" value={money(cost.maintCost)} />
        <Metric
          label={`Cost / ${vehicle.odometerUnit.toLowerCase()}`}
          value={cost.costPerDistance == null ? "—" : `$${cost.costPerDistance.toFixed(2)}`}
          sub={cost.mpg ? `${cost.mpg.toFixed(1)} mpg` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Maintenance */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-4 w-4 text-amber-400" /> Maintenance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {open.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-800 py-6 text-center text-xs text-slate-500">
                Nothing scheduled.
              </p>
            ) : (
              <ul className="space-y-2">
                {open.map((m) => (
                  <li key={m.id} className="rounded-lg border border-slate-800 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-200">
                          {m.type}
                          {m.description ? ` · ${m.description}` : ""}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          due {fmtDate(m.dueAt)}
                          {m.dueOdometer != null && ` or ${m.dueOdometer.toLocaleString()} ${vehicle.odometerUnit}`}
                          {(m.intervalDays || m.intervalDistance) && " · repeats"}
                        </p>
                      </div>
                    </div>
                    <form action={actionCompleteMaintenance} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="vehicleId" value={vehicle.id} />
                      <label className="text-[11px] text-slate-500">
                        Odometer
                        <Input name="completedOdometer" type="number" step="1" className="h-8 w-28" />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Cost
                        <Input name="cost" type="number" step="0.01" className="h-8 w-24" />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Vendor
                        <Input name="vendor" className="h-8 w-32" />
                      </label>
                      <Button type="submit" size="sm" variant="outline">
                        Complete
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            <form action={actionAddMaintenance} className="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-2">
              <input type="hidden" name="vehicleId" value={vehicle.id} />
              <p className="sm:col-span-2 text-xs font-medium text-slate-400">Schedule maintenance</p>
              <label className="text-[11px] text-slate-500">
                Type
                <select name="type" className={selectClass} defaultValue="PM">
                  {MAINTENANCE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-slate-500">
                Description
                <Input name="description" placeholder="Oil & filter" />
              </label>
              <label className="text-[11px] text-slate-500">
                Due date
                <Input name="dueAt" type="date" />
              </label>
              <label className="text-[11px] text-slate-500">
                Due odometer
                <Input name="dueOdometer" type="number" step="1" />
              </label>
              <label className="text-[11px] text-slate-500">
                Repeat every (days)
                <Input name="intervalDays" type="number" placeholder="180" />
              </label>
              <label className="text-[11px] text-slate-500">
                Repeat every ({vehicle.odometerUnit.toLowerCase()})
                <Input name="intervalDistance" type="number" placeholder="5000" />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm">Schedule</Button>
              </div>
            </form>

            {history.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-400">History</p>
                <ul className="space-y-1 text-xs text-slate-400">
                  {history.slice(0, 8).map((m) => (
                    <li key={m.id} className="flex justify-between gap-2">
                      <span className="truncate">
                        {fmtDate(m.completedAt)} · {m.type}
                        {m.vendor ? ` · ${m.vendor}` : ""}
                      </span>
                      <span className="shrink-0 tabular-nums">{money(m.cost)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fuel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Fuel className="h-4 w-4 text-teal-400" /> Fuel
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form action={actionAddFuel} className="grid gap-2 sm:grid-cols-4">
              <input type="hidden" name="vehicleId" value={vehicle.id} />
              <label className="text-[11px] text-slate-500">
                Gallons *
                <Input name="gallons" type="number" step="0.01" required />
              </label>
              <label className="text-[11px] text-slate-500">
                Cost *
                <Input name="cost" type="number" step="0.01" required />
              </label>
              <label className="text-[11px] text-slate-500">
                Odometer
                <Input name="odometer" type="number" step="1" />
              </label>
              <div className="flex items-end">
                <Button type="submit" size="sm">Log</Button>
              </div>
            </form>

            {vehicle.fuelLogs.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-800 py-6 text-center text-xs text-slate-500">
                No fuel logged yet.
              </p>
            ) : (
              <ul className="space-y-1 text-xs text-slate-400">
                {vehicle.fuelLogs.slice(0, 10).map((f) => (
                  <li key={f.id} className="flex justify-between gap-2">
                    <span>
                      {fmtDate(f.filledAt)} · {f.gallons.toFixed(1)} gal
                      {f.odometer != null && ` @ ${Math.round(f.odometer).toLocaleString()}`}
                    </span>
                    <span className="shrink-0 tabular-nums">{money(f.cost)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Details */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Vehicle details</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionUpdateVehicle} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="id" value={vehicle.id} />
            <label className="text-xs text-slate-500">
              Nickname
              <Input name="name" defaultValue={vehicle.name || ""} />
            </label>
            <label className="text-xs text-slate-500">
              Type
              <select name="type" className={selectClass} defaultValue={vehicle.type}>
                {VEHICLE_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Status
              <select name="status" className={selectClass} defaultValue={vehicle.status}>
                {VEHICLE_STATUSES.map((s) => (<option key={s} value={s}>{s.replace(/_/g, " ")}</option>))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Year
              <Input name="year" type="number" defaultValue={vehicle.year ?? ""} />
            </label>
            <label className="text-xs text-slate-500">
              Make
              <Input name="make" defaultValue={vehicle.make || ""} />
            </label>
            <label className="text-xs text-slate-500">
              Model
              <Input name="model" defaultValue={vehicle.model || ""} />
            </label>
            <label className="text-xs text-slate-500">
              VIN
              <Input name="vin" defaultValue={vehicle.vin || ""} />
            </label>
            <label className="text-xs text-slate-500">
              Plate
              <Input name="licensePlate" defaultValue={vehicle.licensePlate || ""} />
            </label>
            <label className="text-xs text-slate-500">
              Odometer
              <Input name="odometer" type="number" step="1" defaultValue={vehicle.odometer} />
            </label>
            <label className="text-xs text-slate-500">
              Units
              <select name="odometerUnit" className={selectClass} defaultValue={vehicle.odometerUnit}>
                <option value="MI">MI</option>
                <option value="KM">KM</option>
                <option value="HOURS">HOURS</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Assigned to
              <select name="assignedToId" className={selectClass} defaultValue={vehicle.assignedToId || ""}>
                <option value="">Unassigned</option>
                {users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Home location
              <Input name="homeLocation" defaultValue={vehicle.homeLocation || ""} />
            </label>
            <label className="text-xs text-slate-500">
              Registration expires
              <Input name="registrationExpires" type="date" defaultValue={forInput(vehicle.registrationExpires)} />
            </label>
            <label className="text-xs text-slate-500">
              Insurance expires
              <Input name="insuranceExpires" type="date" defaultValue={forInput(vehicle.insuranceExpires)} />
            </label>
            <label className="text-xs text-slate-500">
              Inspection expires
              <Input name="inspectionExpires" type="date" defaultValue={forInput(vehicle.inspectionExpires)} />
            </label>
            <label className="text-xs text-slate-500 sm:col-span-3">
              Notes
              <Input name="notes" defaultValue={vehicle.notes || ""} />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">Save</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-slate-100">{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}
