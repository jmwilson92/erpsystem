"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  actionCreatePlaidLinkToken,
  actionExchangePlaidToken,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Link2, Loader2 } from "lucide-react";

type PlaidLinkHandler = { open: () => void };
type PlaidGlobal = {
  create: (config: {
    token: string;
    onSuccess: (
      publicToken: string,
      metadata: { institution?: { name?: string } | null }
    ) => void;
    onExit: (err: { display_message?: string } | null) => void;
  }) => PlaidLinkHandler;
};

declare global {
  interface Window {
    Plaid?: PlaidGlobal;
  }
}

const PLAID_LINK_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

/** Loads Plaid's Link script on demand (once) and resolves the global. */
function loadPlaid(): Promise<PlaidGlobal> {
  return new Promise((resolve, reject) => {
    if (window.Plaid) return resolve(window.Plaid);
    const existing = document.querySelector(`script[src="${PLAID_LINK_SRC}"]`);
    const script = existing || document.createElement("script");
    const onReady = () =>
      window.Plaid
        ? resolve(window.Plaid)
        : reject(new Error("Plaid Link failed to initialize"));
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Could not load Plaid Link — check your network")),
      { once: true }
    );
    if (!existing) {
      (script as HTMLScriptElement).src = PLAID_LINK_SRC;
      document.head.appendChild(script);
    } else if (window.Plaid) {
      resolve(window.Plaid);
    }
  });
}

export function PlaidLinkButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const [plaid, tokenRes] = await Promise.all([
        loadPlaid(),
        actionCreatePlaidLinkToken(),
      ]);
      if (!tokenRes.linkToken) {
        setStatus(tokenRes.error || "Could not start Plaid Link");
        setBusy(false);
        return;
      }
      const handler = plaid.create({
        token: tokenRes.linkToken,
        onSuccess: async (publicToken, metadata) => {
          setStatus("Linking accounts…");
          const res = await actionExchangePlaidToken({
            publicToken,
            institution: metadata.institution?.name || null,
          });
          if (res.error) {
            setStatus(res.error);
          } else {
            setStatus(`Linked ${res.linked} account(s) — feed synced.`);
            router.refresh();
          }
          setBusy(false);
        },
        onExit: (err) => {
          setStatus(err?.display_message || null);
          setBusy(false);
        },
      });
      handler.open();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Plaid Link failed");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" onClick={connect} disabled={busy}>
        {busy ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Link2 className="mr-1.5 h-4 w-4" />
        )}
        {busy ? "Connecting…" : "Connect company bank via Plaid"}
      </Button>
      {status && <p className="text-xs text-slate-400">{status}</p>}
    </div>
  );
}
