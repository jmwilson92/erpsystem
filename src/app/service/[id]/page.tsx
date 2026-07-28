import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { listUsers } from "@/lib/auth";
import {
  getTicket,
  getTicketTotals,
  isUnderWarranty,
  TICKET_STATUSES,
} from "@/lib/services/field-service";
import { listVehicles } from "@/lib/services/fleet";
import {
  actionAddLabor,
  actionAddPartUsage,
  actionCompleteVisit,
  actionRemoveLabor,
  actionRemovePartUsage,
  actionScheduleVisit,
  actionStartVisit,
  actionUpdateTicketStatus,
} from "../actions";
import { MapPin, Phone, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

function money(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function fmtDateTime(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
}

const VISIT_TONE: Record<string, string> = {
  SCHEDULED: "text-teal-300",
  EN_ROUTE: "text-sky-300",
  ON_SITE: "text-amber-300",
  DONE: "text-emerald-300",
  CANCELLED: "text-slate-600",
};

export default async function ServiceTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ticket = await getTicket(id);
  if (!ticket) notFound();

  const [totals, customer, users, vehicles, parts] = await Promise.all([
    getTicketTotals(id),
    prisma.customer.findUnique({
      where: { id: ticket.customerId },
      select: { name: true },
    }),
    listUsers().catch(() => []),
    listVehicles({ status: "ACTIVE" }).catch(() => []),
    prisma.part.findMany({
      orderBy: { partNumber: "asc" },
      take: 500,
      select: { id: true, partNumber: true, description: true },
    }),
  ]);

  const userName = new Map(users.map((u) => [u.id, u.name]));
  const partLabel = new Map(
    parts.map((p) => [p.id, `${p.partNumber}${p.description ? ` — ${p.description}` : ""}`])
  );
  const openVisits = ticket.visits.filter(
    (v) => v.status !== "DONE" && v.status !== "CANCELLED"
  );
  const closed = ticket.status === "CLOSED" || ticket.status === "CANCELLED";
  const warranty = isUnderWarranty(ticket.installedAsset?.warrantyEnds);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${ticket.number} · ${ticket.title}`}
        description={`${customer?.name || "Unknown customer"} · ${ticket.serviceType} · ${ticket.priority} priority`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/service" className="text-xs text-teal-300 hover:underline">
          ← All tickets
        </Link>
        <form action={actionUpdateTicketStatus} className="flex items-center gap-2">
          <input type="hidden" name="id" value={ticket.id} />
          <select
            name="status"
            defaultValue={ticket.status}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
          >
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline">
            Update status
          </Button>
        </form>
        {!ticket.billable && (
          <span className="rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-300">
            NO CHARGE
          </span>
        )}
        {warranty && (
          <span className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
            <ShieldCheck className="h-3 w-3" />
            UNDER WARRANTY
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Call details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-300">
            <p className="whitespace-pre-wrap">
              {ticket.description || (
                <span className="text-slate-500">No additional detail recorded.</span>
              )}
            </p>
            <div className="grid gap-2 border-t border-slate-800 pt-3 text-xs sm:grid-cols-2">
              {ticket.siteAddress && (
                <span className="flex items-start gap-1.5 text-slate-400">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                  {ticket.siteAddress}
                </span>
              )}
              {(ticket.contactName || ticket.contactPhone) && (
                <span className="flex items-start gap-1.5 text-slate-400">
                  <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                  {[ticket.contactName, ticket.contactPhone].filter(Boolean).join(" · ")}
                </span>
              )}
              <span className="text-slate-500">Opened {fmtDateTime(ticket.createdAt)}</span>
              {ticket.slaDueAt && (
                <span
                  className={
                    new Date(ticket.slaDueAt) < new Date() && !ticket.closedAt
                      ? "text-rose-300"
                      : "text-slate-500"
                  }
                >
                  Respond by {fmtDateTime(ticket.slaDueAt)}
                </span>
              )}
              {ticket.installedAsset && (
                <span className="text-slate-500">
                  Unit {ticket.installedAsset.serialNumber || ticket.installedAsset.id.slice(0, 8)}
                  {ticket.installedAsset.siteName ? ` @ ${ticket.installedAsset.siteName}` : ""}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Job cost</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-sm">
              <Row label={`Labor (${totals.laborHours.toFixed(1)} h)`} value={money(totals.laborCost)} />
              <Row label="Parts" value={money(totals.partsCost)} />
              <div className="border-t border-slate-800 pt-1.5">
                <Row label="Billable" value={money(totals.billableTotal)} strong />
              </div>
              {totals.nonBillableTotal > 0 && (
                <Row label="Absorbed" value={money(totals.nonBillableTotal)} muted />
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* ── Visits ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Visits <span className="text-xs font-normal text-slate-500">({ticket.visits.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {ticket.visits.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-800 py-8 text-center text-sm text-slate-500">
              Nobody dispatched yet — schedule a visit below.
            </p>
          )}

          {ticket.visits.map((v) => {
            const laborTotal = v.labor.reduce((s, l) => s + l.hours * (l.rate || 0), 0);
            const partsTotal = v.parts.reduce((s, p) => s + p.quantity * (p.unitPrice || 0), 0);
            const done = v.status === "DONE" || v.status === "CANCELLED";
            return (
              <div key={v.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className={`font-medium ${VISIT_TONE[v.status] || ""}`}>
                      {v.status.replace(/_/g, " ")}
                    </span>
                    <span className="ml-2 text-xs text-slate-400">
                      {fmtDateTime(v.scheduledFor)}
                    </span>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {v.technicianId ? userName.get(v.technicianId) || "—" : "Unassigned"}
                      {v.vehicle ? ` · ${v.vehicle.unitNumber}` : ""}
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    {v.labor.length + v.parts.length > 0 && (
                      <>
                        {money(laborTotal + partsTotal)}
                        <div className="text-slate-600">
                          {v.labor.length} labor · {v.parts.length} parts
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {v.summary && (
                  <p className="mt-2 whitespace-pre-wrap border-t border-slate-800 pt-2 text-xs text-slate-300">
                    {v.summary}
                  </p>
                )}
                {v.signedBy && (
                  <p className="mt-1 text-xs text-slate-500">Signed by {v.signedBy}</p>
                )}

                {/* Labor lines */}
                {v.labor.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-slate-800 pt-2 text-xs">
                    {v.labor.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2">
                        <span className="text-slate-300">
                          {l.hours.toFixed(2)} h ·{" "}
                          {l.userId ? userName.get(l.userId) || "—" : "—"}
                          {l.notes ? ` · ${l.notes}` : ""}
                          {!l.billable && (
                            <span className="ml-1 text-slate-500">(no charge)</span>
                          )}
                        </span>
                        <span className="flex items-center gap-2 tabular-nums text-slate-400">
                          {money(l.hours * (l.rate || 0))}
                          {!done && (
                            <form action={actionRemoveLabor}>
                              <input type="hidden" name="id" value={l.id} />
                              <input type="hidden" name="ticketId" value={ticket.id} />
                              <button
                                type="submit"
                                className="text-slate-600 hover:text-rose-400"
                                aria-label="Remove labor line"
                              >
                                ×
                              </button>
                            </form>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Part lines */}
                {v.parts.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-slate-800 pt-2 text-xs">
                    {v.parts.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2">
                        <span className="text-slate-300">
                          {p.quantity} ×{" "}
                          {(p.partId && partLabel.get(p.partId)) || p.description || "part"}
                          {!p.billable && (
                            <span className="ml-1 text-slate-500">(no charge)</span>
                          )}
                        </span>
                        <span className="flex items-center gap-2 tabular-nums text-slate-400">
                          {money(p.quantity * (p.unitPrice || 0))}
                          {!done && (
                            <form action={actionRemovePartUsage}>
                              <input type="hidden" name="id" value={p.id} />
                              <input type="hidden" name="ticketId" value={ticket.id} />
                              <button
                                type="submit"
                                className="text-slate-600 hover:text-rose-400"
                                aria-label="Remove part line"
                              >
                                ×
                              </button>
                            </form>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {!done && (
                  <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
                    {v.status === "SCHEDULED" || v.status === "EN_ROUTE" ? (
                      <form
                        action={actionStartVisit}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="id" value={v.id} />
                        <input type="hidden" name="ticketId" value={ticket.id} />
                        <label className="text-[11px] text-slate-500">
                          Odometer out
                          <Input
                            name="odometerStart"
                            type="number"
                            step="1"
                            className="h-8 w-32"
                            placeholder="optional"
                          />
                        </label>
                        <Button type="submit" size="sm" variant="outline">
                          Arrive on site
                        </Button>
                      </form>
                    ) : null}

                    {/* Add labor */}
                    <form action={actionAddLabor} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="visitId" value={v.id} />
                      <input type="hidden" name="ticketId" value={ticket.id} />
                      <label className="text-[11px] text-slate-500">
                        Hours
                        <Input
                          name="hours"
                          type="number"
                          step="0.25"
                          required
                          className="h-8 w-20"
                        />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Rate
                        <Input name="rate" type="number" step="0.01" className="h-8 w-24" />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Tech
                        <select
                          name="userId"
                          className="mt-1 h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                          defaultValue={v.technicianId || ""}
                        >
                          <option value="">—</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Notes
                        <Input name="notes" className="h-8 w-48" placeholder="What was done" />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Bill
                        <select
                          name="billable"
                          className="mt-1 h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                          defaultValue={ticket.billable ? "yes" : "no"}
                        >
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </label>
                      <Button type="submit" size="sm" variant="outline">
                        Add labor
                      </Button>
                    </form>

                    {/* Add parts */}
                    <form action={actionAddPartUsage} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="visitId" value={v.id} />
                      <input type="hidden" name="ticketId" value={ticket.id} />
                      <label className="text-[11px] text-slate-500">
                        Part
                        <select
                          name="partId"
                          className="mt-1 h-8 max-w-[16rem] rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                          defaultValue=""
                        >
                          <option value="">— free text —</option>
                          {parts.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.partNumber}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Description
                        <Input
                          name="description"
                          className="h-8 w-40"
                          placeholder="if not catalogued"
                        />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Qty
                        <Input
                          name="quantity"
                          type="number"
                          step="1"
                          required
                          className="h-8 w-20"
                        />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Unit price
                        <Input name="unitPrice" type="number" step="0.01" className="h-8 w-24" />
                      </label>
                      {vehicles.length > 0 && (
                        <label className="text-[11px] text-slate-500">
                          Off van
                          <select
                            name="fromVehicleId"
                            className="mt-1 h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                            defaultValue={v.vehicleId || ""}
                          >
                            <option value="">—</option>
                            {vehicles.map((veh) => (
                              <option key={veh.id} value={veh.id}>
                                {veh.unitNumber}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="text-[11px] text-slate-500">
                        Bill
                        <select
                          name="billable"
                          className="mt-1 h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                          defaultValue={ticket.billable ? "yes" : "no"}
                        >
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </label>
                      <Button type="submit" size="sm" variant="outline">
                        Add part
                      </Button>
                    </form>

                    {/* Close out */}
                    <form
                      action={actionCompleteVisit}
                      className="flex flex-wrap items-end gap-2 border-t border-slate-800/60 pt-3"
                    >
                      <input type="hidden" name="id" value={v.id} />
                      <input type="hidden" name="ticketId" value={ticket.id} />
                      <label className="text-[11px] text-slate-500">
                        Work summary
                        <Input
                          name="summary"
                          className="h-8 w-64"
                          placeholder="Replaced drive motor, verified run"
                        />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Signed by
                        <Input name="signedBy" className="h-8 w-40" placeholder="Customer name" />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Odometer in
                        <Input
                          name="odometerEnd"
                          type="number"
                          step="1"
                          className="h-8 w-28"
                        />
                      </label>
                      <Button type="submit" size="sm">
                        Complete visit
                      </Button>
                    </form>
                  </div>
                )}
              </div>
            );
          })}

          {!closed && (
            <form
              action={actionScheduleVisit}
              className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-slate-800 p-4"
            >
              <input type="hidden" name="ticketId" value={ticket.id} />
              <label className="text-xs text-slate-500">
                Technician
                <select name="technicianId" className={selectClass} defaultValue="">
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Vehicle
                <select name="vehicleId" className={selectClass} defaultValue="">
                  <option value="">—</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.unitNumber}
                      {v.name ? ` · ${v.name}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Scheduled for
                <Input name="scheduledFor" type="datetime-local" />
              </label>
              <label className="text-xs text-slate-500">
                Until
                <Input name="scheduledEnd" type="datetime-local" />
              </label>
              <Button type="submit" size="sm">
                {openVisits.length > 0 ? "Schedule another visit" : "Dispatch"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className={`text-xs ${muted ? "text-slate-600" : "text-slate-500"}`}>{label}</dt>
      <dd
        className={`tabular-nums ${
          strong ? "text-base font-semibold text-slate-100" : muted ? "text-slate-500" : "text-slate-300"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
