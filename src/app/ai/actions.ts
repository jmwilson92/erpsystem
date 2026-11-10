"use server";

import { helpIdentity } from "@/lib/ai-help/identity";
import { helpPageContext, type HelpCitation } from "@/lib/ai-help/knowledge";
import { reserveHelpTurn, logHelpAnswer, redactHelpText } from "@/lib/ai-help/budget";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma, currentRequestSchema } from "@/lib/db";
import { cachedHelp } from "@/lib/ai-help/cache";
import {
  processAiConversation,
  processAiQuery,
  type AiGuideAction,
  type AiPendingAction,
} from "@/lib/services/ai";
import { grokConfigured, grokModel } from "@/lib/services/grok";
import { getCarinaFeatures } from "@/lib/services/carina-features";
import { formatCarinaCostReport } from "@/lib/services/carina-cost";

export type AiConversationResult =
  | {
      ok: true;
      text: string;
      citations?: HelpCitation[];
      answerId?: string;
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
    page?: string | null;
    /** Stable browser id for guest rate limits (localStorage uuid) */
    guestKey?: string | null;
  }
): Promise<AiConversationResult> {
  try {
    if (!Array.isArray(messages) || messages.length > 100) return {ok:false,error:"Invalid conversation"};
    const clean = messages.slice(-8)
      .filter((m) => typeof m?.content === "string" && m.content.trim() && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: redactHelpText(m.content.trim().slice(0, 2000)) }));

    if (clean.length === 0) {
      return { ok: false, error: "No message to send" };
    }

    const identity=await helpIdentity();
    if (!identity) return {ok:false,error:"Sign in or start a demo to use AI help."};
    const {user,demo}=identity;
    // Client source/guestKey never grant identity, remove a budget, or select a tenant.
    const answerId = await reserveHelpTurn(user.id, demo);
    const page = helpPageContext(opts?.page);
    const result = await cachedHelp(`${await currentRequestSchema()}:${user.id}`, {clean,page,language:opts?.language,model:grokModel()}, ()=>processAiConversation(clean, {
      page,
      language: opts?.language,
    }));
    if (!result?.text?.trim()) {
      return { ok: false, error: "Empty reply from the model" };
    }
    await logHelpAnswer(user.id, answerId, clean.filter(m=>m.role==='user').at(-1)?.content || '', result, page);
    return {
      ok: true,
      text: result.text.trim(),
      source: result.source || "local",
      answerId,
      citations: result.citations,
      guide: result.guide,
      pendingAction: result.pendingAction ?? null,
      language: result.language,
      href: result.href,
    };
  } catch (e) {
    console.warn("[actionAiConversation] unavailable");
    return {
      ok: false,
      error: e instanceof Error && e.message.startsWith("AI help is busy") ? e.message : "AI help is unavailable. Please use the Support tab for a human.",
    };
  }
}

/** Local/dev: which Carina capabilities this tenant has. */
export async function actionCarinaFeatures() {
  return getCarinaFeatures();
}

/** Local/dev: print unit-economics assumptions (not a live meter). */
export async function actionCarinaCostReport() {
  return formatCarinaCostReport("flagship");
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
  const result=await actionAiConversation([{role:"user",content:"How do I set up my sign-off PIN?"}]);
  return {configured:grokConfigured(),model:grokModel(),ok:result.ok && result.source==='grok',sample:result.ok?result.text:undefined,error:result.ok?undefined:result.error};
}

/** One-click: fixed plant question for TTS smoke test. */
export async function actionVoiceSmokeTest(): Promise<AiConversationResult> {
  return actionAiConversation([
    {
      role: "user",
      content:
        "In one short spoken sentence, say you're the Protessera plant assistant and ready to help with production and quality. Do not say any personal name.",
    },
  ]);
}

/** Feedback is owned by the same signed-in tenant user, never a client-selected tenant. */
export async function actionAiFeedback(answerId:string, helpful:boolean) {
  const identity=await helpIdentity();
  const user=identity?.user;
  if(!user?.isActive || typeof answerId!=="string" || answerId.length>50 || typeof helpful!=="boolean") return {ok:false};
  const answer=await prisma.auditLog.findFirst({where:{entityType:"CarinaHelp",entityId:answerId,action:"ANSWER",userId:user.id}});
  if(!answer) return {ok:false};
  await prisma.auditLog.update({where:{id:answer.id},data:{changes:JSON.stringify({helpful})}});
  return {ok:true};
}
