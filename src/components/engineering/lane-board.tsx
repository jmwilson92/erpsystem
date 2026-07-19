"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  actionMoveEngWork,
  actionScanIn,
  actionScanOut,
  actionUpdateEngTask,
  actionBreakDownTask,
  actionCreateEngTask,
  actionCreateSaga,
} from "@/app/actions";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDate } from "@/lib/utils";
import { GripVertical, Plus, X, Users } from "lucide-react";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import {
  WorkDependencyTypeahead,
  type WorkHit,
} from "@/components/engineering/work-typeahead";

const COLS = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "BLOCKED",
  "DONE",
] as const;

type Col = (typeof COLS)[number];

export type BoardTask = {
  id: string;
  number: string;
  name: string;
  status: string;
  priority: string;
  assigneeId?: string | null;
  storyPoints?: number | null;
  product?: { code: string } | null;
  blockedBy?: {
    sourceTask?: { number: string } | null;
    sourceSaga?: { number: string } | null;
  }[];
  children?: { id: string; number: string; name: string; status: string }[];
  productionIssue?: { number: string } | null;
  requirementTraces?: { requirement: { number: string; status: string } }[];
};

export type BoardSaga = {
  id: string;
  number: string;
  name: string;
  status: string;
  priority: string;
  projectId: string;
  campaignId: string;
  dueDate?: string | Date | null;
  campaign: { number: string };
  project: { number: string };
  engSprint?: { id: string; name: string } | null;
  engTasks: BoardTask[];
  blockedBy?: {
    sourceTask?: { number: string } | null;
    sourceSaga?: { number: string } | null;
  }[];
};

export type OpenScan = {
  id: string;
  engTaskId: string;
  userId: string;
  userName?: string;
  engTask: { id: string; number: string; name: string };
};

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

function isCol(id: string | null | undefined): id is Col {
  return !!id && (COLS as readonly string[]).includes(id);
}

function DropColumn({
  col,
  children,
  isOver,
  count,
}: {
  col: Col;
  children: React.ReactNode;
  isOver: boolean;
  count: number;
}) {
  const { setNodeRef } = useDroppable({ id: col });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-80 shrink-0 flex-col rounded-xl border bg-slate-900/40 transition",
        isOver ? "border-teal-500/60 ring-2 ring-teal-400/40" : "border-slate-800"
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {col.replace(/_/g, " ")}
        </span>
        <span className="text-[10px] text-slate-600">{count}</span>
      </div>
      <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">{children}</div>
    </div>
  );
}

function DraggableCard({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id });
  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "opacity-40")}
    >
      <div className="flex gap-1">
        <button
          type="button"
          className="mt-2 shrink-0 cursor-grab text-slate-600 active:cursor-grabbing"
          {...listeners}
          {...attributes}
          aria-label="Drag"
          // dnd-kit sets aria-describedby only on the client
          suppressHydrationWarning
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export function LaneBoard({
  discipline,
  returnTo,
  sagas: initialSagas,
  openScans,
  userMap,
  users,
  campaigns,
  projects,
  allTasks,
  allSagas,
  allCampaigns = [],
  currentUserId,
}: {
  discipline: string;
  returnTo: string;
  sagas: BoardSaga[];
  openScans: OpenScan[];
  userMap: Record<string, string>;
  users: { id: string; name: string }[];
  campaigns: {
    id: string;
    number: string;
    name: string;
    projectId: string;
    project: { number: string };
  }[];
  projects: { id: string; number: string; name: string }[];
  allTasks: { id: string; number: string; name: string; discipline: string | null }[];
  allSagas: { id: string; number: string; name: string; discipline: string }[];
  allCampaigns?: { id: string; number: string; name: string }[];
  currentUserId?: string | null;
}) {
  const router = useRouter();
  const [sagas, setSagas] = useState(initialSagas);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Col | null>(null);
  const [showSagaModal, setShowSagaModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);

  // Sync when server revalidates
  const key = initialSagas
    .map(
      (s) =>
        `${s.id}:${s.status}:${s.engTasks.map((t) => `${t.id}:${t.status}`).join(",")}`
    )
    .join("|");
  useEffect(() => {
    setSagas(initialSagas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const scansByTask = useMemo(() => {
    const m = new Map<string, OpenScan[]>();
    for (const s of openScans) {
      const list = m.get(s.engTaskId) || [];
      list.push(s);
      m.set(s.engTaskId, list);
    }
    return m;
  }, [openScans]);

  const workHits: WorkHit[] = useMemo(() => {
    const hits: WorkHit[] = [];
    for (const t of allTasks) {
      hits.push({
        id: t.id,
        kind: "TASK",
        number: t.number,
        name: t.name,
        discipline: t.discipline,
      });
    }
    for (const s of allSagas) {
      hits.push({
        id: s.id,
        kind: "SAGA",
        number: s.number,
        name: s.name,
        discipline: s.discipline,
      });
    }
    for (const c of allCampaigns) {
      hits.push({
        id: c.id,
        kind: "CAMPAIGN",
        number: c.number,
        name: c.name,
      });
    }
    return hits;
  }, [allTasks, allSagas, allCampaigns]);

  const byCol = useMemo(() => {
    const map = Object.fromEntries(COLS.map((c) => [c, [] as BoardSaga[]])) as Record<
      Col,
      BoardSaga[]
    >;
    for (const s of sagas) {
      const col = (COLS.includes(s.status as Col) ? s.status : "BACKLOG") as Col;
      map[col].push(s);
    }
    return map;
  }, [sagas]);

  function parseDragId(id: string): { kind: "saga" | "task"; id: string } | null {
    if (id.startsWith("saga:")) return { kind: "saga", id: id.slice(5) };
    if (id.startsWith("task:")) return { kind: "task", id: id.slice(5) };
    return null;
  }

  function onDragStart(e: DragStartEvent) {
    setError(null);
    setActiveId(String(e.active.id));
  }

  function onDragOver(e: { over: { id: string | number } | null }) {
    const overId = e.over ? String(e.over.id) : null;
    if (isCol(overId)) setOverCol(overId);
    else if (overId?.startsWith("saga:")) {
      const sid = overId.slice(5);
      const s = sagas.find((x) => x.id === sid);
      setOverCol((s?.status as Col) || null);
    } else setOverCol(null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    setOverCol(null);
    const parsed = parseDragId(String(e.active.id));
    if (!parsed || !e.over) return;

    let targetCol: Col | null = null;
    const overId = String(e.over.id);
    if (isCol(overId)) targetCol = overId;
    else if (overId.startsWith("saga:")) {
      const s = sagas.find((x) => x.id === overId.slice(5));
      targetCol = (s?.status as Col) || null;
    }
    if (!targetCol) return;

    if (parsed.kind === "saga") {
      const saga = sagas.find((s) => s.id === parsed.id);
      if (!saga || saga.status === targetCol) return;
      const prev = sagas;
      setSagas((list) =>
        list.map((s) => (s.id === parsed.id ? { ...s, status: targetCol! } : s))
      );
      startTransition(async () => {
        const res = await actionMoveEngWork({
          kind: "saga",
          id: parsed.id,
          status: targetCol!,
        });
        if (!res.ok) {
          setSagas(prev);
          setError(res.error);
          return;
        }
        router.refresh();
      });
    } else {
      // task drag — find parent saga
      let parent: BoardSaga | undefined;
      let task: BoardTask | undefined;
      for (const s of sagas) {
        const t = s.engTasks.find((x) => x.id === parsed.id);
        if (t) {
          parent = s;
          task = t;
          break;
        }
      }
      if (!task || !parent || task.status === targetCol) return;
      const prev = sagas;
      setSagas((list) =>
        list.map((s) =>
          s.id !== parent!.id
            ? s
            : {
                ...s,
                engTasks: s.engTasks.map((t) =>
                  t.id === parsed.id ? { ...t, status: targetCol! } : t
                ),
                // If task moves to in progress, nudge saga
                status:
                  targetCol === "IN_PROGRESS" &&
                  ["BACKLOG", "TODO"].includes(s.status)
                    ? "IN_PROGRESS"
                    : s.status,
              }
        )
      );
      startTransition(async () => {
        const res = await actionMoveEngWork({
          kind: "task",
          id: parsed.id,
          status: targetCol!,
        });
        if (!res.ok) {
          setSagas(prev);
          setError(res.error);
          return;
        }
        router.refresh();
      });
    }
  }

  async function runForm(
    action: (fd: FormData) => Promise<void>,
    fd: FormData
  ) {
    setError(null);
    startTransition(async () => {
      try {
        await action(fd);
        router.refresh();
        setShowSagaModal(false);
        setShowTaskModal(false);
      } catch (err) {
        if (isRedirectError(err)) {
          router.refresh();
          setShowSagaModal(false);
          setShowTaskModal(false);
          throw err;
        }
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  const activeLabel = activeId
    ? (() => {
        const p = parseDragId(activeId);
        if (!p) return null;
        if (p.kind === "saga") {
          const s = sagas.find((x) => x.id === p.id);
          return s ? `${s.number} ${s.name}` : null;
        }
        for (const s of sagas) {
          const t = s.engTasks.find((x) => x.id === p.id);
          if (t) return `${t.number} ${t.name}`;
        }
        return null;
      })()
    : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setShowSagaModal(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          New saga
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowTaskModal(true)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          New task
        </Button>
        <span className="text-[11px] text-slate-500">
          Drag cards between columns · multi-scan supported
        </span>
      </div>

      {error && (
        <p className="rounded border border-rose-900/50 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setOverCol(null);
        }}
      >
        <div className="flex gap-2 overflow-x-auto pb-2">
          {COLS.map((col) => (
            <DropColumn
              key={col}
              col={col}
              isOver={overCol === col}
              count={byCol[col].length}
            >
              {byCol[col].map((s) => (
                <DraggableCard key={s.id} id={`saga:${s.id}`}>
                  <Card
                    className={cn(
                      "border-slate-800",
                      s.status === "BLOCKED" && "border-amber-500/40"
                    )}
                  >
                    <CardContent className="space-y-2 p-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-sky-400">
                          {s.number}
                        </span>
                        <StatusBadge status={s.priority} />
                        {s.engSprint && (
                          <span className="text-[9px] text-violet-400">
                            {s.engSprint.name}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-slate-200">
                        {s.name}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {s.campaign.number} · {s.project.number}
                        {s.dueDate
                          ? ` · due ${formatDate(s.dueDate)}`
                          : ""}
                      </p>
                      {(s.blockedBy?.length || 0) > 0 && (
                        <p className="text-[10px] text-amber-400">
                          Depends on{" "}
                          {s.blockedBy!
                            .map(
                              (b) =>
                                b.sourceTask?.number || b.sourceSaga?.number
                            )
                            .join(", ")}
                        </p>
                      )}

                      <ul className="space-y-1.5 border-t border-slate-800 pt-2">
                        {s.engTasks.map((t) => {
                          const scanners = scansByTask.get(t.id) || [];
                          return (
                            <li
                              key={t.id}
                              className="rounded border border-slate-800/80 px-2 py-1.5 text-[11px]"
                            >
                              <DraggableCard id={`task:${t.id}`}>
                                <div className="flex justify-between gap-1">
                                  <Link
                                    href={`/engineering/tasks/${t.id}`}
                                    className="min-w-0 text-left hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <span className="font-mono text-teal-400">
                                      {t.number}
                                    </span>{" "}
                                    <span className="text-slate-200">{t.name}</span>
                                  </Link>
                                  <StatusBadge status={t.status} />
                                </div>
                              </DraggableCard>
                              {t.product && (
                                <p className="text-[10px] text-teal-500/90">
                                  Product {t.product.code}
                                </p>
                              )}
                              {(t.requirementTraces?.length || 0) > 0 && (
                                <p className="mt-0.5 flex flex-wrap gap-1">
                                  {t.requirementTraces!.map((rt) => (
                                    <Link
                                      key={rt.requirement.number}
                                      href="/requirements"
                                      onClick={(e) => e.stopPropagation()}
                                      className={`rounded-full border px-1.5 py-px font-mono text-[9px] ${
                                        rt.requirement.status === "VERIFIED"
                                          ? "border-emerald-700/50 text-emerald-400"
                                          : "border-violet-700/50 text-violet-300"
                                      }`}
                                    >
                                      {rt.requirement.number}
                                    </Link>
                                  ))}
                                </p>
                              )}
                              {t.assigneeId && (
                                <p className="text-[10px] text-slate-500">
                                  Assignee: {userMap[t.assigneeId] || "—"}
                                </p>
                              )}
                              {scanners.length > 0 && (
                                <p className="flex items-center gap-1 text-[10px] text-teal-300">
                                  <Users className="h-3 w-3" />
                                  Scanned in:{" "}
                                  {scanners
                                    .map((sc) => sc.userName || "Eng")
                                    .join(", ")}
                                </p>
                              )}
                              {(t.blockedBy?.length || 0) > 0 && (
                                <p className="text-[9px] text-amber-400/90">
                                  Depends on{" "}
                                  {t.blockedBy!
                                    .map(
                                      (b) =>
                                        b.sourceTask?.number ||
                                        b.sourceSaga?.number
                                    )
                                    .join(", ")}
                                </p>
                              )}

                              <div className="mt-1 flex flex-wrap gap-1">
                                <form
                                  action={actionUpdateEngTask}
                                  className="flex gap-0.5"
                                >
                                  <input type="hidden" name="id" value={t.id} />
                                  <input
                                    type="hidden"
                                    name="returnTo"
                                    value={returnTo}
                                  />
                                  <select
                                    name="assigneeId"
                                    defaultValue={t.assigneeId || ""}
                                    className="h-6 max-w-[100px] rounded border border-slate-700 bg-slate-950 px-0.5 text-[9px]"
                                  >
                                    <option value="">Unassigned</option>
                                    {users.map((u) => (
                                      <option key={u.id} value={u.id}>
                                        {u.name.split(" ")[0]}
                                      </option>
                                    ))}
                                  </select>
                                  <Button
                                    type="submit"
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-1 text-[9px]"
                                  >
                                    Set
                                  </Button>
                                </form>

                                {scanners.some(
                                  (sc) => sc.userId === currentUserId
                                ) ? (
                                  <form action={actionScanOut}>
                                    <input
                                      type="hidden"
                                      name="engTaskId"
                                      value={t.id}
                                    />
                                    <input
                                      type="hidden"
                                      name="returnTo"
                                      value={returnTo}
                                    />
                                    <Button
                                      type="submit"
                                      size="sm"
                                      className="h-6 px-1.5 text-[9px]"
                                    >
                                      Scan out
                                    </Button>
                                  </form>
                                ) : (
                                  <form action={actionScanIn}>
                                    <input
                                      type="hidden"
                                      name="engTaskId"
                                      value={t.id}
                                    />
                                    <input
                                      type="hidden"
                                      name="returnTo"
                                      value={returnTo}
                                    />
                                    <Button
                                      type="submit"
                                      size="sm"
                                      variant="outline"
                                      className="h-6 px-1.5 text-[9px]"
                                    >
                                      Scan in
                                    </Button>
                                  </form>
                                )}
                              </div>

                              {(t.children?.length || 0) > 0 && (
                                <ul className="mt-1 space-y-0.5 border-l border-slate-700 pl-2 text-[10px] text-slate-500">
                                  {t.children!.map((c) => (
                                    <li
                                      key={c.id}
                                      className="flex justify-between"
                                    >
                                      <span>
                                        {c.number} {c.name}
                                      </span>
                                      <StatusBadge status={c.status} />
                                    </li>
                                  ))}
                                </ul>
                              )}

                              <form
                                action={actionBreakDownTask}
                                className="mt-1 flex gap-0.5"
                              >
                                <input
                                  type="hidden"
                                  name="parentTaskId"
                                  value={t.id}
                                />
                                <input
                                  type="hidden"
                                  name="returnTo"
                                  value={returnTo}
                                />
                                <Input
                                  name="name"
                                  required
                                  placeholder="Split subtask…"
                                  className="h-6 text-[10px]"
                                />
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-1 text-[9px]"
                                >
                                  Split
                                </Button>
                              </form>
                            </li>
                          );
                        })}
                      </ul>
                    </CardContent>
                  </Card>
                </DraggableCard>
              ))}
            </DropColumn>
          ))}
        </div>
        <DragOverlay>
          {activeLabel ? (
            <div className="rounded-md border border-teal-500/50 bg-slate-900 px-3 py-2 text-xs text-slate-200 shadow-lg">
              {activeLabel}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Saga modal */}
      {showSagaModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-100">
                New {discipline} saga → backlog
              </h3>
              <button
                type="button"
                onClick={() => setShowSagaModal(false)}
                className="text-slate-500 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              className="grid gap-3 p-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                runForm(actionCreateSaga, fd);
              }}
            >
              <input type="hidden" name="discipline" value={discipline} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Campaign *
                </label>
                <select name="campaignId" required className={`${selectClass} mt-1`}>
                  <option value="">— Select —</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.project.number} / {c.number} · {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Project *
                </label>
                <select name="projectId" required className={`${selectClass} mt-1`}>
                  <option value="">— Select —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number} · {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Name *
                </label>
                <Input name="name" required className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Description
                </label>
                <Textarea name="description" rows={2} className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Definition of Done
                </label>
                <Textarea name="definitionOfDone" rows={2} className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Priority
                </label>
                <select name="priority" className={`${selectClass} mt-1`} defaultValue="NORMAL">
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Due
                </label>
                <Input name="dueDate" type="date" className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Depends on (type to search)
                </label>
                <div className="mt-1">
                  <WorkDependencyTypeahead items={workHits} />
                </div>
                <p className="mt-0.5 text-[10px] text-slate-600">
                  PM is notified when dependencies are set.
                </p>
              </div>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSagaModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? "Adding…" : "Add to backlog"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Task modal */}
      {showTaskModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-100">
                New task → backlog
              </h3>
              <button
                type="button"
                onClick={() => setShowTaskModal(false)}
                className="text-slate-500 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              className="grid gap-3 p-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                runForm(actionCreateEngTask, fd);
              }}
            >
              <input type="hidden" name="discipline" value={discipline} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Saga *
                </label>
                <select name="sagaId" required className={`${selectClass} mt-1`}>
                  <option value="">— Select saga —</option>
                  {sagas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.number} {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Project * (must match saga)
                </label>
                <select name="projectId" required className={`${selectClass} mt-1`}>
                  <option value="">—</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Name *
                </label>
                <Input name="name" required className="mt-1" />
              </div>
              <Textarea
                name="description"
                rows={2}
                placeholder="Description"
                className="sm:col-span-2"
              />
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Assignee
                </label>
                <select name="assigneeId" className={`${selectClass} mt-1`}>
                  <option value="">—</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Due
                </label>
                <Input name="dueDate" type="date" className="mt-1" />
              </div>
              <Input name="estimatedHours" type="number" placeholder="Est hours" />
              <Input name="storyPoints" type="number" placeholder="Points" />
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Depends on (type to search)
                </label>
                <div className="mt-1">
                  <WorkDependencyTypeahead items={workHits} />
                </div>
              </div>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowTaskModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? "Adding…" : "Add to backlog"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
