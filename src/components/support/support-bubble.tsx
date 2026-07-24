"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import {
  LifeBuoy,
  MessageCircle,
  MessagesSquare,
  X,
  Send,
  ExternalLink,
  Loader2,
  Sparkles,
  Plus,
} from "lucide-react";
import {
  actionCreateSupportTicketResult,
  actionFetchSupportThread,
  actionPostSupportMessageResult,
  type SupportThreadMessage,
} from "@/app/support/actions";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
} from "@/lib/support-constants";
import { cn } from "@/lib/utils";

const AUTO_OPEN_MS = 4000;
const SESSION_KEY = "forge-support-auto-opened";
const THREAD_KEY = "forge-support-active-thread";
const POLL_MS = 8000;

type ActiveThread = {
  kind: "guest" | "user";
  id: string;
  number: string;
  token?: string;
};

/**
 * Floating help chat — full conversation stays in the bubble (no page jump).
 * Hidden only for ForgeRP platform staff (they use the admin support desk).
 */
export function SupportBubble({
  accountLinked = false,
  showStaffLink = false,
  badge = 0,
  source = "APP",
  defaultName = "",
  defaultEmail = "",
  autoOpen = true,
}: {
  accountLinked?: boolean;
  showStaffLink?: boolean;
  badge?: number;
  source?: "LANDING" | "MARKETING" | "APP" | "DEMO" | "TENANT";
  defaultName?: string;
  defaultEmail?: string;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [autoPrompt, setAutoPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveThread | null>(null);
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState("");
  const [closed, setClosed] = useState(false);
  const [messages, setMessages] = useState<SupportThreadMessage[]>([]);
  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();
  const [loadingThread, setLoadingThread] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const needContact = !accountLinked;

  const persistThread = useCallback((t: ActiveThread | null) => {
    try {
      if (t) localStorage.setItem(THREAD_KEY, JSON.stringify(t));
      else localStorage.removeItem(THREAD_KEY);
    } catch {
      // ignore
    }
  }, []);

  const loadThread = useCallback(
    async (t: ActiveThread) => {
      setLoadingThread(true);
      setError(null);
      const result = await actionFetchSupportThread({
        ticketId: t.id,
        guestToken: t.token || null,
      });
      setLoadingThread(false);
      if (!result.ok) {
        setError(result.error);
        setActive(null);
        persistThread(null);
        return;
      }
      setActive(t);
      setSubject(result.subject);
      setStatus(result.status);
      setClosed(result.closed);
      setMessages(result.messages);
      persistThread({
        ...t,
        number: result.number,
        token: result.guestToken || t.token,
      });
    },
    [persistThread]
  );

  // Restore last conversation from this browser
  useEffect(() => {
    try {
      const raw = localStorage.getItem(THREAD_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ActiveThread;
      if (parsed?.id) {
        void loadThread(parsed);
      }
    } catch {
      // ignore
    }
  }, [loadThread]);

  // Auto-open once per browser session after 4 seconds
  useEffect(() => {
    if (!autoOpen) return;
    try {
      if (sessionStorage.getItem(SESSION_KEY) === "1") return;
    } catch {
      // private mode
    }
    const t = window.setTimeout(() => {
      setOpen(true);
      setAutoPrompt(true);
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // ignore
      }
    }, AUTO_OPEN_MS);
    return () => window.clearTimeout(t);
  }, [autoOpen]);

  // Poll for staff replies while conversation is open
  useEffect(() => {
    if (!open || !active) return;
    const tick = () => {
      void actionFetchSupportThread({
        ticketId: active.id,
        guestToken: active.token || null,
      }).then((result) => {
        if (!result.ok) return;
        setMessages(result.messages);
        setStatus(result.status);
        setClosed(result.closed);
      });
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [open, active]);

  // Scroll to latest message
  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, open, active]);

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
    setAutoPrompt(false);
  }

  function startNewChat() {
    setActive(null);
    setMessages([]);
    setSubject("");
    setStatus("");
    setClosed(false);
    setReply("");
    setError(null);
    setAutoPrompt(false);
    persistThread(null);
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setAutoPrompt(false);
    const form = e.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const result = await actionCreateSupportTicketResult(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const thread: ActiveThread =
        result.kind === "guest"
          ? {
              kind: "guest",
              id: result.id,
              number: result.number,
              token: result.token,
            }
          : {
              kind: "user",
              id: result.id,
              number: result.number,
            };
      await loadThread(thread);
      form.reset();
    });
  }

  function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !reply.trim() || closed) return;
    setError(null);
    const body = reply.trim();
    const fd = new FormData();
    fd.set("ticketId", active.id);
    fd.set("body", body);
    if (active.token) fd.set("guestToken", active.token);
    startTransition(async () => {
      const result = await actionPostSupportMessageResult(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessages(result.messages);
      setReply("");
    });
  }

  const inConversation = !!active;

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
          className="pointer-events-auto flex max-h-[min(70vh,36rem)] w-[min(100vw-2rem,22rem)] flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950 shadow-2xl shadow-black/50"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-gradient-to-r from-teal-600/20 to-sky-600/10 px-4 py-3">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="flex items-center gap-2 text-sm font-semibold text-slate-50"
              >
                <MessageCircle className="h-4 w-4 text-teal-400" aria-hidden />
                {inConversation ? active.number : "Chat with ForgeRP"}
              </h2>
              <p className="mt-0.5 truncate text-[11px] text-slate-400">
                {inConversation
                  ? subject || "Conversation"
                  : "Ask a question — we reply right here."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {inConversation && (
                <button
                  type="button"
                  onClick={startNewChat}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  aria-label="Start a new chat"
                  title="New chat"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label="Close help chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── Conversation view ── */}
          {inConversation ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {status && (
                <div className="flex shrink-0 items-center justify-between border-b border-slate-800/80 px-4 py-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                  <span>{status.replace(/_/g, " ")}</span>
                  <span className="normal-case tracking-normal text-slate-600">
                    Updates every few seconds
                  </span>
                </div>
              )}

              <div
                ref={scrollerRef}
                className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3"
              >
                {loadingThread && messages.length === 0 ? (
                  <div className="flex justify-center py-8 text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "flex flex-col gap-0.5",
                        m.isStaff ? "items-start" : "items-end"
                      )}
                    >
                      <span className="text-[10px] text-slate-500">
                        {m.authorName}
                        {m.isStaff && (
                          <span className="ml-1 rounded bg-violet-500/20 px-1 text-[9px] font-semibold uppercase text-violet-300">
                            Staff
                          </span>
                        )}{" "}
                        · {formatWhen(m.createdAt)}
                      </span>
                      <div
                        className={cn(
                          "max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
                          m.isStaff
                            ? "rounded-bl-md border border-violet-500/30 bg-violet-500/10 text-slate-100"
                            : "rounded-br-md bg-teal-600/90 text-white"
                        )}
                      >
                        {m.body}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {error && (
                <p
                  role="alert"
                  className="mx-3 mb-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
                >
                  {error}
                </p>
              )}

              {closed ? (
                <p className="shrink-0 border-t border-slate-800 px-4 py-3 text-xs text-slate-500">
                  This ticket is closed.{" "}
                  <button
                    type="button"
                    onClick={startNewChat}
                    className="font-medium text-teal-400 hover:underline"
                  >
                    Start a new chat
                  </button>
                </p>
              ) : (
                <form
                  onSubmit={handleReply}
                  className="flex shrink-0 gap-2 border-t border-slate-800 p-3"
                >
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Type a reply…"
                    disabled={pending}
                    className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={pending || !reply.trim()}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500 text-slate-950 hover:bg-teal-400 disabled:opacity-50"
                    aria-label="Send reply"
                  >
                    {pending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </form>
              )}
            </div>
          ) : (
            /* ── New ticket form ── */
            <div className="space-y-3 overflow-y-auto p-4">
              {autoPrompt && (
                <div className="flex items-start gap-2 rounded-xl border border-teal-500/30 bg-teal-500/10 px-3 py-2.5">
                  <Sparkles
                    className="mt-0.5 h-4 w-4 shrink-0 text-teal-300"
                    aria-hidden
                  />
                  <p className="text-sm font-medium text-teal-100">
                    Have a question? Ask away!
                  </p>
                </div>
              )}

              <form onSubmit={handleCreate} className="space-y-3">
                <input type="hidden" name="source" value={source} />
                {needContact && (
                  <>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-400">
                        Your name
                      </label>
                      <input
                        name="name"
                        required
                        maxLength={120}
                        defaultValue={defaultName}
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
                        defaultValue={defaultEmail}
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

              {accountLinked && (
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
                  {showStaffLink && (
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
          )}
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
        {!open && (badge > 0 || active) && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-slate-950 ring-2 ring-slate-950">
            {badge > 0 ? (badge > 9 ? "9+" : badge) : "•"}
          </span>
        )}
      </button>
    </div>
  );
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

const fieldClass =
  "flex h-9 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:opacity-60";

const selectClass =
  "flex h-9 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-2 text-xs text-slate-100 disabled:opacity-60";
