"use client";

/**
 * Floating help chat (ERP + marketing).
 *
 * Tabs (ERP only):
 *   AI  — Carina text + enable site-wide voice
 *   Support — human ticket thread (same as before)
 *
 * Landing / marketing / login: Support tab only (no AI).
 * Demo sessions: AI allowed but rate-limited server-side.
 */
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
  Plus,
  CheckCheck,
  Languages,
  Bot,
  Mic,
  MicOff,
} from "lucide-react";
import {
  actionCreateSupportTicketResult,
  actionFetchSupportThread,
  actionPostSupportMessageResult,
  actionSupportTyping,
  actionTranslateText,
  type SupportThreadMessage,
} from "@/app/support/actions";
import { actionAiConversation } from "@/app/ai/actions";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
} from "@/lib/support-constants";
import {
  DEFAULT_LANG,
  loadStoredLang,
  resolveLang,
  storeLang,
  type CarinaLang,
} from "@/lib/carina-language";
import {
  enableCarinaVoiceEvent,
  persistWantListen,
  readWantListen,
  stopCarinaVoiceEvent,
  carinaPointEvent,
} from "@/lib/carina-voice-bus";
import { cn } from "@/lib/utils";

const AUTO_OPEN_MS = 5000;
const SESSION_KEY = "forge-support-auto-opened";
const THREAD_KEY = "forge-support-active-thread";
const GUEST_AI_KEY = "forge-carina-guest-id";
const POLL_MS = 2000;

type Tab = "ai" | "support";

type ActiveThread = {
  kind: "guest" | "user";
  id: string;
  number: string;
  token?: string;
};

type CarinaMsg = { role: "user" | "assistant"; content: string };

function guestAiKey(): string {
  try {
    let id = localStorage.getItem(GUEST_AI_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `g-${Date.now()}`;
      localStorage.setItem(GUEST_AI_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

export function SupportBubble({
  accountLinked = false,
  showStaffLink = false,
  badge = 0,
  source = "APP",
  defaultName = "",
  defaultEmail = "",
  autoOpen = true,
  /** Show Carina AI tab — only inside the ERP shell */
  enableAi = false,
}: {
  accountLinked?: boolean;
  showStaffLink?: boolean;
  badge?: number;
  source?: "LANDING" | "MARKETING" | "APP" | "DEMO" | "TENANT";
  defaultName?: string;
  defaultEmail?: string;
  autoOpen?: boolean;
  enableAi?: boolean;
}) {
  const aiAllowed = enableAi;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(aiAllowed ? "ai" : "support");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveThread | null>(null);
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState("");
  const [closed, setClosed] = useState(false);
  const [messages, setMessages] = useState<SupportThreadMessage[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);
  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();
  const [loadingThread, setLoadingThread] = useState(false);
  const [lang, setLang] = useState("English");
  const [translated, setTranslated] = useState<Record<string, string>>({});
  const [carinaMsgs, setCarinaMsgs] = useState<CarinaMsg[]>([
    {
      role: "assistant",
      content:
        "Hi — I'm Carina. I help with Protessera (production, quality, purchasing, inventory…). Ask in the chat, or enable voice and say my name from any page.",
    },
  ]);
  const [carinaInput, setCarinaInput] = useState("");
  const [carinaLang, setCarinaLang] = useState<CarinaLang>(DEFAULT_LANG);
  const [voiceOn, setVoiceOn] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const carinaPendingRef = useRef<{
    action: string;
    partial: Record<string, string>;
    phase?: "clarify" | "confirm";
  } | null>(null);
  const carinaBusyRef = useRef(false);
  const titleId = useId();
  const needContact = !accountLinked;

  useEffect(() => {
    setCarinaLang(loadStoredLang());
    setVoiceOn(readWantListen());
    const onListen = (e: Event) => {
      setVoiceOn(!!(e as CustomEvent).detail?.listening);
    };
    window.addEventListener("forge:carina-listen-changed", onListen);
    return () =>
      window.removeEventListener("forge:carina-listen-changed", onListen);
  }, []);

  // Force support-only outside ERP
  useEffect(() => {
    if (!aiAllowed && tab === "ai") setTab("support");
  }, [aiAllowed, tab]);

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
      setTab("support");
      setSubject(result.subject);
      setStatus(result.status);
      setClosed(result.closed);
      setMessages(result.messages);
      setPeerTyping(result.peerTyping);
      persistThread({
        ...t,
        number: result.number,
        token: result.guestToken || t.token,
      });
    },
    [persistThread]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(THREAD_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ActiveThread;
      if (parsed?.id) void loadThread(parsed);
    } catch {
      // ignore
    }
  }, [loadThread]);

  useEffect(() => {
    if (!autoOpen) return;
    try {
      if (sessionStorage.getItem(SESSION_KEY) === "1") return;
    } catch {
      // private mode
    }
    const t = window.setTimeout(() => {
      setOpen(true);
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // ignore
      }
    }, AUTO_OPEN_MS);
    return () => window.clearTimeout(t);
  }, [autoOpen]);

  useEffect(() => {
    if (!open || !active || tab !== "support") return;
    const tick = () => {
      void actionFetchSupportThread({
        ticketId: active.id,
        guestToken: active.token || null,
      }).then((result) => {
        if (!result.ok) return;
        setMessages(result.messages);
        setStatus(result.status);
        setClosed(result.closed);
        setPeerTyping(result.peerTyping);
      });
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [open, active, tab]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, carinaMsgs, open, tab, active]);

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
  }

  function startNewChat() {
    setActive(null);
    setMessages([]);
    setSubject("");
    setStatus("");
    setClosed(false);
    setReply("");
    setError(null);
    setTab("support");
    persistThread(null);
  }

  function toggleVoice() {
    if (voiceOn) {
      setVoiceOn(false);
      persistWantListen(false);
      window.dispatchEvent(stopCarinaVoiceEvent());
      setCarinaMsgs((m) => [
        ...m,
        { role: "assistant", content: "Voice off. You can still type here." },
      ]);
    } else {
      setVoiceOn(true);
      window.dispatchEvent(enableCarinaVoiceEvent());
      setCarinaMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content:
            "Voice on site-wide. Say “Carina, …” from any ERP page. Say “Carina” while I talk to interrupt. Type here anytime.",
        },
      ]);
    }
  }

  function sendCarina(e: React.FormEvent) {
    e.preventDefault();
    const q = carinaInput.trim();
    if (!q || pending || carinaBusyRef.current) return;
    setCarinaInput("");
    setError(null);
    carinaBusyRef.current = true;
    const nextHistory: CarinaMsg[] = [
      ...carinaMsgs.filter((m) => m.content?.trim()),
      { role: "user" as const, content: q },
    ].slice(-12);
    setCarinaMsgs(nextHistory);
    startTransition(async () => {
      try {
        const result = await actionAiConversation(nextHistory, {
          pendingAction: carinaPendingRef.current,
          language: carinaLang.code,
          source,
          guestKey: guestAiKey(),
        });
        if (!result.ok) {
          setError(result.error);
          setCarinaMsgs((m) => [
            ...m,
            { role: "assistant", content: result.error },
          ]);
          return;
        }
        carinaPendingRef.current = result.pendingAction ?? null;
        if (result.language) {
          const next = resolveLang(result.language);
          setCarinaLang(next);
          storeLang(next);
        }
        setCarinaMsgs((m) => [
          ...m,
          { role: "assistant", content: result.text },
        ]);
        if (result.href) {
          window.dispatchEvent(
            new CustomEvent("forge:carina-navigate", {
              detail: { href: result.href },
            })
          );
        }

        const { wantsPointOnly, bestPointAnchor } = await import(
          "@/lib/carina-catalog"
        );
        if (wantsPointOnly(q)) {
          const a = bestPointAnchor(q);
          const step = result.guide?.steps?.[0];
          const sel = a?.selector || step?.selector;
          if (sel) {
            window.dispatchEvent(
              carinaPointEvent({
                selector: sel,
                route: a?.route || step?.route,
                label: a?.label || step?.title || "Here",
                ms: 3200,
              })
            );
          }
        } else if (
          result.guide &&
          (result.guide.tourId ||
            (result.guide.steps && result.guide.steps.length))
        ) {
          const { startCarinaGuideEvent } = await import(
            "@/components/guides/guided-tour"
          );
          window.dispatchEvent(
            startCarinaGuideEvent({
              tourId: result.guide.tourId,
              steps: result.guide.steps,
              autoAdvance: true,
              voice: true,
            })
          );
        }
      } finally {
        carinaBusyRef.current = false;
      }
    });
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
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

  function onCustomerReplyChange(value: string) {
    setReply(value);
    if (!active) return;
    if (typingTimer.current) clearTimeout(typingTimer.current);
    void actionSupportTyping({
      ticketId: active.id,
      who: "customer",
      guestToken: active.token || null,
    });
    typingTimer.current = setTimeout(() => undefined, 1500);
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

  function translateMsg(id: string, text: string) {
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

  const inSupportThread = !!active;

  return (
    <div
      ref={panelRef}
      data-help-bubble
      className="pointer-events-none fixed bottom-5 right-5 z-[200] flex flex-col items-end gap-3"
    >
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="pointer-events-auto flex h-[min(70vh,32rem)] w-[min(100vw-2rem,22rem)] flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950 shadow-2xl shadow-black/50"
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-gradient-to-r from-teal-600/20 to-sky-600/10 px-3 py-2.5">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="flex items-center gap-2 text-sm font-semibold text-slate-50"
              >
                <MessageCircle className="h-4 w-4 text-teal-400" />
                Help
              </h2>
              <p className="truncate text-[10px] text-slate-500">
                {tab === "ai"
                  ? `Carina · ${carinaLang.name}${voiceOn ? " · voice on" : ""}`
                  : inSupportThread
                    ? active!.number
                    : "Message our team"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs */}
          {aiAllowed ? (
            <div className="flex shrink-0 border-b border-slate-800">
              <button
                type="button"
                onClick={() => setTab("ai")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-semibold",
                  tab === "ai"
                    ? "border-b-2 border-teal-400 text-teal-300"
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                <Bot className="h-3.5 w-3.5" />
                AI assistant
              </button>
              <button
                type="button"
                onClick={() => setTab("support")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-semibold",
                  tab === "support"
                    ? "border-b-2 border-violet-400 text-violet-300"
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                <LifeBuoy className="h-3.5 w-3.5" />
                Support
                {badge > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 text-[9px] text-slate-950">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </button>
            </div>
          ) : null}

          {/* ── AI chat ── */}
          {tab === "ai" && aiAllowed && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-2 border-b border-slate-800/80 px-3 py-1.5">
                <button
                  type="button"
                  onClick={toggleVoice}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold",
                    voiceOn
                      ? "bg-teal-500 text-slate-950"
                      : "border border-slate-600 text-slate-300 hover:border-teal-500/50"
                  )}
                >
                  {voiceOn ? (
                    <Mic className="h-3 w-3" />
                  ) : (
                    <MicOff className="h-3 w-3" />
                  )}
                  {voiceOn ? "Voice on" : "Voice"}
                </button>
                <Link
                  href="/ai"
                  onClick={() => setOpen(false)}
                  className="text-[10px] text-teal-400 hover:underline"
                >
                  Settings
                </Link>
                <span className="ml-auto text-[10px] text-slate-600">
                  ERP only
                </span>
              </div>
              <div
                ref={scrollerRef}
                className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
              >
                {carinaMsgs.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex flex-col gap-0.5",
                      m.role === "assistant" ? "items-start" : "items-end"
                    )}
                  >
                    <span className="text-[10px] text-slate-500">
                      {m.role === "assistant" ? "Carina" : "You"}
                    </span>
                    <div
                      className={cn(
                        "max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
                        m.role === "assistant"
                          ? "rounded-bl-md border border-teal-500/25 bg-teal-500/10 text-slate-100"
                          : "rounded-br-md bg-slate-700 text-slate-50"
                      )}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>
              {error && tab === "ai" && (
                <p className="mx-3 mb-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
                  {error}
                </p>
              )}
              <form
                onSubmit={sendCarina}
                data-no-loading="true"
                className="flex shrink-0 gap-2 border-t border-slate-800 p-2.5"
              >
                <input
                  value={carinaInput}
                  onChange={(e) => setCarinaInput(e.target.value)}
                  placeholder="Message Carina…"
                  disabled={pending}
                  className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
                />
                <button
                  type="submit"
                  disabled={pending || !carinaInput.trim()}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500 text-slate-950 hover:bg-teal-400 disabled:opacity-50"
                  aria-label="Send"
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ── Support chat ── */}
          {tab === "support" && (
            <div className="flex min-h-0 flex-1 flex-col">
              {inSupportThread ? (
                <>
                  <div className="flex shrink-0 items-center justify-between border-b border-slate-800/80 px-3 py-1.5 text-[10px] text-slate-500">
                    <span className="truncate font-medium text-slate-400">
                      {subject || "Ticket"}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="uppercase tracking-wide">
                        {(status || "").replace(/_/g, " ")}
                      </span>
                      <button
                        type="button"
                        onClick={startNewChat}
                        className="rounded p-1 hover:bg-slate-800"
                        title="New ticket"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 border-b border-slate-800/60 px-3 py-1">
                    <Languages className="h-3 w-3 text-slate-500" />
                    <select
                      value={lang}
                      onChange={(e) => setLang(e.target.value)}
                      className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-400"
                    >
                      {[
                        "English",
                        "Spanish",
                        "French",
                        "German",
                        "Portuguese",
                        "Chinese",
                        "Japanese",
                      ].map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div
                    ref={scrollerRef}
                    className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
                  >
                    {loadingThread && messages.length === 0 ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
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
                            {translated[m.id] || m.body}
                          </div>
                          <div className="flex gap-2 text-[10px] text-slate-500">
                            {!m.isStaff && m.readAt && (
                              <span className="inline-flex items-center gap-0.5 text-sky-400/90">
                                <CheckCheck className="h-3 w-3" /> Read
                              </span>
                            )}
                            {!translated[m.id] && (
                              <button
                                type="button"
                                className="hover:text-teal-400"
                                onClick={() => translateMsg(m.id, m.body)}
                              >
                                Translate
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                    {peerTyping && (
                      <div className="text-xs text-violet-300">
                        Support is typing…
                      </div>
                    )}
                  </div>
                  {error && (
                    <p className="mx-3 mb-1 text-[11px] text-red-300">{error}</p>
                  )}
                  {closed ? (
                    <p className="border-t border-slate-800 px-3 py-2 text-xs text-slate-500">
                      Ticket closed.{" "}
                      <button
                        type="button"
                        onClick={startNewChat}
                        className="text-teal-400 hover:underline"
                      >
                        New chat
                      </button>
                    </p>
                  ) : (
                    <form
                      onSubmit={handleReply}
                      data-no-loading="true"
                      className="flex shrink-0 gap-2 border-t border-slate-800 p-2.5"
                    >
                      <input
                        value={reply}
                        onChange={(e) => onCustomerReplyChange(e.target.value)}
                        placeholder="Reply to support…"
                        disabled={pending}
                        className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
                      />
                      <button
                        type="submit"
                        disabled={pending || !reply.trim()}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-50"
                      >
                        {pending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </button>
                    </form>
                  )}
                </>
              ) : (
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                  <p className="text-xs text-slate-400">
                    Reach a human on our support desk. We reply in this chat.
                  </p>
                  <form
                    onSubmit={handleCreate}
                    data-no-loading="true"
                    className="space-y-2.5"
                  >
                    <input type="hidden" name="source" value={source} />
                    {needContact && (
                      <>
                        <input
                          name="name"
                          required
                          maxLength={120}
                          defaultValue={defaultName}
                          placeholder="Your name"
                          className={fieldClass}
                          disabled={pending}
                        />
                        <input
                          name="email"
                          type="email"
                          required
                          maxLength={200}
                          defaultValue={defaultEmail}
                          placeholder="Work email"
                          className={fieldClass}
                          disabled={pending}
                        />
                      </>
                    )}
                    <input
                      name="subject"
                      required
                      maxLength={200}
                      placeholder="Subject"
                      className={fieldClass}
                      disabled={pending}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        name="category"
                        className={fieldClass}
                        defaultValue="GENERAL"
                        disabled={pending}
                      >
                        {SUPPORT_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                      <select
                        name="priority"
                        className={fieldClass}
                        defaultValue="NORMAL"
                        disabled={pending}
                      >
                        {SUPPORT_PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      name="body"
                      required
                      rows={3}
                      placeholder="How can we help?"
                      className={fieldClass}
                      disabled={pending}
                    />
                    {error && (
                      <p className="text-[11px] text-red-300">{error}</p>
                    )}
                    <button
                      type="submit"
                      disabled={pending}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 py-2.5 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-60"
                    >
                      {pending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Start support chat
                    </button>
                  </form>
                  {accountLinked && (
                    <Link
                      href="/support"
                      onClick={() => setOpen(false)}
                      className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-teal-300"
                    >
                      <MessagesSquare className="h-3.5 w-3.5" />
                      My tickets
                      <ExternalLink className="h-3 w-3 opacity-50" />
                    </Link>
                  )}
                  {showStaffLink && (
                    <Link
                      href="/admin/support"
                      onClick={() => setOpen(false)}
                      className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-violet-300"
                    >
                      <LifeBuoy className="h-3.5 w-3.5" />
                      Staff desk
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
        aria-label={open ? "Close help" : "Open help"}
        className={cn(
          "pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full shadow-lg shadow-teal-950/40 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
          open
            ? "bg-slate-800 text-slate-100 ring-1 ring-slate-600"
            : "bg-gradient-to-br from-teal-400 to-cyan-600 text-white"
        )}
      >
        {open ? (
          <X className="h-6 w-6" />
        ) : (
          <MessageCircle className="h-6 w-6" />
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

const fieldClass =
  "w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:opacity-60";

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
