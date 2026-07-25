"use client";

/**
 * Voice assistant — Grok + Carina TTS.
 * - Continuous mode: say wake name, then your question
 * - Push-to-talk: hold "Talk" and speak (no wake word)
 * - Barge-in: speaking while it talks stops audio
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Bot, Mic, MicOff, Volume2, Radio } from "lucide-react";
import {
  actionAiConversation,
  actionGetAssistantName,
  actionGrokStatus,
  actionProbeGrok,
  actionSetAssistantName,
  actionVoiceSmokeTest,
} from "@/app/ai/actions";
import { cn } from "@/lib/utils";

const NAME_KEY = "forge-assistant-name";
const DEFAULT_VOICE_ID = "carina";
/** Stay "awake" after wake word so follow-ups don't need the name again */
const AWAKE_MS = 20_000;

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

/** Loose wake match: "forge", "forged", "hey forge" */
function includesWake(text: string, wake: string) {
  const w = wake.trim().toLowerCase();
  if (!w) return false;
  const t = text.toLowerCase();
  if (t.includes(w)) return true;
  // first token of multi-word name
  const first = w.split(/\s+/)[0];
  return first.length >= 3 && new RegExp(`\\b${escapeRe(first)}\\b`, "i").test(t);
}

function stripWake(text: string, wake: string) {
  const w = wake.trim();
  if (!w) return text.trim();
  return text
    .replace(new RegExp(`\\b${escapeRe(w)}\\b[,.]?`, "ig"), " ")
    .replace(new RegExp(`\\b${escapeRe(w.split(/\s+/)[0])}\\b[,.]?`, "ig"), " ")
    .replace(/^(hey|ok|okay|hi|hello)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function VoiceAssistant({ compact = false }: { compact?: boolean }) {
  const [name, setName] = useState("Forge");
  const [nameDraft, setNameDraft] = useState("Forge");
  const [listening, setListening] = useState(false);
  const [awake, setAwake] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [ptt, setPtt] = useState(false); // push-to-talk active
  const [status, setStatus] = useState("Off");
  const [partial, setPartial] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [grokOn, setGrokOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>(
    []
  );
  const nameRef = useRef(name);
  const listeningRef = useRef(false);
  const awakeRef = useRef(false);
  const speakingRef = useRef(false);
  const pttRef = useRef(false);
  const busyRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakGenRef = useRef(0);
  const lastHandledRef = useRef("");
  const lastHandledAtRef = useRef(0);
  const awakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pttBufferRef = useRef("");

  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);
  useEffect(() => {
    awakeRef.current = awake;
  }, [awake]);
  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);
  useEffect(() => {
    pttRef.current = ptt;
  }, [ptt]);

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

  const keepAwake = useCallback(() => {
    setAwake(true);
    awakeRef.current = true;
    if (awakeTimerRef.current) clearTimeout(awakeTimerRef.current);
    awakeTimerRef.current = setTimeout(() => {
      setAwake(false);
      awakeRef.current = false;
      if (listeningRef.current) {
        setStatus(`Listening for “${nameRef.current}”…`);
      }
    }, AWAKE_MS);
  }, []);

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
    setSpeaking(false);
    speakingRef.current = false;
  }, []);

  const speak = useCallback(
    async (text: string) => {
      // Cancel previous without double-increment confusion
      stopSpeaking();
      const gen = speakGenRef.current; // stopSpeaking already bumped
      setSpeaking(true);
      speakingRef.current = true;
      // Mic stays on so the user can interrupt by saying her wake name.
      // Noise is ignored in onresult while speaking (wake word only).

      const spoken = text
        .replace(/\*\*/g, "")
        .replace(/`+/g, "")
        .replace(/#{1,6}\s/g, "")
        .replace(/\|/g, " ")
        .replace(/\n{2,}/g, ". ")
        .replace(/\n/g, " ")
        .trim();

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
          if (speakGenRef.current === gen) {
            setSpeaking(false);
            speakingRef.current = false;
          }
          return;
        }
      } catch {
        // browser fallback
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
      if (speakGenRef.current === gen) {
        setSpeaking(false);
        speakingRef.current = false;
      }
    },
    [stopSpeaking]
  );

  const handleUtterance = useCallback(
    (transcript: string) => {
      let text = transcript.trim();
      if (!text) return;

      // De-dupe (recognition often re-fires)
      const now = Date.now();
      const key = text.toLowerCase();
      if (
        key === lastHandledRef.current &&
        now - lastHandledAtRef.current < 2500
      ) {
        return;
      }
      lastHandledRef.current = key;
      lastHandledAtRef.current = now;

      // Don't feed the wake word alone to Grok
      const onlyWake =
        includesWake(text, nameRef.current) &&
        stripWake(text, nameRef.current).length < 2;
      if (onlyWake) {
        keepAwake();
        setStatus("Yes? Ask me anything…");
        setPartial("");
        return;
      }

      // Strip wake word from the question
      if (includesWake(text, nameRef.current)) {
        text = stripWake(text, nameRef.current) || text;
      }
      if (text.length < 2) return;

      if (speakingRef.current) stopSpeaking();
      if (busyRef.current) {
        // cancel in-flight answer
        speakGenRef.current += 1;
      }
      busyRef.current = true;
      setPartial("");
      setLastHeard(text);
      setStatus("Thinking…");
      setError(null);
      keepAwake();

      historyRef.current = [
        ...historyRef.current.slice(-8),
        { role: "user", content: text },
      ];

      startTransition(async () => {
        try {
          const result = await actionAiConversation(historyRef.current);
          if (!result.ok) {
            setError(result.error);
            setLastReply(`Error: ${result.error}`);
            setStatus("Error — try Hold to talk again");
            await speak(
              "Sorry, I could not reach Grok. Check that XAI_API_KEY is set on the server."
            );
            return;
          }
          const safe = result.text;
          historyRef.current = [
            ...historyRef.current,
            { role: "assistant", content: safe },
          ];
          setLastReply(
            result.source === "local"
              ? `${safe}\n\n(local fallback — Grok key may be missing)`
              : safe
          );
          setError(null);
          setStatus("Speaking…");
          await speak(safe);
          setStatus(
            listeningRef.current
              ? awakeRef.current
                ? "Listening… (still awake)"
                : `Listening for “${nameRef.current}”…`
              : "Off"
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Assistant failed";
          setError(msg);
          setLastReply(`Error: ${msg}`);
          setStatus("Error — still listening");
          try {
            await speak("Sorry, I had a problem. Please try again.");
          } catch {
            // ignore
          }
        } finally {
          busyRef.current = false;
        }
      });
    },
    [keepAwake, speak, stopSpeaking]
  );

  /** Bypass mic entirely — proves Grok + Carina TTS pipeline. */
  function runSmokeTest() {
    setError(null);
    setStatus("Testing Grok + Carina…");
    setLastHeard("(smoke test — no mic)");
    startTransition(async () => {
      try {
        const probe = await actionProbeGrok();
        if (!probe.ok) {
          setError(probe.error || "Grok probe failed");
          setLastReply(probe.error || "Grok probe failed");
          setStatus("Grok failed");
          setGrokOn(probe.configured);
          return;
        }
        setGrokOn(true);
        const result = await actionVoiceSmokeTest();
        if (!result.ok) {
          setError(result.error);
          setLastReply(result.error);
          setStatus("Smoke test failed");
          return;
        }
        setLastReply(result.text);
        setStatus("Speaking…");
        await speak(result.text);
        setStatus(
          listeningRef.current
            ? `Listening for “${nameRef.current}”…`
            : "Smoke test OK"
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Smoke test failed";
        setError(msg);
        setLastReply(msg);
        setStatus("Error");
      }
    });
  }

  const startListening = useCallback(async () => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError(
        "Voice recognition isn't supported. Use Chrome or Edge on https://www.forge-rp.live."
      );
      return;
    }

    try {
      if (!window.isSecureContext) {
        setError("Microphone needs HTTPS.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        `Microphone blocked. Lock icon → Microphone → Allow → reload. (${msg})`
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
      // CRITICAL: only process NEW results (resultIndex), not the full history
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
      if (interimText) setPartial(interimText);

      // Push-to-talk: buffer finals until release
      if (pttRef.current) {
        if (finalText) {
          pttBufferRef.current = (pttBufferRef.current + " " + finalText).trim();
          setPartial(pttBufferRef.current);
        }
        return;
      }

      const wake = nameRef.current;

      // While she is speaking: ONLY the wake name can interrupt (not noise).
      // Prefer final transcripts; allow strong interim if it clearly has the name.
      if (speakingRef.current) {
        const candidate = finalText || interimText;
        if (!candidate || !includesWake(candidate, wake)) return;
        // Require the name as a clear token (avoids random noise false hits)
        const wakeRe = new RegExp(
          `\\b${escapeRe(wake.trim().split(/\s+/)[0] || wake)}\\b`,
          "i"
        );
        if (!wakeRe.test(candidate)) return;
        // Prefer finals; if only interim, need the full wake name present
        if (!finalText && !includesWake(interimText, wake)) return;

        stopSpeaking();
        keepAwake();
        setStatus("Interrupted — listening…");
        const after = stripWake(finalText || interimText, wake);
        if (after.length > 2 && finalText) {
          handleUtterance(finalText);
        } else {
          setStatus(`Yes? (you said ${wake}) — ask anything…`);
        }
        return;
      }

      if (!finalText) return;

      // Not awake: need wake word (require a real final phrase)
      if (!awakeRef.current) {
        if (includesWake(finalText, wake)) {
          keepAwake();
          const after = stripWake(finalText, wake);
          setStatus(
            after.length > 2 ? "Thinking…" : "Yes? Ask me anything…"
          );
          if (after.length > 2) handleUtterance(finalText);
        }
        return;
      }

      // Awake: only accept a real sentence (filters coughs / clicks)
      const words = finalText.split(/\s+/).filter(Boolean);
      if (finalText.length >= 4 || words.length >= 2) {
        handleUtterance(finalText);
      }
    };

    rec.onerror = (ev) => {
      if (ev.error === "not-allowed") {
        setError("Microphone permission denied.");
        setListening(false);
        listeningRef.current = false;
      } else if (ev.error === "aborted") {
        // ignore
      } else if (ev.error === "network") {
        setError("Speech recognition network error — check connection.");
      } else if (ev.error !== "no-speech") {
        setError(`Mic: ${ev.error}`);
      }
    };

    rec.onend = () => {
      // Auto-restart continuous recognition
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
      setStatus(`Listening for “${nameRef.current}”… (or hold Talk)`);
      setError(null);
      setPartial("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start mic");
    }
  }, [handleUtterance, keepAwake, stopSpeaking]);

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
    setListening(false);
    setAwake(false);
    awakeRef.current = false;
    setPtt(false);
    pttRef.current = false;
    setStatus("Off");
    setPartial("");
  }, [stopSpeaking]);

  /** Push-to-talk: press = start buffering, release = send */
  const pttDown = useCallback(async () => {
    if (!listeningRef.current) {
      await startListening();
    }
    stopSpeaking();
    pttBufferRef.current = "";
    setPtt(true);
    pttRef.current = true;
    keepAwake();
    setStatus("Talk now… (release when done)");
    setPartial("");
    setError(null);
  }, [keepAwake, startListening, stopSpeaking]);

  const pttUp = useCallback(() => {
    if (!pttRef.current) return;
    setPtt(false);
    pttRef.current = false;
    const text = pttBufferRef.current.trim();
    pttBufferRef.current = "";
    setPartial("");
    if (text.length > 1) {
      handleUtterance(text);
    } else {
      setStatus(
        listeningRef.current
          ? `Listening for “${nameRef.current}”…`
          : "Off"
      );
    }
  }, [handleUtterance]);

  useEffect(() => {
    return () => {
      listeningRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        // ignore
      }
      stopSpeaking();
      if (awakeTimerRef.current) clearTimeout(awakeTimerRef.current);
    };
  }, [stopSpeaking]);

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
        const clean = nameDraft.trim() || "Forge";
        setName(clean);
        try {
          localStorage.setItem(NAME_KEY, clean);
        } catch {
          // ignore
        }
        setError(e instanceof Error ? e.message : "Saved name locally only");
      }
    });
  }

  if (compact) {
    return (
      <div className="pointer-events-none fixed bottom-5 left-5 z-40 flex flex-col items-start gap-2">
        {(error || lastReply || status !== "Off") && (
          <div className="pointer-events-auto max-w-[16rem] rounded-lg border border-slate-700 bg-slate-950/95 px-2.5 py-1.5 text-[10px] shadow-lg">
            <p className="text-slate-400">{status}</p>
            {error && <p className="mt-0.5 text-amber-300">{error}</p>}
            {lastHeard && !error && (
              <p className="mt-0.5 text-slate-500">You: {lastHeard.slice(0, 80)}</p>
            )}
            {lastReply && !error && (
              <p className="mt-0.5 text-slate-300 line-clamp-3">{lastReply.slice(0, 140)}</p>
            )}
          </div>
        )}
        {partial && listening && (
          <div className="pointer-events-none max-w-[14rem] rounded-lg border border-slate-700 bg-slate-950/90 px-2 py-1 text-[10px] text-slate-400">
            …{partial.slice(-80)}
          </div>
        )}
        {speaking && (
          <button
            type="button"
            onClick={stopSpeaking}
            className="pointer-events-auto rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-[11px] font-medium text-amber-200"
          >
            Tap to interrupt
          </button>
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
                ? speaking
                  ? `Speaking — say “${name}” to interrupt`
                  : `On — say “${name}” or hold Talk`
                : "Enable mic"
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
              title="Hold to talk — no wake word needed"
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
            Carina voice via Grok. Say “{name}, …” or <strong>hold Talk</strong>.
            While she speaks, say “{name}” to interrupt (noise is ignored).
            {grokOn ? " Grok connected." : " Needs XAI_API_KEY on the server."}
          </p>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-medium text-slate-400">
          Assistant name (wake word)
        </label>
        <div className="flex gap-2">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={32}
            placeholder="e.g. Atlas, Nova, Forge"
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
          onClick={runSmokeTest}
          disabled={pending}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 text-sm font-medium text-teal-200 hover:bg-teal-500/20"
        >
          Test Grok + Carina
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
          {listening ? "Mic on" : "Enable mic"}
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
              "inline-flex h-9 select-none items-center gap-2 rounded-lg px-4 text-sm font-semibold",
              ptt
                ? "bg-teal-400 text-slate-950 ring-2 ring-teal-300"
                : "border border-slate-600 bg-slate-800 text-slate-100"
            )}
          >
            <Radio className="h-4 w-4" />
            {ptt ? "Release to send…" : "Hold to talk"}
          </button>
        )}
        {speaking && (
          <button
            type="button"
            onClick={stopSpeaking}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-sm text-amber-200"
          >
            Stop talking
          </button>
        )}
      </div>

      <p className="text-xs text-slate-400">
        Status: <span className="text-slate-200">{status}</span>
        {awake && (
          <span className="ml-2 rounded bg-teal-500/20 px-1.5 py-0.5 text-teal-300">
            Awake
          </span>
        )}
        {speaking && (
          <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200">
            Speaking — say “{name}” to interrupt
          </span>
        )}
        {ptt && (
          <span className="ml-2 rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-200">
            Recording
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
        Tip: <strong>Hold to talk</strong> is the most reliable. Wake word mode
        needs a clear “{name}, how is the floor?” Chrome/Edge +{" "}
        <code className="text-teal-500">XAI_API_KEY</code>.
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
