import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { listUsers } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import {
  ACTIVITY_TYPES,
  OPEN_STAGES,
  STAGES,
  getOpportunity,
} from "@/lib/services/crm";
import {
  actionAddActivity,
  actionCompleteActivity,
  actionConvertToCustomer,
  actionSetStage,
  actionUpdateOpportunity,
} from "../actions";
import { Trophy, XCircle, Building2 } from "lucide-react";

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

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const opp = await getOpportunity(id);
  if (!opp) notFound();

  const [customers, users, customer] = await Promise.all([
    prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    listUsers().catch(() => []),
    opp.customerId
      ? prisma.customer.findUnique({
          where: { id: opp.customerId },
          select: { id: true, name: true, code: true },
        })
      : null,
  ]);

  const userName = new Map(users.map((u) => [u.id, u.name]));
  const closed = opp.stage === "WON" || opp.stage === "LOST";
  const tasks = opp.activities.filter((a) => a.type === "TASK" && !a.completedAt);
  const timeline = opp.activities.filter((a) => a.type !== "TASK" || a.completedAt);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${opp.number} · ${opp.name}`}
        description={`${opp.stage} · ${formatCurrency(opp.value)} · ${opp.probability}% · ${
          opp.ownerId ? userName.get(opp.ownerId) || "unassigned" : "unassigned"
        }`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/crm" className="text-xs text-teal-300 hover:underline">
          ← Pipeline
        </Link>
        {opp.stage === "WON" && (
          <span className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
            <Trophy className="h-3 w-3" /> WON {fmtDate(opp.closedAt)}
          </span>
        )}
        {opp.stage === "LOST" && (
          <span className="flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
            <XCircle className="h-3 w-3" /> LOST — {opp.lostReason}
          </span>
        )}
        {customer && (
          <Link
            href={`/customers`}
            className="flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-900"
          >
            <Building2 className="h-3 w-3" /> {customer.name} ({customer.code})
          </Link>
        )}
      </div>

      {/* ── Move the deal ────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={actionSetStage} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={opp.id} />
            <label className="text-[11px] text-slate-500">
              Stage
              <select
                key={`stage-${opp.stage}`}
                name="stage"
                defaultValue={opp.stage}
                className="mt-1 h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-slate-500">
              Probability %
              <Input
                key={`prob-${opp.probability}`}
                name="probability"
                type="number"
                min="0"
                max="100"
                defaultValue={String(opp.probability)}
                className="h-8 w-24"
              />
            </label>
            <label className="text-[11px] text-slate-500">
              Reason (required to mark lost)
              <Input
                name="lostReason"
                defaultValue={opp.lostReason ?? ""}
                className="h-8 w-64"
                placeholder="Price, lead time, incumbent…"
              />
            </label>
            <Button type="submit" size="sm">
              Update stage
            </Button>
          </form>

          {opp.stage === "WON" && !opp.customerId && (
            <form
              action={actionConvertToCustomer}
              className="flex flex-wrap items-end gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3"
            >
              <input type="hidden" name="opportunityId" value={opp.id} />
              <p className="flex-1 text-xs text-emerald-200">
                Won, but no customer record yet. Create one to raise quotes and orders.
              </p>
              <label className="text-[11px] text-slate-500">
                Terms
                <Input name="paymentTerms" defaultValue="NET30" className="h-8 w-24" />
              </label>
              <label className="text-[11px] text-slate-500">
                Credit limit
                <Input name="creditLimit" type="number" step="0.01" className="h-8 w-28" />
              </label>
              <Button type="submit" size="sm">
                Create customer
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* ── Activity ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Activity{" "}
            <span className="text-xs font-normal text-slate-500">
              ({opp.activities.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={actionAddActivity} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="opportunityId" value={opp.id} />
            <label className="text-[11px] text-slate-500">
              Type
              <select
                name="type"
                className="mt-1 h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                defaultValue="NOTE"
              >
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-slate-500">
              Subject *
              <Input name="subject" required className="h-8 w-72" placeholder="Called about lead time" />
            </label>
            <label className="text-[11px] text-slate-500">
              Due (tasks only)
              <Input name="dueAt" type="date" className="h-8 w-36" />
            </label>
            <Button type="submit" size="sm" variant="outline">
              Log
            </Button>
          </form>

          {tasks.length > 0 && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2">
              <p className="mb-1 text-[11px] uppercase tracking-wider text-amber-300/80">
                Open tasks
              </p>
              <ul className="space-y-1 text-xs">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-200">
                      {t.subject}
                      {t.dueAt && (
                        <span
                          className={
                            new Date(t.dueAt) < new Date()
                              ? " text-rose-300"
                              : " text-slate-500"
                          }
                        >
                          {" "}
                          · due {fmtDate(t.dueAt)}
                        </span>
                      )}
                    </span>
                    <form action={actionCompleteActivity}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="opportunityId" value={opp.id} />
                      <button
                        type="submit"
                        className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-900"
                      >
                        Done
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {timeline.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 py-6 text-center text-xs text-slate-500">
              Nothing logged yet.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {timeline.map((a) => (
                <li
                  key={a.id}
                  className="flex items-start justify-between gap-2 border-b border-slate-800/60 pb-1.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="mr-1.5 rounded bg-slate-800/60 px-1 py-0.5 text-[10px] text-slate-400">
                      {a.type}
                    </span>
                    <span className="text-slate-200">{a.subject}</span>
                    {a.body && <span className="text-slate-500"> — {a.body}</span>}
                  </span>
                  <span className="shrink-0 text-slate-500">
                    {a.userId ? `${userName.get(a.userId) || ""} · ` : ""}
                    {fmtDateTime(a.occurredAt)}
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
          <CardTitle className="text-base">Deal details</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionUpdateOpportunity} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="id" value={opp.id} />
            <label className="text-xs text-slate-500 sm:col-span-2">
              Name
              <Input name="name" defaultValue={opp.name} />
            </label>
            <label className="text-xs text-slate-500">
              Value
              <Input name="value" type="number" step="0.01" defaultValue={String(opp.value)} />
            </label>
            <label className="text-xs text-slate-500">
              Probability %
              <Input
                name="probability"
                type="number"
                min="0"
                max="100"
                defaultValue={String(opp.probability)}
              />
            </label>
            <label className="text-xs text-slate-500">
              Expected close
              <Input
                name="expectedCloseAt"
                type="date"
                defaultValue={forInput(opp.expectedCloseAt)}
              />
            </label>
            <label className="text-xs text-slate-500">
              Owner
              <select name="ownerId" className={selectClass} defaultValue={opp.ownerId || ""}>
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Customer
              <select
                name="customerId"
                className={selectClass}
                defaultValue={opp.customerId || ""}
              >
                <option value="">— none —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Source
              <Input name="source" defaultValue={opp.source ?? ""} />
            </label>
            <label className="text-xs text-slate-500">
              Notes
              <Input name="description" defaultValue={opp.description ?? ""} />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm" disabled={closed}>
                Save
              </Button>
              {closed && (
                <span className="ml-2 text-[11px] text-slate-500">
                  Reopen the deal (change stage) to edit.
                </span>
              )}
            </div>
          </form>
          <p className="mt-2 text-[11px] text-slate-600">
            Open stages: {OPEN_STAGES.join(" → ")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
