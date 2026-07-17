"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  actionMoveCmBoardCard,
  actionVoteCm,
  actionAssignEcrApprovers,
  actionReleaseDocumentEcr,
  actionMoveCmSubmission,
} from "@/app/actions";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  GripVertical,
  MessageSquare,
  Paperclip,
} from "lucide-react";
import type { CmBoardColumn } from "@/lib/services/cm-library";

export type CmBoardCardData = {
  id: string;
  kind: "CR" | "WI" | "BOM";
  number: string;
  title: string;
  type: string;
  status: string;
  priority?: string;
  href?: string;
  meta?: string;
  column: CmBoardColumn;
  changeRequestId?: string;
  boardMembers?: {
    id: string;
    userId: string;
    role: string;
    vote: string | null;
  }[];
  isDocumentEcr?: boolean;
  documentNumber?: string | null;
  documentRevision?: string | null;
  productName?: string | null;
  productFolderId?: string | null;
  isCompanyInternal?: boolean;
  isDocumentUpdate?: boolean;
  releaseFolderId?: string | null;
  releasedDocumentId?: string | null;
  attachments?: { id: string }[];
  comments?: { id: string }[];
};

export type CmBoardColumnDef = {
  id: CmBoardColumn;
  label: string;
  accent: string;
};

type CmUser = { id: string; name: string; role: string };
type ReleaseFolder = {
  id: string;
  name: string;
  kind: string;
  productName: string | null;
  parentId: string | null;
};

function isColumnId(id: string | undefined | null): id is CmBoardColumn {
  return (
    id === "IN_WORK" ||
    id === "SUBMITTED" ||
    id === "IN_REVIEW" ||
    id === "APPROVED" ||
    id === "RELEASED"
  );
}

function BoardColumn({
  col,
  count,
  children,
  isOver,
}: {
  col: CmBoardColumnDef;
  count: number;
  children: React.ReactNode;
  isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: col.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-xl border transition",
        col.accent,
        isOver && "ring-2 ring-teal-400/60 ring-offset-2 ring-offset-slate-950"
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-800/60 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
          {col.label}
        </h3>
        <span className="rounded-full bg-slate-950/80 px-2 py-0.5 font-mono text-[10px] text-slate-500">
          {count}
        </span>
      </div>
      <div className="flex min-h-[8rem] max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
        {children}
      </div>
    </div>
  );
}

function DraggableCardShell({
  card,
  disabled,
  children,
}: {
  card: CmBoardCardData;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: card.id,
      disabled,
      data: {
        changeRequestId: card.changeRequestId,
        column: card.column,
        isDocumentEcr: !!card.isDocumentEcr,
        kind: card.kind,
      },
    });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 40 : undefined,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative",
        isDragging && "opacity-40",
        !disabled && "touch-none"
      )}
    >
      {!disabled && (
        <button
          type="button"
          className="absolute left-1 top-2 z-10 rounded p-0.5 text-slate-600 hover:bg-slate-800 hover:text-slate-300"
          title="Drag to another column"
          aria-label="Drag card"
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <div className={cn(!disabled && "pl-5")}>{children}</div>
    </div>
  );
}

function CardBody({
  card,
  colId,
  userMap,
  cmUsers,
  releaseFolders,
  adminRootId,
  columns,
  currentUserId,
}: {
  card: CmBoardCardData;
  colId: CmBoardColumn;
  userMap: Record<string, { name: string }>;
  cmUsers: CmUser[];
  releaseFolders: ReleaseFolder[];
  adminRootId: string | null;
  columns: CmBoardColumnDef[];
  currentUserId?: string | null;
}) {
  const detailHref =
    card.kind === "CR" && card.changeRequestId
      ? `/cm/ecr/${card.changeRequestId}`
      : card.href;
  const attN = card.attachments?.length || 0;
  const noteN = card.comments?.length || 0;

  return (
    <Card className="border-slate-700/80 bg-slate-950/70 shadow-sm transition hover:border-teal-500/40">
      <CardContent className="space-y-2 p-3">
        {detailHref ? (
          <Link
            href={detailHref}
            className="block space-y-2 rounded-md outline-none ring-offset-slate-950 focus-visible:ring-2 focus-visible:ring-teal-500/50"
          >
            <div className="flex flex-wrap items-center gap-1">
              <span
                className={cn(
                  "font-mono text-xs font-semibold",
                  card.kind === "CR"
                    ? "text-teal-400"
                    : card.kind === "WI"
                      ? "text-sky-400"
                      : "text-violet-400"
                )}
              >
                {card.number}
              </span>
              <StatusBadge status={card.kind} />
              <StatusBadge status={card.status} />
              {card.priority && card.priority !== "NORMAL" && (
                <StatusBadge status={card.priority} />
              )}
            </div>
            <p className="text-sm leading-snug text-slate-200">{card.title}</p>
            {card.meta && (
              <p className="text-[10px] text-slate-500">{card.meta}</p>
            )}
            {card.kind === "CR" && (attN > 0 || noteN > 0) && (
              <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
                {attN > 0 && (
                  <span className="inline-flex items-center gap-0.5">
                    <Paperclip className="h-3 w-3" />
                    {attN}
                  </span>
                )}
                {noteN > 0 && (
                  <span className="inline-flex items-center gap-0.5">
                    <MessageSquare className="h-3 w-3" />
                    {noteN}
                  </span>
                )}
                <span className="text-sky-500/80">Open full details →</span>
              </div>
            )}
            {card.kind === "CR" && attN === 0 && noteN === 0 && (
              <p className="text-[10px] text-sky-500/80">Open full details →</p>
            )}
          </Link>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-mono text-xs font-semibold text-violet-400">
                {card.number}
              </span>
              <StatusBadge status={card.kind} />
              <StatusBadge status={card.status} />
            </div>
            <p className="text-sm leading-snug text-slate-200">{card.title}</p>
          </>
        )}

        {card.kind === "CR" &&
          card.isDocumentEcr &&
          card.changeRequestId &&
          (colId === "SUBMITTED" ||
            (colId === "IN_REVIEW" &&
              (!card.boardMembers || card.boardMembers.length < 2))) && (
            <form
              action={actionAssignEcrApprovers}
              className="space-y-1.5 border-t border-slate-800 pt-2"
            >
              <input
                type="hidden"
                name="changeRequestId"
                value={card.changeRequestId}
              />
              <input
                type="hidden"
                name="returnTo"
                value={`/cm/ecr/${card.changeRequestId}`}
              />
              <p className="text-[10px] font-medium uppercase text-amber-500/90">
                CM: assign 2 approvers
              </p>
              <select
                name="approverUserId1"
                required
                className="h-7 w-full rounded border border-slate-700 bg-slate-950 px-1 text-[10px]"
                defaultValue=""
              >
                <option value="" disabled>
                  Approver 1…
                </option>
                {cmUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
              <select
                name="approverUserId2"
                required
                className="h-7 w-full rounded border border-slate-700 bg-slate-950 px-1 text-[10px]"
                defaultValue=""
              >
                <option value="" disabled>
                  Approver 2…
                </option>
                {cmUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" className="h-7 w-full text-[10px]">
                Assign &amp; open review
              </Button>
            </form>
          )}

        {card.kind === "CR" &&
          card.boardMembers &&
          card.boardMembers.length > 0 &&
          colId === "IN_REVIEW" && (
            <div className="space-y-1.5 border-t border-slate-800 pt-2">
              <p className="text-[10px] uppercase text-slate-600">Approvers</p>
              {card.boardMembers
                .filter((m) =>
                  card.isDocumentEcr
                    ? ["APPROVER", "ENGINEERING", "QUALITY"].includes(m.role)
                    : m.role !== "CHAIR"
                )
                .map((m) => {
                  const isMine = currentUserId && m.userId === currentUserId;
                  return (
                    <div
                      key={m.id}
                      className="min-w-0 space-y-1 rounded border border-slate-800/80 bg-slate-900/40 p-1.5 text-[11px]"
                    >
                      <div className="flex min-w-0 items-center justify-between gap-1">
                        <span className="min-w-0 truncate text-slate-400">
                          {userMap[m.userId]?.name || m.role}
                          <span className="text-slate-600"> · {m.role}</span>
                        </span>
                        {m.vote && (
                          <StatusBadge
                            status={m.vote}
                            className="shrink-0 text-[9px]"
                          />
                        )}
                      </div>
                      {/* Only the assigned person can cast their own vote */}
                      {isMine ? (
                        <div className="flex w-full min-w-0 flex-wrap gap-1">
                          <form action={actionVoteCm} className="min-w-0 flex-1">
                            <input type="hidden" name="memberId" value={m.id} />
                            <input type="hidden" name="vote" value="APPROVE" />
                            <input
                              type="hidden"
                              name="returnTo"
                              value={`/cm/ecr/${card.changeRequestId}`}
                            />
                            <Button
                              type="submit"
                              size="sm"
                              variant={
                                m.vote === "APPROVE" ? "default" : "outline"
                              }
                              className="h-7 w-full px-1.5 text-[10px]"
                            >
                              Approve
                            </Button>
                          </form>
                          <form action={actionVoteCm} className="min-w-0 flex-1">
                            <input type="hidden" name="memberId" value={m.id} />
                            <input type="hidden" name="vote" value="REJECT" />
                            <input
                              type="hidden"
                              name="comments"
                              value="Rejected on CM board"
                            />
                            <input
                              type="hidden"
                              name="returnTo"
                              value={`/cm/ecr/${card.changeRequestId}`}
                            />
                            <Button
                              type="submit"
                              size="sm"
                              variant={
                                m.vote === "REJECT" ? "destructive" : "outline"
                              }
                              className="h-7 w-full px-1.5 text-[10px]"
                            >
                              Reject
                            </Button>
                          </form>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-600">
                          {m.vote
                            ? "Voted"
                            : "Waiting on this approver"}
                        </p>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

        {card.kind === "CR" &&
          card.isDocumentEcr &&
          card.changeRequestId &&
          colId === "APPROVED" && (
            <form
              action={actionReleaseDocumentEcr}
              className="space-y-1.5 border-t border-emerald-900/40 pt-2"
            >
              <input
                type="hidden"
                name="changeRequestId"
                value={card.changeRequestId}
              />
              <p className="text-[10px] font-medium uppercase text-emerald-400/90">
                CM release → library folder
              </p>
              <select
                name="releaseFolderId"
                required
                className="h-7 w-full rounded border border-slate-700 bg-slate-950 px-1 text-[10px]"
                defaultValue={
                  card.productFolderId ||
                  (card.isCompanyInternal ? adminRootId || "" : "") ||
                  ""
                }
              >
                <option value="" disabled>
                  Assign folder…
                </option>
                {releaseFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.kind === "ADMIN" && !f.parentId
                      ? "Admin (company)"
                      : f.productName || f.name}
                    {f.parentId ? ` / ${f.name}` : ""}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" className="h-7 w-full text-[10px]">
                Release to CM library
              </Button>
            </form>
          )}

        {card.kind === "CR" && card.changeRequestId && !card.isDocumentEcr && (
          <form
            action={actionMoveCmSubmission}
            className="flex items-center gap-1 border-t border-slate-800 pt-2"
          >
            <input
              type="hidden"
              name="changeRequestId"
              value={card.changeRequestId}
            />
            <input
              type="hidden"
              name="returnTo"
              value={`/cm/ecr/${card.changeRequestId}`}
            />
            <select
              name="column"
              className="h-7 flex-1 rounded border border-slate-700 bg-slate-950 px-1 text-[10px] text-slate-300"
              defaultValue={colId}
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  → {c.label}
                </option>
              ))}
            </select>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[10px]"
            >
              Move
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function CmSubmissionsBoard({
  columns,
  initialCards,
  userMap,
  cmUsers,
  releaseFolders,
  adminRootId,
  currentUserId,
}: {
  columns: CmBoardColumnDef[];
  initialCards: CmBoardCardData[];
  userMap: Record<string, { name: string }>;
  cmUsers: CmUser[];
  releaseFolders: ReleaseFolder[];
  adminRootId: string | null;
  currentUserId?: string | null;
}) {
  const router = useRouter();
  const [cards, setCards] = useState(initialCards);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<CmBoardColumn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Sync when server revalidates (key avoids thrashing on new array identity)
  const cardsKey = initialCards.map((c) => `${c.id}:${c.column}`).join("|");
  useEffect(() => {
    setCards(initialCards);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by cardsKey
  }, [cardsKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const byColumn = useMemo(() => {
    const map = Object.fromEntries(
      columns.map((c) => [c.id, [] as CmBoardCardData[]])
    ) as Record<CmBoardColumn, CmBoardCardData[]>;
    for (const card of cards) {
      map[card.column]?.push(card);
    }
    return map;
  }, [cards, columns]);

  const activeCard = activeId
    ? cards.find((c) => c.id === activeId) || null
    : null;

  function onDragStart(event: DragStartEvent) {
    setError(null);
    setActiveId(String(event.active.id));
  }

  function onDragOver(event: { over: { id: string | number } | null }) {
    const overId = event.over ? String(event.over.id) : null;
    if (isColumnId(overId)) {
      setOverColumn(overId);
    } else if (overId) {
      const card = cards.find((c) => c.id === overId);
      setOverColumn(card?.column || null);
    } else {
      setOverColumn(null);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    setOverColumn(null);

    const { active, over } = event;
    if (!over) return;

    const card = cards.find((c) => c.id === String(active.id));
    if (!card?.changeRequestId) {
      setError("Only change requests can be moved on this board");
      return;
    }

    let targetColumn: CmBoardColumn | null = null;
    const overId = String(over.id);
    if (isColumnId(overId)) {
      targetColumn = overId;
    } else {
      const overCard = cards.find((c) => c.id === overId);
      targetColumn = overCard?.column || null;
    }
    if (!targetColumn || targetColumn === card.column) return;

    if (card.isDocumentEcr && targetColumn === "RELEASED") {
      setError(
        "Document ECRs: drop into Approved, then use CM release (folder pick) — not Released"
      );
      return;
    }
    // Document ECRs enter at Submitted — In work is for WI/BOM drafts only
    if (card.isDocumentEcr && targetColumn === "IN_WORK") {
      setError(
        "Document ECRs start in Submitted (not In work). Move to In review after CM assigns approvers."
      );
      return;
    }

    const prev = cards;
    setCards((list) =>
      list.map((c) =>
        c.id === card.id
          ? {
              ...c,
              column: targetColumn!,
              status:
                targetColumn === "IN_WORK"
                  ? "DRAFT"
                  : targetColumn === "SUBMITTED"
                    ? "SUBMITTED"
                    : targetColumn === "IN_REVIEW"
                      ? "REVIEW_BOARD"
                      : targetColumn === "APPROVED"
                        ? "APPROVED"
                        : "IMPLEMENTED",
            }
          : c
      )
    );

    startTransition(async () => {
      const result = await actionMoveCmBoardCard({
        changeRequestId: card.changeRequestId!,
        column: targetColumn!,
        isDocumentEcr: !!card.isDocumentEcr,
      });
      if (!result.ok) {
        setCards(prev);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function onDragCancel() {
    setActiveId(null);
    setOverColumn(null);
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">
        Drag tiles by the{" "}
        <GripVertical className="inline h-3.5 w-3.5 text-slate-400" /> handle into
        another column. Click the card body for full details.
        {pending && (
          <span className="ml-2 text-sky-400">Saving move…</span>
        )}
      </p>
      {error && (
        <p className="rounded border border-rose-900/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="flex gap-3 overflow-x-auto pb-2">
          {columns.map((col) => (
            <BoardColumn
              key={col.id}
              col={col}
              count={byColumn[col.id].length}
              isOver={overColumn === col.id && !!activeId}
            >
              {byColumn[col.id].length === 0 && (
                <p className="px-1 py-6 text-center text-[11px] text-slate-600">
                  {activeId ? "Drop here" : "Empty"}
                </p>
              )}
              {byColumn[col.id].map((card) => (
                <DraggableCardShell
                  key={card.id}
                  card={card}
                  disabled={!card.changeRequestId}
                >
                  <CardBody
                    card={card}
                    colId={col.id}
                    userMap={userMap}
                    cmUsers={cmUsers}
                    releaseFolders={releaseFolders}
                    adminRootId={adminRootId}
                    columns={columns}
                    currentUserId={currentUserId}
                  />
                </DraggableCardShell>
              ))}
            </BoardColumn>
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div className="w-72 rotate-1 opacity-95 shadow-2xl">
              <Card className="border-teal-500/50 bg-slate-950">
                <CardContent className="space-y-1 p-3">
                  <p className="font-mono text-xs font-semibold text-teal-400">
                    {activeCard.number}
                  </p>
                  <p className="text-sm text-slate-100">{activeCard.title}</p>
                  <p className="text-[10px] text-slate-500">
                    Drop on a column to move
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
