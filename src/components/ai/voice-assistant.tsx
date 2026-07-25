"use client";

/**
 * Always-on voice assistant (Grok + Carina TTS).
 *
 * Browser requires ONE user click to grant the mic. After that:
 *   1. Continuously listens for the wake name (default: Carina)
 *   2. On name (+ question) → Grok → she speaks with Carina TTS
 *   3. While speaking, saying her name interrupts
 *   4. After a reply, ~25s of follow-ups without re-saying the name
 *
 * SpeechRecognition is recreated after every speak cycle — Chrome often
 * kills the recognizer when Audio plays, which made her "intro then die".
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
const CONVO_MS = 25_000;
const SILENCE_MS = 1100;
/** Recreate recognizer if no events while we expect listening */
const WATCHDOG_MS = 4_000;
/** Ignore wake matches for this long after TTS starts (self-echo) */
const SPEAK_GUARD_MS = 700;

type Mode = "off" | "wake" | "command" | "thinking" | "speaking";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
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

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesWake(text: string, wake: string) {
  const w = wake.trim().toLowerCase();
  if (w.length < 2) return false;
  const t = normalize(text);
  if (t.includes(w)) return true;
  // Common STT mishears for Carina
  if (w === "carina") {
    if (/\b(karina|karen a|corina|kar ena|careena|karrina|car ina)\b/i.test(t))
      return true;
  }
  const first = w.split(/\s+/)[0];
  return first.length >= 3 && new RegExp(`\\b${escapeRe(first)}\\b`, "i").test(t);
}

function stripWake(text: string, wake: string) {
  const w = wake.trim();
  if (!w) return text.trim();
  const first = w.split(/\s+/)[0];
  let out = text;
  if (first.toLowerCase() === "carina") {
    out = out.replace(
      /\b(carina|karina|corina|careena|karrina)\b[,.!?]?/gi,
      " "
    );
  }
  out = out
    .replace(new RegExp(`\\b${escapeRe(w)}\\b[,.!?]?`, "ig"), " ")
    .replace(new RegExp(`\\b${escapeRe(first)}\\b[,.!?]?`, "ig"), " ")
    .replace(/^(hey|ok|okay|hi|hello|yo|um|uh)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

/** Transcript is likely the speakers playing our own TTS. */
function isLikelyEcho(heard: string, spoken: string, wake: string) {
  const h = normalize(heard);
  const s = normalize(spoken);
  if (!h || !s) return false;
  if (s.includes(h) && h.length >= 6) return true;
  const hWords = h.split(" ").filter((w) => w.length > 2);
  if (hWords.length >= 3) {
    const sSet = new Set(s.split(" "));
    const hits = hWords.filter((w) => sSet.has(w)).length;
    if (hits / hWords.length >= 0.65) return true;
  }
  // Long interim that shares many words with spoken (minus wake)
  const after = normalize(stripWake(heard, wake));
  if (after.length >= 8 && s.includes(after)) return true;
  return false;
}

export function VoiceAssistant({ compact = false }: { compact?: boolean }) {
  const [name, setName] = useState(DEFAULT_NAME);
  const [nameDraft, setNameDraft] = useState(DEFAULT_NAME);
  const [listening, setListening] = useState(false);
  const [mode, setMode] = useState<Mode>("off");
  const [status, setStatus] = useState("Off — tap Enable once");
  const [partial, setPartial] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [grokOn, setGrokOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [ptt, setPtt] = useState(false);
  const [recAlive, setRecAlive] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>(
    []
  );
  const nameRef = useRef(name);
  const wantListenRef = useRef(false);
  const modeRef = useRef<Mode>("off");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakGenRef = useRef(0);
  const speakingTextRef = useRef("");
  const speakStartedAtRef = useRef(0);
  const commandBufRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const convoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastResultAtRef = useRef(0);
  const lastAskRef = useRef("");
  const lastAskAtRef = useRef(0);
  const pttBufRef = useRef("");
  const pttRef = useRef(false);
  const startingRecRef = useRef(false);
  // Stable handlers via refs so recognition always calls latest logic
  const onSpeechFragmentRef = useRef<
    (finalText: string, interimText: string) => void
  >(() => {});
  const askRef = useRef<(raw: string) => void>(() => {});

  const setModeBoth = useCallback((m: Mode) => {
    modeRef.current = m;
    setMode(m);
  }, []);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    pttRef.current = ptt;
  }, [ptt]);

  useEffect(() => {
    void actionGrokStatus().then((s) => setGrokOn(s.configured));
    void actionGetAssistantName().then((n) => {
      const resolved =
        n && n !== "Forge" ? n : localStorage.getItem(NAME_KEY) || DEFAULT_NAME;
      setName(resolved);
      setNameDraft(resolved);
      nameRef.current = resolved;
    });
  }, []);

  const clearSilence = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const extendConvo = useCallback(() => {
    if (convoTimerRef.current) clearTimeout(convoTimerRef.current);
    convoTimerRef.current = setTimeout(() => {
      if (modeRef.current === "command" || modeRef.current === "wake") {
        setModeBoth("wake");
        if (wantListenRef.current) {
          setStatus(`Listening for “${nameRef.current}”…`);
        }
      }
    }, CONVO_MS);
  }, [setModeBoth]);

  const stopSpeaking = useCallback(() => {
    speakGenRef.current += 1;
    speakingTextRef.current = "";
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

  /** Tear down current SpeechRecognition instance completely. */
  const killRecognition = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onstart = null;
      try {
        rec.abort();
      } catch {
        try {
          rec.stop();
        } catch {
          // ignore
        }
      }
    }
    setRecAlive(false);
  }, []);

  /**
   * Create + start a fresh recognizer. Safe to call often.
   * Chrome dies after TTS audio; recreating is the reliable fix.
   */
  const bootRecognition = useCallback(() => {
    if (!wantListenRef.current) return;
    if (typeof window === "undefined") return;
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError("Use Chrome or Edge on HTTPS for voice.");
      return;
    }
    if (startingRecRef.current) return;
    startingRecRef.current = true;

    killRecognition();

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    if (typeof rec.maxAlternatives === "number") rec.maxAlternatives = 1;

    rec.onstart = () => {
      setRecAlive(true);
      lastResultAtRef.current = Date.now();
      startingRecRef.current = false;
    };

    rec.onresult = (ev) => {
      lastResultAtRef.current = Date.now();
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

      if (pttRef.current) {
        if (finalText) {
          pttBufRef.current = (pttBufRef.current + " " + finalText).trim();
          setPartial(pttBufRef.current);
        } else if (interimText) {
          setPartial((pttBufRef.current + " " + interimText).trim());
        }
        return;
      }

      onSpeechFragmentRef.current(finalText, interimText);
    };

    rec.onerror = (ev) => {
      startingRecRef.current = false;
      if (ev.error === "not-allowed") {
        setError("Microphone permission denied — allow mic in the address bar.");
        wantListenRef.current = false;
        setListening(false);
        setModeBoth("off");
        setStatus("Off — mic blocked");
        killRecognition();
        return;
      }
      // no-speech / aborted / network: restart if we still want listen
      if (
        wantListenRef.current &&
        ev.error !== "aborted" &&
        ev.error !== "not-allowed"
      ) {
        if (ev.error === "network") {
          setError("Speech network glitch — retrying…");
        }
        restartTimerRef.current = setTimeout(() => {
          if (wantListenRef.current) bootRecognition();
        }, 350);
      }
    };

    rec.onend = () => {
      setRecAlive(false);
      startingRecRef.current = false;
      if (!wantListenRef.current) return;
      if (recRef.current !== rec) return;
      // Chrome ends often; always come back if user still wants listening
      restartTimerRef.current = setTimeout(() => {
        if (!wantListenRef.current) return;
        try {
          rec.start();
        } catch {
          bootRecognition();
        }
      }, 120);
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      startingRecRef.current = false;
      restartTimerRef.current = setTimeout(() => {
        if (wantListenRef.current) bootRecognition();
      }, 400);
    }
  }, [killRecognition, setModeBoth]);

  const scheduleBoot = useCallback(
    (delayMs = 150) => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (wantListenRef.current) bootRecognition();
      }, delayMs);
    },
    [bootRecognition]
  );

  const speak = useCallback(
    async (text: string) => {
      stopSpeaking();
      const gen = speakGenRef.current;
      const spoken = text
        .replace(/\*\*/g, "")
        .replace(/`+/g, "")
        .replace(/#{1,6}\s/g, "")
        .replace(/\|/g, " ")
        .replace(/\n{2,}/g, ". ")
        .replace(/\n/g, " ")
        .trim();

      speakingTextRef.current = spoken;
      speakStartedAtRef.current = Date.now();
      setModeBoth("speaking");
      setStatus(`Speaking… say “${nameRef.current}” to interrupt`);

      const finish = () => {
        if (speakGenRef.current !== gen) return;
        speakingTextRef.current = "";
        setModeBoth("command");
        extendConvo();
        setStatus(
          wantListenRef.current
            ? `Listening… (say “${nameRef.current}” or just ask)`
            : "Off"
        );
        // CRITICAL: recreate recognizer after TTS — Chrome often kills it
        if (wantListenRef.current) {
          scheduleBoot(200);
        }
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
          if (speakGenRef.current !== gen) return;
          finish();
          return;
        }
      } catch {
        // fallback below
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
      if (speakGenRef.current !== gen) return;
      finish();
    },
    [extendConvo, scheduleBoot, setModeBoth, stopSpeaking]
  );

  const ask = useCallback(
    (raw: string) => {
      let text = raw.trim();
      if (!text) return;

      const now = Date.now();
      const key = text.toLowerCase();
      if (key === lastAskRef.current && now - lastAskAtRef.current < 2500) {
        return;
      }
      lastAskRef.current = key;
      lastAskAtRef.current = now;

      const wake = nameRef.current;
      if (includesWake(text, wake)) {
        const after = stripWake(text, wake);
        if (after.length < 2) {
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
            setStatus("Error — still listening");
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
          if (wantListenRef.current) scheduleBoot(200);
        }
      });
    },
    [clearSilence, extendConvo, scheduleBoot, setModeBoth, speak, stopSpeaking]
  );

  useEffect(() => {
    askRef.current = ask;
  }, [ask]);

  const armSilenceSend = useCallback(() => {
    clearSilence();
    silenceTimerRef.current = setTimeout(() => {
      const q = commandBufRef.current.trim();
      commandBufRef.current = "";
      setPartial("");
      if (q.length > 2) askRef.current(q);
    }, SILENCE_MS);
  }, [clearSilence]);

  const onSpeechFragment = useCallback(
    (finalText: string, interimText: string) => {
      const wake = nameRef.current;
      const modeNow = modeRef.current;
      const heard = (finalText || interimText).trim();
      if (!heard) return;

      // ── SPEAKING: only wake name interrupts (ignore speaker echo) ──
      if (modeNow === "speaking") {
        if (Date.now() - speakStartedAtRef.current < SPEAK_GUARD_MS) return;
        if (!includesWake(heard, wake)) return;
        if (isLikelyEcho(heard, speakingTextRef.current, wake)) return;

        // Prefer finals for interrupt; allow short pure-name interim
        const after = stripWake(heard, wake);
        const pureName = after.length < 2;
        if (!finalText && !pureName) return;

        stopSpeaking();
        setModeBoth("command");
        extendConvo();
        commandBufRef.current = "";
        setPartial("");

        if (after.length > 2 && finalText) {
          setStatus("Interrupted — thinking…");
          askRef.current(finalText);
        } else {
          setStatus(`Yes? (you said ${wake}) — go ahead`);
          if (wantListenRef.current) scheduleBoot(150);
        }
        return;
      }

      if (modeNow === "thinking") return;
      if (modeNow === "off") return;

      // ── WAKE: wait for name ──
      if (modeNow === "wake") {
        if (!includesWake(heard, wake)) {
          if (interimText) setPartial(interimText.slice(-80));
          return;
        }
        setModeBoth("command");
        extendConvo();
        const after = stripWake(finalText || interimText, wake);
        if (after.length > 2) {
          commandBufRef.current = after;
          setPartial(after);
          setStatus("Got it — listening to your question…");
          // Full question already final → send after short silence
          if (finalText) armSilenceSend();
        } else {
          setStatus(`Yes? I'm ${wake} — ask me anything`);
          commandBufRef.current = "";
          setPartial("");
        }
        return;
      }

      // ── COMMAND (in conversation): buffer, send after pause ──
      if (modeNow === "command") {
        if (finalText) {
          const chunk = includesWake(finalText, wake)
            ? stripWake(finalText, wake) || finalText
            : finalText;
          if (chunk.length < 1) return;
          commandBufRef.current = (commandBufRef.current + " " + chunk).trim();
          setPartial(commandBufRef.current);
          setStatus("Hearing you…");
          armSilenceSend();
        } else if (interimText) {
          setPartial(
            (commandBufRef.current + " " + interimText).trim().slice(-140)
          );
        }
      }
    },
    [armSilenceSend, extendConvo, scheduleBoot, setModeBoth, stopSpeaking]
  );

  useEffect(() => {
    onSpeechFragmentRef.current = onSpeechFragment;
  }, [onSpeechFragment]);

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
      // Permission + echo cancellation where supported
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      setError(
        `Mic blocked: ${e instanceof Error ? e.message : String(e)}. Allow mic in the lock icon.`
      );
      return;
    }

    wantListenRef.current = true;
    setListening(true);
    setModeBoth("wake");
    setStatus(`Listening for “${nameRef.current}”… say her name anytime`);
    setError(null);
    setPartial("");
    commandBufRef.current = "";
    lastResultAtRef.current = Date.now();

    bootRecognition();

    // Watchdog: if recognizer goes quiet while we expect listen, reboot it
    if (watchdogRef.current) clearInterval(watchdogRef.current);
    watchdogRef.current = setInterval(() => {
      if (!wantListenRef.current) return;
      // Don't thrash while thinking (no speech expected) unless rec is dead a long time
      const quiet = Date.now() - lastResultAtRef.current;
      if (!recRef.current || quiet > 12_000) {
        bootRecognition();
      }
    }, WATCHDOG_MS);
  }, [bootRecognition, setModeBoth]);

  const stopListening = useCallback(() => {
    wantListenRef.current = false;
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
    killRecognition();
    stopSpeaking();
    clearSilence();
    if (convoTimerRef.current) clearTimeout(convoTimerRef.current);
    setListening(false);
    setModeBoth("off");
    setPtt(false);
    pttRef.current = false;
    setStatus("Off");
    setPartial("");
  }, [clearSilence, killRecognition, setModeBoth, stopSpeaking]);

  const pttDown = useCallback(async () => {
    if (!wantListenRef.current) await startListening();
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
      wantListenRef.current = false;
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      killRecognition();
      stopSpeaking();
      clearSilence();
      if (convoTimerRef.current) clearTimeout(convoTimerRef.current);
    };
  }, [clearSilence, killRecognition, stopSpeaking]);

  function saveName() {
    startTransition(async () => {
      const clean = nameDraft.trim() || DEFAULT_NAME;
      try {
        const saved = await actionSetAssistantName(clean);
        setName(saved);
        nameRef.current = saved;
        localStorage.setItem(NAME_KEY, saved);
        setStatus(
          wantListenRef.current
            ? `Listening for “${saved}”…`
            : `Named “${saved}”`
        );
        setError(null);
      } catch {
        setName(clean);
        nameRef.current = clean;
        localStorage.setItem(NAME_KEY, clean);
        setStatus(`Named “${clean}” (saved in this browser)`);
      }
    });
  }

  function runSmokeTest() {
    setError(null);
    setStatus("Testing Grok + Carina…");
    setLastHeard("(diagnostic test)");
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
      // Ensure continuous listen is on so after the sample she keeps hearing you
      if (!wantListenRef.current) {
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
            <p className="text-slate-400">
              {status}
              {listening && (
                <span
                  className={cn(
                    "ml-1 inline-block h-1.5 w-1.5 rounded-full",
                    recAlive ? "bg-teal-400" : "bg-amber-400 animate-pulse"
                  )}
                  title={recAlive ? "Mic engine live" : "Reconnecting mic…"}
                />
              )}
            </p>
            {partial && (
              <p className="mt-0.5 italic text-slate-500">
                …{partial.slice(-70)}
              </p>
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
            onClick={() => (listening ? stopListening() : void startListening())}
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
                ? `Always listening for “${name}” — click to stop`
                : "Enable always-on voice (one click, then just say her name)"
            }
          >
            {listening ? (
              <Mic className="h-4 w-4" />
            ) : (
              <MicOff className="h-4 w-4" />
            )}
            <span className="text-xs font-medium">
              {listening ? name : `Enable ${name}`}
            </span>
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
          <h3 className="text-sm font-semibold text-slate-50">
            Voice assistant
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Tap <strong>Enable always-on mic</strong> once (browser requires
            it). Then just say <strong>“{name}, …”</strong> anytime — no more
            buttons. While she talks, say <strong>“{name}”</strong> to
            interrupt.
            {grokOn ? " Grok connected." : " Needs XAI_API_KEY."}
          </p>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-medium text-slate-400">
          Her name (wake / interrupt word)
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
          onClick={() =>
            listening ? stopListening() : void startListening()
          }
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-semibold shadow-md",
            listening
              ? "bg-teal-500 text-slate-950 ring-2 ring-teal-300/50"
              : "bg-teal-600 text-white hover:bg-teal-500"
          )}
        >
          {listening ? (
            <Mic className="h-4 w-4" />
          ) : (
            <MicOff className="h-4 w-4" />
          )}
          {listening
            ? `Always listening for “${name}”`
            : `Enable always-on mic`}
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
              "inline-flex h-11 select-none items-center gap-2 rounded-lg px-4 text-sm font-semibold",
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
              if (wantListenRef.current) scheduleBoot(150);
            }}
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-sm text-amber-200"
          >
            Stop talking
          </button>
        )}
      </div>

      <p className="text-xs text-slate-400">
        Status: <span className="text-slate-200">{status}</span>
        {listening && (
          <span
            className={cn(
              "ml-2 rounded px-1.5 py-0.5 text-[10px]",
              recAlive
                ? "bg-teal-500/20 text-teal-300"
                : "bg-amber-500/20 text-amber-200"
            )}
          >
            {recAlive ? "mic live" : "reconnecting…"}
          </span>
        )}
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

      <details className="text-[11px] text-slate-600">
        <summary className="cursor-pointer text-slate-500 hover:text-slate-400">
          Advanced / diagnostics
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            Example: “{name}, how is the production floor?” — then for ~25s you
            can just ask follow-ups without her name.
          </p>
          <button
            type="button"
            onClick={runSmokeTest}
            disabled={pending}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-700 px-3 text-xs text-slate-400 hover:text-slate-200"
          >
            Test Grok + Carina (diagnostic only)
          </button>
        </div>
      </details>
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
