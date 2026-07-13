import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  actionUpdateEngTask,
  actionScanIn,
  actionScanOut,
  actionBreakDownTask,
  actionAddEngDependency,
  actionAlignBusinessPriority,
} from "@/app/actions";
import { WorkDependencyTypeahead } from "@/components/engineering/work-typeahead";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function EngTaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();

  const [task, businessPriorities] = await Promise.all([
    prisma.engTask.findUnique({
    where: { id },
    include: {
      businessPriority: true,
      project: { select: { id: true, number: true, name: true, projectManagerId: true } },
      product: { select: { id: true, code: true, name: true } },
      campaign: { select: { id: true, number: true, name: true } },
      saga: {
        select: {
          id: true,
          number: true,
          name: true,
          discipline: true,
          definitionOfDone: true,
        },
      },
      engSprint: { select: { id: true, name: true, status: true, quarterId: true } },
      requirementTraces: {
        include: {
          requirement: {
            select: {
              id: true,
              number: true,
              title: true,
              status: true,
              verificationMethod: true,
            },
          },
        },
      },
      children: { orderBy: { number: "asc" } },
      parent: { select: { id: true, number: true, name: true } },
      productionIssue: {
        select: {
          id: true,
          number: true,
          category: true,
          status: true,
          workOrder: { select: { number: true } },
        },
      },
      blockedBy: {
        include: {
          sourceTask: {
            select: {
              id: true,
              number: true,
              name: true,
              status: true,
              discipline: true,
            },
          },
          sourceSaga: {
            select: {
              id: true,
              number: true,
              name: true,
              status: true,
              discipline: true,
            },
          },
        },
      },
      blocking: {
        include: {
          targetTask: {
            select: { id: true, number: true, name: true, status: true },
          },
          targetSaga: {
            select: { id: true, number: true, name: true, status: true },
          },
        },
      },
      scans: {
        orderBy: { scannedInAt: "desc" },
        take: 30,
      },
      timeEntries: {
        orderBy: { date: "desc" },
        take: 40,
      },
    },
  }),
    prisma.businessPriority.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { priority: "asc" },
    }),
  ]);
  if (!task) notFound();

  const [users, openScans, workHits] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.workTimeScan.findMany({
      where: { engTaskId: task.id, status: "OPEN" },
    }),
    Promise.all([
      prisma.engTask.findMany({
        where: { parentId: null, id: { not: task.id } },
        take: 200,
        select: {
          id: true,
          number: true,
          name: true,
          discipline: true,
        },
      }),
      prisma.saga.findMany({
        take: 100,
        select: {
          id: true,
          number: true,
          name: true,
          discipline: true,
        },
      }),
      prisma.campaign.findMany({
        take: 80,
        select: { id: true, number: true, name: true },
      }),
    ]),
  ]);

  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const [hitTasks, hitSagas, hitCampaigns] = workHits;
  const typeaheadItems = [
    ...hitTasks.map((t) => ({
      id: t.id,
      kind: "TASK" as const,
      number: t.number,
      name: t.name,
      discipline: t.discipline,
    })),
    ...hitSagas.map((s) => ({
      id: s.id,
      kind: "SAGA" as const,
      number: s.number,
      name: s.name,
      discipline: s.discipline,
    })),
    ...hitCampaigns.map((c) => ({
      id: c.id,
      kind: "CAMPAIGN" as const,
      number: c.number,
      name: c.name,
    })),
  ];

  const totalTime = task.timeEntries.reduce((s, e) => s + e.hours, 0);
  const totalCost = task.timeEntries.reduce((s, e) => s + (e.costAmount || 0), 0);
  const iAmIn = openScans.some((s) => s.userId === user?.id);
  const lane = (task.discipline || task.saga?.discipline || "other").toLowerCase();
  const returnTo = `/engineering/tasks/${task.id}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={`${task.number} — ${task.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/engineering/${lane}`}>
              <Button size="sm" variant="outline">
                Lane board
              </Button>
            </Link>
            {task.project && (
              <Link href={`/pmo/projects/${task.project.id}`}>
                <Button size="sm" variant="ghost">
                  Project
                </Button>
              </Link>
            )}
            {task.product && (
              <Link href={`/products/${task.product.id}`}>
                <Button size="sm" variant="ghost">
                  Product
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={task.status} />
        <StatusBadge status={task.priority} />
        <StatusBadge status={task.kind} />
        <StatusBadge
          status={
            task.businessPriority
              ? task.businessPriority.number
              : "UNRATED"
          }
        />
        {task.discipline && <StatusBadge status={task.discipline} />}
        {task.engSprint && (
          <span className="text-xs text-violet-400">
            Sprint: {task.engSprint.name}
          </span>
        )}
      </div>

      <form
        action={actionAlignBusinessPriority}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 p-3"
      >
        <input type="hidden" name="entityType" value="EngTask" />
        <input type="hidden" name="entityId" value={task.id} />
        <div>
          <label className="text-[10px] uppercase text-slate-500">
            Business priority
          </label>
          <select
            name="businessPriorityId"
            defaultValue={task.businessPriorityId || "UNRATED"}
            className={`${selectClass} mt-1 min-w-[14rem]`}
          >
            <option value="UNRATED">Unrated</option>
            {businessPriorities.map((bp) => (
              <option key={bp.id} value={bp.id}>
                {bp.number} — {bp.title}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline">
          Align priority
        </Button>
      </form>

      {openScans.length > 0 && (
        <Card className="border-teal-800/50 bg-teal-950/20">
          <CardContent className="p-3 text-sm text-teal-300">
            Scanned in:{" "}
            {openScans
              .map((s) => userMap[s.userId] || s.userId.slice(0, 6))
              .join(", ")}
          </CardContent>
        </Card>
      )}

      {task.requirementTraces.length > 0 && (
        <Card className="border-violet-900/40">
          <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wider text-violet-300">
              Implements requirements
            </span>
            {task.requirementTraces.map((rt) => (
              <Link
                key={rt.id}
                href="/requirements"
                className="flex items-center gap-1.5 rounded-full border border-violet-700/50 px-2 py-0.5 text-[11px]"
              >
                <span className="font-mono text-violet-300">
                  {rt.requirement.number}
                </span>
                <span className="text-slate-400">{rt.requirement.title}</span>
                <StatusBadge status={rt.requirement.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {iAmIn ? (
          <form action={actionScanOut}>
            <input type="hidden" name="engTaskId" value={task.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" size="sm">
              Scan out
            </Button>
          </form>
        ) : (
          <form action={actionScanIn}>
            <input type="hidden" name="engTaskId" value={task.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" size="sm">
              Scan in (→ In progress)
            </Button>
          </form>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Est hours", value: String(task.estimatedHours) },
          { label: "Actual hours", value: totalTime.toFixed(2) },
          { label: "Labor cost", value: formatCurrency(totalCost) },
          {
            label: "% complete",
            value: `${task.percentComplete.toFixed(0)}%`,
          },
        ].map((s) => (
          <Card key={s.label} className="border-slate-800">
            <CardContent className="p-3 text-center">
              <p className="text-lg font-bold tabular-nums text-slate-100">
                {s.value}
              </p>
              <p className="text-[10px] text-slate-500">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-300">
          {task.description ? (
            <p className="whitespace-pre-wrap">{task.description}</p>
          ) : (
            <p className="text-slate-500">No description.</p>
          )}
          <p className="text-xs text-slate-500">
            Due {formatDate(task.dueDate)} · Start {formatDate(task.startDate)}{" "}
            · End {formatDate(task.endDate)}
          </p>
          {task.assigneeId && (
            <p className="text-xs text-slate-400">
              Assignee: {userMap[task.assigneeId] || "—"}
            </p>
          )}
          {task.parent && (
            <p className="text-xs">
              Parent:{" "}
              <Link
                href={`/engineering/tasks/${task.parent.id}`}
                className="text-teal-400 underline"
              >
                {task.parent.number} {task.parent.name}
              </Link>
            </p>
          )}
          {task.saga?.definitionOfDone && (
            <div className="rounded border border-slate-800 bg-slate-950/40 p-2 text-xs">
              <span className="text-slate-500">Saga DoD: </span>
              {task.saga.definitionOfDone}
            </div>
          )}
          {task.productionIssue && (
            <p className="text-xs text-orange-400">
              From production {task.productionIssue.number} (
              {task.productionIssue.category})
              {task.productionIssue.workOrder
                ? ` · ${task.productionIssue.workOrder.number}`
                : ""}
            </p>
          )}
        </CardContent>
      </Card>

      <form action={actionUpdateEngTask} className="grid gap-2 sm:grid-cols-3">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <select
          name="status"
          defaultValue={task.status}
          className={selectClass}
        >
          {[
            "BACKLOG",
            "TODO",
            "IN_PROGRESS",
            "IN_REVIEW",
            "BLOCKED",
            "DONE",
            "CANCELLED",
          ].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          name="assigneeId"
          defaultValue={task.assigneeId || ""}
          className={selectClass}
        >
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select
          name="priority"
          defaultValue={task.priority}
          className={selectClass}
        >
          <option value="LOW">Low</option>
          <option value="NORMAL">Normal</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
        <Button type="submit" size="sm">
          Save
        </Button>
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Blocked by (predecessors)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {task.blockedBy.length === 0 && (
              <p className="text-xs text-slate-500">No predecessors.</p>
            )}
            {task.blockedBy.map((d) => (
              <div key={d.id} className="text-slate-300">
                {d.sourceTask ? (
                  <Link
                    href={`/engineering/tasks/${d.sourceTask.id}`}
                    className="text-teal-400 hover:underline"
                  >
                    {d.sourceTask.number} {d.sourceTask.name}
                  </Link>
                ) : d.sourceSaga ? (
                  <span>
                    {d.sourceSaga.number} {d.sourceSaga.name} (saga)
                  </span>
                ) : (
                  "—"
                )}{" "}
                <StatusBadge
                  status={
                    d.sourceTask?.status || d.sourceSaga?.status || "—"
                  }
                />
              </div>
            ))}
            <form action={actionAddEngDependency} className="space-y-2 border-t border-slate-800 pt-3">
              <input type="hidden" name="targetTaskId" value={task.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <p className="text-[10px] uppercase text-slate-500">
                Add dependency (type to search)
              </p>
              <WorkDependencyTypeahead items={typeaheadItems} />
              <p className="text-[10px] text-slate-600">
                Select predecessors above, then submit. PM is alerted.
              </p>
              <Button type="submit" size="sm" variant="outline">
                Add dependency
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Blocks (successors)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {task.blocking.length === 0 && (
              <p className="text-xs text-slate-500">Nothing waiting on this.</p>
            )}
            {task.blocking.map((d) => (
              <div key={d.id}>
                {d.targetTask ? (
                  <Link
                    href={`/engineering/tasks/${d.targetTask.id}`}
                    className="text-teal-400 hover:underline"
                  >
                    {d.targetTask.number} {d.targetTask.name}
                  </Link>
                ) : d.targetSaga ? (
                  <span>
                    {d.targetSaga.number} {d.targetSaga.name}
                  </span>
                ) : (
                  "—"
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Subtasks ({task.children.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {task.children.map((c) => (
            <Link
              key={c.id}
              href={`/engineering/tasks/${c.id}`}
              className="flex justify-between rounded border border-slate-800 px-2 py-1.5 text-sm hover:border-teal-500/40"
            >
              <span>
                <span className="font-mono text-slate-500">{c.number}</span>{" "}
                {c.name}
              </span>
              <StatusBadge status={c.status} />
            </Link>
          ))}
          <form
            action={actionBreakDownTask}
            className="flex flex-wrap gap-2 border-t border-slate-800 pt-3"
          >
            <input type="hidden" name="parentTaskId" value={task.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Input
              name="name"
              required
              placeholder="Break into subtask…"
              className="min-w-[200px] flex-1"
            />
            <Button type="submit" size="sm" variant="outline">
              Split
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Time log (accounting)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Hours</th>
                <th className="px-3 py-2">Cost</th>
                <th className="px-3 py-2">Type</th>
              </tr>
            </thead>
            <tbody>
              {task.timeEntries.map((e) => (
                <tr key={e.id} className="border-b border-slate-800/80">
                  <td className="px-3 py-1.5 text-xs text-slate-500">
                    {formatDate(e.date)}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {userMap[e.userId] || "—"}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">{e.hours}</td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {formatCurrency(e.costAmount || 0)}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">
                    {e.type}
                  </td>
                </tr>
              ))}
              {task.timeEntries.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    No time yet — scan in to start logging.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
