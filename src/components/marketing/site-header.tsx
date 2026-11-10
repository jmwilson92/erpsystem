"use client";

import { useEffect, useId, useState } from "react";
import { Menu, X } from "lucide-react";
import { BrandMark } from "./logo";
import { SITE_NAME } from "@/lib/site";

/**
 * Shared marketing nav. Story links are plain <a> so a click inside the demo
 * plant does a full navigation and never paints the marketing page inside the
 * ERP shell.
 *
 * `embedded` sits in the demo-plant chrome (normal flow, no sticky overlay).
 */
const LINKS = [
  { href: "/welcome#overview", label: "Overview" },
  { href: "/welcome#industries", label: "Industries" },
  { href: "/welcome#ai", label: "AI" },
  { href: "/welcome#features", label: "Features" },
  { href: "/welcome#pricing", label: "Pricing" },
  { href: "/welcome#integrations", label: "Integrations" },
  { href: "/welcome#stories", label: "Customer stories" },
  { href: "/welcome#resources", label: "Resources" },
  { href: "/welcome#faq", label: "FAQ" },
] as const;

export function SiteHeader({ embedded = false }: { embedded?: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={
        embedded
          ? "relative z-40 shrink-0 px-2 py-2"
          : "sticky top-0 z-40 px-3 pb-3 pt-3 sm:px-4"
      }
    >
      <div className="relative mx-auto flex max-w-[88rem] items-center gap-2 rounded-full bg-white py-1.5 pl-3 pr-1.5 shadow-[0_10px_40px_rgba(16,32,63,0.14)] ring-1 ring-[#10203f]/10 sm:gap-3 sm:pl-4">
        <a
          href="/welcome"
          aria-label="Protessera home"
          className="flex shrink-0 items-center gap-2 rounded-full font-semibold tracking-tight text-[#10203f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f]"
        >
          <BrandMark className="h-7 w-7" />
          <span>{SITE_NAME}</span>
        </a>

        <nav
          className="hidden min-w-0 flex-1 items-center justify-center gap-x-2.5 xl:flex"
          aria-label="Primary"
        >
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="whitespace-nowrap rounded-full px-1 py-1 text-[13px] font-medium text-[#24344d] hover:text-[#10203f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <a
            href="/login"
            className="hidden rounded-full px-2.5 py-2 text-sm font-medium text-[#24344d] hover:text-[#10203f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f] sm:inline"
          >
            Sign in
          </a>
          <a
            href="/signup"
            className="rounded-full bg-[#10203f] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#1b3358] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f]"
          >
            Try for free
          </a>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full text-[#10203f] hover:bg-[#f3f6fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f] xl:hidden"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id={panelId}
          aria-label="Primary"
          className="absolute left-3 right-3 top-[calc(100%-0.25rem)] z-50 max-h-[min(70vh,32rem)] overflow-auto rounded-3xl bg-white p-3 shadow-[0_18px_50px_rgba(16,32,63,0.18)] ring-1 ring-[#10203f]/10 sm:left-4 sm:right-4 xl:hidden"
        >
          <ul className="flex flex-col">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="block rounded-2xl px-3 py-2.5 text-base font-medium text-[#10203f] hover:bg-[#f4f7fb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#10203f]"
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li className="sm:hidden">
              <a
                href="/login"
                className="block rounded-2xl px-3 py-2.5 text-base font-medium text-[#10203f] hover:bg-[#f4f7fb]"
                onClick={() => setOpen(false)}
              >
                Sign in
              </a>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
