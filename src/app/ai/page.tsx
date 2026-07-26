"use client";

import { PageHeader } from "@/components/shared/page-header";
import { VoiceAssistant } from "@/components/ai/voice-assistant";

/**
 * AI settings only — day-to-day chat/voice lives in the help bubble.
 */
export default function AiPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="My AI assistant"
        description="Wake name, language, and voice diagnostics for Carina. Day-to-day chat and voice are in the help bubble."
      />

      <p className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
        <strong className="text-slate-300">Find this page anytime:</strong>{" "}
        sidebar → Administration → <em>My AI assistant</em>, or Company Settings
        → My AI assistant, or the help bubble → AI assistant → Settings. Use
        the floating help bubble to chat or enable site-wide voice.
      </p>

      <VoiceAssistant />
    </div>
  );
}
