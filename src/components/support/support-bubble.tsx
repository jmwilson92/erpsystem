"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  LifeBuoy,
  MessageCircle,
  MessagesSquare,
  X,
  Send,
  ExternalLink,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { actionCreateSupportTicketResult } from "@/app/support/actions";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
} from "@/lib/support-constants";
import { cn } from "@/lib/utils";

/**
 * Global floating help chat — platform (ForgeRP) only.
 * Submits via server action result (no full-page redirect) so the landing
 * page stays put and the bubble can show success/error in place.
 */
export function SupportBubble({
  isAdmin = false,
  signedIn = false,
  badge = 0,
  source = "APP",
}: {
  isAdmin?: boolean;
  signedIn?: boolean;
  badge?: number;
  source?: "LANDING" | "MARKETING" | "APP";
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    number: string;
    href: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      // Ignore while submitting so a late mousedown can't kill the form
      if (pending) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const t = window.setTimeout(
      () => document.addEventListener("mousedown", onPointer),
      0
    );
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, pending]);

  function handleOpen() {
    setOpen(true);
    setError(null);
    // Keep success if they re-open so they can still copy the link
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const result = await actionCreateSupportTicketResult(fd);
      if (!result.ok) {
        setError(result.error);
        setSuccess(null);
        return;
      }
      setSuccess({ number: result.number, href: result.href });
      setError(null);
      form.reset();
    });
  }

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
                Chat with ForgeRP
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {signedIn
                  ? "Opens a ticket for the ForgeRP team."
                  : "Ask a question — we'll reply in this thread."}
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
            {success ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3">
                  <CheckCircle2
                    className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400"
                    aria-hidden
                  />
                  <div>
                    <p className="text-sm font-semibold text-emerald-200">
                      Ticket {success.number} opened
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      Bookmark the conversation link so you can check replies
                      later. We&rsquo;ll answer in that thread.
                    </p>
                  </div>
                </div>
                <Link
                  href={success.href}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-400"
                >
                  Open conversation
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </Link>
                <button
                  type="button"
                  onClick={() => setSuccess(null)}
                  className="w-full text-center text-xs text-slate-500 hover:text-slate-300"
                >
                  Start another chat
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <input type="hidden" name="source" value={source} />
                {!signedIn && (
                  <>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-400">
                        Your name
                      </label>
                      <input
                        name="name"
                        required
                        maxLength={120}
                        placeholder="Jane Smith"
                        className={fieldClass}
                        disabled={pending}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-400">
                        Work email
                      </label>
                      <input
                        name="email"
                        type="email"
                        required
                        maxLength={200}
                        placeholder="you@company.com"
                        className={fieldClass}
                        disabled={pending}
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-400">
                    Subject
                  </label>
                  <input
                    name="subject"
                    required
                    maxLength={200}
                    placeholder="What's going on?"
                    className={fieldClass}
                    disabled={pending}
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
                      className={selectClass}
                      disabled={pending}
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
                      className={selectClass}
                      disabled={pending}
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
                    disabled={pending}
                    className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:opacity-60"
                  />
                </div>

                {error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-60"
                >
                  {pending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" aria-hidden />
                      Start chat
                    </>
                  )}
                </button>
              </form>
            )}

            {signedIn && !success && (
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
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => (open ? setOpen(false) : handleOpen())}
        aria-expanded={open}
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

const fieldClass =
  "flex h-9 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:opacity-60";

const selectClass =
  "flex h-9 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-2 text-xs text-slate-100 disabled:opacity-60";
