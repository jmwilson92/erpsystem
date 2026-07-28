import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { listUsers } from "@/lib/auth";
import { formatCurrency } from "@/lib/utils";
import {
  OPEN_STAGES,
  STAGES,
  getCrmSummary,
  getLostReasons,
  getOpenTasks,
  getPipeline,
  listOpportunities,
} from "@/lib/services/crm";
import { checkModuleHealth } from "@/lib/services/module-health";
import { ModuleNotMigrated } from "@/components/shared/module-not-migrated";
import { actionCreateOpportunity } from "./actions";
import { Target, TrendingUp, Trophy, CalendarClock } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

const STAGE_TONE: Record<string, string> = {
  PROSPECT: "border-slate-700",
  QUALIFY: "border-sky-600/50",
  PROPOSAL: "border-teal-600/50",
  NEGOTIATION: "border-amber-600/50",
};

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

export default async function CrmPage() {
  const health = await checkModuleHealth(() => getPipeline());
  if (!health.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="CRM" description="Leads, opportunities, and pipeline." />
        <ModuleNotMigrated module="CRM" health={health} />
      </div>
    );
  }

  const [pipeline, summary, open, lostReasons, tasks, customers, users] =
    await Promise.all([
      getPipeline(),
      getCrmSummary(90),
      listOpportunities({ open: true }),
      getLostReasons(180),
      getOpenTasks(8),
      prisma.customer.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      listUsers().catch(() => []),
    ]);

  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const now = Date.now();

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM"
        description="The funnel before an order exists — who might buy, what it's worth, and who's chasing it. Won deals become customers and quotes."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Target}
          label="Open pipeline"
          value={formatCurrency(summary.openValue)}
          sub={`${summary.openCount} deals`}
        />
        <Stat
          icon={TrendingUp}
          label="Weighted forecast"
          value={formatCurrency(summary.weighted)}
          sub="by each deal's probability"
        />
        <Stat
          icon={Trophy}
          label="Won (90d)"
          value={formatCurrency(summary.wonValue)}
          sub={`${summary.wonCount} deals · ${summary.winRate}% win rate`}
          tone={summary.wonCount > 0 ? "text-emerald-400" : "text-slate-500"}
        />
        <Stat
          icon={CalendarClock}
          label="Open leads"
          value={summary.leadCount}
          sub={
            summary.overdueTasks > 0
              ? `${summary.overdueTasks} overdue tasks`
              : "no overdue tasks"
          }
          tone={summary.overdueTasks > 0 ? "text-rose-400" : "text-teal-400"}
        />
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <Link href="/crm/leads" className="text-teal-300 hover:underline">
          Leads →
        </Link>
        <Link href="/crm/contacts" className="text-teal-300 hover:underline">
          Contacts →
        </Link>
      </div>

      {/* ── Pipeline board ───────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-4">
        {pipeline.map((col) => {
          const deals = open.filter((o) => o.stage === col.stage);
          return (
            <Card key={col.stage} className={`border-t-2 ${STAGE_TONE[col.stage] || ""}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {col.stage}{" "}
                  <span className="text-xs font-normal text-slate-500">({col.count})</span>
                </CardTitle>
                <p className="text-[11px] text-slate-500">
                  {formatCurrency(col.value)} · weighted {formatCurrency(col.weighted)}
                </p>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {deals.length === 0 ? (
                  <p className="py-4 text-center text-[11px] text-slate-600">empty</p>
                ) : (
                  deals.slice(0, 12).map((o) => {
                    const late =
                      o.expectedCloseAt && new Date(o.expectedCloseAt).getTime() < now;
                    return (
                      <Link
                        key={o.id}
                        href={`/crm/${o.id}`}
                        className="block rounded-lg border border-slate-800 bg-slate-950/40 p-2 hover:border-slate-700"
                      >
                        <p className="truncate text-xs font-medium text-slate-200">
                          {o.name}
                        </p>
                        <p className="mt-0.5 flex items-center justify-between gap-2 text-[11px]">
                          <span className="tabular-nums text-teal-300">
                            {formatCurrency(o.value)}
                          </span>
                          <span className="text-slate-500">{o.probability}%</span>
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500">
                          {o.customerId ? customerName.get(o.customerId) || "" : ""}
                          {o.ownerId ? ` · ${userName.get(o.ownerId) || ""}` : ""}
                        </p>
                        {o.expectedCloseAt && (
                          <p
                            className={`text-[10px] ${
                              late ? "text-rose-300" : "text-slate-500"
                            }`}
                          >
                            close {fmtDate(o.expectedCloseAt)}
                          </p>
                        )}
                      </Link>
                    );
                  })
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">My open tasks</CardTitle>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">Nothing outstanding.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {tasks.map((t) => {
                  const overdue = t.dueAt && new Date(t.dueAt).getTime() < now;
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-2">
                      {t.opportunityId ? (
                        <Link
                          href={`/crm/${t.opportunityId}`}
                          className="truncate text-slate-300 hover:text-teal-300"
                        >
                          {t.subject}
                        </Link>
                      ) : (
                        <span className="truncate text-slate-300">{t.subject}</span>
                      )}
                      <span
                        className={`shrink-0 text-xs ${
                          overdue ? "text-rose-300" : "text-slate-500"
                        }`}
                      >
                        {fmtDate(t.dueAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Why we lose{" "}
              <span className="text-xs font-normal text-slate-500">last 180 days</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lostReasons.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                No lost deals recorded.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {lostReasons.slice(0, 8).map((r) => (
                  <li key={r.reason} className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-300">{r.reason}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {r.count}× · {formatCurrency(r.value)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">New opportunity</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionCreateOpportunity} className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-500 sm:col-span-2">
              Name *
              <Input name="name" required placeholder="Acme — 500 unit bracket order" />
            </label>
            <label className="text-xs text-slate-500">
              Value
              <Input name="value" type="number" step="0.01" placeholder="25000" />
            </label>
            <label className="text-xs text-slate-500">
              Stage
              <select name="stage" className={selectClass} defaultValue="PROSPECT">
                {OPEN_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Existing customer
              <select name="customerId" className={selectClass} defaultValue="">
                <option value="">— new prospect —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Owner
              <select name="ownerId" className={selectClass} defaultValue="">
                <option value="">Me</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Expected close
              <Input name="expectedCloseAt" type="date" />
            </label>
            <label className="text-xs text-slate-500">
              Source
              <Input name="source" placeholder="Referral, trade show, website" />
            </label>
            <label className="text-xs text-slate-500">
              Notes
              <Input name="description" />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                Create opportunity
              </Button>
            </div>
          </form>
          <p className="mt-2 text-[11px] text-slate-600">
            Stages: {STAGES.join(" → ")}
          </p>
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
