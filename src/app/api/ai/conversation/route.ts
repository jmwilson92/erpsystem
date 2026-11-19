import { NextRequest } from "next/server";
import { helpIdentity } from "@/lib/ai-help/identity";
import { helpPageContext } from "@/lib/ai-help/knowledge";
import { reserveHelpTurn, logHelpAnswer, redactHelpText } from "@/lib/ai-help/budget";
import { processAiConversation } from "@/lib/services/ai";
import { grokModel } from "@/lib/services/grok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = { role: "user" | "assistant"; content: string };

function sse(obj: unknown) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/**
 * Streaming Carina conversation. Same auth, budget, and answer path as
 * actionAiConversation. First event is a local ack; later events stream
 * the answer text when the model is used.
 */
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const started = Date.now();
  let body: {
    messages?: Msg[];
    language?: string | null;
    page?: string | null;
    source?: string | null;
    pendingAction?: import("@/lib/services/ai").AiPendingAction | null;
    voice?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid conversation", { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length > 100) {
    return new Response("Invalid conversation", { status: 400 });
  }
  const clean = body.messages
    .slice(-8)
    .filter(
      (m) =>
        typeof m?.content === "string" &&
        m.content.trim() &&
        (m.role === "user" || m.role === "assistant")
    )
    .map((m) => ({
      role: m.role,
      content: redactHelpText(m.content.trim().slice(0, 2000)),
    }));
  if (!clean.length) return new Response("No message to send", { status: 400 });

  const identity = await helpIdentity();
  if (!identity) {
    return new Response("Sign in or start a demo to use AI help.", { status: 401 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(sse(obj)));
      try {
        send({ type: "ack", text: "On it…", ms: Date.now() - started });
        const answerId = await reserveHelpTurn(identity.user.id, identity.demo);
        const page = helpPageContext(body.page);
        let lastDelta = "";
        const result = await processAiConversation(clean, {
          page,
          language: body.language,
          pendingAction: body.pendingAction ?? null,
          userId: identity.user.id,
          voice: !!body.voice,
          onDelta: (text) => {
            if (text && text !== lastDelta) {
              lastDelta = text;
              send({ type: "delta", text });
            }
          },
        });
        if (!result?.text?.trim()) {
          send({ type: "error", error: "Empty reply from the model" });
          controller.close();
          return;
        }
        const question = clean.filter((m) => m.role === "user").at(-1)?.content || "";
        await logHelpAnswer(identity.user.id, answerId, question, result, page);
        send({
          type: "done",
          ok: true,
          text: result.text.trim(),
          source: result.source || "local",
          answerId,
          citations: result.citations,
          guide: result.guide,
          pendingAction: result.pendingAction ?? null,
          language: result.language,
          href: result.href,
          model: grokModel(),
          timing: {
            ackMs: Date.now() - started,
            totalMs: Date.now() - started,
            ...(((result as { timing?: Record<string, number> }).timing) || {}),
          },
        });
      } catch (e) {
        const error =
          e instanceof Error && e.message.startsWith("AI help is busy")
            ? e.message
            : "AI help is unavailable. Please use the Support tab for a human.";
        send({ type: "error", error });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
