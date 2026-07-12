import Link from "next/link";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import type { getTeamOverview } from "@/lib/services/hr";
import {
  actionSavePerformanceReview,
  actionCreateEmployeeGoal,
} from "@/app/actions";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export function TeamView({
  team,
}: {
  team: Awaited<ReturnType<typeof getTeamOverview>>;
}) {
  const pendingCount = team.reduce(
    (s, r) => s + r.ptoRequests.length + r.timeEntries.length,
    0
  );

  return (
    <div className="space-y-4">
      {pendingCount > 0 && (
        <Card className="border-amber-500/30">
          <CardContent className="flex items-center justify-between p-4">
            <p className="text-sm text-slate-300">
              <span className="font-semibold text-amber-400">{pendingCount}</span>{" "}
              item{pendingCount === 1 ? "" : "s"} from your team waiting on you
            </p>
            <Button asChild size="sm">
              <Link href="/approvals">Open approvals</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {team.map((r) => {
          const latestCompleted = r.performanceReviews.find(
            (rv) => rv.status === "COMPLETED"
          );
          const inFlight = r.performanceReviews.find(
            (rv) => rv.status !== "COMPLETED"
          );
          return (
            <Card key={r.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">
                      <Link
                        href={`/hr/person/${r.id}`}
                        className="hover:text-teal-400 hover:underline"
                      >
                        {r.name}
                      </Link>
                    </CardTitle>
                    <p className="text-xs text-slate-500">
                      {r.title} · {r.department}
                    </p>
                    <Link
                      href={`/hr/person/${r.id}`}
                      className="mt-1 inline-block text-[11px] text-sky-400 hover:underline"
                    >
                      Open person page →
                    </Link>
                  </div>
                  <div className="flex gap-1">
                    {r.ptoRequests.length > 0 && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                        {r.ptoRequests.length} PTO
                      </span>
                    )}
                    {r.timeEntries.length > 0 && (
                      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-400">
                        {r.timeEntries.length} time
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Review status */}
                <div className="rounded-lg border border-slate-800 p-3 text-sm">
                  {latestCompleted ? (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">
                        Last review {latestCompleted.period}
                      </span>
                      <span className="text-teal-400">
                        {latestCompleted.overallRating}/5
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No completed reviews.</p>
                  )}
                  {inFlight && (
                    <p className="mt-1 text-xs text-sky-400">
                      {inFlight.period} review in progress{" "}
                      <StatusBadge status={inFlight.status} />
                    </p>
                  )}
                </div>

                {/* Goals */}
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Active goals
                  </p>
                  {r.goals.length === 0 && (
                    <p className="text-xs text-slate-500">None set.</p>
                  )}
                  {r.goals.map((g) => (
                    <div key={g.id} className="mb-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-300">{g.title}</span>
                        <span className="text-slate-500">{g.progress}%</span>
                      </div>
                      <Progress value={g.progress} className="mt-0.5 h-1" />
                    </div>
                  ))}
                  <form
                    action={actionCreateEmployeeGoal}
                    className="mt-2 flex gap-1.5"
                  >
                    <input type="hidden" name="userId" value={r.id} />
                    <Input
                      name="title"
                      required
                      placeholder="Set a goal for this discussion…"
                      className="h-8 text-xs"
                    />
                    <input type="hidden" name="category" value="PERFORMANCE" />
                    <Button type="submit" size="sm" variant="outline" className="h-8">
                      Add
                    </Button>
                  </form>
                </div>

                {/* Write review */}
                <details className="rounded-lg border border-slate-800 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-slate-300">
                    {inFlight ? `Continue ${inFlight.period} review` : "Write review"}
                  </summary>
                  <form
                    action={actionSavePerformanceReview}
                    className="mt-3 grid gap-2"
                  >
                    <input type="hidden" name="employeeId" value={r.id} />
                    {inFlight && (
                      <input type="hidden" name="id" value={inFlight.id} />
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        name="period"
                        required
                        defaultValue={inFlight?.period || ""}
                        placeholder="Period (2026-Q3)"
                      />
                      <Input
                        name="overallRating"
                        type="number"
                        min={1}
                        max={5}
                        step={0.1}
                        defaultValue={inFlight?.overallRating ?? ""}
                        placeholder="Rating 1–5"
                      />
                      <select
                        name="status"
                        className={selectClass}
                        defaultValue={inFlight?.status || "IN_PROGRESS"}
                      >
                        <option value="DRAFT">Draft</option>
                        <option value="IN_PROGRESS">In progress</option>
                        <option value="COMPLETED">Complete</option>
                      </select>
                    </div>
                    <Textarea
                      name="strengths"
                      rows={2}
                      defaultValue={inFlight?.strengths || ""}
                      placeholder="Strengths"
                    />
                    <Textarea
                      name="improvements"
                      rows={2}
                      defaultValue={inFlight?.improvements || ""}
                      placeholder="Growth areas"
                    />
                    <Textarea
                      name="careerNotes"
                      rows={2}
                      defaultValue={inFlight?.careerNotes || ""}
                      placeholder="Career notes"
                    />
                    <Button type="submit" size="sm">
                      Save review
                    </Button>
                  </form>
                </details>

                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-slate-600">
                    {r.performanceReviews.length} review
                    {r.performanceReviews.length === 1 ? "" : "s"} on record
                    {latestCompleted?.completedAt
                      ? ` · last completed ${formatDate(latestCompleted.completedAt)}`
                      : ""}
                  </p>
                  <Button asChild size="sm" variant="outline" className="h-7 text-[11px]">
                    <Link href={`/hr/person/${r.id}`}>Reviews & docs</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
