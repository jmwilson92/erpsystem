"use client";

/**
 * Always-on voice assistant with a customizable wake word.
 * Mic → Grok → xAI TTS (Carina by default). Supports barge-in: speaking
 * while the assistant talks cancels audio and takes the new command.
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
const VOICE_KEY = "forge-assistant-voice";

/** Grok TTS voices (xAI). Carina = natural conversational default. */
export const GROK_VOICES = [
  { id: "carina", label: "Carina — natural, warm" },
  { id: "ara", label: "Ara — warm & conversational" },
  { id: "eve", label: "Eve — energetic" },
  { id: "leo", label: "Leo" },
  { id: "rex", label: "Rex" },
  { id: "sal", label: "Sal" },
  { id: "luna", label: "Luna" },
  { id: "atlas", label: "Atlas" },
  { id: "orion", label: "Orion" },
  { id: "support", label: "Support — soft & empathetic" },
] as const;

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
  results: {
    [i: number]: { [j: number]: { transcript: string }; isFinal?: boolean };
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

export function VoiceAssistant({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [name, setName] = useState("Forge");
  const [nameDraft, setNameDraft] = useState("Forge");
  const [voiceId, setVoiceId] = useState("carina");
  const [listening, setListening] = useState(false);
  const [awake, setAwake] = useState(false);
  const [speaking, setSpeaking] = useState(false);
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
  const voiceRef = useRef(voiceId);
  const speakingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakGenRef = useRef(0); // bump to cancel in-flight TTS
  const busyRef = useRef(false);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    voiceRef.current = voiceId;
  }, [voiceId]);
  useEffect(() => {
    awakeRef.current = awake;
  }, [awake]);
  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

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
        const v = localStorage.getItem(VOICE_KEY);
        if (v) setVoiceId(v);
      } catch {
        // ignore
      }
    });
  }, []);

  /** Hard-stop any audio (barge-in). */
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
        a.pause();
        a.src = "";
      } catch {
        // ignore
      }
      audioRef.current = null;
    }
    setSpeaking(false);
    speakingRef.current = false;
  }, []);

  const speak = useCallback(async (text: string) => {
    const gen = ++speakGenRef.current;
    stopSpeaking();
    // re-bump was wrong — start fresh generation id
    speakGenRef.current = gen;
    setSpeaking(true);
    speakingRef.current = true;

    // Prefer short spoken chunks feel snappier; still one API call for quality
    const spoken = text
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/#{1,6}\s/g, "")
      .trim();

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: spoken.slice(0, 1800),
          voiceId: voiceRef.current,
        }),
      });
      if (speakGenRef.current !== gen) return; // cancelled
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (speakGenRef.current !== gen) return;
        const blob = new Blob([buf], {
          type: res.headers.get("Content-Type") || "audio/mpeg",
        });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("audio play failed"));
          };
          void audio.play().catch(reject);
        });
        if (speakGenRef.current === gen) {
          setSpeaking(false);
          speakingRef.current = false;
        }
        return;
      }
    } catch {
      // fall through to browser TTS
    }

    if (speakGenRef.current !== gen) return;
    // Softer browser fallback: pick a non-default voice if available
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(spoken);
        u.rate = 1.02;
        u.pitch = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find((v) => /google|natural|neural|samantha|karen|moira/i.test(v.name)) ||
          voices.find((v) => v.lang.startsWith("en") && v.localService === false) ||
          voices.find((v) => v.lang.startsWith("en"));
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
  }, [stopSpeaking]);

  const handleUtterance = useCallback(
    (transcript: string) => {
      const text = transcript.trim();
      if (!text) return;
      // Barge-in: stop current speech immediately
      if (speakingRef.current) {
        stopSpeaking();
      }
      if (busyRef.current) {
        // allow interrupt mid-think: drop previous answer path via gen bump
        speakGenRef.current += 1;
      }
      busyRef.current = true;
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
          setStatus(
            listening ? `Listening for “${nameRef.current}”…` : "Off"
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : "Assistant failed");
          setStatus("Error");
        } finally {
          busyRef.current = false;
        }
      });
    },
    [listening, speak, stopSpeaking]
  );

  const startListening = useCallback(async () => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError(
        "Voice recognition isn't supported in this browser. Use Chrome or Edge on https://www.forge-rp.live."
      );
      return;
    }

    try {
      if (!window.isSecureContext) {
        setError("Microphone needs HTTPS. Open https://www.forge-rp.live.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        `Microphone blocked. Lock icon → Site settings → Microphone → Allow, then reload. (${msg})`
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
      let interim = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0]?.transcript || "";
        if (r.isFinal) final += t + " ";
        else interim += t + " ";
      }
      const heardFinal = final.trim();
      const heardAny = (final + interim).trim();
      if (!heardAny) return;

      const wake = nameRef.current.toLowerCase();
      const lowerAny = heardAny.toLowerCase();
      const lowerFinal = heardFinal.toLowerCase();

      // Barge-in while speaking: any clear speech cancels audio
      if (speakingRef.current && heardAny.length > 1) {
        stopSpeaking();
        setStatus("Interrupted — listening…");
        // If they said the wake word + question, handle; else open for command
        if (lowerAny.includes(wake)) {
          setAwake(true);
          awakeRef.current = true;
          const after = heardFinal
            .replace(
              new RegExp(wake.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"),
              ""
            )
            .replace(/^[,.\s]+/, "")
            .trim();
          if (after.length > 2) handleUtterance(after);
          else setAwake(true);
        } else if (heardFinal.length > 2) {
          // Treat as new command without requiring wake word mid-conversation
          handleUtterance(heardFinal);
        }
        return;
      }

      if (!awakeRef.current) {
        if (lowerFinal.includes(wake) || lowerAny.includes(wake)) {
          setAwake(true);
          awakeRef.current = true;
          setStatus("Yes? Listening…");
          const after = (heardFinal || heardAny)
            .replace(
              new RegExp(wake.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"),
              ""
            )
            .replace(/^[,.\s]+/, "")
            .trim();
          if (after.length > 2 && heardFinal) {
            handleUtterance(after);
          }
        }
        return;
      }
      if (heardFinal.length > 2) {
        handleUtterance(heardFinal);
      }
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed") {
        setError(
          "Microphone permission denied. Lock icon → Microphone → Allow → reload."
        );
        setListening(false);
      } else if (ev.error === "aborted") {
        // ignore
      } else if (ev.error !== "no-speech") {
        setError(`Mic error: ${ev.error}`);
      }
    };
    rec.onend = () => {
      if (recRef.current === rec) {
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
      setStatus(`Listening for “${nameRef.current}”…`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start mic");
    }
  }, [handleUtterance, stopSpeaking]);

  const stopListening = useCallback(() => {
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
    setStatus("Off");
  }, [stopSpeaking]);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        // ignore
      }
      stopSpeaking();
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
        setError(
          e instanceof Error
            ? e.message
            : "Saved locally only (DB column may need migration)"
        );
      }
    });
  }

  function saveVoice(id: string) {
    setVoiceId(id);
    try {
      localStorage.setItem(VOICE_KEY, id);
    } catch {
      // ignore
    }
  }

  if (compact) {
    return (
      <div className="pointer-events-none fixed bottom-5 left-5 z-40 flex flex-col items-start gap-2">
        {speaking && (
          <button
            type="button"
            onClick={stopSpeaking}
            className="pointer-events-auto rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-[11px] font-medium text-amber-200"
          >
            Tap to interrupt
          </button>
        )}
        <button
          type="button"
          onClick={() => (listening ? stopListening() : startListening())}
          className={cn(
            "pointer-events-auto flex h-12 items-center gap-2 rounded-full border px-3 shadow-lg transition-colors",
            listening
              ? speaking
                ? "border-amber-400 bg-amber-500/20 text-amber-100"
                : awake
                  ? "border-teal-400 bg-teal-500 text-slate-950"
                  : "border-violet-500/50 bg-violet-500/20 text-violet-100"
              : "border-slate-700 bg-slate-900/90 text-slate-300 hover:border-slate-500"
          )}
          title={
            listening
              ? speaking
                ? "Speaking — talk to interrupt"
                : `Voice on — say “${name}”`
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
          {speaking && (
            <span className="text-[10px] opacity-80">speaking…</span>
          )}
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
            Natural Grok voice (default <strong>Carina</strong>). Say your wake
            word anytime; talk over the reply to interrupt.
            {grokOn ? " Grok connected." : " Set XAI_API_KEY for Grok + TTS."}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
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
              className="flex h-9 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 text-sm text-slate-100"
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
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-400">
            Voice (Grok TTS)
          </label>
          <select
            value={voiceId}
            onChange={(e) => saveVoice(e.target.value)}
            className="flex h-9 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 text-sm text-slate-100"
          >
            {GROK_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
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
            Speaking — talk to interrupt
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
      {error && <p className="text-xs text-amber-300">{error}</p>}
      <p className="text-[11px] text-slate-600">
        Needs <code className="text-teal-500">XAI_API_KEY</code> on the server
        for Grok answers + Carina-quality TTS. Chrome/Edge recommended.
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
