"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { actionStartTestDrive, actionEnterExistingDemo } from "@/app/demo-actions";

const MIN_SPLASH_MS = 3200;
const BG_SRC = "/marketing/E-splash-bg.jpg";

/**
 * Apex hero: static factory scene + spinning SVG ring.
 * Copy sits on a light plaque with black text for maximum contrast.
 */
export function SpinningUpShop({
  hasExistingDemo = false,
  autoStart = true,
  ended = false,
}: {
  hasExistingDemo?: boolean;
  autoStart?: boolean;
  ended?: boolean;
}) {
  const [pct, setPct] = useState(ended ? 100 : 0);
  const [status, setStatus] = useState(
    ended ? "Test drive ended" : "Spinning up the Shop"
  );
  const formRef = useRef<HTMLFormElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (ended || !autoStart) return;
    if (started.current) return;
    started.current = true;

    const begin = Date.now();
    let raf = 0;
    const tick = () => {
      const t = Date.now() - begin;
      const p = Math.min(94, Math.round((t / MIN_SPLASH_MS) * 94));
      setPct(p);
      if (t < MIN_SPLASH_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    let creep = 0;
    const kickoff = window.setTimeout(() => {
      setStatus(
        hasExistingDemo
          ? "Re-entering your plant…"
          : "Spinning up your private plant…"
      );
      setPct(95);
      formRef.current?.requestSubmit();
      // Sandboxes are pre-warmed, so the redirect is normally immediate. On a
      // cold start (empty pool) the clone can take a few seconds — keep easing
      // toward 99 so the bar never looks frozen while we wait.
      creep = window.setInterval(() => {
        setPct((p) => (p >= 99 ? 99 : p + 1));
      }, 700);
    }, MIN_SPLASH_MS);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(kickoff);
      if (creep) window.clearInterval(creep);
    };
  }, [autoStart, ended, hasExistingDemo]);

  return (
    <div className="relative flex min-h-[min(100vh,720px)] flex-col items-center justify-center overflow-hidden px-6 py-16">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${BG_SRC})` }}
        aria-hidden
      />

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center text-center">
        <div className="relative flex h-[min(300px,70vw)] w-[min(300px,70vw)] items-center justify-center">
          <div
            className="absolute inset-[8%] rounded-full blur-2xl"
            style={{
              background:
                "radial-gradient(circle, rgba(45,212,191,0.35) 0%, transparent 68%)",
            }}
            aria-hidden
          />
          <svg
            viewBox="0 0 120 120"
            className="shop-ring-spin relative h-full w-full drop-shadow-[0_0_24px_rgba(45,212,191,0.55)]"
            aria-hidden
          >
            <defs>
              <linearGradient id="shop-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#5eead4" />
                <stop offset="55%" stopColor="#2dd4bf" />
                <stop offset="100%" stopColor="#22d3ee" />
              </linearGradient>
              <filter id="shop-ring-glow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="1.6" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <circle
              cx="60"
              cy="60"
              r="46"
              fill="none"
              stroke="rgba(45,212,191,0.18)"
              strokeWidth="5"
            />
            <circle
              cx="60"
              cy="60"
              r="46"
              fill="none"
              stroke="url(#shop-ring-grad)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray="190 100"
              strokeDashoffset="20"
              filter="url(#shop-ring-glow)"
            />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="rgba(34,211,238,0.25)"
              strokeWidth="1.5"
              strokeDasharray="3 7"
            />
          </svg>
        </div>

        {/* White tile + forced black type via .marketing-story (beats light-mode wash) */}
        <div className="marketing-story mt-6 w-full max-w-md">
          <div className="tile rounded-2xl px-6 py-5 shadow-[0_16px_48px_rgba(0,0,0,0.55)]">
            <p
              className="font-mono text-4xl font-bold tracking-tight tabular-nums sm:text-5xl"
              aria-live="polite"
            >
              {pct}
              <span className="muted text-2xl sm:text-3xl">%</span>
            </p>
            <div className="mx-auto mt-3 h-1.5 w-44 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-teal-600 transition-[width] duration-100"
                style={{ width: `${pct}%` }}
              />
            </div>

            <p className="eyebrow mt-5 text-xs font-semibold uppercase tracking-[0.28em]">
              Protessera
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              {status}
            </h1>
            <p className="muted mx-auto mt-3 max-w-md text-sm leading-relaxed sm:text-base">
              {ended
                ? "Your sandbox is gone — scroll for pricing, FAQ, and features, or spin the shop up again when you’re ready."
                : hasExistingDemo
                  ? "Your sandbox is still warm — taking you back onto the floor."
                  : "Building a private sandbox with a live demo factory — sales, floor, quality, and accounting already talking."}
            </p>

            {ended || !autoStart ? (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <form action={actionStartTestDrive}>
                  <button
                    type="submit"
                    className="btn-green rounded-xl px-5 py-3 text-sm font-semibold"
                  >
                    Spin the shop up again
                  </button>
                </form>
                <a
                  href="#pricing"
                  className="btn-outline-black rounded-xl px-4 py-2.5 text-sm font-semibold"
                >
                  See pricing
                </a>
                <a
                  href="#faq"
                  className="btn-outline-black rounded-xl px-4 py-2.5 text-sm font-semibold"
                >
                  Read FAQ
                </a>
              </div>
            ) : (
              <>
                <form
                  ref={formRef}
                  action={
                    hasExistingDemo
                      ? actionEnterExistingDemo
                      : actionStartTestDrive
                  }
                  className="sr-only"
                >
                  <button type="submit">Continue</button>
                </form>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <p className="muted text-xs font-medium">
                    This only takes a moment
                  </p>
                  <Link
                    href="/welcome#pricing"
                    className="btn-outline-black rounded-xl px-4 py-2 text-sm font-semibold"
                  >
                    Browse pricing & FAQ
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
