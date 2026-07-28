import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import {
  CRITICALITIES,
  METER_UNITS,
  getAvailability,
  getDowntimePareto,
  getMaintenanceDue,
  getMaintenanceSummary,
  listEquipment,
} from "@/lib/services/maintenance";
import { checkModuleHealth } from "@/lib/services/module-health";
import { ModuleNotMigrated } from "@/components/shared/module-not-migrated";
import { actionCreateEquipment } from "./actions";
import { Cog, Wrench, AlertOctagon, Activity } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "text-emerald-300",
  DOWN: "text-rose-300",
  STANDBY: "text-amber-300",
  RETIRED: "text-slate-500",
};

const CRIT_TONE: Record<string, string> = {
  CRITICAL: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  HIGH: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  MEDIUM: "bg-slate-700/40 text-slate-300 ring-slate-600/40",
  LOW: "bg-slate-800/60 text-slate-400 ring-slate-700/40",
};

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}
function hhmm(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function MaintenancePage() {
  const health = await checkModuleHealth(() => listEquipment());
  if (!health.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Maintenance" description="Plant equipment and PM schedules." />
        <ModuleNotMigrated module="Maintenance" health={health} />
      </div>
    );
  }

  const [equipment, due, summary, pareto, availability, workCenters] =
    await Promise.all([
      listEquipment(),
      getMaintenanceDue(),
      getMaintenanceSummary(),
      getDowntimePareto(30),
      getAvailability(30),
      prisma.workCenter
        .findMany({ where: { isActive: true }, orderBy: { code: "asc" } })
        .catch(() => []),
    ]);

  const wcName = new Map(workCenters.map((w) => [w.id, `${w.code} — ${w.name}`]));
  const worstAvailability = availability.slice(0, 6);
  const paretoMax = Math.max(...pareto.map((p) => p.minutes), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance"
        description="Plant equipment, preventive maintenance, and why machines stop. Availability is the uptime term of OEE — it does not include performance or quality."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Cog} label="Equipment" value={summary.total} sub={`${summary.down} down now`} />
        <Stat
          icon={Wrench}
          label="Maintenance due"
          value={summary.dueCount}
          sub={`${summary.overdueCount} overdue`}
          tone={summary.overdueCount > 0 ? "text-rose-400" : "text-teal-400"}
        />
        <Stat
          icon={AlertOctagon}
          label="Open stoppages"
          value={summary.openDowntime}
          sub="not yet resolved"
          tone={summary.openDowntime > 0 ? "text-rose-400" : "text-teal-400"}
        />
        <Stat
          icon={Activity}
          label="Downtime 30d"
          value={hhmm(pareto.reduce((n, p) => n + p.minutes, 0))}
          sub={`${pareto.reduce((n, p) => n + p.events, 0)} events`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-4 w-4 text-amber-400" />
              Due &amp; overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            {due.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">Nothing due.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {due.slice(0, 8).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/maintenance/${d.equipmentId}`}
                      className="truncate hover:text-teal-300"
                    >
                      <span className="font-mono text-xs text-slate-400">{d.assetTag}</span>{" "}
                      {d.type}
                      {d.description ? ` · ${d.description}` : ""}
                    </Link>
                    <span
                      className={`shrink-0 text-xs ${
                        d.reason === "DUE_SOON" ? "text-amber-300" : "text-rose-300"
                      }`}
                    >
                      {d.reason === "OVERDUE_METER"
                        ? `${Math.round(d.meter)} / ${d.dueMeter} ${d.meterUnit.toLowerCase()}`
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
              <AlertOctagon className="h-4 w-4 text-rose-400" />
              Downtime by reason
              <span className="text-xs font-normal text-slate-500">last 30 days</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pareto.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No downtime recorded.
              </p>
            ) : (
              <div className="space-y-1.5">
                {pareto.map((p) => (
                  <div key={p.reason} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-[11px] text-slate-300">
                      {p.reason}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-900">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-500"
                        style={{ width: `${Math.max(4, (p.minutes / paretoMax) * 100)}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
                      {hhmm(p.minutes)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {worstAvailability.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Lowest availability{" "}
              <span className="text-xs font-normal text-slate-500">last 30 days</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {worstAvailability.map((a) => (
                <div key={a.id} className="flex items-center gap-3">
                  <Link
                    href={`/maintenance/${a.id}`}
                    className="w-40 shrink-0 truncate text-[11px] text-slate-300 hover:text-teal-300"
                  >
                    <span className="font-mono">{a.assetTag}</span> {a.name}
                  </Link>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-900">
                    <div
                      className={`h-full rounded-full ${
                        a.availability < 90
                          ? "bg-gradient-to-r from-rose-500 to-amber-500"
                          : "bg-gradient-to-r from-teal-500 to-emerald-500"
                      }`}
                      style={{ width: `${Math.max(2, a.availability)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
                    {a.availability}% · {hhmm(a.downMinutes)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Equipment{" "}
            <span className="text-xs font-normal text-slate-500">({equipment.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {equipment.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 py-10 text-center text-sm text-slate-500">
              No equipment registered — add your first machine below.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Asset</th>
                    <th className="pb-2 pr-3 font-medium">Workcenter</th>
                    <th className="pb-2 pr-3 font-medium">Make / model</th>
                    <th className="pb-2 pr-3 font-medium">Meter</th>
                    <th className="pb-2 pr-3 font-medium">Criticality</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {equipment.map((e) => (
                    <tr key={e.id} className="text-slate-300">
                      <td className="py-2 pr-3">
                        <Link
                          href={`/maintenance/${e.id}`}
                          className="font-medium text-teal-300 hover:underline"
                        >
                          {e.assetTag}
                        </Link>
                        <div className="text-xs text-slate-500">{e.name}</div>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {e.workCenterId ? wcName.get(e.workCenterId) || "—" : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {[e.manufacturer, e.model].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs tabular-nums">
                        {Math.round(e.meter).toLocaleString()}{" "}
                        <span className="text-slate-500">{e.meterUnit.toLowerCase()}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${
                            CRIT_TONE[e.criticality] || CRIT_TONE.MEDIUM
                          }`}
                        >
                          {e.criticality}
                        </span>
                      </td>
                      <td className={`py-2 text-xs font-medium ${STATUS_TONE[e.status] || ""}`}>
                        {e.status}
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
          <CardTitle className="text-base">Add equipment</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionCreateEquipment} className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-500">
              Asset tag *
              <Input name="assetTag" required placeholder="CNC-01" />
            </label>
            <label className="text-xs text-slate-500">
              Name *
              <Input name="name" required placeholder="Haas VF-2 mill" />
            </label>
            <label className="text-xs text-slate-500">
              Workcenter
              <select name="workCenterId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {workCenters.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Manufacturer
              <Input name="manufacturer" placeholder="Haas" />
            </label>
            <label className="text-xs text-slate-500">
              Model
              <Input name="model" placeholder="VF-2SS" />
            </label>
            <label className="text-xs text-slate-500">
              Serial number
              <Input name="serialNumber" />
            </label>
            <label className="text-xs text-slate-500">
              Meter reading
              <Input name="meter" type="number" step="1" placeholder="0" />
            </label>
            <label className="text-xs text-slate-500">
              Meter unit
              <select name="meterUnit" className={selectClass} defaultValue="HOURS">
                {METER_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Criticality
              <select name="criticality" className={selectClass} defaultValue="MEDIUM">
                {CRITICALITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Location
              <Input name="location" placeholder="Bay 3" />
            </label>
            <label className="text-xs text-slate-500">
              Installed
              <Input name="installedAt" type="date" />
            </label>
            <label className="text-xs text-slate-500">
              Warranty ends
              <Input name="warrantyEnds" type="date" />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                Add equipment
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
