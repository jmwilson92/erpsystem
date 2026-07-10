import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getBurndownData } from "@/lib/services/engineering-work";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProjectReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, number: true, name: true },
  });
  if (!project) notFound();

  const data = await getBurndownData(id);
  const maxRem = Math.max(
    1,
    ...data.burnSeries.map((p) => Math.max(p.remaining, p.ideal))
  );
  const maxCost = Math.max(
    1,
    data.developmentBudget,
    ...data.costSeries.map((c) => c.cumulative)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Reports · ${project.number}`}
        description={project.name}
        actions={
          <Link href={`/pmo/projects/${project.id}`}>
            <Button size="sm" variant="outline">
              Back to project
            </Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Points remaining",
            value: String(data.remainingPoints),
            sub: `${data.donePoints} / ${data.totalPoints} done`,
          },
          {
            label: "Tasks done",
            value: `${data.tasksDone}/${data.taskCount}`,
            sub: `${data.tasksBlocked} blocked`,
          },
          {
            label: "Hours actual / est",
            value: `${data.totalActHours.toFixed(0)} / ${data.totalEstHours.toFixed(0)}`,
            sub: "From scans + estimates",
          },
          {
            label: "Dev cost",
            value: formatCurrency(data.developmentActual),
            sub: `Budget ${formatCurrency(data.developmentBudget)}`,
          },
        ].map((s) => (
          <Card key={s.label} className="border-slate-800">
            <CardContent className="p-4">
              <p className="text-2xl font-bold tabular-nums text-slate-100">
                {s.value}
              </p>
              <p className="text-xs text-slate-400">{s.label}</p>
              <p className="text-[11px] text-slate-600">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Story-point burndown */}
      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Burndown (story points)</CardTitle>
          <p className="text-xs text-slate-500">
            Remaining work vs ideal linear burn across project dates. Day{" "}
            {data.dayIndex} of {data.days}.
          </p>
        </CardHeader>
        <CardContent>
          <div className="relative h-56 w-full rounded-md border border-slate-800 bg-slate-950/50 p-3">
            <svg
              viewBox={`0 0 ${Math.max(data.burnSeries.length, 2)} 100`}
              className="h-full w-full"
              preserveAspectRatio="none"
            >
              {/* Ideal line */}
              <polyline
                fill="none"
                stroke="rgb(100 116 139)"
                strokeWidth="0.5"
                strokeDasharray="2 2"
                points={data.burnSeries
                  .map(
                    (p, i) =>
                      `${i},${100 - (p.ideal / maxRem) * 90 - 5}`
                  )
                  .join(" ")}
              />
              {/* Actual remaining */}
              <polyline
                fill="none"
                stroke="rgb(45 212 191)"
                strokeWidth="0.8"
                points={data.burnSeries
                  .map(
                    (p, i) =>
                      `${i},${100 - (p.remaining / maxRem) * 90 - 5}`
                  )
                  .join(" ")}
              />
            </svg>
            <div className="absolute bottom-2 left-3 flex gap-4 text-[10px] text-slate-500">
              <span className="text-teal-400">━ Remaining</span>
              <span className="text-slate-500">┄ Ideal</span>
            </div>
          </div>
          <div className="mt-2 max-h-32 overflow-y-auto text-[11px] text-slate-500">
            <table className="w-full">
              <thead>
                <tr className="text-left text-slate-600">
                  <th className="py-0.5">Date</th>
                  <th>Remaining</th>
                  <th>Ideal</th>
                </tr>
              </thead>
              <tbody>
                {data.burnSeries
                  .filter((_, i) => i % Math.max(1, Math.floor(data.days / 12)) === 0 || i === data.dayIndex)
                  .map((p) => (
                    <tr key={p.date} className={cn(p.day === data.dayIndex && "text-teal-400")}>
                      <td className="py-0.5 font-mono">{p.date}</td>
                      <td>{p.remaining.toFixed(1)}</td>
                      <td>{p.ideal.toFixed(1)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Discipline throughput */}
      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Engineering discipline health
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.keys(data.byDiscipline).length === 0 && (
            <p className="text-sm text-slate-500">No sagas yet.</p>
          )}
          {Object.entries(data.byDiscipline).map(([d, v]) => (
            <div key={d}>
              <div className="mb-0.5 flex justify-between text-xs">
                <span className="font-medium text-slate-300">{d}</span>
                <span className="text-slate-500">
                  {v.done}/{v.total} done · {v.inProgress} active · {v.blocked}{" "}
                  blocked
                </span>
              </div>
              <div className="flex h-2 overflow-hidden rounded bg-slate-800">
                <div
                  className="bg-emerald-500"
                  style={{
                    width: `${v.total ? (v.done / v.total) * 100 : 0}%`,
                  }}
                />
                <div
                  className="bg-sky-500"
                  style={{
                    width: `${v.total ? (v.inProgress / v.total) * 100 : 0}%`,
                  }}
                />
                <div
                  className="bg-amber-500"
                  style={{
                    width: `${v.total ? (v.blocked / v.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Cost burn */}
      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Development cost burn</CardTitle>
          <p className="text-xs text-slate-500">
            Cumulative NRE / labor from cost entries and eng scans. Budget line{" "}
            {formatCurrency(data.developmentBudget)}.
          </p>
        </CardHeader>
        <CardContent>
          {data.costSeries.length === 0 ? (
            <p className="text-sm text-slate-500">No cost entries yet.</p>
          ) : (
            <>
              <div className="relative h-40 w-full rounded-md border border-slate-800 bg-slate-950/50 p-2">
                <svg
                  viewBox={`0 0 ${Math.max(data.costSeries.length, 2)} 100`}
                  className="h-full w-full"
                  preserveAspectRatio="none"
                >
                  <line
                    x1="0"
                    y1={100 - (data.developmentBudget / maxCost) * 90 - 5}
                    x2={data.costSeries.length}
                    y2={100 - (data.developmentBudget / maxCost) * 90 - 5}
                    stroke="rgb(251 191 36)"
                    strokeWidth="0.4"
                    strokeDasharray="2 1"
                  />
                  <polyline
                    fill="none"
                    stroke="rgb(244 63 94)"
                    strokeWidth="0.8"
                    points={data.costSeries
                      .map(
                        (p, i) =>
                          `${i},${100 - (p.cumulative / maxCost) * 90 - 5}`
                      )
                      .join(" ")}
                  />
                </svg>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Cumulative actual{" "}
                <span className="text-rose-300">
                  {formatCurrency(
                    data.costSeries[data.costSeries.length - 1]?.cumulative || 0
                  )}
                </span>{" "}
                · budget{" "}
                <span className="text-amber-300">
                  {formatCurrency(data.developmentBudget)}
                </span>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
