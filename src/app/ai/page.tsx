"use client";

import { useState, useTransition } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { actionAiChat } from "@/app/actions";
import { Bot, Send, Sparkles } from "lucide-react";

const suggestions = [
  "How is the production floor looking?",
  "Summarize open MRB cases and next steps",
  "Which suppliers need attention?",
  "Show value stream bottlenecks",
  "Project EVM status",
  "Suggest workforce development goals",
  "Explain prototype BOM certification flow",
];

export default function AiPage() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([
    {
      role: "assistant",
      content:
        "Welcome to **ForgeERP AI**. I can summarize production, quality/MRB, suppliers, value stream, projects, and goals. Ask anything — or set `XAI_API_KEY` for live Grok.",
    },
  ]);
  const [pending, startTransition] = useTransition();

  function send(q: string) {
    if (!q.trim()) return;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setQuery("");
    startTransition(async () => {
      const reply = await actionAiChat(q);
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="AI Assistant"
        description="Local intelligence with upgrade path to xAI Grok API + tool calling"
      />

      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs text-slate-400 transition-colors hover:border-teal-500/40 hover:text-teal-300"
          >
            <Sparkles className="mr-1 inline h-3 w-3" />
            {s}
          </button>
        ))}
      </div>

      <Card className="min-h-[420px]">
        <CardContent className="flex h-[480px] flex-col p-0">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}
              >
                {m.role === "assistant" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/20">
                    <Bot className="h-4 w-4 text-teal-400" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-teal-600/30 text-slate-100"
                      : "bg-slate-900 text-slate-300"
                  }`}
                >
                  <div className="whitespace-pre-wrap [&_strong]:font-semibold [&_strong]:text-slate-100">
                    {m.content.split(/(\*\*[^*]+\*\*)/).map((part, j) => {
                      if (part.startsWith("**") && part.endsWith("**")) {
                        return <strong key={j}>{part.slice(2, -2)}</strong>;
                      }
                      return <span key={j}>{part}</span>;
                    })}
                  </div>
                </div>
              </div>
            ))}
            {pending && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/20">
                  <Bot className="h-4 w-4 animate-pulse text-teal-400" />
                </div>
                <div className="rounded-xl bg-slate-900 px-4 py-3 text-sm text-slate-500">
                  Thinking…
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-slate-800 p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(query);
              }}
              className="flex gap-2"
            >
              <Textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask about production, MRB, suppliers, EVM…"
                className="min-h-[44px] resize-none"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(query);
                  }
                }}
              />
              <Button type="submit" disabled={pending || !query.trim()} className="shrink-0">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
