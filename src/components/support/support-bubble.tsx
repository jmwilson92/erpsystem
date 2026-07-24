"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  LifeBuoy,
  MessageCircle,
  MessagesSquare,
  X,
  Send,
  ExternalLink,
} from "lucide-react";
import { actionCreateSupportTicket } from "@/app/support/actions";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
} from "@/lib/support-constants";
import { cn } from "@/lib/utils";

/**
 * Global floating help chat launcher — shown on every app shell page so
 * users never have to dig for support. Opens a panel to start a ticket
 * chat or jump to existing tickets / the staff desk.
 */
export function SupportBubble({
  isAdmin = false,
  badge = 0,
}: {
  isAdmin?: boolean;
  badge?: number;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // Delay so the opening click doesn't immediately close
    const t = window.setTimeout(
      () => document.addEventListener("mousedown", onPointer),
      0
    );
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div
      ref={panelRef}
      className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3"
    >
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="pointer-events-auto w-[min(100vw-2rem,22rem)] overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950 shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-gradient-to-r from-teal-600/20 to-sky-600/10 px-4 py-3">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="flex items-center gap-2 text-sm font-semibold text-slate-50"
              >
                <MessageCircle className="h-4 w-4 text-teal-400" aria-hidden />
                Help chat
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Opens a support ticket. Staff reply in the thread.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              aria-label="Close help chat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3 p-4">
            <form action={actionCreateSupportTicket} className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-400">
                  Subject
                </label>
                <input
                  name="subject"
                  required
                  maxLength={200}
                  placeholder="What's going on?"
                  className="flex h-9 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    Category
                  </label>
                  <select
                    name="category"
                    defaultValue="GENERAL"
                    className="flex h-9 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-2 text-xs text-slate-100"
                  >
                    {SUPPORT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    Priority
                  </label>
                  <select
                    name="priority"
                    defaultValue="MEDIUM"
                    className="flex h-9 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-2 text-xs text-slate-100"
                  >
                    {SUPPORT_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-400">
                  Message
                </label>
                <textarea
                  name="body"
                  required
                  rows={4}
                  placeholder="Describe the issue…"
                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
                />
              </div>
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-400"
              >
                <Send className="h-4 w-4" aria-hidden />
                Start chat
              </button>
            </form>

            <div className="flex flex-col gap-1.5 border-t border-slate-800 pt-3">
              <Link
                href="/support"
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-900 hover:text-white"
              >
                <MessagesSquare className="h-3.5 w-3.5 text-teal-400" />
                View my tickets
                <ExternalLink className="ml-auto h-3 w-3 opacity-50" />
              </Link>
              {isAdmin && (
                <Link
                  href="/admin/support"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-900 hover:text-white"
                >
                  <LifeBuoy className="h-3.5 w-3.5 text-violet-400" />
                  Staff support desk
                  <ExternalLink className="ml-auto h-3 w-3 opacity-50" />
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? titleId : undefined}
        aria-label={open ? "Close help chat" : "Open help chat"}
        className={cn(
          "pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full shadow-lg shadow-teal-950/40 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
          open
            ? "bg-slate-800 text-slate-100 ring-1 ring-slate-600"
            : "bg-gradient-to-br from-teal-400 to-cyan-600 text-white"
        )}
      >
        {open ? (
          <X className="h-6 w-6" aria-hidden />
        ) : (
          <MessageCircle className="h-6 w-6" aria-hidden />
        )}
        {!open && badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-slate-950 ring-2 ring-slate-950">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>
    </div>
  );
}
