"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  processAiConversation,
  processAiQuery,
  type AiGuideAction,
  type AiPendingAction,
} from "@/lib/services/ai";
import { grokConfigured, grokModel, probeGrok } from "@/lib/services/grok";
import { getCarinaFeatures } from "@/lib/services/carina-features";
import { formatCarinaCostReport } from "@/lib/services/carina-cost";

export type AiConversationResult =
  | {
      ok: true;
      text: string;
      source: "grok" | "local";
      /** When set, client should start the interactive spotlight tour */
      guide?: AiGuideAction;
      /** Echo back on next turn for multi-step agent actions */
      pendingAction?: AiPendingAction | null;
      /** BCP-47 code for TTS */
      language?: string;
      /** Optional path to open after agent action */
      href?: string;
    }
  | { ok: false; error: string };

export async function actionAiChat(query: string) {
  return processAiQuery(query);
}

export async function actionAiConversation(
  messages: { role: "user" | "assistant"; content: string }[],
  opts?: {
    pendingAction?: AiPendingAction | null;
    language?: string | null;
    /** LANDING | MARKETING | DEMO | APP | TENANT — demo/landing get strict rate limits */
    source?: string | null;
    /** Stable browser id for guest rate limits (localStorage uuid) */
    guestKey?: string | null;
  }
): Promise<AiConversationResult> {
  try {
    const clean = (messages || [])
      .filter((m) => m?.content?.trim() && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 4000) }))
      .slice(-12);

    if (clean.length === 0) {
      return { ok: false, error: "No message to send" };
    }

    const user = await getCurrentUser().catch(() => null);
    const { checkCarinaRateLimit } = await import(
      "@/lib/services/carina-rate-limit"
    );
    const rl = checkCarinaRateLimit({
      source: opts?.source,
      userId: user?.id,
      guestKey: opts?.guestKey,
    });
    if (!rl.ok) {
      return { ok: false, error: rl.message };
    }

    const result = await processAiConversation(clean, {
      pendingAction: opts?.pendingAction,
      language: opts?.language,
    });
    if (!result?.text?.trim()) {
      return { ok: false, error: "Empty reply from the model" };
    }
    return {
      ok: true,
      text: result.text.trim(),
      source: grokConfigured() ? "grok" : "local",
      guide: result.guide,
      pendingAction: result.pendingAction ?? null,
      language: result.language,
      href: result.href,
    };
  } catch (e) {
    console.error("[actionAiConversation]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "AI request failed",
    };
  }
}

/** Local/dev: which Carina capabilities this tenant has. */
export async function actionCarinaFeatures() {
  return getCarinaFeatures();
}

/** Local/dev: print unit-economics assumptions (not a live meter). */
export async function actionCarinaCostReport() {
  return formatCarinaCostReport("fast");
}

export async function actionGetAssistantName(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) return "Carina";
  try {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { assistantName: true },
    });
    return row?.assistantName?.trim() || "Carina";
  } catch {
    return "Carina";
  }
}

export async function actionSetAssistantName(name: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in required");
  const clean = name.trim().slice(0, 32);
  if (clean.length < 2) throw new Error("Name must be at least 2 characters");
  if (!/^[A-Za-z][A-Za-z0-9\- ]{1,31}$/.test(clean)) {
    throw new Error("Use letters, numbers, spaces, or hyphens only");
  }
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { assistantName: clean },
    });
  } catch {
    throw new Error(
      "Could not save assistant name. Run scripts/sql/support-typing-read-assistant.sql on the database."
    );
  }
  revalidatePath("/ai");
  return clean;
}

export async function actionGrokStatus() {
  return {
    configured: grokConfigured(),
    model: grokModel(),
  };
}

/** One-click server test: AI chat (no mic). */
export async function actionProbeGrok() {
  return probeGrok();
}

/** One-click: fixed plant question for TTS smoke test. */
export async function actionVoiceSmokeTest(): Promise<AiConversationResult> {
  return actionAiConversation([
    {
      role: "user",
      content:
        "In one short spoken sentence, say you're the ForgeRP plant assistant and ready to help with production and quality. Do not say any personal name.",
    },
  ]);
}
