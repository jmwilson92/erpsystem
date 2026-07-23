"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cookie } from "lucide-react";

const KEY = "forge-cookie-consent";

/**
 * Lightweight cookie-consent banner. ForgeRP only uses a strictly-necessary
 * session cookie plus this consent flag, so there's nothing to gate behind
 * consent — this is the notice + acknowledgement. The choice is remembered in
 * localStorage so it shows once.
 */
export function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true);
    } catch {
      /* private mode / storage blocked — don't nag */
    }
  }, []);

  function decide(choice: "accepted" | "essential") {
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[200] px-4 pb-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-sm text-slate-300">
          <Cookie className="mt-0.5 h-4 w-4 shrink-0 text-teal-400" />
          <span>
            We use a strictly-necessary session cookie to keep you signed in, and
            optional cookies to improve the product. See our{" "}
            <Link href="/legal/cookie-policy" className="text-teal-400 hover:underline">
              Cookie Policy
            </Link>
            .
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => decide("essential")}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500"
          >
            Essential only
          </button>
          <button
            onClick={() => decide("accepted")}
            className="rounded-lg bg-teal-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-teal-400"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
