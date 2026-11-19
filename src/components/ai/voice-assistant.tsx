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
 * Listening uses one getUserMedia stream, client energy VAD, and server STT
 * (xAI grok-voice-transcribe-2.0). Browser Web Speech is not used.
 * While she speaks, VAD stays on the AEC'd stream; sustained user energy
 * barges in (stops audio, clears the queue, aborts the turn). PTT press
 * interrupts immediately and transcribes on release.
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
import { includesWake, isLikelyEcho, normalizeHeard, stripWake } from "@/lib/ai-help/voice-wake";
import { startMicListen, voiceInputSupported, type ListenHandle } from "@/lib/carina-listen";
import { carinaWarmStt, transcribeUtterance } from "@/lib/carina-stt";
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

  const listenHandleRef = useRef<ListenHandle | null>(null);
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
  const streamRef = useRef<MediaStream | null>(null);
  const voiceDebugRef = useRef(createVoiceDebugLog());
  const [voiceDebugOn, setVoiceDebugOn] = useState(false);
  const [voiceDebugText, setVoiceDebugText] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [uttTiming, setUttTiming] = useState("");
  const lastUttRef = useRef<{ vadEndedAt: number; sttMs: number; text: string } | null>(null);
  const lastLevelUiRef = useRef(0);
  const consumeTranscriptRef = useRef<(text: string, source: "vad" | "ptt") => void>(() => {});
  const debugVoice = (event: string, detail?: string) => {
    voiceDebugRef.current.push(event, detail);
    if (voiceDebugOn) setVoiceDebugText(voiceDebugRef.current.format());
  };
  const bootGenRef = useRef(0);
  const recAliveRef = useRef(false);
  const networkFailsRef = useRef(0);
  const startingRef = useRef(false);
  const askingRef = useRef(false);
  const turnSeqRef = useRef(0);
  const askAbortRef = useRef<AbortController | null>(null);
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

  /** Cancel the in-flight turn and audio so a barge-in or PTT can take over. */
  const interruptTurn = useCallback(
    (reason: string) => {
      turnSeqRef.current += 1;
      try {
        askAbortRef.current?.abort();
      } catch {
        // ignore
      }
      askAbortRef.current = null;
      askingRef.current = false;
      globalAskLock = false;
      setBusy(false);
      stopSpeaking();
      setModeBoth("command");
      extendConvo();
      debugVoice("interrupt", reason);
    },
    [extendConvo, setModeBoth, stopSpeaking]
  );

  const detachRecognition = useCallback(
    (opts?: { abort?: boolean; markDead?: boolean }) => {
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      const handle = listenHandleRef.current;
      listenHandleRef.current = null;
      if (handle) {
        try {
          handle.stop();
        } catch {
          // ignore
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
          supported: voiceInputSupported(),
        })
      );
    } catch {
      // ignore
    }
  }, []);

  const bootRecognition = useCallback(() => {
    if (!wantListenRef.current) return;
    if (host !== "shell") return;
    if (typeof window === "undefined") return;
    const stream = streamRef.current;
    const live = stream?.getTracks().some((tr) => tr.readyState === "live");
    if (!live || !stream) return;
    if (listenHandleRef.current) {
      setRecAliveBoth(true);
      return;
    }
    try {
      const handle = startMicListen(stream, {
        getSpeaking: () => carinaIsSpeaking(),
        getPtt: () => pttRef.current,
        onLevel: (rms) => {
          const now = Date.now();
          if (now - lastLevelUiRef.current < 80) return;
          lastLevelUiRef.current = now;
          setMicLevel(rms);
        },
        onVad: (event) => debugVoice(`vad-${event}`),
        onBargeIn: () => {
          interruptTurn("barge");
          setStatus("Listening…");
        },
        onUtterance: (utt) => {
          debugVoice("vad-end", `${utt.durationMs}ms ${utt.reason}`);
          const vadEndedAt = utt.vadEndedAt;
          void (async () => {
            try {
              const stt = await transcribeUtterance(utt.wav, {
                language: langRef.current.code,
              });
              const line = `vadEnd→stt=${stt.sttMs}ms ${stt.provider}/${stt.model} “${stt.text.slice(0, 80)}”`;
              lastUttRef.current = { vadEndedAt, sttMs: stt.sttMs, text: stt.text };
              setUttTiming(line);
              debugVoice("stt", line);
              if (!stt.text.trim()) return;
              setRawHeard(stt.text);
              consumeTranscriptRef.current(
                stt.text,
                utt.reason === "ptt" ? "ptt" : "vad"
              );
            } catch (e) {
              const msg = e instanceof Error ? e.message : "stt-unavailable";
              debugVoice("stt-error", msg);
              setError(msg === "Voice limit reached." ? msg : "Voice listening glitched — try again or type.");
            }
          })();
        },
      });
      listenHandleRef.current = handle;
      setRecAliveBoth(true);
      startingRef.current = false;
      debugVoice("pipeline-start", "xai/grok-voice-transcribe-2.0");
    } catch (e) {
      startingRef.current = false;
      setRecAliveBoth(false);
      const msg = e instanceof Error ? e.message : "Could not start the microphone.";
      setError(msg);
      debugVoice("pipeline-error", msg);
    }
  }, [host, interruptTurn, setRecAliveBoth]);

  const scheduleBoot = useCallback(
    (delayMs = 200) => {
      if (host !== "shell") return;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (!wantListenRef.current) return;
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
      const utt = lastUttRef.current;
      const parts = [
        ttsTiming.timeToFirstAudioMs != null ? `replyTtfa=${ttsTiming.timeToFirstAudioMs}ms` : "",
        utt ? `vadEnd→stt=${utt.sttMs}ms` : "",
        utt ? `vadEnd→audio≈${Date.now() - utt.vadEndedAt}ms` : "",
      ].filter(Boolean);
      debugVoice("tts-end", parts.join(" ") || undefined);
      if (parts.length) setUttTiming(parts.join(" "));

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
      const key = normalizeHeard(text);
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
      const myTurn = ++turnSeqRef.current;
      try {
        askAbortRef.current?.abort();
      } catch {
        // ignore
      }
      const ac = new AbortController();
      askAbortRef.current = ac;
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
              voice: true,
              signal: ac.signal,
            });
            return;
          }

          setStatus("On it…");
          const speechOpts = {
            language: ttsLanguageCode(langRef.current),
            voiceId: DEFAULT_VOICE_ID,
            turnId: myTurn,
          };
          let speechOpen = false;
          const openSpeech = () => {
            if (host === "page" || speechOpen) return;
            speechOpen = true;
            speakStartedAtRef.current = Date.now();
            carinaStartReply(myTurn);
            setModeBoth("speaking");
            setStatus("Speaking…");
          };
          const result = await streamCarinaConversation(historyRef.current, {
            pendingAction: pendingActionRef.current,
            language: langRef.current.code,
            source: "APP",
            page: window.location.pathname,
            voice: true,
            signal: ac.signal,
            onAck: () => {
              if (turnSeqRef.current !== myTurn) return;
              setStatus("On it…");
              void carinaWarmTts();
            },
            onDelta: (preview) => {
              if (turnSeqRef.current !== myTurn) return;
              setStatus(preview.slice(0, 80));
              if (host === "page" || !preview.trim()) return;
              openSpeech();
              speakingTextRef.current = preview;
              carinaEnqueueCumulative(preview, speechOpts);
            },
          });
          if (turnSeqRef.current !== myTurn || (!result.ok && result.aborted)) {
            return;
          }
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
              const utt = lastUttRef.current;
              const parts = [
                ttsTiming.timeToFirstAudioMs != null ? `replyTtfa=${ttsTiming.timeToFirstAudioMs}ms` : "",
                utt ? `vadEnd→stt=${utt.sttMs}ms` : "",
                utt ? `vadEnd→audio≈${Date.now() - utt.vadEndedAt}ms` : "",
              ].filter(Boolean);
              debugVoice("tts-end", parts.join(" ") || undefined);
              if (parts.length) setUttTiming(parts.join(" "));
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
            const utt = lastUttRef.current;
            const parts = [
              ttsTiming.timeToFirstAudioMs != null ? `replyTtfa=${ttsTiming.timeToFirstAudioMs}ms` : "",
              utt ? `vadEnd→stt=${utt.sttMs}ms` : "",
              utt ? `vadEnd→audio≈${Date.now() - utt.vadEndedAt}ms` : "",
            ].filter(Boolean);
            debugVoice("tts-end", parts.join(" ") || undefined);
            if (parts.length) setUttTiming(parts.join(" "));
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
          if (turnSeqRef.current === myTurn) {
            askingRef.current = false;
            globalAskLock = false;
            setBusy(false);
          }
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

  useEffect(() => {
    consumeTranscriptRef.current = (text, source) => {
      const heard = text.trim();
      if (!heard) return;
      if (source === "ptt") {
        if (heard.length > 1) askRef.current(heard);
        else {
          setModeBoth("command");
          setStatus(`Listening… (say “${nameRef.current}”)`);
        }
        return;
      }
      finalBufRef.current = heard;
      interimBufRef.current = "";
      setPartial(heard.slice(-160));
      handleResultRef.current(heard, "");
      flushAskRef.current();
    };
  }, [setModeBoth]);

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

    if (!voiceInputSupported()) {
      const unsupported =
        "Voice listening needs a microphone in a current browser on HTTPS. You can still type your question.";
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
    void carinaWarmStt();
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
    // PTT uses the shared VAD/STT pipeline; nothing to detach except the flag.
  }, []);

  const startPttRecognition = useCallback(() => {
    bootRecognition();
    debugVoice("ptt-capture-start");
  }, [bootRecognition]);

  const pttDown = useCallback(async () => {
    if (modeRef.current === "speaking" || modeRef.current === "thinking" || askingRef.current) {
      interruptTurn("ptt");
    }
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
  }, [ensureMicStream, extendConvo, interruptTurn, setModeBoth, startPttRecognition]);

  const pttUp = useCallback(() => {
    if (!pttRef.current) return;
    // Flush recorded audio before clearing the PTT flag.
    listenHandleRef.current?.flush("ptt");
    setPtt(false);
    pttRef.current = false;
    pttBufRef.current = "";
    interimBufRef.current = "";
    setPartial("");
    debugVoice("ptt-up");
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

    // Keep the VAD/STT pipeline attached while the user wants the mic on.
    const watchdog = window.setInterval(() => {
      if (!wantListenRef.current) return;
      if (!listenHandleRef.current) bootRecognition();
    }, 2500);

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

  const micPct = Math.max(0, Math.min(100, Math.round((micLevel / 0.08) * 100)));
  const debugOverlay = voiceDebugOn ? (
    <div
      data-voice-debug="1"
      className="pointer-events-auto fixed bottom-3 left-3 z-[9999] flex min-h-[17rem] w-[min(36rem,calc(100vw-1.25rem))] max-h-[75vh] resize flex-col overflow-hidden rounded-lg border border-amber-500/50 bg-black/90 p-3 font-mono text-[13px] leading-5 text-amber-100 shadow-2xl"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-amber-200">Carina voiceDebug</div>
        <button
          type="button"
          className="rounded border border-amber-500/40 px-2 py-0.5 text-[12px] text-amber-100 hover:bg-amber-500/20"
          onClick={() => {
            const text = [
              voiceDebugText,
              uttTiming && `last: ${uttTiming}`,
            ]
              .filter(Boolean)
              .join("\n");
            void navigator.clipboard?.writeText(text || "no events");
          }}
        >
          Copy logs
        </button>
      </div>
      <div className="text-[12px] text-amber-100/90">
        mode={mode} listen={String(listening)} recAlive={String(recAlive)} pipeline={listenHandleRef.current ? "yes" : "no"} ptt={String(ptt)}{" "}
        speaking={String(carinaIsSpeaking())} stream={
          streamRef.current?.getTracks().some((tr) => tr.readyState === "live") ? "live" : "off"
        } stt=xai/grok-voice-transcribe-2.0
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="shrink-0 text-[12px]">mic</span>
        <div className="h-2 flex-1 overflow-hidden rounded bg-slate-800">
          <div className="h-full bg-teal-400" style={{ width: `${micPct}%` }} />
        </div>
        <span className="w-10 shrink-0 text-right text-[12px]">{micPct}%</span>
      </div>
      <div>status={status}</div>
      {uttTiming ? <div className="text-teal-200">timing {uttTiming}</div> : null}
      <pre className="mt-1 min-h-0 flex-1 overflow-auto whitespace-pre-wrap text-[13px] leading-5 text-amber-100">{voiceDebugText || "waiting for events…"}</pre>
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
