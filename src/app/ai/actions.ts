"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  processAiConversation,
  processAiQuery,
} from "@/lib/services/ai";
import { grokConfigured } from "@/lib/services/grok";

export async function actionAiChat(query: string) {
  return processAiQuery(query);
}

export async function actionAiConversation(
  messages: { role: "user" | "assistant"; content: string }[]
) {
  return processAiConversation(messages);
}

export async function actionGetAssistantName(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) return "Forge";
  try {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { assistantName: true },
    });
    return row?.assistantName?.trim() || "Forge";
  } catch {
    return "Forge";
  }
}

export async function actionSetAssistantName(name: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in required");
  const clean = name.trim().slice(0, 32);
  if (clean.length < 2) throw new Error("Name must be at least 2 characters");
  // Only allow simple wake-word names
  if (!/^[A-Za-z][A-Za-z0-9\- ]{1,31}$/.test(clean)) {
    throw new Error("Use letters, numbers, spaces, or hyphens only");
  }
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { assistantName: clean },
    });
  } catch {
    // Column may not exist until SQL migration runs — still ok for localStorage fallback
    throw new Error(
      "Could not save assistant name. Run scripts/sql/support-typing-read-assistant.sql on the database."
    );
  }
  revalidatePath("/ai");
  return clean;
}

export async function actionGrokStatus() {
  return { configured: grokConfigured() };
}
