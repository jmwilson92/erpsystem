import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { listUsers } from "@/lib/auth";
import {
  getServiceSummary,
  listInstalledAssets,
  listTickets,
  SERVICE_TYPES,
  TICKET_PRIORITIES,
} from "@/lib/services/field-service";
import { actionCreateTicket } from "./actions";
import { Headphones, CalendarClock, AlarmClock, Inbox } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

const PRIORITY_TONE: Record<string, string> = {
  URGENT: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  HIGH: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  MEDIUM: "bg-slate-700/40 text-slate-300 border-slate-600/40",
  LOW: "bg-slate-800/60 text-slate-400 border-slate-700/40",
};

const STATUS_TONE: Record<string, string> = {
  REQUEST: "text-sky-300",
  SCHEDULED: "text-teal-300",
  IN_PROGRESS: "text-amber-300",
  ON_HOLD: "text-orange-300",
  COMPLETED: "text-emerald-300",
  CLOSED: "text-slate-500",
  CANCELLED: "text-slate-600",
};

function fmtDateTime(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—";
}

export default async function ServicePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const showAll = status === "all";

  const [tickets, summary, customers, users, assets] = await Promise.all([
    listTickets(showAll ? {} : { open: true }),
    getServiceSummary(),
    prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    listUsers().catch(() => []),
    listInstalledAssets().catch(() => []),
  ]);

  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const now = Date.now();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Field service"
        description="Customer calls, dispatch, on-site work, and what gets billed for it."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Headphones} label="Open tickets" value={summary.open} />
        <Stat
          icon={Inbox}
          label="Awaiting dispatch"
          value={summary.unscheduled}
          tone={summary.unscheduled > 0 ? "text-sky-400" : "text-teal-400"}
        />
        <Stat
          icon={AlarmClock}
          label="Past SLA"
          value={summary.overdueSla}
          tone={summary.overdueSla > 0 ? "text-rose-400" : "text-teal-400"}
        />
        <Stat icon={CalendarClock} label="Visits today" value={summary.todayVisits} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">
            {showAll ? "All tickets" : "Open tickets"}{" "}
            <span className="text-xs font-normal text-slate-500">({tickets.length})</span>
          </CardTitle>
          <Link
            href={showAll ? "/service" : "/service?status=all"}
            className="text-xs text-teal-300 hover:underline"
          >
            {showAll ? "Show open only" : "Show all"}
          </Link>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 py-10 text-center text-sm text-slate-500">
              {showAll ? "No tickets yet." : "Nothing open — everything is closed out."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Ticket</th>
                    <th className="pb-2 pr-3 font-medium">Customer</th>
                    <th className="pb-2 pr-3 font-medium">Priority</th>
                    <th className="pb-2 pr-3 font-medium">Type</th>
                    <th className="pb-2 pr-3 font-medium">Next visit</th>
                    <th className="pb-2 pr-3 font-medium">SLA</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {tickets.map((t) => {
                    const next = t.visits.find(
                      (v) => v.status !== "DONE" && v.status !== "CANCELLED"
                    );
                    const slaLate = t.slaDueAt && new Date(t.slaDueAt).getTime() < now;
                    return (
                      <tr key={t.id} className="text-slate-300">
                        <td className="py-2 pr-3">
                          <Link
                            href={`/service/${t.id}`}
                            className="font-mono text-xs font-medium text-teal-300 hover:underline"
                          >
                            {t.number}
                          </Link>
                          <div className="max-w-xs truncate text-xs text-slate-400">{t.title}</div>
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {customerName.get(t.customerId) || "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                              PRIORITY_TONE[t.priority] || PRIORITY_TONE.MEDIUM
                            }`}
                          >
                            {t.priority}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-xs">{t.serviceType}</td>
                        <td className="py-2 pr-3 text-xs">
                          {next ? (
                            <>
                              {fmtDateTime(next.scheduledFor)}
                              {next.technicianId && (
                                <div className="text-slate-500">
                                  {userName.get(next.technicianId) || "—"}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-600">not dispatched</span>
                          )}
                        </td>
                        <td
                          className={`py-2 pr-3 text-xs ${
                            slaLate ? "font-medium text-rose-300" : "text-slate-400"
                          }`}
                        >
                          {t.slaDueAt ? fmtDateTime(t.slaDueAt) : "—"}
                        </td>
                        <td
                          className={`py-2 text-xs font-medium ${STATUS_TONE[t.status] || ""}`}
                        >
                          {t.status.replace(/_/g, " ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Log a service call</CardTitle>
        </CardHeader>
        <CardContent>
          {customers.length === 0 ? (
            <p className="text-sm text-slate-500">
              Add a customer first — service tickets are always against a customer.
            </p>
          ) : (
            <form action={actionCreateTicket} className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-slate-500 sm:col-span-2">
                What&apos;s wrong? *
                <Input name="title" required placeholder="Conveyor drive motor overheating" />
              </label>
              <label className="text-xs text-slate-500">
                Customer *
                <select name="customerId" required className={selectClass} defaultValue="">
                  <option value="" disabled>
                    Select…
                  </option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-slate-500 sm:col-span-3">
                Details
                <textarea
                  name="description"
                  rows={2}
                  className={selectClass}
                  placeholder="What the customer reported, what's been tried already…"
                />
              </label>

              <label className="text-xs text-slate-500">
                Priority
                <select name="priority" className={selectClass} defaultValue="MEDIUM">
                  {TICKET_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Service type
                <select name="serviceType" className={selectClass} defaultValue="REPAIR">
                  {SERVICE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Billable
                <select name="billable" className={selectClass} defaultValue="yes">
                  <option value="yes">Billable</option>
                  <option value="no">No charge / warranty</option>
                </select>
              </label>

              {assets.length > 0 && (
                <label className="text-xs text-slate-500">
                  Installed unit
                  <select name="installedAssetId" className={selectClass} defaultValue="">
                    <option value="">—</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {[a.serialNumber, a.siteName].filter(Boolean).join(" · ") || a.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="text-xs text-slate-500">
                Respond by (SLA)
                <Input name="slaDueAt" type="datetime-local" />
              </label>
              <label className="text-xs text-slate-500">
                Site address
                <Input name="siteAddress" placeholder="1200 Industrial Way, Bay 4" />
              </label>
              <label className="text-xs text-slate-500">
                Site contact
                <Input name="contactName" placeholder="Dana Ruiz" />
              </label>
              <label className="text-xs text-slate-500">
                Contact phone
                <Input name="contactPhone" placeholder="555-0142" />
              </label>

              <div className="sm:col-span-3">
                <Button type="submit" size="sm">
                  Create ticket
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "text-teal-400",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <Icon className={`h-5 w-5 ${tone}`} />
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-100">{value}</p>
      <p className="text-xs font-medium text-slate-300">{label}</p>
    </div>
  );
}
