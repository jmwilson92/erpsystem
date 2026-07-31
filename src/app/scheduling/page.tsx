import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DISPATCH_RULES,
  RULE_LABELS,
  buildQueueFromWorkOrders,
  compareRules,
  sequence,
  type DispatchRule,
} from "@/lib/services/finite-scheduling";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";
const th = "pb-2 text-left text-xs uppercase tracking-wide text-slate-500";

function fmtDate(d: Date) {
  return new Date(d).toISOString().slice(0, 10);
}

function hours(minutes: number) {
  return `${(minutes / 60).toFixed(1)} h`;
}

export default async function SchedulingPage({
  searchParams,
}: {
  searchParams: Promise<{ rule?: string; horizon?: string }>;
}) {
  const sp = await searchParams;
  const rule = ((DISPATCH_RULES as readonly string[]).includes(sp.rule || "")
    ? sp.rule
    : "EDD") as DispatchRule;
  const horizonDays = Number(sp.horizon ?? 90) || 90;

  const { jobs, centers } = await buildQueueFromWorkOrders({ horizonDays });
  const start = new Date();
  const result = sequence(jobs, centers, { start, rule, horizonDays });
  const comparison = compareRules(jobs, centers, { start, horizonDays });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finite-capacity schedule"
        description="Work orders sequenced into real capacity, with the finish dates that fall out"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sequencing</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-400">
              Dispatch rule
              <select name="rule" defaultValue={rule} className={selectClass}>
                {DISPATCH_RULES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Horizon (days)
              <Input name="horizon" type="number" min="7" defaultValue={horizonDays} className="w-28" />
            </label>
            <Button type="submit" variant="outline">
              Re-sequence
            </Button>
            <p className="w-full text-xs text-slate-500">{RULE_LABELS[rule]}</p>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Scheduled</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-slate-100">
              {result.scheduled.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">of {jobs.length} open jobs</p>
          </CardContent>
        </Card>
        <Card className={result.lateCount > 0 ? "border-amber-800/60" : undefined}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Late</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-semibold ${
                result.lateCount > 0 ? "text-amber-300" : "text-emerald-300"
              }`}
            >
              {result.lateCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              worst {result.maxLatenessDays} d, average{" "}
              {result.averageLatenessDays.toFixed(1)} d
            </p>
          </CardContent>
        </Card>
        <Card
          className={result.unschedulable.length > 0 ? "border-rose-800/60" : undefined}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Unschedulable</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-semibold ${
                result.unschedulable.length > 0 ? "text-rose-300" : "text-slate-100"
              }`}
            >
              {result.unschedulable.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">no capacity or past horizon</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Work centres</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-slate-100">{centers.length}</p>
            <p className="mt-1 text-xs text-slate-500">active</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rule comparison</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Rule</th>
                <th className={`${th} text-right`}>Late jobs</th>
                <th className={`${th} text-right`}>Worst lateness</th>
                <th className={`${th} text-right`}>Average lateness</th>
                <th className={`${th} text-right`}>Unschedulable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {comparison.map((c) => (
                <tr key={c.rule} className={c.rule === rule ? "bg-slate-900/60" : ""}>
                  <td className="py-2 font-mono text-slate-200">{c.rule}</td>
                  <td className="py-2 text-right text-slate-300">{c.lateCount}</td>
                  <td className="py-2 text-right text-slate-300">
                    {c.maxLatenessDays} d
                  </td>
                  <td className="py-2 text-right text-slate-400">
                    {c.averageLatenessDays.toFixed(1)} d
                  </td>
                  <td className="py-2 text-right text-slate-400">
                    {c.unschedulable}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">
            Picking a rule is picking which failure you prefer. Earliest due date
            holds worst-case lateness down; shortest processing time gets more
            jobs out sooner and will starve a big one.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Work centre load</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Centre</th>
                <th className={`${th} text-right`}>Assigned</th>
                <th className={`${th} text-right`}>Available</th>
                <th className={`${th} text-right`}>Utilisation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {result.utilisation.map((u) => (
                <tr key={u.workCenter}>
                  <td className="py-2 font-mono text-slate-200">{u.workCenter}</td>
                  <td className="py-2 text-right text-slate-400">
                    {hours(u.assignedMinutes)}
                  </td>
                  <td className="py-2 text-right text-slate-400">
                    {hours(u.availableMinutes)}
                  </td>
                  <td
                    className={`py-2 text-right ${
                      u.pct > 100
                        ? "text-rose-300"
                        : u.pct > 85
                          ? "text-amber-300"
                          : "text-slate-300"
                    }`}
                  >
                    {u.pct.toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sequence</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {result.scheduled.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">
              Nothing to sequence — no open work orders, or no active work
              centres with capacity.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Work order</th>
                  <th className={th}>Centre</th>
                  <th className={`${th} text-right`}>Work</th>
                  <th className={th}>Start</th>
                  <th className={th}>Finish</th>
                  <th className={th}>Due</th>
                  <th className={`${th} text-right`}>Lateness</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {result.scheduled.slice(0, 200).map((s) => (
                  <tr key={s.jobId}>
                    <td className="py-2 font-mono text-slate-200">{s.label}</td>
                    <td className="py-2 font-mono text-slate-400">
                      {s.workCenter}
                    </td>
                    <td className="py-2 text-right text-slate-400">
                      {hours(s.minutes)}
                    </td>
                    <td className="py-2 text-slate-400">{fmtDate(s.start)}</td>
                    <td className="py-2 text-slate-300">{fmtDate(s.finish)}</td>
                    <td className="py-2 text-slate-400">{fmtDate(s.dueDate)}</td>
                    <td
                      className={`py-2 text-right ${
                        s.isLate ? "text-rose-300" : "text-emerald-300"
                      }`}
                    >
                      {s.isLate ? `+${s.latenessDays} d` : "on time"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {result.unschedulable.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm text-rose-200">
              {result.unschedulable.slice(0, 20).map((u) => (
                <li key={u.jobId}>
                  {u.label} — {u.reason}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
