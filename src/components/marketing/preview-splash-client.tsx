"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const TOTAL_MS = 4000;

/**
 * Apex-landing concept: rotating ring + “Starting your ERP experience”.
 * Auto-navigates to demo hub; Skip always available.
 */
export function PreviewSplashClient() {
  const router = useRouter();
  const [pct, setPct] = useState(0);
  const [left, setLeft] = useState(4);

  useEffect(() => {
    const start = Date.now();
    let raf = 0;
    let done = false;
    const tick = () => {
      if (done) return;
      const t = Date.now() - start;
      const p = Math.min(100, Math.round((t / TOTAL_MS) * 100));
      setPct(p);
      setLeft(Math.max(0, Math.ceil((TOTAL_MS - t) / 1000)));
      if (t >= TOTAL_MS) {
        done = true;
        router.push("/preview/demo-hub?from=splash");
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      done = true;
      cancelAnimationFrame(raf);
    };
  }, [router]);

  return (
    <div className="relative grid min-h-[calc(100vh-8rem)] place-items-center overflow-hidden px-6 py-16">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(55% 45% at 50% 42%, rgba(20,184,166,0.16), transparent 70%),
            radial-gradient(40% 30% at 80% 10%, rgba(34,211,238,0.08), transparent 60%)
          `,
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-[0.22]"
        style={{ backgroundImage: "url(/marketing-preview/E-demo-splash-ring.jpg)" }}
        aria-hidden
      />

      <div className="relative z-10 max-w-md text-center">
        <div className="relative mx-auto mb-6 h-[min(220px,52vw)] w-[min(220px,52vw)]">
          <div className="absolute inset-0 rounded-full border-[3px] border-teal-500/15 shadow-[0_0_40px_rgba(20,184,166,0.12)]" />
          <div
            className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-teal-300 border-r-cyan-400/50"
            style={{ animationDuration: "1.15s" }}
            aria-hidden
          />
          <div className="absolute inset-[18%] rounded-full border border-teal-400/15 bg-[radial-gradient(circle_at_40%_35%,rgba(45,212,191,0.18),rgba(2,6,23,0.4)_70%)]" />
          <div className="absolute inset-0 grid place-items-center text-sm font-semibold tracking-wide text-teal-200">
            {pct}%
          </div>
        </div>

        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Starting your ERP experience
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-slate-400">
          Spinning up a private demo with sample plant data — sales, floor,
          quality, and accounting already connected.
        </p>

        <div className="mx-auto mt-6 h-[3px] w-[min(260px,70vw)] overflow-hidden rounded-full bg-slate-700/50">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-400 transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/preview/demo-hub"
            className="rounded-xl bg-teal-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-teal-400"
          >
            Enter the experience →
          </Link>
          <Link
            href="/preview/demo-hub"
            className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold hover:border-teal-500/50"
          >
            Skip wait
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          {left > 0
            ? `Continuing in ${left}s… (paying customers never see this)`
            : "Opening demo experience…"}
        </p>
      </div>
    </div>
  );
}
