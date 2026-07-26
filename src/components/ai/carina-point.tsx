"use client";

/**
 * Non-blocking temporary highlight for “where is the … button?”
 * Draws a ring around a catalog target without dimming the page or trapping clicks.
 * Also handles forge:carina-navigate from agent actions.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";

type Rect = { top: number; left: number; width: number; height: number };

export function CarinaPoint() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const onNav = (e: Event) => {
      const href = (e as CustomEvent).detail?.href as string | undefined;
      if (href) router.push(href);
    };
    window.addEventListener("forge:carina-navigate", onNav);
    return () => window.removeEventListener("forge:carina-navigate", onNav);
  }, [router]);
  const [rect, setRect] = useState<Rect | null>(null);
  const [label, setLabel] = useState("");
  const [mounted, setMounted] = useState(false);
  const [pending, setPending] = useState<{
    selector: string;
    route?: string;
    label?: string;
    ms: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
    const onPoint = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        selector?: string;
        route?: string;
        label?: string;
        ms?: number;
      };
      if (!d?.selector) return;
      setPending({
        selector: d.selector,
        route: d.route,
        label: d.label || "",
        ms: d.ms ?? 2800,
      });
    };
    window.addEventListener("forge:carina-point", onPoint);
    return () => window.removeEventListener("forge:carina-point", onPoint);
  }, []);

  // Navigate then locate
  useEffect(() => {
    if (!pending) return;
    if (pending.route && pathname !== pending.route) {
      router.push(pending.route);
      return;
    }

    let tries = 0;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const locate = () => {
      const el = document.querySelector(pending.selector) as HTMLElement | null;
      if (!el) return false;
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      setRect({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      });
      setLabel(pending.label || "");
      // Soft pulse class if possible
      el.classList.add("carina-point-pulse");
      hideTimer = setTimeout(() => {
        el.classList.remove("carina-point-pulse");
        setRect(null);
        setLabel("");
        setPending(null);
      }, pending.ms);
      return true;
    };

    if (!locate()) {
      poll = setInterval(() => {
        tries += 1;
        if (locate() || tries > 30) {
          if (poll) clearInterval(poll);
          if (tries > 30) setPending(null);
        }
      }, 80);
    }

    const onScroll = () => {
      const el = document.querySelector(pending.selector) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      });
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);

    return () => {
      if (poll) clearInterval(poll);
      if (hideTimer) clearTimeout(hideTimer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      const el = document.querySelector(pending.selector) as HTMLElement | null;
      el?.classList.remove("carina-point-pulse");
    };
  }, [pending, pathname, router]);

  if (!mounted || !rect) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[250]">
      <div
        className="absolute rounded-xl ring-2 ring-teal-400 shadow-[0_0_0_4px_rgba(45,212,191,0.25)] transition-all duration-200"
        style={{
          top: rect.top - 6,
          left: rect.left - 6,
          width: rect.width + 12,
          height: rect.height + 12,
        }}
      />
      {label && (
        <div
          className="absolute max-w-[14rem] rounded-lg border border-teal-500/40 bg-slate-950/95 px-2.5 py-1.5 text-[11px] font-medium text-teal-100 shadow-lg"
          style={{
            top: Math.min(rect.top + rect.height + 10, window.innerHeight - 48),
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 200)),
          }}
        >
          {label}
        </div>
      )}
    </div>,
    document.body
  );
}
