"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  processAiConversation,
  processAiQuery,
} from "@/lib/services/ai";
import { grokConfigured, grokModel, probeGrok } from "@/lib/services/grok";

export type AiConversationResult =
  | { ok: true; text: string; source: "grok" | "local" }
  | { ok: false; error: string };

export async function actionAiChat(query: string) {
  return processAiQuery(query);
}

export async function actionAiConversation(
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<AiConversationResult> {
  try {
    const clean = (messages || [])
      .filter((m) => m?.content?.trim() && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 4000) }))
      .slice(-12);

    if (clean.length === 0) {
      return { ok: false, error: "No message to send" };
    }

    const text = await processAiConversation(clean);
    if (!text?.trim()) {
      return { ok: false, error: "Empty reply from the model" };
    }
    return {
      ok: true,
      text: text.trim(),
      source: grokConfigured() ? "grok" : "local",
    };
  } catch (e) {
    console.error("[actionAiConversation]", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "AI request failed",
    };
  }
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

/** One-click server test: Grok chat (no mic). */
export async function actionProbeGrok() {
  return probeGrok();
}

/** One-click: ask Grok a fixed plant question and return text for TTS. */
export async function actionVoiceSmokeTest(): Promise<AiConversationResult> {
  return actionAiConversation([
    {
      role: "user",
      content:
        "In one short spoken sentence, say you're the ForgeRP plant assistant and ready to help with production and quality. Do not say any personal name.",
    },
  ]);
}
