"use client";

/**
 * Always-on voice assistant (Carina TTS).
 *
 * After one "Enable mic" click:
 *   - Continuously listens for wake name (default Carina)
 *   - On name + question → plant AI reply → Carina TTS
 *   - While speaking, saying her name interrupts
 *   - ~25s after a reply, follow-ups without the name
 *
 * Critical Chrome quirks we handle:
 *   - SpeechRecognition often ends mid-session → auto-restart loop
 *   - Many utterances only get interim results (no final) → send on silence
 *   - TTS audio kills the recognizer → reboot after every speak
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Mic, MicOff, Volume2, Radio } from "lucide-react";
import {
  actionAiConversation,
  actionGetAssistantName,
  actionGrokStatus,
  actionSetAssistantName,
  actionVoiceSmokeTest,
  actionProbeGrok,
} from "@/app/ai/actions";
import { startCarinaGuideEvent } from "@/components/guides/guided-tour";
import {
  DEFAULT_LANG,
  loadStoredLang,
  resolveLang,
  storeLang,
  ttsLanguageCode,
  type CarinaLang,
} from "@/lib/carina-language";
import {
  carinaPointEvent,
  enableCarinaVoiceEvent,
  persistWantListen,
  readWantListen,
  stopCarinaVoiceEvent,
} from "@/lib/carina-voice-bus";
import {
  carinaIsAudioCurrent,
  carinaPlaySpeech,
  carinaStopAllAudio,
  carinaBumpAudioGen,
  carinaIsSpeaking,
} from "@/lib/carina-audio";
import {
  bestPointAnchor,
  wantsPointOnly,
} from "@/lib/carina-catalog";
import { cn } from "@/lib/utils";

export { enableCarinaVoiceEvent, stopCarinaVoiceEvent } from "@/lib/carina-voice-bus";

/** Only one shell engine should boot recognition */
let shellEngineActive = false;
let globalAskLock = false;

const NAME_KEY = "forge-assistant-name";
const DEFAULT_NAME = "Carina";
const DEFAULT_VOICE_ID = "carina";
const CONVO_MS = 30_000;
/** How long after last speech activity before we send the buffered question */
const SILENCE_MS = 900;
const SPEAK_GUARD_MS = 800;
const RESTART_MS = 180;

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
  onspeechend: (() => void) | null;
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

/** Fuzzy wake match — STT mangles "Carina" constantly. */
function includesWake(text: string, wake: string) {
  const w = wake.trim().toLowerCase();
  if (w.length < 2) return false;
  const t = normalize(text);
  if (!t) return false;
  if (t.includes(w)) return true;

  if (w === "carina" || w === "karina") {
    // Broad mishears for Carina / Karina
    if (
      /\b(carina|karina|corina|careena|karrina|karinna|carinna|katrina|carena|karena|serina|sarina|marina|farina|carine|karine|karen|carrie|kari|cara)\b/.test(
        t
      )
    ) {
      // "karen" alone is common noise — only count if near hey/hi or short utterance
      if (/\bkaren\b/.test(t) && !/\b(carina|karina|corina|careena)\b/.test(t)) {
        const words = t.split(" ");
        if (words.length > 4 && !/^(hey|hi|ok|okay|yo)\b/.test(t)) return false;
      }
      return true;
    }
    // "hey carina" split oddly: "hey care en a"
    if (/\b(care|car|kar)\s*(ina|ena|rena)\b/.test(t)) return true;
  }

  const first = w.split(/\s+/)[0];
  if (first.length >= 4 && new RegExp(`\\b${escapeRe(first)}\\b`).test(t)) {
    return true;
  }
  return false;
}

function stripWake(text: string, wake: string) {
  let out = text;
  const w = wake.trim();
  const first = w.split(/\s+/)[0] || w;
  if (first.toLowerCase() === "carina" || first.toLowerCase() === "karina") {
    out = out.replace(
      /\b(hey|hi|ok|okay|yo)?\s*(carina|karina|corina|careena|karrina|karinna|carinna|katrina|carena|karena|serina|sarina|marina|farina|carine|karine|karen|carrie|kari|cara)\b[,.!?]?/gi,
      " "
    );
    out = out.replace(/\b(care|car|kar)\s*(ina|ena|rena)\b[,.!?]?/gi, " ");
  }
  out = out
    .replace(new RegExp(`\\b${escapeRe(w)}\\b[,.!?]?`, "ig"), " ")
    .replace(new RegExp(`\\b${escapeRe(first)}\\b[,.!?]?`, "ig"), " ")
    .replace(/^(hey|ok|okay|hi|hello|yo|um|uh)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

function isLikelyEcho(heard: string, spoken: string, wake: string) {
  const h = normalize(heard);
  const s = normalize(spoken);
  if (!h || !s) return false;
  if (s.includes(h) && h.length >= 8) return true;
  const hWords = h.split(" ").filter((x) => x.length > 2);
  if (hWords.length >= 3) {
    const sSet = new Set(s.split(" "));
    const hits = hWords.filter((x) => sSet.has(x)).length;
    if (hits / hWords.length >= 0.7) return true;
  }
  const after = normalize(stripWake(heard, wake));
  if (after.length >= 10 && s.includes(after)) return true;
  return false;
}

/**
 * host="page" — full settings UI (Company Settings → My AI assistant / /ai)
 * host="shell" — invisible engine for the help bubble (no left-side chip)
 * compact — legacy floating chip (prefer shell + bubble)
 */
export function VoiceAssistant({
  compact = false,
  host = "page",
}: {
  compact?: boolean;
  host?: "page" | "shell";
}) {
  const [name, setName] = useState(DEFAULT_NAME);
  const [nameDraft, setNameDraft] = useState(DEFAULT_NAME);
  const [listening, setListening] = useState(false);
  const [mode, setMode] = useState<Mode>("off");
  const [status, setStatus] = useState("Off — tap Enable once");
  const [partial, setPartial] = useState("");
  const [rawHeard, setRawHeard] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [grokOn, setGrokOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  /** Committed final text for current turn */
  const finalBufRef = useRef("");
  /** Latest interim (replaced each result) */
  const interimBufRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const convoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAskRef = useRef("");
  const lastAskAtRef = useRef(0);
  const pttBufRef = useRef("");
  const pttRef = useRef(false);
  const bootGenRef = useRef(0);
  const askingRef = useRef(false);
  /** Business-agent multi-turn state (finish WO, etc.) */
  const pendingActionRef = useRef<{
    action: string;
    partial: Record<string, string>;
    phase?: "clarify" | "confirm";
  } | null>(null);
  const langRef = useRef<CarinaLang>(DEFAULT_LANG);
  const [langLabel, setLangLabel] = useState(DEFAULT_LANG.name);

  const handleResultRef = useRef<
    (finalChunk: string, interim: string) => void
  >(() => {});
  const flushAskRef = useRef<() => void>(() => {});
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
    const stored = loadStoredLang();
    langRef.current = stored;
    setLangLabel(stored.name);
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

  const clearBuf = useCallback(() => {
    finalBufRef.current = "";
    interimBufRef.current = "";
    setPartial("");
  }, []);

  const currentUtterance = useCallback(() => {
    return (finalBufRef.current + " " + interimBufRef.current).trim();
  }, []);

  const extendConvo = useCallback(() => {
    if (convoTimerRef.current) clearTimeout(convoTimerRef.current);
    convoTimerRef.current = setTimeout(() => {
      if (modeRef.current === "command" || modeRef.current === "wake") {
        setModeBoth("wake");
        clearBuf();
        if (wantListenRef.current) {
          setStatus(`Listening for “${nameRef.current}”…`);
        }
      }
    }, CONVO_MS);
  }, [clearBuf, setModeBoth]);

  const stopSpeaking = useCallback(() => {
    speakGenRef.current = carinaBumpAudioGen();
    speakingTextRef.current = "";
    carinaStopAllAudio();
    audioRef.current = null;
  }, []);

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
      rec.onspeechend = null;
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
   * Chrome-reliable pattern: continuous=false + restart on end.
   * continuous=true often stops delivering results without erroring.
   */
  const bootRecognition = useCallback(() => {
    if (!wantListenRef.current) return;
    if (host !== "shell") return;
    if (typeof window === "undefined") return;
    if (carinaIsSpeaking() || modeRef.current === "speaking") return;
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError("Use Chrome or Edge on HTTPS for voice.");
      return;
    }

    const gen = ++bootGenRef.current;
    killRecognition();

    const rec = new Ctor();
    // Non-continuous + loop is more reliable than continuous=true on Chrome
    rec.continuous = false;
    rec.interimResults = true;
    // Follow Carina's reply language (default en-US)
    rec.lang = langRef.current.code || "en-US";
    if (typeof rec.maxAlternatives === "number") rec.maxAlternatives = 3;

    rec.onstart = () => {
      if (bootGenRef.current !== gen) return;
      setRecAlive(true);
    };

    rec.onresult = (ev) => {
      if (bootGenRef.current !== gen) return;
      let finals = "";
      let interim = "";
      // Also scan alternatives for wake-name mishears (Chrome often puts
      // "Carina" on alt 1–2 while alt 0 is "Karen" / "Katrina").
      let wakeHint = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        let best = "";
        try {
          best = (r[0]?.transcript || "").trim();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyR = r as any;
          const n = typeof anyR.length === "number" ? anyR.length : 1;
          for (let a = 0; a < Math.min(n, 3); a++) {
            const alt = (anyR[a]?.transcript || "").trim();
            if (alt && includesWake(alt, nameRef.current)) {
              wakeHint = alt;
              // Prefer alt that contains the wake word as the best text
              if (a === 0 || !includesWake(best, nameRef.current)) {
                best = best && a === 0 ? best : alt;
              }
            }
          }
        } catch {
          best = "";
        }
        if (!best) continue;
        if (r.isFinal) finals += best + " ";
        else interim += best + " ";
      }
      // If primary transcript missed the name but an alternative had it, merge
      if (wakeHint && !includesWake(finals + " " + interim, nameRef.current)) {
        interim = (interim + " " + wakeHint).trim();
      }
      const finalText = finals.trim();
      const interimText = interim.trim();
      const display = (finalText || interimText).trim();
      if (display) setRawHeard(display);

      if (pttRef.current) {
        if (finalText) {
          pttBufRef.current = (pttBufRef.current + " " + finalText).trim();
          setPartial(pttBufRef.current);
        } else if (interimText) {
          setPartial((pttBufRef.current + " " + interimText).trim());
        }
        return;
      }

      handleResultRef.current(finalText, interimText);
    };

    rec.onerror = (ev) => {
      if (bootGenRef.current !== gen) return;
      if (ev.error === "not-allowed") {
        setError("Microphone permission denied — allow mic in the address bar.");
        wantListenRef.current = false;
        setListening(false);
        setModeBoth("off");
        setStatus("Off — mic blocked");
        killRecognition();
        return;
      }
      // no-speech is normal for short sessions — onend restarts
      if (ev.error === "network") {
        setError("Speech network glitch — retrying…");
      }
    };

    rec.onend = () => {
      if (bootGenRef.current !== gen) return;
      setRecAlive(false);
      if (!wantListenRef.current) return;
      // If we still have a pending utterance when the session ends, flush it
      if (
        (modeRef.current === "command" || modeRef.current === "wake") &&
        currentUtterance().length > 2
      ) {
        // Let silence timer handle it; re-arm if missing
        if (!silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            flushAskRef.current();
          }, 400);
        }
      }
      restartTimerRef.current = setTimeout(() => {
        if (!wantListenRef.current) return;
        if (bootGenRef.current !== gen) return;
        // Same instance restart is fine for non-continuous
        try {
          rec.start();
          setRecAlive(true);
        } catch {
          bootRecognition();
        }
      }, RESTART_MS);
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      restartTimerRef.current = setTimeout(() => {
        if (wantListenRef.current && bootGenRef.current === gen) {
          bootRecognition();
        }
      }, 400);
    }
  }, [currentUtterance, host, killRecognition, setModeBoth]);

  const scheduleBoot = useCallback(
    (delayMs = 200) => {
      if (host !== "shell") return;
      bootGenRef.current += 1; // invalidate current loop
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (wantListenRef.current && !carinaIsSpeaking()) bootRecognition();
      }, delayMs);
    },
    [bootRecognition, host]
  );

  const speak = useCallback(
    async (text: string) => {
      // Settings page must not run a second audio channel
      if (host === "page") {
        return;
      }
      const spoken = text
        .replace(/\*\*/g, "")
        .replace(/`+/g, "")
        .replace(/#{1,6}\s/g, "")
        .replace(/\|/g, " ")
        .replace(/\n{2,}/g, ". ")
        .replace(/\n/g, " ")
        .trim();
      if (!spoken) return;

      speakingTextRef.current = spoken;
      speakStartedAtRef.current = Date.now();
      setModeBoth("speaking");
      setStatus(`Speaking… say “${nameRef.current}” to interrupt`);
      setError(null);

      // Pause recognition while speaking to avoid self-echo loops
      try {
        recRef.current?.stop();
      } catch {
        // ignore
      }

      const genBefore = carinaBumpAudioGen();
      speakGenRef.current = genBefore;
      await carinaPlaySpeech(spoken, {
        language: ttsLanguageCode(langRef.current),
        voiceId: DEFAULT_VOICE_ID,
      });

      // Another speak may have started
      if (carinaIsSpeaking()) return;
      speakingTextRef.current = "";
      setModeBoth("command");
      extendConvo();
      setStatus(
        wantListenRef.current
          ? `Listening… (say “${nameRef.current}” or just ask)`
          : "Off"
      );
      if (wantListenRef.current) scheduleBoot(400);
    },
    [extendConvo, host, scheduleBoot, setModeBoth]
  );

  const ask = useCallback(
    (raw: string) => {
      let text = raw.trim();
      if (!text || askingRef.current || globalAskLock) return;
      // Don't process while another utterance is still playing
      if (carinaIsSpeaking() && modeRef.current === "speaking") return;

      const now = Date.now();
      const key = normalize(text);
      if (key === lastAskRef.current && now - lastAskAtRef.current < 2800) {
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
          clearBuf();
          return;
        }
        text = after;
      }

      if (text.length < 2) return;

      if (modeRef.current === "speaking") stopSpeaking();

      clearSilence();
      clearBuf();
      setLastHeard(text);
      setModeBoth("thinking");
      setStatus("Thinking…");
      setError(null);
      setBusy(true);
      askingRef.current = true;
      globalAskLock = true;
      extendConvo();

      historyRef.current = [
        ...historyRef.current.slice(-8),
        { role: "user", content: text },
      ];

      // Plain async — do NOT use startTransition (defers the reply)
      void (async () => {
        try {
          const result = await actionAiConversation(historyRef.current, {
            pendingAction: pendingActionRef.current,
            language: langRef.current.code,
            source: "APP",
          });
          if (!result.ok) {
            setError(result.error);
            setLastReply(result.error);
            setModeBoth("command");
            setStatus("Error — still listening");
            await speak(
              "Sorry, I could not reach the plant assistant. Please try again in a moment."
            );
            return;
          }
          // Persist language if model / switch path returned a code
          if (result.language) {
            const next = resolveLang(result.language);
            langRef.current = next;
            storeLang(next);
            setLangLabel(next.name);
          }
          historyRef.current = [
            ...historyRef.current,
            { role: "assistant", content: result.text },
          ];
          setLastReply(result.text);
          setError(null);

          // Navigate after agent action (open PR, WO, module, etc.)
          if (result.href && typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("forge:carina-navigate", {
                detail: { href: result.href },
              })
            );
          }

          // Multi-turn agent (confirm / clarify)
          pendingActionRef.current = result.pendingAction ?? null;
          if (result.pendingAction?.phase === "confirm") {
            setStatus("Waiting for yes/no…");
          } else if (result.pendingAction?.phase === "clarify") {
            setStatus("Need a bit more info…");
          }

          const guide = result.guide;
          const willTour = !!(
            guide?.tourId ||
            (guide?.steps && guide.steps.length)
          );
          const userQ = text;
          const pointMode = wantsPointOnly(userQ);
          let point:
            | { selector: string; route?: string; label?: string }
            | null = null;
          if (pointMode) {
            const a = bestPointAnchor(userQ);
            if (a?.selector) {
              point = {
                selector: a.selector,
                route: a.route,
                label: a.label,
              };
            } else if (guide?.steps?.[0]?.selector) {
              point = {
                selector: guide.steps[0].selector!,
                route: guide.steps[0].route,
                label: guide.steps[0].title,
              };
            }
          }

          if (point && typeof window !== "undefined") {
            await speak(result.text.replace(/\n+/g, " ").slice(0, 320));
            setStatus("Highlighting…");
            window.dispatchEvent(
              carinaPointEvent({
                selector: point.selector,
                route: point.route,
                label: point.label || "Here",
                ms: 3200,
              })
            );
            setStatus(
              wantListenRef.current || host === "page"
                ? `Listening… (say “${nameRef.current}”)`
                : "Highlighted"
            );
          } else if (willTour && typeof window !== "undefined") {
            // Tour narration owns speech — only a short ack so we don't double-talk
            setLastReply(result.text);
            setStatus("Opening walkthrough…");
            window.dispatchEvent(
              startCarinaGuideEvent({
                tourId: guide?.tourId,
                steps: guide?.steps,
                autoAdvance: true,
                voice: true,
              })
            );
            setStatus(
              wantListenRef.current
                ? `Walkthrough running — say “${nameRef.current}” when done`
                : "Walkthrough running"
            );
            // Resume listen after a beat without stacking TTS
            if (wantListenRef.current) scheduleBoot(800);
          } else {
            await speak(result.text);
          }

          if (result.pendingAction) {
            setModeBoth("command");
            extendConvo();
            setStatus(
              result.pendingAction.phase === "confirm"
                ? "Say yes to confirm, or no to cancel"
                : "Listening for your answer…"
            );
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed";
          setError(msg);
          setLastReply(msg);
          setModeBoth("command");
          setStatus("Error — still listening");
          if (wantListenRef.current) scheduleBoot(200);
        } finally {
          askingRef.current = false;
          globalAskLock = false;
          setBusy(false);
        }
      })();
    },
    [
      clearBuf,
      clearSilence,
      extendConvo,
      scheduleBoot,
      setModeBoth,
      speak,
      stopSpeaking,
    ]
  );

  useEffect(() => {
    askRef.current = ask;
  }, [ask]);

  /** Send whatever we have buffered (final + interim). */
  const flushAsk = useCallback(() => {
    silenceTimerRef.current = null;
    if (askingRef.current) return;
    if (modeRef.current === "thinking" || modeRef.current === "speaking") return;

    const full = currentUtterance();
    finalBufRef.current = "";
    interimBufRef.current = "";
    setPartial("");

    if (full.length < 2) return;

    const wake = nameRef.current;
    // Still need wake if in wake mode
    if (modeRef.current === "wake") {
      if (!includesWake(full, wake)) {
        // Discard non-wake speech
        return;
      }
    }

    // Name alone → ready for follow-up
    const after = includesWake(full, wake) ? stripWake(full, wake) : full;
    if (after.length < 2) {
      setModeBoth("command");
      extendConvo();
      setStatus(`Yes? I'm ${wake} — go ahead`);
      return;
    }

    askRef.current(full);
  }, [currentUtterance, extendConvo, setModeBoth]);

  useEffect(() => {
    flushAskRef.current = flushAsk;
  }, [flushAsk]);

  const armSilence = useCallback(() => {
    clearSilence();
    silenceTimerRef.current = setTimeout(() => {
      flushAskRef.current();
    }, SILENCE_MS);
  }, [clearSilence]);

  const handleResult = useCallback(
    (finalChunk: string, interim: string) => {
      const wake = nameRef.current;
      const modeNow = modeRef.current;
      const heard = (finalChunk || interim).trim();
      if (!heard) return;

      // ── SPEAKING: name-only interrupt ──
      if (modeNow === "speaking") {
        if (Date.now() - speakStartedAtRef.current < SPEAK_GUARD_MS) return;
        if (!includesWake(heard, wake)) return;
        if (isLikelyEcho(heard, speakingTextRef.current, wake)) return;

        const after = stripWake(heard, wake);
        const pureName = after.length < 2;
        // Allow interim pure-name barge-in; require more for long phrases
        if (!finalChunk && !pureName && after.length < 4) return;

        stopSpeaking();
        clearBuf();
        setModeBoth("command");
        extendConvo();

        if (after.length > 2) {
          setStatus("Interrupted — thinking…");
          askRef.current(heard);
        } else {
          setStatus(`Yes? (you said ${wake}) — go ahead`);
          if (wantListenRef.current) scheduleBoot(200);
        }
        return;
      }

      if (modeNow === "thinking" || modeNow === "off") return;

      // Commit finals into rolling buffer; interim is the live tail
      if (finalChunk) {
        // Non-continuous sessions often re-send the whole final each time
        const prev = finalBufRef.current.trim();
        const next = finalChunk.trim();
        if (!prev) {
          finalBufRef.current = next;
        } else if (next.startsWith(prev) || prev.startsWith(next)) {
          finalBufRef.current = next.length >= prev.length ? next : prev;
        } else if (!prev.includes(next)) {
          finalBufRef.current = (prev + " " + next).trim();
        }
      }
      interimBufRef.current = interim;
      const full = currentUtterance();
      setPartial(full.slice(-160));

      // ── WAKE: must hear name before we treat speech as a command ──
      if (modeNow === "wake") {
        if (!includesWake(full, wake)) {
          setStatus(`Listening for “${wake}”…`);
          return;
        }
        // Woke — switch to command and keep collecting
        setModeBoth("command");
        extendConvo();
        const after = stripWake(full, wake);
        if (after.length > 2) {
          setStatus("Hearing you…");
          armSilence();
        } else {
          setStatus(`Yes? I'm ${wake} — ask me anything`);
          // Keep listening; don't flush yet
          armSilence();
        }
        return;
      }

      // ── COMMAND: any speech; send after pause ──
      if (modeNow === "command") {
        setStatus("Hearing you…");
        extendConvo();
        armSilence();
      }
    },
    [
      armSilence,
      clearBuf,
      currentUtterance,
      extendConvo,
      scheduleBoot,
      setModeBoth,
      stopSpeaking,
    ]
  );

  useEffect(() => {
    handleResultRef.current = handleResult;
  }, [handleResult]);

  const startListening = useCallback(async () => {
    // Settings page does not own the mic — shell engine does (survives navigation)
    if (host === "page") {
      persistWantListen(true);
      window.dispatchEvent(enableCarinaVoiceEvent());
      setListening(true);
      setStatus(`Listening site-wide for “${nameRef.current}”…`);
      setError(null);
      return;
    }

    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError("Use Chrome or Edge on https://www.forge-rp.live for voice.");
      return;
    }
    const stored = loadStoredLang();
    langRef.current = stored;
    setLangLabel(stored.name);
    try {
      if (!window.isSecureContext) {
        setError("Needs HTTPS.");
        return;
      }
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
      persistWantListen(false);
      return;
    }

    if (shellEngineActive && wantListenRef.current) {
      // Already running — don't stack engines
      setListening(true);
      setStatus(`Listening for “${nameRef.current}”… (any page)`);
      return;
    }
    shellEngineActive = true;
    wantListenRef.current = true;
    persistWantListen(true);
    setListening(true);
    setModeBoth("wake");
    setStatus(`Listening for “${nameRef.current}”… (any page)`);
    setError(null);
    clearBuf();
    setRawHeard("");
    bootRecognition();
  }, [bootRecognition, clearBuf, host, setModeBoth]);

  const stopListening = useCallback(() => {
    if (host === "page") {
      persistWantListen(false);
      window.dispatchEvent(stopCarinaVoiceEvent());
      setListening(false);
      setModeBoth("off");
      setStatus("Off");
      return;
    }
    wantListenRef.current = false;
    shellEngineActive = false;
    persistWantListen(false);
    bootGenRef.current += 1;
    killRecognition();
    stopSpeaking();
    carinaStopAllAudio();
    clearSilence();
    clearBuf();
    if (convoTimerRef.current) clearTimeout(convoTimerRef.current);
    setListening(false);
    setModeBoth("off");
    setPtt(false);
    pttRef.current = false;
    setStatus("Off");
    setBusy(false);
    askingRef.current = false;
    globalAskLock = false;
  }, [clearBuf, clearSilence, host, killRecognition, setModeBoth, stopSpeaking]);

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
      // Page instance must NOT kill shell mic when leaving /ai
      if (host !== "shell") return;
      // Shell unmount (rare): stop engine but keep session flag so remount resumes
      bootGenRef.current += 1;
      killRecognition();
      stopSpeaking();
      clearSilence();
      if (convoTimerRef.current) clearTimeout(convoTimerRef.current);
    };
  }, [clearSilence, host, killRecognition, stopSpeaking]);

  // Shell owns mic: enable/stop from bubble or settings page
  useEffect(() => {
    if (host !== "shell") {
      // Mirror shell listen state into settings UI
      const onChange = (e: Event) => {
        const on = !!(e as CustomEvent).detail?.listening;
        setListening(on);
        setStatus(
          on
            ? `Listening site-wide for “${nameRef.current}”…`
            : "Off — enable mic once (works everywhere)"
        );
        if (on) setModeBoth("wake");
        else setModeBoth("off");
      };
      window.addEventListener("forge:carina-listen-changed", onChange);
      setListening(readWantListen());
      return () =>
        window.removeEventListener("forge:carina-listen-changed", onChange);
    }

    const onEnable = () => {
      void startListening();
    };
    const onStop = () => {
      stopListening();
    };
    window.addEventListener("forge:carina-enable-voice", onEnable);
    window.addEventListener("forge:carina-stop-voice", onStop);
    // Resume after refresh / soft remount if user left mic on
    if (readWantListen()) {
      void startListening();
    }
    return () => {
      window.removeEventListener("forge:carina-enable-voice", onEnable);
      window.removeEventListener("forge:carina-stop-voice", onStop);
    };
  }, [host, setModeBoth, startListening, stopListening]);

  async function saveName() {
    const clean = nameDraft.trim() || DEFAULT_NAME;
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  async function runSmokeTest() {
    setError(null);
    setStatus("Testing Carina voice…");
    setLastHeard("(diagnostic test)");
    setBusy(true);
    try {
      const probe = await actionProbeGrok();
      if (!probe.ok) {
        setError(probe.error || "AI connection failed");
        setLastReply(probe.error || "AI connection failed");
        setGrokOn(probe.configured);
        setStatus("AI test failed");
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
      if (!wantListenRef.current) await startListening();
      await speak(result.text);
    } finally {
      setBusy(false);
    }
  }

  const speaking = mode === "speaking";
  const awake = mode === "command" || mode === "thinking";

  // Shell host: engine only — no floating status bubble (voice UI is in help chat)
  if (host === "shell" || compact) {
    return null;
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
            Tap <strong>Enable always-on mic</strong> once — stays on across the
            ERP until you stop. Say <strong>&ldquo;{name}, …&rdquo;</strong>.
            Ask <strong>&ldquo;where is the … button?&rdquo;</strong> for a quick
            highlight (page stays usable), or{" "}
            <strong>&ldquo;show me how…&rdquo;</strong> for a full walkthrough.
            ERP only. Interrupt with her name.
            {grokOn ? " AI connected." : " Needs XAI_API_KEY on the server."}
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
            onClick={() => void saveName()}
            disabled={busy}
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
            ? `Listening site-wide for “${name}”`
            : "Enable always-on mic"}
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
        {mode === "thinking" && (
          <span className="ml-2 rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-300">
            Thinking
          </span>
        )}
      </p>

      {(partial || rawHeard) && (
        <p className="text-xs italic text-slate-500">
          Hearing: {partial || rawHeard}
        </p>
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
        Examples: “{name}, how is the production floor?” · “{name}, show me how
        to create a work order” · “{name}, walk me through MRB” · “{name},
        finish work order WO-10042”. If “Hearing:” never updates, use
        Chrome/Edge on HTTPS with mic allowed and the tab focused.
      </p>

      <details className="text-[11px] text-slate-600">
        <summary className="cursor-pointer text-slate-500 hover:text-slate-400">
          Advanced / diagnostics
        </summary>
        <div className="mt-2">
          <button
            type="button"
            onClick={() => void runSmokeTest()}
            disabled={busy}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-700 px-3 text-xs text-slate-400 hover:text-slate-200"
          >
            Test Carina voice (diagnostic only)
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
