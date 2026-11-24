"use client";

import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  actionAddCarinaTask,
  actionCancelCarinaTask,
  actionListCarinaTasks,
  actionReorderCarinaTasks,
  actionUpdateCarinaTask,
} from "@/app/ai/carina-task-actions";
import { parseTaskLog, type CarinaTaskRecord } from "@/lib/services/carina-task-model";
import Link from "next/link";

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  working: "Working",
  "needs-approval": "Needs your OK",
  "needs-info": "Needs info",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function CarinaTodoPanel({ compact = false }: { compact?: boolean }) {
  const search = useSearchParams();
  const focusId = search.get("task");
  const [tasks, setTasks] = useState<CarinaTaskRecord[]>([]);
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openLog, setOpenLog] = useState<string | null>(focusId);
  const [pending, start] = useTransition();

  async function refresh() {
    const list = await actionListCarinaTasks();
    setTasks(list);
  }

  useEffect(() => {
    start(() => {
      void refresh().catch((e) => setError(e instanceof Error ? e.message : "Could not load tasks."));
    });
  }, []);

  useEffect(() => {
    if (focusId) setOpenLog(focusId);
  }, [focusId]);

  const visible = tasks;

  return (
    <div className={compact ? "flex h-full flex-col" : "space-y-3"}>
      <div className="px-1">
        <h2 className={`font-semibold text-slate-100 ${compact ? "text-sm" : "text-base"}`}>
          Carina’s to-do list
        </h2>
        <p className="text-[11px] text-slate-500">
          Add work by typing here, in chat, or by voice (“add to your list…”, “when you get a chance…”). I’ll work on it in the background as you, with your permissions.
        </p>
      </div>
      <form
        className="flex flex-col gap-2 px-1"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData();
          fd.set("text", text);
          if (confirmed) fd.set("confirmedReadback", "on");
          start(async () => {
            setError(null);
            try {
              await actionAddCarinaTask(fd);
              setText("");
              setConfirmed(false);
              await refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not add that.");
            }
          });
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add to Carina’s list…"
          className="h-8 text-sm"
        />
        <label className="flex items-start gap-2 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          I confirm the read-back for a change to an existing record (otherwise it waits in Approvals).
        </label>
        <Button type="submit" size="sm" disabled={pending || !text.trim()}>
          Add
        </Button>
      </form>
      {error && <p className="px-1 text-xs text-rose-400">{error}</p>}
      <ul className={`space-y-2 px-1 ${compact ? "flex-1 overflow-auto pb-3" : ""}`}>
        {visible.length === 0 && (
          <li className="text-xs text-slate-500">Nothing on my list yet.</li>
        )}
        {visible.map((task, index) => {
          const isProductionJournal = task.id.startsWith("pj:");
          const log = parseTaskLog(task.log);
          const open = openLog === task.id;
          return (
            <li
              key={task.id}
              id={`carina-task-${task.id}`}
              className={`rounded-lg border px-3 py-2 ${
                focusId === task.id ? "border-teal-700 bg-teal-950/20" : "border-slate-800 bg-slate-950/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm text-slate-200">{task.text}</p>
                  <p className="text-[11px] text-slate-500">
                    {STATUS_LABEL[task.status] || task.status}
                    {task.status === "needs-approval" && (
                      <>
                        {" "}
                        ·{" "}
                        <Link
                          href={isProductionJournal ? `/approvals#${task.id.replace("pj:", "pj-")}` : `/approvals#carina-${task.id}`}
                          className="text-teal-400 hover:underline"
                        >
                          Open in Approvals
                        </Link>
                      </>
                    )}
                    {task.resultHref && (
                      <>
                        {" "}
                        ·{" "}
                        <Link href={task.resultHref} className="text-teal-400 hover:underline">
                          Result
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                {!isProductionJournal && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={index === 0 || pending}
                    onClick={() => {
                      const ids = visible.filter((t) => !t.id.startsWith("pj:")).map((t) => t.id);
                      const from = ids.indexOf(task.id);
                      if (from <= 0) return;
                      [ids[from - 1], ids[from]] = [ids[from], ids[from - 1]];
                      start(async () => {
                        await actionReorderCarinaTasks(ids);
                        await refresh();
                      });
                    }}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={index === visible.length - 1 || pending}
                    onClick={() => {
                      const ids = visible.filter((t) => !t.id.startsWith("pj:")).map((t) => t.id);
                      const from = ids.indexOf(task.id);
                      if (from < 0 || from >= ids.length - 1) return;
                      [ids[from + 1], ids[from]] = [ids[from], ids[from + 1]];
                      start(async () => {
                        await actionReorderCarinaTasks(ids);
                        await refresh();
                      });
                    }}
                  >
                    ↓
                  </Button>
                </div>
                )}
              </div>
              {!isProductionJournal && task.status !== "done" && task.status !== "cancelled" && task.status !== "working" && (
                <form
                  className="mt-2 flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    start(async () => {
                      await actionUpdateCarinaTask(fd);
                      await refresh();
                    });
                  }}
                >
                  <input type="hidden" name="taskId" value={task.id} />
                  <Input name="text" defaultValue={task.text} className="h-7 text-xs" />
                  <Button type="submit" size="sm" variant="outline">
                    Save
                  </Button>
                </form>
              )}
              {!isProductionJournal && task.status !== "done" && task.status !== "cancelled" && (
                <form
                  className="mt-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData();
                    fd.set("taskId", task.id);
                    start(async () => {
                      await actionCancelCarinaTask(fd);
                      await refresh();
                    });
                  }}
                >
                  <Button type="submit" size="sm" variant="ghost">
                    Cancel
                  </Button>
                </form>
              )}
              {!isProductionJournal && <button
                type="button"
                className="mt-1 text-[11px] text-teal-400 hover:underline"
                onClick={() => setOpenLog(open ? null : task.id)}
              >
                {open ? "Hide log" : "Show log"}
              </button>}
              {open && !isProductionJournal && (
                <ol className="mt-1 space-y-1 border-t border-slate-800/80 pt-1 text-[11px] text-slate-400">
                  {log.length === 0 && <li>No log entries yet.</li>}
                  {log.map((entry, i) => (
                    <li key={i}>
                      <span className="text-slate-600">
                        {new Date(entry.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT
                      </span>{" "}
                      {entry.message}
                      {entry.href && (
                        <>
                          {" "}
                          <Link href={entry.href} className="text-teal-400 hover:underline">
                            Open
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
