"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { actionStartTestDrive, actionEnterExistingDemo } from "@/app/demo-actions";
import "./photo-tiles.css";

const MIN_SPLASH_MS = 3200;
const BG_SRC = "/marketing/product-inventory.png";

/**
 * Apex hero. Default is explore-first: real product screenshot, no auto-provision.
 * autoStart is only used if a caller explicitly opts in.
 */
export function SpinningUpShop({
  hasExistingDemo = false,
  autoStart = false,
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

  const idle = ended || !autoStart;

  return (
    <div className="relative flex min-h-[min(100vh,780px)] flex-col items-center justify-center overflow-hidden px-6 py-16">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-top"
        style={{ backgroundImage: `url(${BG_SRC})` }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950/55 via-slate-950/35 to-slate-950/75"
        aria-hidden
      />

      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center text-center">
        {!idle && (
          <div className="relative flex h-[min(220px,55vw)] w-[min(220px,55vw)] items-center justify-center">
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
              />
            </svg>
          </div>
        )}

        <div className="marketing-story mt-2 w-full max-w-xl">
          <div className="tile tile-on-photo rounded-2xl px-6 py-6 shadow-[0_16px_48px_rgba(0,0,0,0.55)] sm:px-8">
            {!idle && (
              <>
                <p
                  className="font-mono text-4xl font-bold tracking-tight tabular-nums sm:text-5xl"
                  aria-live="polite"
                >
                  {pct}
                  <span className="muted text-2xl sm:text-3xl">%</span>
                </p>
                <div className="mx-auto mt-3 h-1.5 w-44 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full rounded-full bg-teal-400 transition-[width] duration-100"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            )}

            <p className="eyebrow mt-1 text-xs font-semibold uppercase tracking-[0.28em]">
              Protessera
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              {idle
                ? ended
                  ? "Test drive ended"
                  : hasExistingDemo
                    ? "Your sandbox is still warm"
                    : "See the real shop \u2014 then take it for a drive"
                : status}
            </h1>
            <p className="muted mx-auto mt-3 max-w-md text-sm leading-relaxed sm:text-base">
              {ended
                ? "Your sandbox is gone. Scroll for pricing, FAQ, and features, or spin a new plant when you\u2019re ready."
                : idle && hasExistingDemo
                  ? "Pick up where you left off, or scroll the product first. Nothing provisions until you click."
                  : idle
                    ? "Screens below are the live product \u2014 inventory, value stream, work orders, test center. Explore first. A private sandbox only starts when you ask."
                    : hasExistingDemo
                      ? "Your sandbox is still warm \u2014 taking you back onto the floor."
                      : "Building a private sandbox with a live demo factory \u2014 sales, floor, quality, and accounting already talking."}
            </p>

            {idle ? (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <form
                  action={
                    hasExistingDemo && !ended
                      ? actionEnterExistingDemo
                      : actionStartTestDrive
                  }
                >
                  <button
                    type="submit"
                    className="btn-green rounded-xl px-5 py-3 text-sm font-semibold"
                  >
                    {hasExistingDemo && !ended
                      ? "Re-enter your plant"
                      : "Start live demo"}
                  </button>
                </form>
                <Link
                  href="/signup"
                  className="btn-outline-black rounded-xl px-4 py-2.5 text-sm font-semibold"
                >
                  Start free trial
                </Link>
                <a
                  href="#pricing"
                  className="btn-outline-black rounded-xl px-4 py-2.5 text-sm font-semibold"
                >
                  See pricing
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
