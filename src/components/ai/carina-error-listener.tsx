"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import {
  askCarinaAboutError,
  installFetchCapture,
  latestLocalError,
  reportClientError,
} from "@/lib/carina-error-client";

/**
 * Installs session error capture: failed fetch, window errors, and a
 * consistent “Ask Carina” action on error toasts.
 */
export function CarinaErrorListener() {
  useEffect(() => {
    const uninstall = installFetchCapture();

    const onWindowError = (e: ErrorEvent) => {
      reportClientError({
        message: e.message || "Window error",
        source: "window",
        payload: { filename: e.filename, lineno: e.lineno, colno: e.colno },
      });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const message = reason instanceof Error ? reason.message : String(reason || "Unhandled rejection");
      reportClientError({ message, source: "window", actionAttempted: "unhandledrejection" });
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onRejection);

    const orig = toast.error.bind(toast);
    toast.error = ((message: unknown, opts?: Parameters<typeof toast.error>[1]) => {
      const text = typeof message === "string" ? message : String(message);
      const already = opts?.action;
      return orig(text, {
        ...opts,
        action: already || {
          label: "Ask Carina",
          onClick: () => {
            const latest = latestLocalError();
            if (!latest || latest.message !== text) {
              reportClientError({ message: text, source: "action" });
            }
            askCarinaAboutError();
          },
        },
      });
    }) as typeof toast.error;

    return () => {
      uninstall();
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onRejection);
      toast.error = orig;
    };
  }, []);
  return null;
}
