import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listVehicles,
  getMaintenanceDue,
  getComplianceDue,
  VEHICLE_TYPES,
} from "@/lib/services/fleet";
import { listUsers } from "@/lib/auth";
import { actionCreateVehicle } from "./actions";
import { Truck, Wrench, ShieldAlert, Gauge } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "text-emerald-300",
  IN_SHOP: "text-amber-300",
  OUT_OF_SERVICE: "text-rose-300",
  RETIRED: "text-slate-500",
};

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<{ due?: string }>;
}) {
  const { due: dueParam } = await searchParams;
  const [allVehicles, due, compliance, users] = await Promise.all([
    listVehicles(),
    getMaintenanceDue(),
    getComplianceDue(),
    listUsers().catch(() => []),
  ]);

  // `?due=1` (the "Vehicle Maintenance" nav entry) narrows the table to units
  // that actually need attention.
  const needsAttention = new Set([
    ...due.map((d) => d.vehicleId),
    ...compliance.map((c) => c.vehicleId),
  ]);
  const onlyDue = dueParam === "1";
  const vehicles = onlyDue
    ? allVehicles.filter((v) => needsAttention.has(v.id))
    : allVehicles;

  const byId = new Map(users.map((u) => [u.id, u.name]));
  const active = allVehicles.filter((v) => v.status === "ACTIVE").length;
  const overdue = due.filter((d) => d.reason !== "DUE_SOON").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet"
        description="Service vans, trucks, and yard equipment — assignments, preventive maintenance, fuel cost, and compliance dates."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Truck} label="Vehicles" value={allVehicles.length} sub={`${active} active`} />
        <Stat
          icon={Wrench}
          label="Maintenance due"
          value={due.length}
          sub={`${overdue} overdue`}
          tone={overdue > 0 ? "text-rose-400" : "text-teal-400"}
        />
        <Stat
          icon={ShieldAlert}
          label="Compliance"
          value={compliance.length}
          sub="reg / insurance / inspection"
          tone={compliance.some((c) => c.expired) ? "text-rose-400" : "text-teal-400"}
        />
        <Stat
          icon={Gauge}
          label="Assigned"
          value={allVehicles.filter((v) => v.assignedToId).length}
          sub="to a technician"
        />
      </div>

      {(due.length > 0 || compliance.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4 text-amber-400" />
                Maintenance due
              </CardTitle>
            </CardHeader>
            <CardContent>
              {due.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">Nothing due.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {due.slice(0, 8).map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <Link href={`/fleet/${d.vehicleId}`} className="truncate hover:text-teal-300">
                        <span className="font-mono text-xs text-slate-400">{d.unitNumber}</span>{" "}
                        {d.type}
                        {d.description ? ` · ${d.description}` : ""}
                      </Link>
                      <span
                        className={`shrink-0 text-xs ${
                          d.reason === "DUE_SOON" ? "text-amber-300" : "text-rose-300"
                        }`}
                      >
                        {d.reason === "OVERDUE_ODOMETER"
                          ? `${Math.round(d.odometer)} / ${d.dueOdometer}`
                          : fmtDate(d.dueAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4 text-rose-400" />
                Registration / insurance / inspection
              </CardTitle>
            </CardHeader>
            <CardContent>
              {compliance.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">All current.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {compliance.slice(0, 8).map((c, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <Link href={`/fleet/${c.vehicleId}`} className="truncate hover:text-teal-300">
                        <span className="font-mono text-xs text-slate-400">{c.unitNumber}</span>{" "}
                        {c.kind}
                      </Link>
                      <span className={`shrink-0 text-xs ${c.expired ? "text-rose-300" : "text-amber-300"}`}>
                        {c.expired ? "expired " : "due "}
                        {fmtDate(c.date)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">
            {onlyDue ? "Needs attention" : "Vehicles"}{" "}
            <span className="text-xs font-normal text-slate-500">({vehicles.length})</span>
          </CardTitle>
          <Link
            href={onlyDue ? "/fleet" : "/fleet?due=1"}
            className="text-xs text-teal-300 hover:underline"
          >
            {onlyDue ? "Show all vehicles" : "Show only what's due"}
          </Link>
        </CardHeader>
        <CardContent>
          {vehicles.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 py-10 text-center text-sm text-slate-500">
              {onlyDue
                ? "Nothing due — every unit is current."
                : "No vehicles yet — add your first unit below."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Unit</th>
                    <th className="pb-2 pr-3 font-medium">Type</th>
                    <th className="pb-2 pr-3 font-medium">Vehicle</th>
                    <th className="pb-2 pr-3 font-medium">Assigned</th>
                    <th className="pb-2 pr-3 font-medium">Odometer</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {vehicles.map((v) => (
                    <tr key={v.id} className="text-slate-300">
                      <td className="py-2 pr-3">
                        <Link href={`/fleet/${v.id}`} className="font-medium text-teal-300 hover:underline">
                          {v.unitNumber}
                        </Link>
                        {v.name && <div className="text-xs text-slate-500">{v.name}</div>}
                      </td>
                      <td className="py-2 pr-3 text-xs">{v.type}</td>
                      <td className="py-2 pr-3 text-xs">
                        {[v.year, v.make, v.model].filter(Boolean).join(" ") || "—"}
                        {v.licensePlate && (
                          <div className="text-slate-500">{v.licensePlate}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {v.assignedToId ? byId.get(v.assignedToId) || "—" : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs tabular-nums">
                        {Math.round(v.odometer).toLocaleString()} {v.odometerUnit}
                      </td>
                      <td className={`py-2 text-xs font-medium ${STATUS_TONE[v.status] || ""}`}>
                        {v.status.replace(/_/g, " ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Add a vehicle</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionCreateVehicle} className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-500">
              Unit number *
              <Input name="unitNumber" required placeholder="VAN-01" />
            </label>
            <label className="text-xs text-slate-500">
              Nickname
              <Input name="name" placeholder="Service van 1" />
            </label>
            <label className="text-xs text-slate-500">
              Type
              <select name="type" className={selectClass} defaultValue="VAN">
                {VEHICLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Year
              <Input name="year" type="number" placeholder="2022" />
            </label>
            <label className="text-xs text-slate-500">
              Make
              <Input name="make" placeholder="Ford" />
            </label>
            <label className="text-xs text-slate-500">
              Model
              <Input name="model" placeholder="Transit 250" />
            </label>
            <label className="text-xs text-slate-500">
              Plate
              <Input name="licensePlate" placeholder="7ABC123" />
            </label>
            <label className="text-xs text-slate-500">
              Odometer
              <Input name="odometer" type="number" step="1" placeholder="0" />
            </label>
            <label className="text-xs text-slate-500">
              Assign to
              <select name="assignedToId" className={selectClass} defaultValue="">
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Registration expires
              <Input name="registrationExpires" type="date" />
            </label>
            <label className="text-xs text-slate-500">
              Insurance expires
              <Input name="insuranceExpires" type="date" />
            </label>
            <label className="text-xs text-slate-500">
              Inspection expires
              <Input name="inspectionExpires" type="date" />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                Add vehicle
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
  value: number;
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
