import type { AiGuideAction, AiPendingAction } from "@/lib/services/ai";
import type { HelpCitation } from "@/lib/ai-help/knowledge";

export type CarinaClientResult =
  | {
      ok: true;
      text: string;
      citations?: HelpCitation[];
      answerId?: string;
      source: "grok" | "local";
      guide?: AiGuideAction;
      pendingAction?: AiPendingAction | null;
      language?: string;
      href?: string;
      timing?: { totalMs?: number; ttftMs?: number };
    }
  | { ok: false; error: string; aborted?: boolean };

/**
 * Stream a Carina turn. Calls onAck immediately, onDelta as text arrives,
 * then returns the final result. Falls back to the server action if the
 * stream endpoint is unavailable.
 */
export async function streamCarinaConversation(
  messages: { role: "user" | "assistant"; content: string }[],
  opts: {
    language?: string | null;
    page?: string | null;
    source?: string | null;
    guestKey?: string | null;
    pendingAction?: AiPendingAction | null;
    onAck?: (text: string) => void;
    onDelta?: (text: string) => void;
    signal?: AbortSignal;
    voice?: boolean;
  } = {}
): Promise<CarinaClientResult> {
  try {
    if (opts.signal?.aborted) return { ok: false, error: "aborted", aborted: true };
    const res = await fetch("/api/ai/conversation", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        language: opts.language,
        page: opts.page,
        source: opts.source,
        guestKey: opts.guestKey,
        pendingAction: opts.pendingAction,
        voice: opts.voice,
      }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      if (res.status === 404 || res.status === 405) throw new Error("fallback");
      const err = await res.text().catch(() => "");
      return {
        ok: false,
        error:
          res.status === 401
            ? "Sign in or start a demo to use AI help."
            : err.slice(0, 240) || "AI help is unavailable. Please use the Support tab for a human.",
      };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let result: CarinaClientResult | null = null;
    while (true) {
      if (opts.signal?.aborted) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return { ok: false, error: "aborted", aborted: true };
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let ev: { type?: string; text?: string; error?: string; ok?: boolean } & CarinaClientResult;
        try {
          ev = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (ev.type === "ack") opts.onAck?.(ev.text || "On it…");
        else if (ev.type === "delta" && ev.text) opts.onDelta?.(ev.text);
        else if (ev.type === "error") result = { ok: false, error: ev.error || "AI help is unavailable." };
        else if (ev.type === "done") {
          if (ev.ok === false) result = { ok: false, error: ev.error || "AI help is unavailable." };
          else {
            result = {
              ok: true,
              text: ev.text || "",
              citations: ev.citations,
              answerId: ev.answerId,
              source: ev.source || "local",
              guide: ev.guide,
              pendingAction: ev.pendingAction ?? null,
              language: ev.language,
              href: ev.href,
              timing: ev.timing,
            };
          }
        }
      }
    }
    if (result) return result;
    return { ok: false, error: "Empty reply from the model" };
  } catch (e) {
    const aborted =
      opts.signal?.aborted ||
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) return { ok: false, error: "aborted", aborted: true };
    const { actionAiConversation } = await import("@/app/ai/actions");
    opts.onAck?.("On it…");
    const fallback = await actionAiConversation(messages, {
      language: opts.language,
      page: opts.page,
      source: opts.source,
      guestKey: opts.guestKey,
      pendingAction: opts.pendingAction,
      voice: opts.voice,
    });
    return fallback;
  }
}
