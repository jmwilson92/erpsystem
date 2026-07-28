import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/utils";
import {
  CRITICALITIES,
  DOWNTIME_REASONS,
  EQUIPMENT_STATUSES,
  MAINTENANCE_TYPES,
  METER_UNITS,
  getEquipment,
} from "@/lib/services/maintenance";
import {
  actionAddMaintenance,
  actionCompleteMaintenance,
  actionEndDowntime,
  actionRecordMeter,
  actionStartDowntime,
  actionUpdateEquipment,
} from "../actions";
import { AlertOctagon } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}
function fmtDateTime(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—";
}
function forInput(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}
function hhmm(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const eq = await getEquipment(id);
  if (!eq) notFound();

  const workCenters = await prisma.workCenter
    .findMany({ where: { isActive: true }, orderBy: { code: "asc" } })
    .catch(() => []);

  const scheduled = eq.maintenance.filter((m) => m.status === "SCHEDULED");
  const history = eq.maintenance.filter((m) => m.status !== "SCHEDULED");
  const openStop = eq.downtime.find((d) => !d.endedAt);
  const maintCost = history.reduce((n, m) => n + (m.cost ?? 0), 0);
  const downMinutes = eq.downtime.reduce((n, d) => {
    const end = d.endedAt ?? new Date();
    return n + Math.max(0, (end.getTime() - d.startedAt.getTime()) / 60_000);
  }, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${eq.assetTag} · ${eq.name}`}
        description={[eq.manufacturer, eq.model, eq.location].filter(Boolean).join(" · ") || "Equipment"}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/maintenance" className="text-xs text-teal-300 hover:underline">
          ← All equipment
        </Link>
        {openStop && (
          <span className="flex items-center gap-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
            <AlertOctagon className="h-3 w-3" />
            DOWN — {openStop.reason} since {fmtDateTime(openStop.startedAt)}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Meter" value={`${Math.round(eq.meter).toLocaleString()} ${eq.meterUnit.toLowerCase()}`} />
        <Metric label="PMs scheduled" value={String(scheduled.length)} />
        <Metric label="Maintenance cost" value={formatCurrency(maintCost)} sub="recorded to date" />
        <Metric label="Downtime logged" value={hhmm(downMinutes)} sub={`${eq.downtime.length} events`} />
      </div>

      {/* ── Downtime ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Downtime</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {openStop ? (
            <form
              action={actionEndDowntime}
              className="flex flex-wrap items-end gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3"
            >
              <input type="hidden" name="id" value={openStop.id} />
              <input type="hidden" name="equipmentId" value={eq.id} />
              <p className="flex-1 text-xs text-rose-200">
                Stopped for <strong>{openStop.reason}</strong> since{" "}
                {fmtDateTime(openStop.startedAt)}
                {openStop.description ? ` — ${openStop.description}` : ""}
              </p>
              <Button type="submit" size="sm">
                Back in service
              </Button>
            </form>
          ) : (
            <form action={actionStartDowntime} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="equipmentId" value={eq.id} />
              <label className="text-[11px] text-slate-500">
                Reason
                <select
                  name="reason"
                  className="mt-1 h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                  defaultValue="BREAKDOWN"
                >
                  {DOWNTIME_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-slate-500">
                What happened
                <Input name="description" className="h-8 w-72" placeholder="Spindle fault F0231" />
              </label>
              <Button type="submit" size="sm" variant="outline">
                Report machine down
              </Button>
            </form>
          )}

          {eq.downtime.length > 0 && (
            <ul className="space-y-1 border-t border-slate-800 pt-2 text-xs">
              {eq.downtime.slice(0, 10).map((d) => {
                const end = d.endedAt ?? new Date();
                const mins = Math.max(0, (end.getTime() - d.startedAt.getTime()) / 60_000);
                return (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-300">
                      <span className="font-medium">{d.reason}</span>
                      {d.description ? ` · ${d.description}` : ""}
                      <span className="text-slate-500"> · {fmtDateTime(d.startedAt)}</span>
                    </span>
                    <span
                      className={`shrink-0 tabular-nums ${
                        d.endedAt ? "text-slate-400" : "text-rose-300"
                      }`}
                    >
                      {hhmm(mins)}
                      {!d.endedAt && " (open)"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Maintenance ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Preventive maintenance{" "}
            <span className="text-xs font-normal text-slate-500">({scheduled.length} scheduled)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {scheduled.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-800 py-6 text-center text-xs text-slate-500">
              Nothing scheduled — add a PM below and it will repeat on its interval.
            </p>
          )}
          {scheduled.map((m) => {
            const overdueDate = m.dueAt && m.dueAt <= new Date();
            const overdueMeter = m.dueMeter != null && eq.meter >= m.dueMeter;
            return (
              <div
                key={m.id}
                className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-slate-200">
                    <span className="font-medium">{m.type}</span>
                    {m.description ? ` · ${m.description}` : ""}
                  </span>
                  <span
                    className={`text-xs ${
                      overdueDate || overdueMeter ? "text-rose-300" : "text-slate-400"
                    }`}
                  >
                    {m.dueAt ? `due ${fmtDate(m.dueAt)}` : ""}
                    {m.dueAt && m.dueMeter != null ? " · " : ""}
                    {m.dueMeter != null
                      ? `at ${m.dueMeter.toLocaleString()} ${eq.meterUnit.toLowerCase()}`
                      : ""}
                    {!m.dueAt && m.dueMeter == null ? "no trigger set" : ""}
                  </span>
                </div>
                {(m.intervalDays || m.intervalMeter) && (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    repeats every{" "}
                    {[
                      m.intervalDays ? `${m.intervalDays} days` : null,
                      m.intervalMeter
                        ? `${m.intervalMeter.toLocaleString()} ${eq.meterUnit.toLowerCase()}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" / ")}
                  </p>
                )}
                <form
                  action={actionCompleteMaintenance}
                  className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-2"
                >
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="equipmentId" value={eq.id} />
                  <label className="text-[11px] text-slate-500">
                    Meter now
                    <Input name="completedMeter" type="number" step="1" className="h-8 w-28" />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Cost
                    <Input name="cost" type="number" step="0.01" className="h-8 w-24" />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Downtime (min)
                    <Input name="downtimeMinutes" type="number" step="1" className="h-8 w-24" />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Vendor
                    <Input name="vendor" className="h-8 w-32" />
                  </label>
                  <Button type="submit" size="sm" variant="outline">
                    Mark complete
                  </Button>
                </form>
              </div>
            );
          })}

          <form
            action={actionAddMaintenance}
            className="grid gap-3 rounded-lg border border-dashed border-slate-800 p-3 sm:grid-cols-3"
          >
            <input type="hidden" name="equipmentId" value={eq.id} />
            <label className="text-xs text-slate-500">
              Type
              <select name="type" className={selectClass} defaultValue="PM">
                {MAINTENANCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500 sm:col-span-2">
              Description
              <Input name="description" placeholder="Way lube, filters, spindle taper check" />
            </label>
            <label className="text-xs text-slate-500">
              Due date
              <Input name="dueAt" type="date" />
            </label>
            <label className="text-xs text-slate-500">
              Due at meter
              <Input name="dueMeter" type="number" step="1" placeholder="2000" />
            </label>
            <div />
            <label className="text-xs text-slate-500">
              Repeat every (days)
              <Input name="intervalDays" type="number" placeholder="90" />
            </label>
            <label className="text-xs text-slate-500">
              Repeat every (meter)
              <Input name="intervalMeter" type="number" placeholder="500" />
            </label>
            <div className="flex items-end">
              <Button type="submit" size="sm">
                Schedule
              </Button>
            </div>
          </form>

          {history.length > 0 && (
            <div className="border-t border-slate-800 pt-2">
              <p className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">
                History
              </p>
              <ul className="space-y-1 text-xs">
                {history.slice(0, 10).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-400">
                      {m.type}
                      {m.description ? ` · ${m.description}` : ""}
                      {m.vendor ? ` · ${m.vendor}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-500">
                      {fmtDate(m.completedAt)}
                      {m.cost ? ` · ${formatCurrency(m.cost)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Meter ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Meter readings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={actionRecordMeter} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="equipmentId" value={eq.id} />
            <label className="text-[11px] text-slate-500">
              Reading ({eq.meterUnit.toLowerCase()})
              <Input name="value" type="number" step="1" required className="h-8 w-32" />
            </label>
            <label className="text-[11px] text-slate-500">
              Note
              <Input name="notes" className="h-8 w-56" placeholder="Monthly read" />
            </label>
            <Button type="submit" size="sm" variant="outline">
              Log reading
            </Button>
          </form>
          {eq.meterLogs.length > 0 && (
            <ul className="space-y-1 border-t border-slate-800 pt-2 text-xs">
              {eq.meterLogs.slice(0, 10).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">
                    {fmtDateTime(r.readAt)}
                    {r.notes ? ` · ${r.notes}` : ""}
                  </span>
                  <span className="tabular-nums text-slate-300">
                    {Math.round(r.value).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Details ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Equipment details</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionUpdateEquipment} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="id" value={eq.id} />
            <label className="text-xs text-slate-500">
              Name
              <Input name="name" defaultValue={eq.name} />
            </label>
            <label className="text-xs text-slate-500">
              Workcenter
              <select name="workCenterId" className={selectClass} defaultValue={eq.workCenterId || ""}>
                <option value="">—</option>
                {workCenters.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Status
              <select name="status" className={selectClass} defaultValue={eq.status}>
                {EQUIPMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Manufacturer
              <Input name="manufacturer" defaultValue={eq.manufacturer || ""} />
            </label>
            <label className="text-xs text-slate-500">
              Model
              <Input name="model" defaultValue={eq.model || ""} />
            </label>
            <label className="text-xs text-slate-500">
              Serial number
              <Input name="serialNumber" defaultValue={eq.serialNumber || ""} />
            </label>
            <label className="text-xs text-slate-500">
              Meter unit
              <select name="meterUnit" className={selectClass} defaultValue={eq.meterUnit}>
                {METER_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Criticality
              <select name="criticality" className={selectClass} defaultValue={eq.criticality}>
                {CRITICALITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Location
              <Input name="location" defaultValue={eq.location || ""} />
            </label>
            <label className="text-xs text-slate-500">
              Installed
              <Input name="installedAt" type="date" defaultValue={forInput(eq.installedAt)} />
            </label>
            <label className="text-xs text-slate-500">
              Warranty ends
              <Input name="warrantyEnds" type="date" defaultValue={forInput(eq.warrantyEnds)} />
            </label>
            <label className="text-xs text-slate-500">
              Notes
              <Input name="notes" defaultValue={eq.notes || ""} />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                Save
              </Button>
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
      <p className="text-2xl font-bold tabular-nums text-slate-100">{value}</p>
      <p className="text-xs font-medium text-slate-300">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}
