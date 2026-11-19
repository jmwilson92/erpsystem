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
 * Critical Chrome / Edge quirks we handle:
 *   - SpeechRecognition often ends mid-session → auto-restart loop
 *   - Edge continuous mode dies quickly and fires `network` without onend
 *     → new instance + backoff, never rec.start() on a dead recognizer
 *   - Edge one-shot ends (onend / no-speech) are normal: keep "listening",
 *     do not abort, match wake / PTT transcripts, then start a new instance
 *   - Many utterances only get interim results (no final) → send on silence
 *   - TTS audio kills the recognizer → reboot after every speak
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Mic, MicOff, Volume2, Radio } from "lucide-react";
import {
  actionGetAssistantName,
  actionGrokStatus,
  actionSetAssistantName,
  actionVoiceSmokeTest,
  actionProbeGrok,
} from "@/app/ai/actions";
import { helpMetaReply } from "@/lib/ai-help/meta";
import { composeUtterance } from "@/lib/ai-help/utterance";
import {
  WATCHDOG_MS,
  classifyRecognitionError,
  collectRecognitionTranscripts,
  commitPttTranscript,
  planRecognitionEnd,
  shouldWatchdogReboot,
} from "@/lib/ai-help/recognition-cycle";
import { streamCarinaConversation } from "@/lib/ai-help/conversation-client";
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
  carinaVoiceStatusEvent,
  enableCarinaVoiceEvent,
  persistWantListen,
  readWantListen,
  stopCarinaVoiceEvent,
  carinaPendingEvent,
} from "@/lib/carina-voice-bus";
import type { AiPendingAction } from "@/lib/services/ai";
import {
  carinaPlaySpeech,
  carinaStopAllAudio,
  carinaBumpAudioGen,
  carinaIsSpeaking,
  carinaBeginSpeechHold,
  carinaStartReply,
  carinaEnqueueCumulative,
  carinaFinishReply,
  carinaWarmTts,
  carinaLastSpeakTimings,
} from "@/lib/carina-audio";
import {
  MIC_AUDIO_CONSTRAINTS,
  createVoiceDebugLog,
  shouldShowVoiceDebug,
} from "@/lib/ai-help/voice-debug";
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
/** Wait for a real pause. Edge one-shot sessions end mid-sentence; do not flush on onend. */
const SILENCE_AFTER_FINAL_MS = 1100;
const SILENCE_INTERIM_ONLY_MS = 1500;
const SPEAK_GUARD_MS = 800;

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

/** Chromium Edge (desktop/Android/iOS). Its Web Speech continuous mode is flaky. */
function isChromiumEdge(): boolean {
  if (typeof navigator === "undefined") return false;
  return /\bEdg(e|A|iOS)?\//.test(navigator.userAgent);
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
      /\b(carina|karina|corina|corrina|korina|careena|kareena|coreena|karrina|karinna|carinna|katrina|carena|karena|kerina|karrena|serina|sarina|marina|farina|carine|karine|karen|carrie|kari|cara)\b/.test(
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
      /\b(hey|hi|ok|okay|yo)?\s*(carina|karina|corina|corrina|korina|careena|kareena|coreena|karrina|karinna|carinna|katrina|carena|karena|kerina|karrena|serina|sarina|marina|farina|carine|karine|karen|carrie|kari|cara)\b[,.!?]?/gi,
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
  const pttRecRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const voiceDebugRef = useRef(createVoiceDebugLog());
  const [voiceDebugOn, setVoiceDebugOn] = useState(false);
  const [voiceDebugText, setVoiceDebugText] = useState("");
  const debugVoice = (event: string, detail?: string) => {
    voiceDebugRef.current.push(event, detail);
    if (voiceDebugOn) setVoiceDebugText(voiceDebugRef.current.format());
  };
  const bootGenRef = useRef(0);
  const recAliveRef = useRef(false);
  const networkFailsRef = useRef(0);
  const startingRef = useRef(false);
  const askingRef = useRef(false);
  /** Business-agent multi-turn state (finish WO, etc.) */
  const pendingActionRef = useRef<AiPendingAction | null>(null);
  useEffect(() => {
    const onPending = (e: Event) => {
      const pending = (e as CustomEvent).detail as AiPendingAction | null;
      pendingActionRef.current = pending ?? null;
    };
    window.addEventListener("forge:carina-pending", onPending);
    return () => window.removeEventListener("forge:carina-pending", onPending);
  }, []);
  const langRef = useRef<CarinaLang>(DEFAULT_LANG);
  const [langLabel, setLangLabel] = useState(DEFAULT_LANG.name);

  const handleResultRef = useRef<
    (finalChunk: string, interim: string) => void
  >(() => {});
  const flushAskRef = useRef<() => void>(() => {});
  const armSilenceRef = useRef<() => void>(() => {});
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
    return composeUtterance(finalBufRef.current, interimBufRef.current);
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

  const detachRecognition = useCallback(
    (opts?: { abort?: boolean; markDead?: boolean }) => {
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
        if (opts?.abort) {
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
      }
      if (opts?.markDead) {
        recAliveRef.current = false;
        setRecAlive(false);
        try {
          window.dispatchEvent(
            new CustomEvent("forge:carina-rec-alive", {
              detail: { recAlive: false },
            })
          );
        } catch {
          // ignore
        }
      }
    },
    []
  );

  const killRecognition = useCallback(() => {
    startingRef.current = false;
    detachRecognition({ abort: true, markDead: true });
  }, [detachRecognition]);

  const setRecAliveBoth = useCallback((alive: boolean) => {
    recAliveRef.current = alive;
    setRecAlive(alive);
    try {
      window.dispatchEvent(
        new CustomEvent("forge:carina-rec-alive", { detail: { recAlive: alive } })
      );
      window.dispatchEvent(
        carinaVoiceStatusEvent({
          listening: wantListenRef.current,
          recAlive: alive,
          error: null,
          supported: !!getSpeechRecognition(),
        })
      );
    } catch {
      // ignore
    }
  }, []);

  /**
   * Restart-on-end with a new instance. Planned Edge one-shot ends stay
   * "listening" — no abort, no reconnecting flash, no audio drop.
   */
  const bootRecognition = useCallback(() => {
    if (!wantListenRef.current) return;
    if (host !== "shell") return;
    if (typeof window === "undefined") return;
    if (startingRef.current) return;
    // Only skip while audio is actually playing (not a stuck mode flag)
    if (carinaIsSpeaking()) {
      restartTimerRef.current = setTimeout(() => {
        if (wantListenRef.current && !carinaIsSpeaking()) bootRecognition();
      }, 500);
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError("Use Chrome or Edge on HTTPS for voice.");
      return;
    }

    startingRef.current = true;
    const gen = ++bootGenRef.current;
    // Never abort a just-ended or still-usable session; aborting on Edge
    // drops the last audio and often starts an aborted/network loop.
    detachRecognition({ abort: false, markDead: false });

    const rec = new Ctor();
    const edge = isChromiumEdge();
    // Edge's continuous recognizer often ends in a second and then throws
    // `network`. One-shot + new-instance restart is far more reliable there.
    rec.continuous = !edge;
    rec.interimResults = true;
    rec.lang = langRef.current.code || "en-US";
    if (typeof rec.maxAlternatives === "number") rec.maxAlternatives = 3;

    rec.onstart = () => {
      if (bootGenRef.current !== gen) return;
      startingRef.current = false;
      networkFailsRef.current = 0;
      setRecAliveBoth(true);
      setError(null);
      if (modeRef.current === "off" || modeRef.current === "wake") {
        setStatus(`Listening for “${nameRef.current}”… (any page)`);
      }
    };

    rec.onresult = (ev) => {
      if (bootGenRef.current !== gen) return;
      // A throw here used to kill the Edge session and flash "reconnecting"
      // on any speech. Swallow it and keep the recognizer alive.
      try {
        if (carinaIsSpeaking() && !pttRef.current) {
          debugVoice("ignore-result", "speaking");
          return;
        }
        setRecAliveBoth(true);
        const { finalText, interimText } = collectRecognitionTranscripts(
          ev,
          (text) => includesWake(text, nameRef.current)
        );
        const display = (finalText || interimText).trim();
        if (display) setRawHeard(display);

        if (pttRef.current) {
          if (finalText) {
            pttBufRef.current = commitPttTranscript(pttBufRef.current, finalText, "");
            interimBufRef.current = "";
            setPartial(pttBufRef.current);
          } else if (interimText) {
            interimBufRef.current = interimText;
            setPartial(commitPttTranscript(pttBufRef.current, "", interimText));
          }
          return;
        }

        handleResultRef.current(finalText, interimText);
      } catch {
        // Leave recAlive as-is. onend will do a planned restart if the
        // engine ends the one-shot session after speech.
      }
    };

    rec.onerror = (ev) => {
      if (bootGenRef.current !== gen) return;
      startingRef.current = false;
      const reason = classifyRecognitionError(ev.error);
      if (reason === "not-allowed") {
        const msg =
          "Microphone permission denied — click the lock icon in the address bar and allow the mic, then tap Voice on.";
        setError(msg);
        wantListenRef.current = false;
        shellEngineActive = false;
        persistWantListen(false);
        setListening(false);
        setModeBoth("off");
        setStatus("Off — mic blocked");
        setRecAliveBoth(false);
        try {
          window.dispatchEvent(
            carinaVoiceStatusEvent({
              listening: false,
              recAlive: false,
              error: msg,
              supported: true,
            })
          );
        } catch {
          // ignore
        }
        killRecognition();
        return;
      }
      const plan = planRecognitionEnd({
        reason,
        edge: isChromiumEdge(),
        networkFails: networkFailsRef.current,
        ptt: pttRef.current,
        wantListen: wantListenRef.current,
        speaking: carinaIsSpeaking(),
        finalText: pttRef.current ? "" : finalBufRef.current,
        interimText: interimBufRef.current,
        pttBuf: pttBufRef.current,
      });
      if (plan.processPttInterim) {
        pttBufRef.current = plan.pttBuf;
        if (plan.pttBuf) setPartial(plan.pttBuf);
      }
      if (plan.processWakeBeforeRestart && plan.committedFinal) {
        finalBufRef.current = plan.committedFinal;
        interimBufRef.current = "";
        handleResultRef.current(plan.committedFinal, "");
      }
      if (plan.incrementNetworkFails) {
        networkFailsRef.current += 1;
      }
      // no-speech / aborted: keep listening; onend restarts without a flash
      if (plan.keepRecAlive) return;

      if (plan.showReconnecting) {
        const msg =
          reason === "service-not-allowed"
            ? "Speech service unavailable — retrying…"
            : "Speech recognition dropped — retrying…";
        setError(msg);
        setRecAliveBoth(false);
        try {
          window.dispatchEvent(
            carinaVoiceStatusEvent({
              listening: true,
              recAlive: false,
              error: msg,
              supported: true,
            })
          );
        } catch {
          // ignore
        }
        if (plan.restartDelayMs != null) {
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (!wantListenRef.current) return;
            if (carinaIsSpeaking()) return;
            bootRecognition();
          }, plan.restartDelayMs);
        }
      }
    };

    rec.onend = () => {
      if (bootGenRef.current !== gen) return;
      startingRef.current = false;
      const plan = planRecognitionEnd({
        reason: "onend",
        edge: isChromiumEdge(),
        networkFails: networkFailsRef.current,
        ptt: pttRef.current,
        wantListen: wantListenRef.current,
        speaking: carinaIsSpeaking() || modeRef.current === "speaking",
        finalText: pttRef.current ? "" : finalBufRef.current,
        interimText: interimBufRef.current,
        pttBuf: pttBufRef.current,
      });

      // Promote unfinalized interim so the next Edge one-shot session
      // does not overwrite it. Do not flush here — sessions end mid-phrase.
      if (!pttRef.current && plan.committedFinal) {
        finalBufRef.current = plan.committedFinal;
        interimBufRef.current = "";
      } else if (pttRef.current) {
        interimBufRef.current = "";
      }
      if (plan.processPttInterim) {
        pttBufRef.current = plan.pttBuf;
        if (plan.pttBuf) setPartial(plan.pttBuf);
      }
      if (plan.processWakeBeforeRestart) {
        if (plan.committedFinal) {
          handleResultRef.current(plan.committedFinal, "");
        }
        if (
          (modeRef.current === "command" || modeRef.current === "wake") &&
          currentUtterance().length > 2
        ) {
          armSilenceRef.current();
        }
      }

      if (!wantListenRef.current) {
        setRecAliveBoth(false);
        return;
      }

      if (plan.keepRecAlive) {
        recAliveRef.current = true;
      } else if (plan.showReconnecting) {
        setRecAliveBoth(false);
      }

      // Don't fight TTS — leave the mic stream alone and boot after onend of speech.
      if (carinaIsSpeaking() || modeRef.current === "speaking" || plan.restartDelayMs == null) {
        if (recRef.current === rec) {
          rec.onresult = null;
          rec.onerror = null;
          rec.onend = null;
          rec.onstart = null;
          rec.onspeechend = null;
          recRef.current = null;
        }
        debugVoice("rec-onend-held", "onend");
        return;
      }

      // Drop this ended instance without abort, then start a new one.
      if (recRef.current === rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.onstart = null;
        rec.onspeechend = null;
        recRef.current = null;
      }

      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (!wantListenRef.current) return;
        if (bootGenRef.current !== gen) return;
        if (carinaIsSpeaking()) return;
        // Always a new SpeechRecognition instance. Edge's rec.start() after
        // onend / network is often a no-op or immediately errors again.
        bootRecognition();
      }, plan.restartDelayMs);
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch (e) {
      startingRef.current = false;
      const alreadyStarted =
        e instanceof Error &&
        /already started|InvalidStateError/i.test(`${e.name} ${e.message}`);
      if (alreadyStarted && recRef.current === rec) {
        return;
      }
      restartTimerRef.current = setTimeout(() => {
        if (wantListenRef.current && bootGenRef.current === gen) {
          bootRecognition();
        }
      }, 400);
    }
  }, [
    currentUtterance,
    detachRecognition,
    host,
    killRecognition,
    setModeBoth,
    setRecAliveBoth,
  ]);

  const scheduleBoot = useCallback(
    (delayMs = 200) => {
      if (host !== "shell") return;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (!wantListenRef.current) return;
        if (carinaIsSpeaking()) {
          // Try again shortly — don't leave mic dead
          scheduleBoot(400);
          return;
        }
        bootRecognition();
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
      // Hold recognition (do not stop the mic stream or restart capture).
      // Results are ignored until this reply's audio ends.
      carinaBeginSpeechHold();
      setModeBoth("speaking");
      setStatus("Speaking…");
      setError(null);
      debugVoice("tts-start", spoken.slice(0, 80));
      await carinaPlaySpeech(spoken, {
        language: ttsLanguageCode(langRef.current),
        voiceId: DEFAULT_VOICE_ID,
      });
      const ttsTiming = carinaLastSpeakTimings();
      debugVoice(
        "tts-end",
        ttsTiming.timeToFirstAudioMs != null ? `ttfa=${ttsTiming.timeToFirstAudioMs}ms` : undefined
      );

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
      setStatus("On it…");
      setError(null);
      setBusy(true);
      void carinaWarmTts();
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
          const meta = helpMetaReply(text);
          if (meta) {
            const result = {
              ok: true as const,
              text: meta,
              source: "local" as const,
              pendingAction: null,
            };
            historyRef.current = [
              ...historyRef.current,
              { role: "assistant", content: result.text },
            ];
            setLastReply(result.text);
            setError(null);
            if (process.env.NODE_ENV !== "production") {
              console.info("[carina-voice]", { q: text, a: result.text, source: "local-meta" });
            }
            await speak(result.text);
            // Audit in the background; do not wait or speak again.
            void streamCarinaConversation(historyRef.current.slice(0, -1), {
              pendingAction: pendingActionRef.current,
              language: langRef.current.code,
              source: "APP",
              page: window.location.pathname,
            });
            return;
          }

          setStatus("On it…");
          const speechOpts = {
            language: ttsLanguageCode(langRef.current),
            voiceId: DEFAULT_VOICE_ID,
          };
          let speechOpen = false;
          const openSpeech = () => {
            if (host === "page" || speechOpen) return;
            speechOpen = true;
            speakStartedAtRef.current = Date.now();
            carinaStartReply();
            setModeBoth("speaking");
            setStatus("Speaking…");
          };
          const result = await streamCarinaConversation(historyRef.current, {
            pendingAction: pendingActionRef.current,
            language: langRef.current.code,
            source: "APP",
            page: window.location.pathname,
            onAck: () => {
              setStatus("On it…");
              void carinaWarmTts();
            },
            onDelta: (preview) => {
              setStatus(preview.slice(0, 80));
              if (host === "page" || !preview.trim()) return;
              openSpeech();
              speakingTextRef.current = preview;
              carinaEnqueueCumulative(preview, speechOpts);
            },
          });
          if (process.env.NODE_ENV !== "production" && result.ok) {
            console.info("[carina-voice]", {
              q: text,
              a: result.text.slice(0, 160),
              source: result.source,
              timing: result.timing,
            });
          }
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
          window.dispatchEvent(carinaPendingEvent(pendingActionRef.current));
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
            if (speechOpen) {
              speakingTextRef.current = result.text;
              await carinaFinishReply(result.text, speechOpts);
              const ttsTiming = carinaLastSpeakTimings();
              debugVoice(
                "tts-end",
                ttsTiming.timeToFirstAudioMs != null ? `ttfa=${ttsTiming.timeToFirstAudioMs}ms` : undefined
              );
              speakingTextRef.current = "";
            } else {
              await speak(result.text.replace(/\n+/g, " ").slice(0, 320));
            }
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
            if (speechOpen) carinaStopAllAudio();
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
          } else if (host === "page") {
            // Settings page must not run a second audio channel
          } else {
            openSpeech();
            speakingTextRef.current = result.text;
            await carinaFinishReply(result.text, speechOpts);
            const ttsTiming = carinaLastSpeakTimings();
            debugVoice(
              "tts-end",
              ttsTiming.timeToFirstAudioMs != null ? `ttfa=${ttsTiming.timeToFirstAudioMs}ms` : undefined
            );
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
      host,
      scheduleBoot,
      setModeBoth,
      speak,
      stopSpeaking,
    ]
  );

  useEffect(() => {
    askRef.current = ask;
  }, [ask]);

  /** Send the composed utterance after a real pause, not a stale/partial cut-off. */
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
    const ms = finalBufRef.current.trim()
      ? SILENCE_AFTER_FINAL_MS
      : SILENCE_INTERIM_ONLY_MS;
    silenceTimerRef.current = setTimeout(() => {
      flushAskRef.current();
    }, ms);
  }, [clearSilence]);
  useEffect(() => {
    armSilenceRef.current = armSilence;
  }, [armSilence]);


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
      const unsupported =
        "Voice listening isn’t supported in this browser. Use Microsoft Edge or Google Chrome on https://www.protessera.com, or type your question.";
      setError(unsupported);
      persistWantListen(false);
      try {
        window.dispatchEvent(
          carinaVoiceStatusEvent({
            listening: false,
            recAlive: false,
            error: unsupported,
            supported: false,
          })
        );
      } catch {
        // ignore
      }
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
      const live = streamRef.current?.getTracks().some((tr) => tr.readyState === "live");
      if (!live) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: MIC_AUDIO_CONSTRAINTS,
        });
        streamRef.current = stream;
      }
    } catch (e) {
      const msg = `Mic blocked: ${e instanceof Error ? e.message : String(e)}. Click the lock icon in the address bar, allow the microphone, then tap Voice on.`;
      setError(msg);
      persistWantListen(false);
      try {
        window.dispatchEvent(
          carinaVoiceStatusEvent({
            listening: false,
            recAlive: false,
            error: msg,
            supported: true,
          })
        );
      } catch {
        // ignore
      }
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
    void carinaWarmTts();
    // Always (re)boot — recovers from stuck "reconnecting" if engine was half-dead
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
    try {
      pttRecRef.current?.stop();
    } catch {
      // ignore
    }
    pttRecRef.current = null;
    streamRef.current?.getTracks().forEach((tr) => {
      try {
        tr.stop();
      } catch {
        // ignore
      }
    });
    streamRef.current = null;
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

  const ensureMicStream = useCallback(async () => {
    const live = streamRef.current?.getTracks().some((tr) => tr.readyState === "live");
    if (live) return streamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: MIC_AUDIO_CONSTRAINTS,
    });
    streamRef.current = stream;
    return stream;
  }, []);

  const stopPttRecognition = useCallback(() => {
    const rec = pttRecRef.current;
    pttRecRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    rec.onstart = null;
    try {
      rec.stop();
    } catch {
      // ignore
    }
  }, []);

  const startPttRecognition = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    stopPttRecognition();
    // Do not run the wake/listen recognizer at the same time as PTT.
    detachRecognition({ abort: false, markDead: false });
    const rec = new Ctor();
    const edge = isChromiumEdge();
    rec.continuous = !edge;
    rec.interimResults = true;
    rec.lang = langRef.current.code || "en-US";
    if (typeof rec.maxAlternatives === "number") rec.maxAlternatives = 3;
    rec.onresult = (ev) => {
      if (!pttRef.current || pttRecRef.current !== rec) return;
      try {
        const { finalText, interimText } = collectRecognitionTranscripts(
          ev,
          (text) => includesWake(text, nameRef.current)
        );
        const display = (finalText || interimText).trim();
        if (display) setRawHeard(display);
        if (finalText) {
          pttBufRef.current = commitPttTranscript(pttBufRef.current, finalText, "");
          interimBufRef.current = "";
          setPartial(pttBufRef.current);
        } else if (interimText) {
          interimBufRef.current = interimText;
          setPartial(commitPttTranscript(pttBufRef.current, "", interimText));
        }
        debugVoice("ptt-result", (finalText || interimText).slice(0, 80));
      } catch {
        // keep the PTT session
      }
    };
    rec.onend = () => {
      if (pttRecRef.current !== rec) return;
      pttRecRef.current = null;
      // Edge one-shot ends mid-hold: start a fresh PTT recognizer only while held.
      if (pttRef.current) {
        debugVoice("ptt-onend-restart");
        startPttRecognition();
      }
    };
    rec.onerror = () => {
      /* onend follows and restarts while held */
    };
    pttRecRef.current = rec;
    try {
      rec.start();
      debugVoice("ptt-rec-start");
    } catch {
      pttRecRef.current = null;
    }
  }, [detachRecognition, stopPttRecognition]);

  const pttDown = useCallback(async () => {
    if (modeRef.current === "speaking") stopSpeaking();
    try {
      await ensureMicStream();
    } catch (e) {
      const msg = `Mic blocked: ${e instanceof Error ? e.message : String(e)}. Allow the microphone, then hold Talk again.`;
      setError(msg);
      debugVoice("ptt-mic-blocked", msg);
      return;
    }
    if (!wantListenRef.current) {
      wantListenRef.current = true;
      shellEngineActive = true;
      persistWantListen(true);
      setListening(true);
    }
    pttBufRef.current = "";
    interimBufRef.current = "";
    setPtt(true);
    pttRef.current = true;
    setModeBoth("command");
    extendConvo();
    setStatus("Talk now… release when done");
    setPartial("");
    startPttRecognition();
  }, [ensureMicStream, extendConvo, setModeBoth, startPttRecognition, stopSpeaking]);

  const pttUp = useCallback(() => {
    if (!pttRef.current) return;
    setPtt(false);
    pttRef.current = false;
    stopPttRecognition();
    // Commit the final transcript, or the last interim if nothing finalized.
    const text = commitPttTranscript(
      pttBufRef.current,
      "",
      interimBufRef.current
    );
    pttBufRef.current = "";
    interimBufRef.current = "";
    setPartial("");
    debugVoice("ptt-up", text.slice(0, 80) || "(empty)");
    if (text.length > 1) ask(text);
    else {
      setModeBoth("command");
      setStatus(`Listening… (say “${nameRef.current}”)`);
    }
    if (wantListenRef.current) scheduleBoot(200);
  }, [ask, scheduleBoot, setModeBoth, stopPttRecognition]);

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
      // Mirror shell listen + rec-alive into settings UI
      const onChange = (e: Event) => {
        const d = (e as CustomEvent).detail as {
          listening?: boolean;
          recAlive?: boolean;
        };
        const on = !!d?.listening;
        setListening(on);
        if (typeof d?.recAlive === "boolean") setRecAlive(d.recAlive);
        setStatus(
          on
            ? `Listening site-wide for “${nameRef.current}”…`
            : "Off — enable mic once (works everywhere)"
        );
        if (on) setModeBoth("wake");
        else {
          setModeBoth("off");
          setRecAlive(false);
        }
      };
      const onAlive = (e: Event) => {
        const alive = !!(e as CustomEvent).detail?.recAlive;
        setRecAlive(alive);
      };
      window.addEventListener("forge:carina-listen-changed", onChange);
      window.addEventListener("forge:carina-rec-alive", onAlive);
      setListening(readWantListen());
      // Settings page is not the engine — if listening, show as live (shell owns mic)
      if (readWantListen()) setRecAlive(true);
      return () => {
        window.removeEventListener("forge:carina-listen-changed", onChange);
        window.removeEventListener("forge:carina-rec-alive", onAlive);
      };
    }

    const onEnable = () => {
      void startListening();
    };
    const onStop = () => {
      stopListening();
    };
    const onPttDown = () => {
      void pttDown();
    };
    const onPttUp = () => {
      pttUp();
    };
    window.addEventListener("forge:carina-enable-voice", onEnable);
    window.addEventListener("forge:carina-stop-voice", onStop);
    window.addEventListener("forge:carina-ptt-down", onPttDown);
    window.addEventListener("forge:carina-ptt-up", onPttUp);
    // Resume after refresh / soft remount if user left mic on
    if (readWantListen()) {
      void startListening();
    }

    // Watchdog: Edge can leave a dead recognizer after `network` without
    // onend. Do not reboot during a planned one-shot restart or in-flight start.
    const watchdog = window.setInterval(() => {
      if (
        shouldWatchdogReboot({
          wantListen: wantListenRef.current,
          speaking: carinaIsSpeaking() || modeRef.current === "speaking",
          thinking: modeRef.current === "thinking",
          restartPending: !!restartTimerRef.current,
          starting: startingRef.current,
          recExists: !!recRef.current,
          recAlive: recAliveRef.current,
        })
      ) {
        bootRecognition();
      }
    }, WATCHDOG_MS);

    return () => {
      window.removeEventListener("forge:carina-enable-voice", onEnable);
      window.removeEventListener("forge:carina-stop-voice", onStop);
      window.removeEventListener("forge:carina-ptt-down", onPttDown);
      window.removeEventListener("forge:carina-ptt-up", onPttUp);
      window.clearInterval(watchdog);
    };
  }, [bootRecognition, host, pttDown, pttUp, setModeBoth, startListening, stopListening]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = shouldShowVoiceDebug(window.location.search);
    setVoiceDebugOn(on);
    if (on) setVoiceDebugText(voiceDebugRef.current.format());
  }, []);

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

  const debugOverlay = voiceDebugOn ? (
    <div
      data-voice-debug="1"
      className="pointer-events-none fixed bottom-3 left-3 z-[9999] max-h-[40vh] max-w-[min(28rem,92vw)] overflow-auto rounded-md border border-amber-500/40 bg-black/80 p-2 font-mono text-[10px] leading-snug text-amber-100 shadow-lg"
    >
      <div className="mb-1 font-semibold text-amber-200">Carina voiceDebug</div>
      <div>
        mode={mode} listen={String(listening)} recAlive={String(recAlive)} rec={recRef.current ? "yes" : "no"} ptt={String(ptt)}{" "}
        speaking={String(carinaIsSpeaking())} stream={
          streamRef.current?.getTracks().some((tr) => tr.readyState === "live") ? "live" : "off"
        }
      </div>
      <div>status={status}</div>
      <pre className="mt-1 whitespace-pre-wrap text-amber-100/90">{voiceDebugText || "waiting for events…"}</pre>
    </div>
  ) : null;

  const speaking = mode === "speaking";
  const awake = mode === "command" || mode === "thinking";

  // Shell host: engine only — no floating status bubble (voice UI is in help chat)
  if (host === "shell" || compact) {
    return debugOverlay;
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
            {recAlive ? "mic live" : "starting mic…"}
          </span>
        )}
        {mode === "command" && (
          <span className="ml-2 rounded bg-teal-500/20 px-1.5 py-0.5 text-teal-300">
            In conversation
          </span>
        )}
        {mode === "speaking" && (
          <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200">
            Speaking
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
        I can answer permitted counts and, when an administrator enables Carina voice actions, propose confirm-gated record changes.
        Examples: “{name}, show me how to create a work order” · “{name},
        walk me through MRB” · “{name}, explain work order completion”.
        If “Hearing:” never updates, use
        Chrome/Edge on HTTPS with mic allowed and the tab focused.
      </p>

      {debugOverlay}

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
