"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Loader2,
  Send,
  UserRound,
  RefreshCw,
  Languages,
  CheckCheck,
} from "lucide-react";
import {
  actionFetchSupportThread,
  actionPostSupportMessageResult,
  actionSupportTyping,
  actionTranslateText,
  type SupportThreadMessage,
} from "@/app/support/actions";
import { cn } from "@/lib/utils";

const POLL_MS = 2000;

type InitialMessage = {
  id: string;
  body: string;
  isStaff: boolean;
  createdAt: Date | string;
  readAt?: Date | string | null;
  author: { id: string; name: string } | null;
};

export function StaffTicketChat({
  ticketId,
  contactName,
  contactEmail,
  closed: initiallyClosed,
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
      readAt: m.readAt
        ? typeof m.readAt === "string"
          ? m.readAt
          : m.readAt.toISOString()
        : null,
      authorName: m.author?.name || (m.isStaff ? "Support staff" : contactName),
    }))
  );
  const [closed, setClosed] = useState(initiallyClosed);
  const [peerTyping, setPeerTyping] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [lang, setLang] = useState("English");
  const [translated, setTranslated] = useState<Record<string, string>>({});
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const result = await actionFetchSupportThread({ ticketId });
    if (!result.ok) return;
    setMessages(result.messages);
    setClosed(result.closed);
    setPeerTyping(result.peerTyping);
    setLastPoll(new Date());
  }, [ticketId]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, peerTyping]);

  function onReplyChange(value: string) {
    setReply(value);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    void actionSupportTyping({ ticketId, who: "staff" });
    typingTimer.current = setTimeout(() => {
      // heartbeat ends naturally via TTL
    }, 1500);
  }

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
      void refresh();
    });
  }

  function translateOne(id: string, text: string) {
    startTransition(async () => {
      const result = await actionTranslateText({
        text,
        targetLanguage: lang,
      });
      if (result.ok) {
        setTranslated((t) => ({ ...t, [id]: result.text }));
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
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
        <div className="ml-auto flex flex-col items-end gap-1">
          <label className="flex items-center gap-1 text-[11px] text-slate-500">
            <Languages className="h-3 w-3" />
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px] text-slate-300"
            >
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:border-slate-500 hover:text-slate-200"
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
      </div>

      <div className="max-h-[28rem] min-h-[12rem] space-y-3 overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
        {messages.map((m) => {
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
                <span className="font-medium text-slate-400">{m.authorName}</span>
                {m.isStaff && (
                  <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-300">
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
                {translated[m.id] || m.body}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                {mine && m.readAt && (
                  <span className="inline-flex items-center gap-0.5 text-sky-400/90">
                    <CheckCheck className="h-3 w-3" /> Read
                  </span>
                )}
                {!translated[m.id] && (
                  <button
                    type="button"
                    className="hover:text-teal-400"
                    onClick={() => translateOne(m.id, m.body)}
                  >
                    Translate → {lang}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {peerTyping && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="inline-flex gap-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400 [animation-delay:300ms]" />
            </span>
            {contactName} is typing…
          </div>
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
            Message to <span className="text-teal-300">{contactName}</span>
            {contactEmail ? (
              <span className="font-normal text-slate-500">
                {" "}
                · {contactEmail}
              </span>
            ) : null}
          </label>
          <textarea
            value={reply}
            onChange={(e) => onReplyChange(e.target.value)}
            required
            rows={3}
            disabled={pending}
            placeholder={`Write your reply to ${contactName}…`}
            className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              Live updates ~2s · typing indicator on · read receipts when they open the chat
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

const LANGS = [
  "English",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Chinese",
  "Japanese",
  "Korean",
  "Arabic",
  "Hindi",
];

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
