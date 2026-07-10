import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  getDisciplineBoard,
  listSwimLanes,
} from "@/lib/services/engineering-work";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, cn } from "@/lib/utils";
import { LaneBoard } from "@/components/engineering/lane-board";
import {
  actionScanOut,
  actionUpdateEngSprint,
  actionAssignTaskSprint,
  actionAssignSagaSprint,
  actionUpdateEngTask,
  actionScanIn,
  actionAcceptProductionIssue,
  actionUpdateProductionEngIssue,
  actionCreateProductionEngIssue,
  actionCreateEngTask,
} from "@/app/actions";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function DisciplineLanePage({
  params,
  searchParams,
}: {
  params: Promise<{ discipline: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { discipline: raw } = await params;
  const discipline = raw.toUpperCase();
  const lanes = await listSwimLanes(true);
  if (!lanes.some((l) => l.code === discipline)) notFound();

  const sp = await searchParams;
  const tab = pick(sp, "tab") || "board";
  const returnTo = `/engineering/${raw.toLowerCase()}?tab=${tab}`;

  const user = await getCurrentUser();
  let board;
  try {
    board = await getDisciplineBoard(discipline);
  } catch {
    notFound();
  }

  const [projects, campaigns, allTasks, allSagas, users] =
    await Promise.all([
      prisma.project.findMany({
        where: { status: { in: ["ACTIVE", "PLANNING"] } },
        orderBy: { number: "asc" },
        select: { id: true, number: true, name: true },
      }),
      prisma.campaign.findMany({
        where: { status: { notIn: ["CANCELLED", "DONE"] } },
        orderBy: { number: "asc" },
        select: {
          id: true,
          number: true,
          name: true,
          projectId: true,
          project: { select: { number: true } },
        },
      }),
      prisma.engTask.findMany({
        where: { parentId: null },
        orderBy: { number: "asc" },
        select: {
          id: true,
          number: true,
          name: true,
          discipline: true,
          status: true,
        },
        take: 300,
      }),
      prisma.saga.findMany({
        orderBy: [{ discipline: "asc" }, { number: "asc" }],
        select: {
          id: true,
          number: true,
          name: true,
          discipline: true,
          status: true,
        },
        take: 200,
      }),
      prisma.user.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const myOpen = board.openScans.filter((s) => s.userId === user?.id);
  const isMfgEng = discipline === "MFG_ENG";

  const products = isMfgEng
    ? await prisma.product.findMany({
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, lifecyclePhase: true },
      })
    : [];

  // Sprint membership maps
  const tasksBySprint = new Map<string, typeof board.tasks>();
  const sagasBySprint = new Map<string, typeof board.sagas>();
  for (const t of board.tasks) {
    if (!t.engSprintId) continue;
    const list = tasksBySprint.get(t.engSprintId) || [];
    list.push(t);
    tasksBySprint.set(t.engSprintId, list);
  }
  for (const s of board.sagas) {
    if (!s.engSprintId) continue;
    const list = sagasBySprint.get(s.engSprintId) || [];
    list.push(s);
    sagasBySprint.set(s.engSprintId, list);
  }

  const tabs = [
    { id: "board", label: "Board" },
    { id: "backlog", label: "Backlog" },
    ...(isMfgEng
      ? ([
          { id: "prod", label: "Production issues" },
          { id: "sustainment", label: "Product sustainment" },
        ] as const)
      : []),
    { id: "sprints", label: "Sprints" },
  ] as const;

  const boardSagas = board.sagas.map((s) => ({
    ...s,
    dueDate: s.dueDate,
    engTasks: s.engTasks.map((t) => ({
      ...t,
      product: t.product,
      blockedBy: t.blockedBy,
      children: t.children,
      productionIssue: t.productionIssue,
    })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${board.laneName || discipline} swim lane`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/engineering">
              <Button size="sm" variant="outline">
                All lanes
              </Button>
            </Link>
            <Link href="/pmo/pi">
              <Button size="sm" variant="ghost">
                PI / sprints
              </Button>
            </Link>
            <Link href="/pmo">
              <Button size="sm" variant="ghost">
                PMO
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {lanes.map((d) => (
          <Link
            key={d.code}
            href={`/engineering/${d.code.toLowerCase()}`}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs",
              d.code === discipline
                ? "bg-slate-800 text-teal-300"
                : "text-slate-500 hover:text-slate-300"
            )}
          >
            {d.name}
          </Link>
        ))}
      </div>

      {myOpen.length > 0 && (
        <Card className="border-teal-700/50 bg-teal-950/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="text-sm text-teal-300">
              Scanned in: {myOpen.map((s) => s.engTask.number).join(", ")}
            </div>
            {myOpen.map((s) => (
              <form key={s.id} action={actionScanOut}>
                <input type="hidden" name="scanId" value={s.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <Button type="submit" size="sm">
                  Scan out {s.engTask.number}
                </Button>
              </form>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/engineering/${raw.toLowerCase()}?tab=${t.id}`}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              tab === t.id
                ? "bg-slate-800 text-slate-50"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            {t.label}
            {t.id === "prod" &&
              (board.productionIssues?.length || 0) > 0 && (
                <span className="ml-1 text-orange-400">
                  {board.productionIssues!.length}
                </span>
              )}
          </Link>
        ))}
      </div>

      {tab === "board" && (
        <LaneBoard
          discipline={discipline}
          returnTo={returnTo}
          sagas={boardSagas}
          openScans={board.openScans}
          userMap={userMap}
          users={users}
          campaigns={campaigns}
          projects={projects}
          allTasks={allTasks}
          allSagas={allSagas}
          currentUserId={user?.id}
        />
      )}

      {tab === "backlog" && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Unstarted work. Use <strong className="text-slate-300">New saga</strong>{" "}
            / <strong className="text-slate-300">New task</strong> on the Board
            tab (modals). Pull into sprints below.
          </p>
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sagas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {board.sagas
                .filter((s) => s.status === "BACKLOG" || !s.engSprintId)
                .map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-mono text-sky-400">{s.number}</span>{" "}
                      {s.name}
                      {(s.blockedBy?.length || 0) > 0 && (
                        <p className="text-[10px] text-amber-400">
                          Has dependencies
                        </p>
                      )}
                    </div>
                    <form action={actionAssignSagaSprint} className="flex gap-1">
                      <input type="hidden" name="sagaId" value={s.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <select
                        name="engSprintId"
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                      >
                        <option value="">— Sprint —</option>
                        {board.sprints.map((sp) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.name}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" size="sm" variant="outline">
                        Pull to sprint
                      </Button>
                    </form>
                  </div>
                ))}
            </CardContent>
          </Card>
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tasks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {board.tasks
                .filter(
                  (t) =>
                    !t.engSprintId ||
                    t.status === "BACKLOG" ||
                    t.status === "TODO"
                )
                .map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 px-3 py-2 text-sm"
                  >
                    <div>
                      <Link
                        href={`/engineering/tasks/${t.id}`}
                        className="font-mono text-teal-400 hover:underline"
                      >
                        {t.number}
                      </Link>{" "}
                      <Link
                        href={`/engineering/tasks/${t.id}`}
                        className="hover:underline"
                      >
                        {t.name}
                      </Link>
                      {t.product && (
                        <span className="ml-2 text-[10px] text-teal-400">
                          {t.product.code}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <form action={actionUpdateEngTask} className="flex gap-1">
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <select
                          name="assigneeId"
                          defaultValue={t.assigneeId || ""}
                          className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                        >
                          <option value="">Assign…</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" size="sm" variant="outline">
                          Assign
                        </Button>
                      </form>
                      <form action={actionAssignTaskSprint} className="flex gap-1">
                        <input type="hidden" name="engTaskId" value={t.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <select
                          name="engSprintId"
                          className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                        >
                          <option value="">Sprint…</option>
                          {board.sprints.map((sp) => (
                            <option key={sp.id} value={sp.id}>
                              {sp.name}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" size="sm" variant="outline">
                          Pull
                        </Button>
                      </form>
                      <form action={actionScanIn}>
                        <input type="hidden" name="engTaskId" value={t.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <Button type="submit" size="sm">
                          Scan in
                        </Button>
                      </form>
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "sprints" && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Sprints are created by PMO under quarters during PI planning. Pull
            backlog work into a sprint below.{" "}
            <Link href="/pmo/pi" className="text-teal-400 hover:underline">
              Open PI planning
            </Link>
          </p>
          {board.sprints.length === 0 && (
            <Card className="border-dashed border-slate-800">
              <CardContent className="py-6 text-center text-sm text-slate-500">
                No sprints assigned to this lane yet. PMO creates them at{" "}
                <Link href="/pmo/pi" className="text-teal-400 hover:underline">
                  /pmo/pi
                </Link>
                .
              </CardContent>
            </Card>
          )}
          {board.sprints.map((sp) => {
            const sprintTasks = tasksBySprint.get(sp.id) || [];
            const sprintSagas = sagasBySprint.get(sp.id) || [];
            const nestedFromSagas = sprintSagas.flatMap((s) => s.engTasks);
            const allSprintTaskIds = new Set([
              ...sprintTasks.map((t) => t.id),
              ...nestedFromSagas.map((t) => t.id),
            ]);
            const allSprintTasks = [
              ...sprintTasks,
              ...nestedFromSagas.filter(
                (t) => !sprintTasks.some((x) => x.id === t.id)
              ),
            ];

            return (
              <Card key={sp.id} className="border-slate-800">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {sp.name}
                      <StatusBadge status={sp.status} />
                    </CardTitle>
                    <form action={actionUpdateEngSprint} className="flex gap-1">
                      <input type="hidden" name="id" value={sp.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <select
                        name="status"
                        defaultValue={sp.status}
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                      >
                        <option value="PLANNED">PLANNED</option>
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="COMPLETED">COMPLETED</option>
                      </select>
                      <Button type="submit" size="sm" variant="outline">
                        Save
                      </Button>
                    </form>
                  </div>
                  {sp.goal && (
                    <p className="text-xs text-slate-500">{sp.goal}</p>
                  )}
                  <p className="text-[11px] text-slate-600">
                    {formatDate(sp.startDate)} – {formatDate(sp.endDate)}
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {sprintSagas.length > 0 && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase text-slate-500">
                        Sagas in sprint
                      </p>
                      {sprintSagas.map((s) => (
                        <div
                          key={s.id}
                          className="mb-1 rounded border border-slate-800 px-2 py-1.5 text-sm"
                        >
                          <span className="font-mono text-sky-400">
                            {s.number}
                          </span>{" "}
                          {s.name}{" "}
                          <StatusBadge status={s.status} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div>
                    <p className="mb-1 text-[10px] uppercase text-slate-500">
                      Tasks in sprint ({allSprintTaskIds.size})
                    </p>
                    {allSprintTasks.length === 0 && (
                      <p className="text-xs text-slate-500">
                        No tasks pulled yet — use Backlog → Pull to sprint.
                      </p>
                    )}
                    {allSprintTasks.map((t) => (
                      <Link
                        key={t.id}
                        href={`/engineering/tasks/${t.id}`}
                        className="mb-1 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 px-2 py-1.5 text-sm hover:border-teal-500/40 hover:bg-slate-900/50"
                      >
                        <span>
                          <span className="font-mono text-slate-500">
                            {t.number}
                          </span>{" "}
                          {t.name}
                          {t.assigneeId && (
                            <span className="ml-2 text-[10px] text-slate-500">
                              {userMap[t.assigneeId]}
                            </span>
                          )}
                        </span>
                        <StatusBadge status={t.status} />
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "prod" && isMfgEng && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Production issues from the floor / work orders. Accept onto the board
            as MFG_ENG tasks.
          </p>
          {(board.productionIssues || []).map((issue) => (
            <Card key={issue.id} className="border-orange-900/40">
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-orange-300">
                    {issue.number}
                  </span>
                  <StatusBadge status={issue.status} />
                  <StatusBadge status={issue.category} />
                </div>
                <p className="font-medium text-slate-100">{issue.title}</p>
                {issue.description && (
                  <p className="text-xs text-slate-400">{issue.description}</p>
                )}
                {issue.engTask ? (
                  <p className="text-xs text-teal-400">
                    On board: {issue.engTask.number}
                  </p>
                ) : (
                  <form
                    action={actionAcceptProductionIssue}
                    className="flex flex-wrap gap-2"
                  >
                    <input type="hidden" name="issueId" value={issue.id} />
                    <input
                      type="hidden"
                      name="returnTo"
                      value="/engineering/mfg_eng?tab=board"
                    />
                    <select
                      name="assigneeId"
                      className={`${selectClass} max-w-[180px]`}
                    >
                      <option value="">Assign ME…</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" size="sm">
                      Accept → task
                    </Button>
                  </form>
                )}
                <form
                  action={actionUpdateProductionEngIssue}
                  className="flex flex-wrap gap-2 border-t border-slate-800 pt-2"
                >
                  <input type="hidden" name="id" value={issue.id} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value="/engineering/mfg_eng?tab=prod"
                  />
                  <select
                    name="status"
                    defaultValue={issue.status}
                    className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                  >
                    <option value="OPEN">OPEN</option>
                    <option value="IN_PROGRESS">IN_PROGRESS</option>
                    <option value="WAITING_ECR">WAITING_ECR</option>
                    <option value="RESOLVED">RESOLVED</option>
                    <option value="CLOSED">CLOSED</option>
                  </select>
                  <Input
                    name="resolution"
                    placeholder="Resolution"
                    className="h-8 max-w-xs text-xs"
                  />
                  <Button type="submit" size="sm" variant="outline">
                    Update
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Log production issue</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionCreateProductionEngIssue}
                className="grid gap-2 sm:grid-cols-2"
              >
                <input
                  type="hidden"
                  name="returnTo"
                  value="/engineering/mfg_eng?tab=prod"
                />
                <Input name="title" required className="sm:col-span-2" />
                <Textarea name="description" rows={2} className="sm:col-span-2" />
                <select name="category" className={selectClass} defaultValue="PROCESS">
                  <option value="HARDWARE">Hardware</option>
                  <option value="PROCESS">Process</option>
                  <option value="DOCUMENT">Document</option>
                  <option value="BOM">BOM</option>
                  <option value="OTHER">Other</option>
                </select>
                <select name="productId" className={selectClass}>
                  <option value="">Product</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm">
                  Submit
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "sustainment" && isMfgEng && (
        <div className="space-y-4">
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Product sustainment task (no project required)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionCreateEngTask}
                className="grid gap-2 sm:grid-cols-2"
              >
                <input type="hidden" name="discipline" value="MFG_ENG" />
                <input type="hidden" name="kind" value="SUSTAINMENT" />
                <input
                  type="hidden"
                  name="returnTo"
                  value="/engineering/mfg_eng?tab=sustainment"
                />
                <select name="productId" required className={`${selectClass} sm:col-span-2`}>
                  <option value="">— Product —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </select>
                <Input
                  name="name"
                  required
                  placeholder="e.g. Update BOM…"
                  className="sm:col-span-2"
                />
                <Textarea name="description" rows={2} className="sm:col-span-2" />
                <select name="assigneeId" className={selectClass}>
                  <option value="">Assignee</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <Input name="dueDate" type="date" />
                <Button type="submit" size="sm">
                  Create
                </Button>
              </form>
            </CardContent>
          </Card>
          {board.tasks
            .filter((t) => t.productId || t.kind === "SUSTAINMENT")
            .map((t) => (
              <div
                key={t.id}
                className="flex justify-between rounded border border-slate-800 px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-mono text-slate-500">{t.number}</span>{" "}
                  {t.name}
                </span>
                <StatusBadge status={t.status} />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
