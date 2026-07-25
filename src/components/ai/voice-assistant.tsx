"use client";

/**
 * Always-on voice assistant with a customizable wake word.
 * Uses browser SpeechRecognition for listen + wake-word match, Grok for
 * answers (XAI_API_KEY), and /api/tts or speechSynthesis for replies.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Bot, Mic, MicOff, Volume2 } from "lucide-react";
import {
  actionAiConversation,
  actionGetAssistantName,
  actionGrokStatus,
  actionSetAssistantName,
} from "@/app/ai/actions";
import { cn } from "@/lib/utils";

const NAME_KEY = "forge-assistant-name";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  results: { [i: number]: { [j: number]: { transcript: string }; isFinal?: boolean }; length: number };
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

async function speak(text: string) {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 1500) }),
    });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
      return;
    }
  } catch {
    // fall through
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(u);
  }
}

export function VoiceAssistant({
  compact = false,
}: {
  /** Compact floating control for app shell */
  compact?: boolean;
}) {
  const [name, setName] = useState("Forge");
  const [nameDraft, setNameDraft] = useState("Forge");
  const [listening, setListening] = useState(false);
  const [awake, setAwake] = useState(false);
  const [status, setStatus] = useState("Off");
  const [lastHeard, setLastHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [grokOn, setGrokOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>(
    []
  );
  const awakeRef = useRef(false);
  const nameRef = useRef(name);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    awakeRef.current = awake;
  }, [awake]);

  useEffect(() => {
    void actionGrokStatus().then((s) => setGrokOn(s.configured));
    void actionGetAssistantName().then((n) => {
      setName(n);
      setNameDraft(n);
      try {
        const local = localStorage.getItem(NAME_KEY);
        if (local) {
          setName(local);
          setNameDraft(local);
        }
      } catch {
        // ignore
      }
    });
  }, []);

  const handleUtterance = useCallback(
    (transcript: string) => {
      const text = transcript.trim();
      if (!text) return;
      setLastHeard(text);
      setStatus("Thinking…");
      setAwake(false);
      awakeRef.current = false;
      historyRef.current = [
        ...historyRef.current.slice(-8),
        { role: "user", content: text },
      ];
      startTransition(async () => {
        try {
          const reply = await actionAiConversation(historyRef.current);
          historyRef.current = [
            ...historyRef.current,
            { role: "assistant", content: reply },
          ];
          setLastReply(reply);
          setStatus("Speaking…");
          await speak(reply);
          setStatus(listening ? `Listening for “${nameRef.current}”…` : "Off");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Assistant failed");
          setStatus("Error");
        }
      });
    },
    [listening]
  );

  const startListening = useCallback(async () => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError(
        "Voice recognition isn't supported in this browser. Use Chrome or Edge on https://www.forge-rp.live (not a random preview URL)."
      );
      return;
    }

    // Explicit mic prompt first — clearer than SpeechRecognition alone
    try {
      if (!window.isSecureContext) {
        setError(
          "Microphone needs HTTPS. Open https://www.forge-rp.live (secure site)."
        );
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // We only needed permission; SpeechRecognition opens its own stream
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        `Microphone blocked. In Chrome: click the lock icon left of the URL → Site settings → Microphone → Allow, then reload. (${msg})`
      );
      setListening(false);
      return;
    }

    try {
      recRef.current?.abort();
    } catch {
      // ignore
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (ev) => {
      let final = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0]?.transcript || "";
        if (r.isFinal !== false) final += t + " ";
      }
      const heard = final.trim() || "";
      if (!heard) return;
      const wake = nameRef.current.toLowerCase();
      const lower = heard.toLowerCase();

      if (!awakeRef.current) {
        if (lower.includes(wake)) {
          setAwake(true);
          awakeRef.current = true;
          setStatus("Yes? Listening…");
          const after = heard
            .replace(new RegExp(wake.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "")
            .replace(/^[,.\s]+/, "")
            .trim();
          if (after.length > 2) {
            handleUtterance(after);
          }
        }
        return;
      }
      if (heard.length > 2) {
        handleUtterance(heard);
      }
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed") {
        setError(
          "Microphone permission denied. Lock icon next to URL → Microphone → Allow → reload."
        );
        setListening(false);
      } else if (ev.error === "aborted") {
        // ignore intentional stop
      } else if (ev.error !== "no-speech") {
        setError(`Mic error: ${ev.error}`);
      }
    };
    rec.onend = () => {
      if (recRef.current === rec) {
        try {
          rec.start();
        } catch {
          // ignore double-start
        }
      }
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
      setStatus(`Listening for “${nameRef.current}”…`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start mic");
    }
  }, [handleUtterance]);

  const stopListening = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    try {
      rec?.abort();
    } catch {
      // ignore
    }
    setListening(false);
    setAwake(false);
    setStatus("Off");
  }, []);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        // ignore
      }
    };
  }, []);

  function saveName() {
    startTransition(async () => {
      try {
        const saved = await actionSetAssistantName(nameDraft);
        setName(saved);
        try {
          localStorage.setItem(NAME_KEY, saved);
        } catch {
          // ignore
        }
        setStatus(
          listening ? `Listening for “${saved}”…` : `Named “${saved}”`
        );
        setError(null);
      } catch (e) {
        // Still keep local name for wake word
        const clean = nameDraft.trim() || "Forge";
        setName(clean);
        try {
          localStorage.setItem(NAME_KEY, clean);
        } catch {
          // ignore
        }
        setError(
          e instanceof Error
            ? e.message
            : "Saved locally only (DB column may need migration)"
        );
      }
    });
  }

  if (compact) {
    return (
      <div className="pointer-events-none fixed bottom-5 left-5 z-40">
        <button
          type="button"
          onClick={() => (listening ? stopListening() : startListening())}
          className={cn(
            "pointer-events-auto flex h-12 items-center gap-2 rounded-full border px-3 shadow-lg transition-colors",
            listening
              ? awake
                ? "border-teal-400 bg-teal-500 text-slate-950"
                : "border-violet-500/50 bg-violet-500/20 text-violet-100"
              : "border-slate-700 bg-slate-900/90 text-slate-300 hover:border-slate-500"
          )}
          title={
            listening
              ? `Voice on — say “${name}”`
              : `Enable voice assistant (wake word: ${name})`
          }
        >
          {listening ? (
            <Mic className="h-4 w-4" />
          ) : (
            <MicOff className="h-4 w-4" />
          )}
          <span className="text-xs font-medium">{name}</span>
          {pending && <LoaderDots />}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15 text-teal-400">
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-50">
            Voice assistant
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Name your assistant — say that name anytime to wake it. Powered by
            Grok when <code className="text-teal-400">XAI_API_KEY</code> is set
            {grokOn ? " (connected)" : " (not configured yet)"}.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <label className="mb-1 block text-[11px] font-medium text-slate-400">
            Assistant name (wake word)
          </label>
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={32}
            placeholder="e.g. Atlas, Nova, Forge"
            className="flex h-9 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 text-sm text-slate-100"
          />
        </div>
        <button
          type="button"
          onClick={saveName}
          disabled={pending}
          className="h-9 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 hover:border-teal-500/50"
        >
          Save name
        </button>
        <button
          type="button"
          onClick={() => (listening ? stopListening() : startListening())}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium",
            listening
              ? "bg-teal-500 text-slate-950"
              : "bg-slate-800 text-slate-100 hover:bg-slate-700"
          )}
        >
          {listening ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          {listening ? "Listening" : "Enable mic"}
        </button>
      </div>

      <p className="text-xs text-slate-400">
        Status: <span className="text-slate-200">{status}</span>
        {awake && (
          <span className="ml-2 rounded bg-teal-500/20 px-1.5 py-0.5 text-teal-300">
            Awake
          </span>
        )}
      </p>

      {lastHeard && (
        <p className="text-xs text-slate-500">
          You: <span className="text-slate-300">{lastHeard}</span>
        </p>
      )}
      {lastReply && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-200">
          <Volume2 className="mb-1 h-3.5 w-3.5 text-teal-400" />
          {lastReply}
        </div>
      )}
      {error && (
        <p className="text-xs text-amber-300">{error}</p>
      )}
      <p className="text-[11px] text-slate-600">
        Tip: Chrome or Edge work best. Allow microphone access. Say “{name},
        how is the production floor?” as a full phrase or “{name}” then your
        question.
      </p>
    </div>
  );
}

function LoaderDots() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
    </span>
  );
}
