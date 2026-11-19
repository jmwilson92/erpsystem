"use client";

import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { VoiceAssistant } from "@/components/ai/voice-assistant";
import { CarinaTodoPanel } from "@/components/ai/carina-todo-panel";

/**
 * AI settings only — day-to-day chat/voice lives in the help bubble.
 */
export default function AiPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="My AI assistant"
        description="Carina is an AI assistant powered by Grok and can make mistakes. She can look up records you may view, take you to pages, walk through how-tos, and keep a to-do list she works on in the background. When an administrator enables Carina voice actions she can propose confirm-gated changes and create a purchase request. Source links and human support stay in the help bubble."
      />

      <p className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
        <strong className="text-slate-300">Find this page anytime:</strong>{" "}
        sidebar → Administration → <em>My AI assistant</em>, or Company Settings
        → My AI assistant, or the help bubble → AI assistant → Settings. Use
        the floating help bubble to chat or enable site-wide voice.
      </p>

      <VoiceAssistant />

      <Suspense fallback={<p className="text-xs text-slate-500">Loading to-do list…</p>}>
        <CarinaTodoPanel />
      </Suspense>
    </div>
  );
}
