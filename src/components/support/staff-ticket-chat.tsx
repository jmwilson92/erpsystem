"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Send, UserRound, RefreshCw } from "lucide-react";
import {
  actionFetchSupportThread,
  actionPostSupportMessageResult,
  type SupportThreadMessage,
} from "@/app/support/actions";
import { cn } from "@/lib/utils";

const POLL_MS = 2500;

type InitialMessage = {
  id: string;
  body: string;
  isStaff: boolean;
  createdAt: Date | string;
  author: { id: string; name: string } | null;
};

/**
 * Live staff chat panel: shows who you're writing to, polls for customer
 * replies so you don't need a full page refresh.
 */
export function StaffTicketChat({
  ticketId,
  contactName,
  contactEmail,
  closed: initiallyClosed,
  currentUserId,
  initialMessages,
}: {
  ticketId: string;
  contactName: string;
  contactEmail: string;
  closed: boolean;
  currentUserId: string;
  initialMessages: InitialMessage[];
}) {
  const [messages, setMessages] = useState<SupportThreadMessage[]>(() =>
    initialMessages.map((m) => ({
      id: m.id,
      body: m.body,
      isStaff: m.isStaff,
      createdAt:
        typeof m.createdAt === "string"
          ? m.createdAt
          : m.createdAt.toISOString(),
      authorName: m.author?.name || (m.isStaff ? "Support staff" : contactName),
    }))
  );
  const [closed, setClosed] = useState(initiallyClosed);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const result = await actionFetchSupportThread({ ticketId });
    if (!result.ok) return;
    setMessages(result.messages);
    setClosed(result.closed);
    setLastPoll(new Date());
  }, [ticketId]);

  // Poll for customer replies
  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Scroll to latest when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim() || closed) return;
    setError(null);
    const body = reply.trim();
    const fd = new FormData();
    fd.set("ticketId", ticketId);
    fd.set("body", body);
    fd.set("fromAdmin", "1");
    startTransition(async () => {
      const result = await actionPostSupportMessageResult(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessages(result.messages);
      setReply("");
      setLastPoll(new Date());
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Who you're writing to */}
      <div className="flex items-start gap-3 rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-500/20 text-teal-300">
          <UserRound className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-400/90">
            Writing to
          </p>
          <p className="truncate text-sm font-semibold text-slate-50">
            {contactName}
          </p>
          {contactEmail && (
            <p className="truncate text-xs text-slate-400">{contactEmail}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:border-slate-500 hover:text-slate-200"
          title="Refresh conversation"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          Refresh
          {lastPoll && (
            <span className="text-slate-600">
              {lastPoll.toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
        </button>
      </div>

      {/* Thread */}
      <div
        ref={scrollerRef}
        className="max-h-[28rem] min-h-[12rem] space-y-3 overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-950/40 p-4"
      >
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No messages yet.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.isStaff;
            return (
              <div
                key={m.id}
                className={cn(
                  "flex flex-col gap-1",
                  mine ? "items-end" : "items-start"
                )}
              >
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="font-medium text-slate-400">
                    {m.authorName}
                  </span>
                  {m.isStaff && (
                    <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
                      Staff
                    </span>
                  )}
                  <time dateTime={m.createdAt}>{formatWhen(m.createdAt)}</time>
                </div>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    mine
                      ? "rounded-br-md bg-teal-600/90 text-white"
                      : "rounded-bl-md border border-slate-700 bg-slate-900/90 text-slate-100"
                  )}
                >
                  {m.body}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
        >
          {error}
        </p>
      )}

      {/* Composer — clearly labeled who it goes to */}
      {closed ? (
        <p className="text-sm text-slate-500">
          Ticket is closed. Re-open from ticket settings if needed.
        </p>
      ) : (
        <form
          onSubmit={handleSend}
          className="space-y-2 rounded-xl border border-slate-700 bg-slate-900/50 p-3"
        >
          <label className="block text-xs font-medium text-slate-300">
            Message to{" "}
            <span className="text-teal-300">{contactName}</span>
            {contactEmail ? (
              <span className="font-normal text-slate-500">
                {" "}
                · {contactEmail}
              </span>
            ) : null}
          </label>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            required
            rows={3}
            disabled={pending}
            placeholder={`Write your reply to ${contactName}…`}
            className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              Live updates every few seconds — no need to refresh the page.
            </p>
            <button
              type="submit"
              disabled={pending || !reply.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-50"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
              Send to {contactName.split(" ")[0]}
            </button>
          </div>
        </form>
      )}
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
