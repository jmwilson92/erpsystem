"use client";

/**
 * Continuous voice assistant (Grok + Carina TTS).
 *
 * Flow after Enable mic once:
 *   1. Always listen for the wake name (default: Carina)
 *   2. Hear name → collect the question → Grok answers → she speaks
 *   3. While speaking, only saying the wake name interrupts
 *   4. After she finishes, stay "in conversation" so follow-ups work
 *      without the wake word for ~25s
 *
 * Hold-to-talk remains as a backup. "Test Grok + Carina" is debug only.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Bot, Mic, MicOff, Volume2, Radio } from "lucide-react";
import {
  actionAiConversation,
  actionGetAssistantName,
  actionGrokStatus,
  actionSetAssistantName,
  actionVoiceSmokeTest,
  actionProbeGrok,
} from "@/app/ai/actions";
import { cn } from "@/lib/utils";

const NAME_KEY = "forge-assistant-name";
const DEFAULT_NAME = "Carina";
const DEFAULT_VOICE_ID = "carina";
/** After a reply, accept follow-ups without the wake word */
const CONVO_MS = 25_000;
/** After last speech fragment, send the buffered question */
const SILENCE_MS = 1400;

type Mode = "off" | "wake" | "command" | "thinking" | "speaking";

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
  resultIndex: number;
  results: {
    [i: number]: { [j: number]: { transcript: string }; isFinal: boolean };
    length: number;
  };
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesWake(text: string, wake: string) {
  const w = wake.trim().toLowerCase();
  if (w.length < 2) return false;
  const t = text.toLowerCase();
  if (t.includes(w)) return true;
  const first = w.split(/\s+/)[0];
  return first.length >= 3 && new RegExp(`\\b${escapeRe(first)}\\b`, "i").test(t);
}

function stripWake(text: string, wake: string) {
  const w = wake.trim();
  if (!w) return text.trim();
  const first = w.split(/\s+/)[0];
  return text
    .replace(new RegExp(`\\b${escapeRe(w)}\\b[,.!?]?`, "ig"), " ")
    .replace(new RegExp(`\\b${escapeRe(first)}\\b[,.!?]?`, "ig"), " ")
    .replace(/^(hey|ok|okay|hi|hello|yo)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function VoiceAssistant({ compact = false }: { compact?: boolean }) {
  const [name, setName] = useState(DEFAULT_NAME);
  const [nameDraft, setNameDraft] = useState(DEFAULT_NAME);
  const [listening, setListening] = useState(false);
  const [mode, setMode] = useState<Mode>("off");
  const [status, setStatus] = useState("Off — enable mic once");
  const [partial, setPartial] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [grokOn, setGrokOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [ptt, setPtt] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>(
    []
  );
  const nameRef = useRef(name);
  const listeningRef = useRef(false);
  const modeRef = useRef<Mode>("off");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakGenRef = useRef(0);
  const commandBufRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const convoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAskRef = useRef("");
  const lastAskAtRef = useRef(0);
  const pttBufRef = useRef("");
  const pttRef = useRef(false);

  const setModeBoth = useCallback((m: Mode) => {
    modeRef.current = m;
    setMode(m);
  }, []);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);
  useEffect(() => {
    pttRef.current = ptt;
  }, [ptt]);

  useEffect(() => {
    void actionGrokStatus().then((s) => setGrokOn(s.configured));
    void actionGetAssistantName().then((n) => {
      // Prefer Carina if user never customized
      const resolved =
        n && n !== "Forge" ? n : localStorage.getItem(NAME_KEY) || DEFAULT_NAME;
      setName(resolved);
      setNameDraft(resolved);
    });
  }, []);

  const clearSilence = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const extendConvo = useCallback(() => {
    if (convoTimerRef.current) clearTimeout(convoTimerRef.current);
    convoTimerRef.current = setTimeout(() => {
      if (modeRef.current === "command" || modeRef.current === "wake") {
        setModeBoth("wake");
        if (listeningRef.current) {
          setStatus(`Listening for “${nameRef.current}”…`);
        }
      }
    }, CONVO_MS);
  }, [setModeBoth]);

  const stopSpeaking = useCallback(() => {
    speakGenRef.current += 1;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // ignore
    }
    const a = audioRef.current;
    if (a) {
      try {
        a.onended = null;
        a.onerror = null;
        a.pause();
        a.removeAttribute("src");
        a.load();
      } catch {
        // ignore
      }
      audioRef.current = null;
    }
  }, []);

  const speak = useCallback(
    async (text: string) => {
      stopSpeaking();
      const gen = speakGenRef.current;
      setModeBoth("speaking");
      setStatus("Speaking… (say name to interrupt)");

      const spoken = text
        .replace(/\*\*/g, "")
        .replace(/`+/g, "")
        .replace(/#{1,6}\s/g, "")
        .replace(/\|/g, " ")
        .replace(/\n{2,}/g, ". ")
        .replace(/\n/g, " ")
        .trim();

      const finish = () => {
        if (speakGenRef.current !== gen) return;
        setModeBoth("command");
        extendConvo();
        setStatus(
          listeningRef.current
            ? `Listening… (say “${nameRef.current}” or just ask)`
            : "Off"
        );
      };

      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: spoken.slice(0, 1800),
            voiceId: DEFAULT_VOICE_ID,
          }),
        });
        if (speakGenRef.current !== gen) return;
        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (speakGenRef.current !== gen) return;
          const blob = new Blob([buf], {
            type: res.headers.get("Content-Type") || "audio/mpeg",
          });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;
          await new Promise<void>((resolve) => {
            audio.onended = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            audio.onerror = () => {
              URL.revokeObjectURL(url);
              resolve();
            };
            void audio.play().catch(() => resolve());
          });
          finish();
          return;
        }
      } catch {
        // fallback
      }

      if (speakGenRef.current !== gen) return;
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(spoken);
          u.rate = 1.05;
          const voices = window.speechSynthesis.getVoices();
          const preferred =
            voices.find((v) =>
              /google|natural|neural|samantha|karen|moira/i.test(v.name)
            ) || voices.find((v) => v.lang.startsWith("en"));
          if (preferred) u.voice = preferred;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          window.speechSynthesis.speak(u);
        });
      }
      finish();
    },
    [extendConvo, setModeBoth, stopSpeaking]
  );

  const ask = useCallback(
    (raw: string) => {
      let text = raw.trim();
      if (!text) return;

      // de-dupe
      const now = Date.now();
      const key = text.toLowerCase();
      if (key === lastAskRef.current && now - lastAskAtRef.current < 2000) {
        return;
      }
      lastAskRef.current = key;
      lastAskAtRef.current = now;

      const wake = nameRef.current;
      if (includesWake(text, wake)) {
        const after = stripWake(text, wake);
        if (after.length < 2) {
          // Name alone while not speaking = "I'm here"
          setStatus(`Yes? I'm listening…`);
          setModeBoth("command");
          extendConvo();
          setPartial("");
          commandBufRef.current = "";
          return;
        }
        text = after;
      }

      if (text.length < 2) return;

      // Interrupt current speech
      if (modeRef.current === "speaking") {
        stopSpeaking();
      }

      clearSilence();
      commandBufRef.current = "";
      setPartial("");
      setLastHeard(text);
      setModeBoth("thinking");
      setStatus("Thinking…");
      setError(null);
      extendConvo();

      historyRef.current = [
        ...historyRef.current.slice(-8),
        { role: "user", content: text },
      ];

      startTransition(async () => {
        try {
          const result = await actionAiConversation(historyRef.current);
          if (!result.ok) {
            setError(result.error);
            setLastReply(result.error);
            setModeBoth("command");
            setStatus("Error — still listening for your name");
            await speak(
              "Sorry, I could not reach Grok. Please try again in a moment."
            );
            return;
          }
          historyRef.current = [
            ...historyRef.current,
            { role: "assistant", content: result.text },
          ];
          setLastReply(result.text);
          setError(null);
          await speak(result.text);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed";
          setError(msg);
          setLastReply(msg);
          setModeBoth("command");
          setStatus("Error — still listening");
        }
      });
    },
    [extendConvo, setModeBoth, speak, stopSpeaking]
  );

  /** Buffer speech after wake / in conversation; fire after silence. */
  const onSpeechFragment = useCallback(
    (finalText: string, interimText: string) => {
      const wake = nameRef.current;
      const mode = modeRef.current;
      const heard = (finalText || interimText).trim();
      if (!heard) return;

      // ── SPEAKING: only wake name interrupts ──
      if (mode === "speaking") {
        if (!includesWake(heard, wake)) return;
        // Need a clear name token
        if (!includesWake(finalText || interimText, wake)) return;
        stopSpeaking();
        const after = stripWake(finalText || interimText, wake);
        setModeBoth("command");
        extendConvo();
        if (after.length > 2 && finalText) {
          ask(finalText);
        } else {
          setStatus(`Yes? (you said ${wake}) — go ahead`);
          commandBufRef.current = "";
        }
        return;
      }

      if (mode === "thinking") return; // wait for answer
      if (mode === "off") return;

      // ── WAKE: look for name ──
      if (mode === "wake") {
        if (!includesWake(heard, wake)) {
          if (interimText) setPartial(interimText);
          return;
        }
        // Woke up
        setModeBoth("command");
        extendConvo();
        const after = stripWake(finalText || interimText, wake);
        if (after.length > 2) {
          commandBufRef.current = after;
          setPartial(after);
          setStatus("Listening to your question…");
          clearSilence();
          // If final already has the full question, send soon
          if (finalText) {
            silenceTimerRef.current = setTimeout(() => {
              const q = commandBufRef.current.trim();
              commandBufRef.current = "";
              if (q.length > 2) ask(q);
            }, SILENCE_MS);
          }
        } else {
          setStatus(`Yes? I'm ${wake} — ask me anything`);
          commandBufRef.current = "";
          setPartial("");
        }
        return;
      }

      // ── COMMAND (conversation): buffer speech, send after pause ──
      if (mode === "command") {
        if (finalText) {
          // If they say the name again mid-command, strip it
          const chunk = includesWake(finalText, wake)
            ? stripWake(finalText, wake) || finalText
            : finalText;
          commandBufRef.current = (commandBufRef.current + " " + chunk).trim();
          setPartial(commandBufRef.current);
          clearSilence();
          silenceTimerRef.current = setTimeout(() => {
            const q = commandBufRef.current.trim();
            commandBufRef.current = "";
            setPartial("");
            if (q.length > 2) ask(q);
          }, SILENCE_MS);
        } else if (interimText) {
          setPartial(
            (commandBufRef.current + " " + interimText).trim().slice(-120)
          );
        }
      }
    },
    [ask, extendConvo, setModeBoth, stopSpeaking]
  );

  const startListening = useCallback(async () => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError("Use Chrome or Edge on https://www.forge-rp.live for voice.");
      return;
    }
    try {
      if (!window.isSecureContext) {
        setError("Needs HTTPS.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      setError(
        `Mic blocked: ${e instanceof Error ? e.message : String(e)}. Allow mic in the lock menu.`
      );
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
      let newFinal = "";
      let newInterim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = (r[0]?.transcript || "").trim();
        if (!t) continue;
        if (r.isFinal) newFinal += t + " ";
        else newInterim += t + " ";
      }
      const finalText = newFinal.trim();
      const interimText = newInterim.trim();

      // Push-to-talk buffer
      if (pttRef.current) {
        if (finalText) {
          pttBufRef.current = (pttBufRef.current + " " + finalText).trim();
          setPartial(pttBufRef.current);
        } else if (interimText) {
          setPartial((pttBufRef.current + " " + interimText).trim());
        }
        return;
      }

      onSpeechFragment(finalText, interimText);
    };

    rec.onerror = (ev) => {
      if (ev.error === "not-allowed") {
        setError("Microphone permission denied.");
        setListening(false);
        listeningRef.current = false;
        setModeBoth("off");
      } else if (ev.error === "network") {
        setError("Speech network error — check connection / try Chrome.");
      } else if (ev.error !== "aborted" && ev.error !== "no-speech") {
        setError(`Mic: ${ev.error}`);
      }
    };

    rec.onend = () => {
      if (recRef.current === rec && listeningRef.current) {
        try {
          rec.start();
        } catch {
          // ignore
        }
      }
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
      listeningRef.current = true;
      setModeBoth("wake");
      setStatus(`Listening for “${nameRef.current}”…`);
      setError(null);
      setPartial("");
      commandBufRef.current = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start mic");
    }
  }, [onSpeechFragment, setModeBoth]);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    try {
      rec?.abort();
    } catch {
      // ignore
    }
    stopSpeaking();
    clearSilence();
    if (convoTimerRef.current) clearTimeout(convoTimerRef.current);
    setListening(false);
    setModeBoth("off");
    setPtt(false);
    pttRef.current = false;
    setStatus("Off");
    setPartial("");
  }, [setModeBoth, stopSpeaking]);

  const pttDown = useCallback(async () => {
    if (!listeningRef.current) await startListening();
    if (modeRef.current === "speaking") stopSpeaking();
    pttBufRef.current = "";
    setPtt(true);
    pttRef.current = true;
    setModeBoth("command");
    extendConvo();
    setStatus("Talk now… release when done");
    setPartial("");
  }, [extendConvo, setModeBoth, startListening, stopSpeaking]);

  const pttUp = useCallback(() => {
    if (!pttRef.current) return;
    setPtt(false);
    pttRef.current = false;
    const text = pttBufRef.current.trim();
    pttBufRef.current = "";
    setPartial("");
    if (text.length > 1) ask(text);
    else {
      setModeBoth("command");
      setStatus(`Listening… (say “${nameRef.current}”)`);
    }
  }, [ask, setModeBoth]);

  useEffect(() => {
    return () => {
      listeningRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        // ignore
      }
      stopSpeaking();
      clearSilence();
      if (convoTimerRef.current) clearTimeout(convoTimerRef.current);
    };
  }, [stopSpeaking]);

  function saveName() {
    startTransition(async () => {
      const clean = nameDraft.trim() || DEFAULT_NAME;
      try {
        const saved = await actionSetAssistantName(clean);
        setName(saved);
        localStorage.setItem(NAME_KEY, saved);
        setStatus(
          listening ? `Listening for “${saved}”…` : `Named “${saved}”`
        );
        setError(null);
      } catch {
        setName(clean);
        localStorage.setItem(NAME_KEY, clean);
        nameRef.current = clean;
        setStatus(`Named “${clean}” (saved in this browser)`);
      }
    });
  }

  function runSmokeTest() {
    setError(null);
    setStatus("Testing Grok + Carina…");
    setLastHeard("(test button)");
    startTransition(async () => {
      const probe = await actionProbeGrok();
      if (!probe.ok) {
        setError(probe.error || "Grok failed");
        setLastReply(probe.error || "Grok failed");
        setGrokOn(probe.configured);
        setStatus("Grok failed");
        return;
      }
      setGrokOn(true);
      const result = await actionVoiceSmokeTest();
      if (!result.ok) {
        setError(result.error);
        setLastReply(result.error);
        setStatus("Test failed");
        return;
      }
      setLastReply(result.text);
      // Enable continuous listening after a successful test so they don't
      // have to hunt for buttons again
      if (!listeningRef.current) {
        await startListening();
      }
      await speak(result.text);
    });
  }

  const speaking = mode === "speaking";
  const awake = mode === "command" || mode === "thinking";

  if (compact) {
    return (
      <div className="pointer-events-none fixed bottom-5 left-5 z-40 flex flex-col items-start gap-2">
        {(error || lastReply || listening) && (
          <div className="pointer-events-auto max-w-[16rem] rounded-lg border border-slate-700 bg-slate-950/95 px-2.5 py-1.5 text-[10px] shadow-lg">
            <p className="text-slate-400">{status}</p>
            {partial && (
              <p className="mt-0.5 italic text-slate-500">…{partial.slice(-70)}</p>
            )}
            {error && <p className="mt-0.5 text-amber-300">{error}</p>}
            {lastHeard && !error && (
              <p className="mt-0.5 text-slate-500">
                You: {lastHeard.slice(0, 70)}
              </p>
            )}
            {lastReply && !error && (
              <p className="mt-0.5 line-clamp-3 text-slate-300">
                {lastReply.slice(0, 120)}
              </p>
            )}
          </div>
        )}
        {speaking && (
          <div className="pointer-events-none rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-[11px] font-medium text-amber-200">
            Say “{name}” to interrupt
          </div>
        )}
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => (listening ? stopListening() : startListening())}
            className={cn(
              "flex h-12 items-center gap-2 rounded-full border px-3 shadow-lg",
              listening
                ? speaking
                  ? "border-amber-400 bg-amber-500/20 text-amber-100"
                  : awake
                    ? "border-teal-400 bg-teal-500 text-slate-950"
                    : "border-violet-500/50 bg-violet-500/20 text-violet-100"
                : "border-slate-700 bg-slate-900/90 text-slate-300"
            )}
            title={
              listening
                ? `Always listening for “${name}”`
                : "Enable always-on voice (one click)"
            }
          >
            {listening ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            <span className="text-xs font-medium">{name}</span>
            {pending && <LoaderDots />}
          </button>
          {listening && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                void pttDown();
              }}
              onMouseUp={(e) => {
                e.preventDefault();
                pttUp();
              }}
              onMouseLeave={() => {
                if (pttRef.current) pttUp();
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                void pttDown();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                pttUp();
              }}
              className={cn(
                "flex h-12 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-lg",
                ptt
                  ? "border-teal-400 bg-teal-500 text-slate-950"
                  : "border-slate-600 bg-slate-800 text-slate-200"
              )}
            >
              <Radio className="h-3.5 w-3.5" />
              Talk
            </button>
          )}
        </div>
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
          <h3 className="text-sm font-semibold text-slate-50">Voice assistant</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Enable mic <strong>once</strong>, then just say{" "}
            <strong>“{name}, …”</strong> anytime. While she talks, say{" "}
            <strong>“{name}”</strong> to interrupt. No extra buttons needed.
            {grokOn ? " Grok connected." : " Needs XAI_API_KEY."}
          </p>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-medium text-slate-400">
          Her name (what you say to wake / interrupt)
        </label>
        <div className="flex gap-2">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={32}
            placeholder="Carina"
            className="flex h-9 w-full max-w-md rounded-lg border border-slate-700 bg-slate-950/80 px-3 text-sm text-slate-100"
          />
          <button
            type="button"
            onClick={saveName}
            disabled={pending}
            className="h-9 shrink-0 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 hover:border-teal-500/50"
          >
            Save
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => (listening ? stopListening() : startListening())}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold",
            listening
              ? "bg-teal-500 text-slate-950"
              : "bg-teal-600 text-white hover:bg-teal-500"
          )}
        >
          {listening ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          {listening ? "Always listening" : "Enable always-on mic"}
        </button>
        {listening && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              void pttDown();
            }}
            onMouseUp={(e) => {
              e.preventDefault();
              pttUp();
            }}
            onMouseLeave={() => {
              if (pttRef.current) pttUp();
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              void pttDown();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              pttUp();
            }}
            className={cn(
              "inline-flex h-10 select-none items-center gap-2 rounded-lg px-4 text-sm font-semibold",
              ptt
                ? "bg-teal-400 text-slate-950 ring-2 ring-teal-300"
                : "border border-slate-600 bg-slate-800 text-slate-100"
            )}
          >
            <Radio className="h-4 w-4" />
            {ptt ? "Release…" : "Hold Talk (backup)"}
          </button>
        )}
        {mode === "speaking" && (
          <button
            type="button"
            onClick={() => {
              stopSpeaking();
              setModeBoth("command");
              extendConvo();
              setStatus(`Interrupted — say “${name}” or ask`);
            }}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-sm text-amber-200"
          >
            Stop talking
          </button>
        )}
        <button
          type="button"
          onClick={runSmokeTest}
          disabled={pending}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700 px-3 text-xs text-slate-400 hover:text-slate-200"
        >
          Test Grok + Carina
        </button>
      </div>

      <p className="text-xs text-slate-400">
        Status: <span className="text-slate-200">{status}</span>
        {mode === "command" && (
          <span className="ml-2 rounded bg-teal-500/20 px-1.5 py-0.5 text-teal-300">
            In conversation
          </span>
        )}
        {mode === "speaking" && (
          <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200">
            Speaking — say “{name}” to cut in
          </span>
        )}
      </p>

      {partial && (
        <p className="text-xs italic text-slate-500">Hearing: {partial}</p>
      )}
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
      {error && <p className="text-xs text-amber-300">{error}</p>}
      <p className="text-[11px] text-slate-600">
        Example: “{name}, how is the production floor?” — then after she
        answers you can just ask “what about quality?” for ~25 seconds without
        repeating her name.
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
