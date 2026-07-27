import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_COOKIE, TENANT_COOKIE } from "@/lib/db";
import { isPlatformSupportEnabled } from "@/lib/platform";
import { getCurrentUser } from "@/lib/auth";
import {
  getDailyStarts,
  getDemoFunnel,
  getErrorGroups,
  getLiveDemos,
  getTopActions,
  getTopPages,
  type InsightsWindow,
} from "@/lib/services/telemetry";
import {
  Activity,
  AlertTriangle,
  MousePointerClick,
  Radio,
  Rocket,
  Timer,
} from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Owner insights — who's on the demo right now, what test drivers actually do,
 * and what's breaking. Platform (dogfood) ADMIN only: a customer's own admin is
 * also ADMIN inside their tenant, so the platform-context check matters as much
 * as the role check.
 */
function ago(d: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
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

/** Simple proportional bar list — no chart library needed. */
function BarList({
  rows,
  empty,
}: {
  rows: { key: string; count: number }[];
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-800 py-8 text-center text-xs text-slate-500">
        {empty}
      </p>
    );
  }
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <span className="w-1/2 shrink-0 truncate font-mono text-[11px] text-slate-300">
            {r.key}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-900">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-500"
              style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
            {r.count}
          </span>
        </div>
      ))}
    </div>
  );
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isPlatformSupportEnabled())) redirect("/");
  const jar = await cookies();
  if (jar.get(TENANT_COOKIE)?.value || jar.get(DEMO_COOKIE)?.value) redirect("/");
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/");

  const sp = searchParams ? await searchParams : {};
  const raw = Number(Array.isArray(sp.days) ? sp.days[0] : sp.days);
  const days: InsightsWindow = raw === 1 || raw === 30 ? raw : 7;

  const [live, funnel, pages, actions, errors, daily] = await Promise.all([
    getLiveDemos(10),
    getDemoFunnel(days),
    getTopPages(days),
    getTopActions(days),
    getErrorGroups(days),
    getDailyStarts(days),
  ]);

  const windows: { key: InsightsWindow; label: string }[] = [
    { key: 1, label: "24 hours" },
    { key: 7, label: "7 days" },
    { key: 30, label: "30 days" },
  ];
  const maxDaily = Math.max(...daily.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product insights"
        description="Who's on the demo right now, what test drivers actually do, and what's breaking. Anonymous — no names, emails, or customer data."
      />

      <div className="flex flex-wrap gap-2">
        {windows.map((w) => (
          <Link
            key={w.key}
            href={`/admin/insights?days=${w.key}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              days === w.key
                ? "border-teal-500/50 bg-teal-500/15 text-teal-300"
                : "border-slate-800 text-slate-400 hover:border-slate-700"
            }`}
          >
            {w.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          icon={Radio}
          label="On the demo now"
          value={live.length}
          sub="active in last 10 min"
          tone={live.length > 0 ? "text-emerald-400" : "text-slate-500"}
        />
        <Stat icon={Rocket} label="Test drives started" value={funnel.started} sub={`last ${days === 1 ? "24h" : `${days}d`}`} />
        <Stat
          icon={MousePointerClick}
          label="Clicked to sign up"
          value={funnel.converted}
          sub={`${funnel.convertRate}% of starts`}
          tone={funnel.converted > 0 ? "text-teal-400" : "text-slate-500"}
        />
        <Stat
          icon={Timer}
          label="Median session"
          value={funnel.medianMinutes == null ? "—" : `${funnel.medianMinutes}m`}
          sub={`${funnel.ended} ended`}
        />
        <Stat
          icon={AlertTriangle}
          label="Errors"
          value={errors.reduce((n, e) => n + e.count, 0)}
          sub={`${errors.length} distinct`}
          tone={errors.length > 0 ? "text-rose-400" : "text-slate-500"}
        />
      </div>

      {/* Live demos */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="h-4 w-4 text-emerald-400" />
            Live test drives
            <span className="text-xs font-normal text-slate-500">({live.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {live.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 py-8 text-center text-xs text-slate-500">
              Nobody on the demo right now.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Session</th>
                    <th className="pb-2 pr-3 font-medium">Started</th>
                    <th className="pb-2 pr-3 font-medium">Duration</th>
                    <th className="pb-2 pr-3 font-medium">Pages</th>
                    <th className="pb-2 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {live.map((d) => (
                    <tr key={d.schemaName} className="text-slate-300">
                      <td className="py-2 pr-3 font-mono text-[11px] text-slate-400">
                        {d.schemaName}
                      </td>
                      <td className="py-2 pr-3 text-xs">{ago(d.startedAt)}</td>
                      <td className="py-2 pr-3 text-xs tabular-nums">{d.minutes}m</td>
                      <td className="py-2 pr-3 text-xs tabular-nums">{d.pages}</td>
                      <td className="py-2 text-xs text-emerald-300">{ago(d.lastActiveAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily starts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-teal-400" />
            Test drives per day
          </CardTitle>
        </CardHeader>
        <CardContent>
          {daily.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">No data yet.</p>
          ) : (
            <div className="flex items-end gap-1" style={{ height: 80 }}>
              {daily.map((d) => (
                <div key={d.key} className="group flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-teal-600 to-cyan-400"
                    style={{ height: `${Math.max(2, (d.count / maxDaily) * 64)}px` }}
                    title={`${d.key}: ${d.count}`}
                  />
                  <span className="text-[9px] tabular-nums text-slate-600">
                    {d.key.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Most-visited pages</CardTitle>
            <p className="text-xs text-slate-500">Where test drivers spend their time.</p>
          </CardHeader>
          <CardContent>
            <BarList rows={pages} empty="No demo page views recorded yet." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Actions completed</CardTitle>
            <p className="text-xs text-slate-500">
              What they actually did — records created, statuses changed.
            </p>
          </CardHeader>
          <CardContent>
            <BarList rows={actions} empty="No demo actions recorded yet." />
          </CardContent>
        </Card>
      </div>

      {/* Errors */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-rose-400" />
            Errors
            <span className="text-xs font-normal text-slate-500">
              ({errors.length} distinct)
            </span>
          </CardTitle>
          <p className="text-xs text-slate-500">
            Anything that hit an error boundary or a failed demo provision, worst first.
          </p>
        </CardHeader>
        <CardContent>
          {errors.length === 0 ? (
            <p className="rounded-lg border border-dashed border-emerald-800/40 bg-emerald-500/[0.04] py-8 text-center text-xs text-emerald-300">
              No errors in this window. 🎉
            </p>
          ) : (
            <div className="space-y-2">
              {errors.map((e) => (
                <div
                  key={e.label}
                  className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 break-words text-sm text-rose-200">
                      {e.label}
                    </p>
                    <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-rose-300 ring-1 ring-rose-500/30">
                      ×{e.count}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {e.source}
                    {e.lastPath ? ` · ${e.lastPath}` : ""} · last {ago(e.lastSeen)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
