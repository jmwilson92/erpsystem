"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Volume2, VolumeX, X, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { getTour, type Tour, type TourStep } from "@/lib/guides";
import {
  carinaPlaySpeech,
  carinaStopAllAudio,
} from "@/lib/carina-audio";

const VOICE_KEY = "forge-guide-voice";

/** Fire this to start a canned tour: window.dispatchEvent(startTourEvent("getting-started")) */
export function startTourEvent(tourId: string) {
  return new CustomEvent("forge:start-tour", { detail: { tourId } });
}

/**
 * Carina / voice assistant walkthrough.
 *   window.dispatchEvent(startCarinaGuideEvent({ tourId: "work-order-lifecycle" }))
 *   window.dispatchEvent(startCarinaGuideEvent({ steps: [...], autoAdvance: true }))
 */
export function startCarinaGuideEvent(detail: {
  tourId?: string;
  steps?: TourStep[];
  title?: string;
  /** Speak each step and auto-advance when narration ends (default true for Carina) */
  autoAdvance?: boolean;
  /** Force tour voice on (default true for Carina) */
  voice?: boolean;
}) {
  return new CustomEvent("forge:carina-guide", { detail });
}

function stopNarration() {
  carinaStopAllAudio();
}

/** Shared audio channel — never overlaps Carina's main speak path. */
function narrate(text: string): Promise<void> {
  return carinaPlaySpeech(text, { language: "en", voiceId: "carina" });
}

type Rect = { top: number; left: number; width: number; height: number };

/**
 * Global guided-tour controller. Lives in the app shell so it survives
 * route changes. Spotlights DOM elements, shows a note box (what + why),
 * and narrates each step (Carina TTS via /api/tts when configured).
 *
 * Carina can start canned tours or ad-hoc step lists and auto-advance
 * while she speaks so the UI tracks her explanation.
 */
export function GuidedTour() {
  const router = useRouter();
  const pathname = usePathname();
  const [tour, setTour] = useState<Tour | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const narrateGenRef = useRef(0);
  const autoAdvanceRef = useRef(false);
  const stepIndexRef = useRef(0);
  const tourRef = useRef<Tour | null>(null);

  useEffect(() => {
    autoAdvanceRef.current = autoAdvance;
  }, [autoAdvance]);
  useEffect(() => {
    stepIndexRef.current = stepIndex;
  }, [stepIndex]);
  useEffect(() => {
    tourRef.current = tour;
  }, [tour]);

  useEffect(() => {
    setMounted(true);
    try {
      setVoiceOn(localStorage.getItem(VOICE_KEY) === "1");
    } catch {
      /* ignore */
    }

    const onStart = (e: Event) => {
      const id = (e as CustomEvent).detail?.tourId as string;
      const t = getTour(id);
      if (t) {
        narrateGenRef.current += 1;
        stopNarration();
        setTour(t);
        setStepIndex(0);
        setAutoAdvance(false);
      }
    };

    const onCarina = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        tourId?: string;
        steps?: TourStep[];
        title?: string;
        autoAdvance?: boolean;
        voice?: boolean;
      };
      narrateGenRef.current += 1;
      stopNarration();

      if (d.voice !== false) {
        setVoiceOn(true);
        try {
          localStorage.setItem(VOICE_KEY, "1");
        } catch {
          /* ignore */
        }
      }
      setAutoAdvance(d.autoAdvance !== false);

      if (d.tourId) {
        const t = getTour(d.tourId);
        if (t) {
          setTour(t);
          setStepIndex(0);
          return;
        }
      }
      if (d.steps && d.steps.length > 0) {
        setTour({
          id: "carina-live",
          title: d.title || "Carina is showing you",
          description: "Live walkthrough from the voice assistant",
          category: "Carina",
          minutes: Math.max(1, Math.ceil(d.steps.length * 0.5)),
          steps: d.steps,
        });
        setStepIndex(0);
      }
    };

    window.addEventListener("forge:start-tour", onStart);
    window.addEventListener("forge:carina-guide", onCarina);
    return () => {
      window.removeEventListener("forge:start-tour", onStart);
      window.removeEventListener("forge:carina-guide", onCarina);
    };
  }, []);

  const step: TourStep | null = tour ? tour.steps[stepIndex] ?? null : null;

  const finish = useCallback(() => {
    narrateGenRef.current += 1;
    setTour(null);
    setRect(null);
    setAutoAdvance(false);
    if (pollRef.current) clearInterval(pollRef.current);
    stopNarration();
  }, []);

  // Locate + spotlight the target for the current step (poll after nav).
  useEffect(() => {
    if (!step) return;
    if (pollRef.current) clearInterval(pollRef.current);

    // Navigate first if the step lives on another route.
    if (step.route && pathname !== step.route) {
      router.push(step.route);
      return;
    }
    if (!step.selector) {
      setRect(null);
      return;
    }

    let tries = 0;
    const locate = () => {
      const el = document.querySelector(step.selector!) as HTMLElement | null;
      if (el) {
        const r0 = el.getBoundingClientRect();
        const offscreen =
          r0.bottom < 0 ||
          r0.top > window.innerHeight ||
          r0.right < 0 ||
          r0.left > window.innerWidth;
        el.scrollIntoView({
          behavior: offscreen ? "smooth" : "instant" as ScrollBehavior,
          block: "center",
        });
        const r = el.getBoundingClientRect();
        setRect({
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
        });
        return true;
      }
      return false;
    };
    if (!locate()) {
      pollRef.current = setInterval(() => {
        tries += 1;
        if (locate() || tries > 30) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (tries > 30) setRect(null);
        }
      }, 60);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, pathname, router]);

  // Keep the spotlight glued to the element on scroll/resize.
  useEffect(() => {
    if (!step?.selector) return;
    const update = () => {
      const el = document.querySelector(step.selector!) as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
        });
      }
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [step]);

  // Narrate the step; optionally auto-advance when speech ends.
  useEffect(() => {
    if (!step || !voiceOn) return;
    // Wait until we're on the right route so narration matches the screen
    if (step.route && pathname !== step.route) return;

    const gen = ++narrateGenRef.current;
    const text = [step.title, step.body, step.why].filter(Boolean).join(". ");

    let cancelled = false;
    void (async () => {
      // Short settle after nav so highlight is on-screen before speech
      await new Promise((r) => setTimeout(r, 120));
      if (cancelled || narrateGenRef.current !== gen) return;
      await narrate(text);
      if (cancelled || narrateGenRef.current !== gen) return;
      if (!autoAdvanceRef.current) return;
      const t = tourRef.current;
      if (!t) return;
      const i = stepIndexRef.current;
      if (i < t.steps.length - 1) {
        // Small gap between steps (TTS already ended)
        await new Promise((r) => setTimeout(r, 180));
        if (cancelled || narrateGenRef.current !== gen) return;
        setStepIndex(i + 1);
      } else {
        // Brief hold on last step, then close
        await new Promise((r) => setTimeout(r, 500));
        if (narrateGenRef.current === gen) finish();
      }
    })();

    return () => {
      cancelled = true;
      stopNarration();
    };
  }, [step, voiceOn, stepIndex, pathname, finish]);

  const toggleVoice = useCallback(() => {
    setVoiceOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(VOICE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (!next) {
        narrateGenRef.current += 1;
        stopNarration();
      }
      return next;
    });
  }, []);

  if (!mounted || !tour || !step) return null;

  const total = tour.steps.length;
  const isLast = stepIndex === total - 1;

  const boxW = 340;
  const gap = 16;
  let boxStyle: React.CSSProperties = {};
  if (rect) {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const below = rect.top + rect.height + gap;
    const placeBelow = rect.top + rect.height / 2 < vh / 2;
    const top = placeBelow ? below : Math.max(gap, rect.top - gap - 200);
    let left = rect.left + rect.width / 2 - boxW / 2;
    left = Math.max(gap, Math.min(left, vw - boxW - gap));
    boxStyle = { top, left, width: boxW };
  }

  const noteBox = (
    <div
      className="pointer-events-auto rounded-2xl border border-teal-500/40 bg-slate-950 p-4 shadow-2xl"
      style={
        rect
          ? { position: "fixed", ...boxStyle }
          : {
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%,-50%)",
              width: boxW,
            }
      }
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-full bg-teal-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-300">
          {tour.title}
          {autoAdvance && (
            <span className="ml-1 font-normal normal-case text-teal-400/80">
              · auto
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleVoice}
            title={voiceOn ? "Mute narration" : "Read aloud"}
            className="rounded-md p-1 text-slate-400 hover:text-teal-300"
          >
            {voiceOn ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={finish}
            title="End tour"
            className="rounded-md p-1 text-slate-400 hover:text-rose-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <h3 className="text-base font-semibold text-slate-100">{step.title}</h3>
      <p className="mt-1 text-sm text-slate-300">{step.body}</p>
      {step.why && (
        <p className="mt-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-xs text-slate-400">
          <span className="font-medium text-teal-400">Why: </span>
          {step.why}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-1">
          {tour.steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex ? "w-4 bg-teal-400" : "w-1.5 bg-slate-700"
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              narrateGenRef.current += 1;
              stopNarration();
              setStepIndex((i) => Math.max(0, i - 1));
            }}
            disabled={stepIndex === 0}
            className="flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 disabled:opacity-40 hover:border-slate-500"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={finish}
              className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-teal-400"
            >
              <Check className="h-3.5 w-3.5" /> Done
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                narrateGenRef.current += 1;
                stopNarration();
                setStepIndex((i) => Math.min(total - 1, i + 1));
              }}
              className="flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-teal-400"
            >
              Next <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[300]">
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-teal-400/80 transition-all duration-300"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(2,6,23,0.78)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-950/80" />
      )}
      {noteBox}
    </div>,
    document.body
  );
}
