import Link from "next/link";
import { listPlanningQuarters } from "@/lib/services/pmo";
import { listSwimLanes } from "@/lib/services/engineering-work";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import {
  actionCreatePlanningQuarter,
  actionUpdatePlanningQuarter,
  actionCreatePmoSprint,
  actionUpdateEngSprint,
} from "@/app/actions";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function PmoPiPlanningPage() {
  const [quarters, lanes, projects] = await Promise.all([
    listPlanningQuarters(),
    listSwimLanes(true),
    prisma.project.findMany({
      where: { status: { in: ["ACTIVE", "PLANNING"] } },
      orderBy: { number: "asc" },
      select: { id: true, number: true, name: true },
    }),
  ]);

  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultQ = Math.floor(now.getMonth() / 3) + 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="PI Planning — Quarters & Sprints"
        description="PMO defines quarters and sprints; swim lane managers pull work into them"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/pmo">
              <Button size="sm" variant="outline">
                PMO home
              </Button>
            </Link>
            <Link href="/pmo/alerts">
              <Button size="sm" variant="ghost">
                PM alerts
              </Button>
            </Link>
          </div>
        }
      />

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Create planning quarter</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={actionCreatePlanningQuarter}
            className="grid gap-2 sm:grid-cols-3"
          >
            <Input
              name="year"
              type="number"
              required
              defaultValue={defaultYear}
              placeholder="Year"
            />
            <select
              name="quarter"
              className={selectClass}
              defaultValue={String(defaultQ)}
            >
              <option value="1">Q1</option>
              <option value="2">Q2</option>
              <option value="3">Q3</option>
              <option value="4">Q4</option>
            </select>
            <Input name="name" placeholder="Display name (optional)" />
            <Input name="startDate" type="date" required />
            <Input name="endDate" type="date" required />
            <select name="status" className={selectClass} defaultValue="PLANNED">
              <option value="PLANNED">PLANNED</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="CLOSED">CLOSED</option>
            </select>
            <Textarea
              name="goals"
              rows={2}
              placeholder="PI / quarter objectives"
              className="sm:col-span-3"
            />
            <Button type="submit" size="sm">
              Create quarter
            </Button>
          </form>
        </CardContent>
      </Card>

      {quarters.length === 0 && (
        <p className="text-sm text-slate-500">
          No quarters yet. Create one above during PI planning.
        </p>
      )}

      {quarters.map((q) => (
        <Card key={q.id} className="border-slate-800">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">
                <span className="font-mono text-violet-300">{q.code}</span>{" "}
                {q.name}
              </CardTitle>
              <div className="flex items-center gap-2">
                <StatusBadge status={q.status} />
                <span className="text-xs text-slate-500">
                  {formatDate(q.startDate)} – {formatDate(q.endDate)}
                </span>
              </div>
            </div>
            {q.goals && (
              <p className="text-xs text-slate-400 whitespace-pre-wrap">{q.goals}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <form action={actionUpdatePlanningQuarter} className="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={q.id} />
              <select
                name="status"
                defaultValue={q.status}
                className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-xs"
              >
                <option value="PLANNED">PLANNED</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="CLOSED">CLOSED</option>
              </select>
              <Button type="submit" size="sm" variant="outline">
                Update status
              </Button>
            </form>

            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">
                Sprints in this quarter ({q.sprints.length})
              </p>
              {q.sprints.length === 0 && (
                <p className="text-xs text-slate-600">No sprints yet.</p>
              )}
              {q.sprints.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium text-slate-200">{s.name}</span>
                    {s.discipline && (
                      <span className="ml-2 text-[10px] text-sky-400">
                        {s.discipline}
                      </span>
                    )}
                    <p className="text-[10px] text-slate-500">
                      {s._count.sagas} sagas · {s._count.engTasks} tasks
                      {s.goal ? ` · ${s.goal}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={s.status} />
                    <form action={actionUpdateEngSprint} className="flex gap-1">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="returnTo" value="/pmo/pi" />
                      <select
                        name="status"
                        defaultValue={s.status}
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                      >
                        <option value="PLANNED">PLANNED</option>
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="COMPLETED">COMPLETED</option>
                      </select>
                      <Button type="submit" size="sm" variant="ghost">
                        Set
                      </Button>
                    </form>
                  </div>
                </div>
              ))}
            </div>

            <form
              action={actionCreatePmoSprint}
              className="grid gap-2 rounded border border-dashed border-slate-700 p-3 sm:grid-cols-2"
            >
              <input type="hidden" name="quarterId" value={q.id} />
              <p className="sm:col-span-2 text-xs font-medium text-slate-400">
                Add sprint to {q.code}
              </p>
              <Input name="name" required placeholder="Sprint name" />
              <select name="discipline" className={selectClass}>
                <option value="">All lanes</option>
                {lanes.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
              <select name="projectId" className={selectClass}>
                <option value="">Any project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number} · {p.name}
                  </option>
                ))}
              </select>
              <Input name="goal" placeholder="Sprint goal" />
              <Input name="startDate" type="date" />
              <Input name="endDate" type="date" />
              <Button type="submit" size="sm">
                Create sprint
              </Button>
            </form>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
