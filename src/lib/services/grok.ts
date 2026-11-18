/**
 * Shared xAI chat helpers (OpenAI-compatible completions).
 * Requires XAI_API_KEY. Model IDs are xAI product names (API identifiers).
 */

const XAI_BASE = "https://api.x.ai/v1";

/** Configured deployments keep their selected model; new installs use current flagship.
 * No fallback on authentication, quota, transport or model errors: avoid retry storms. */
export function grokConfigured() {
  return !!process.env.XAI_API_KEY?.trim();
}

export function grokModel() {
  return process.env.XAI_MODEL?.trim() || "grok-4.7";
}

function chatBody(params: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  messages?: { role: "system" | "user" | "assistant"; content: string }[];
  stream?: boolean;
}) {
  const messages =
    params.messages ??
    ([
      { role: "system" as const, content: params.system },
      { role: "user" as const, content: params.user },
    ] as const);
  return {
    model: grokModel(),
    temperature: params.temperature ?? 0.1,
    max_tokens: Math.min(params.maxTokens ?? 700, 1000),
    ...(grokModel() === "grok-4.7" ? { reasoning_effort: "low" } : {}),
    ...(params.stream ? { stream: true } : {}),
    messages,
  };
}

export async function grokChat(params: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  messages?: { role: "system" | "user" | "assistant"; content: string }[];
}): Promise<string> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) throw new Error("XAI_API_KEY is not configured on the server");

  const res = await fetch(`${XAI_BASE}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(params.timeoutMs ?? 25000),
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(chatBody(params)),
  });
  if (!res.ok) {
    // Upstream bodies can echo input or credentials. Never log or expose them.
    console.warn("[ai] upstream status", res.status);
    throw new Error("AI service unavailable. Use the Support tab or try again later.");
  }
  const data = await res.json() as {choices?:{message?:{content?:string}}[]};
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("AI returned no answer");
  return content;
}

export type GrokStreamResult = { text: string; ttftMs: number | null; totalMs: number };

/**
 * Stream a chat completion. onDelta is called with each content chunk and the
 * cumulative text. Time-to-first-token is measured from the fetch start.
 */
export async function grokChatStream(params: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  messages?: { role: "system" | "user" | "assistant"; content: string }[];
  onDelta?: (chunk: string, full: string) => void;
}): Promise<GrokStreamResult> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) throw new Error("XAI_API_KEY is not configured on the server");
  const started = Date.now();
  const res = await fetch(`${XAI_BASE}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(params.timeoutMs ?? 8000),
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(chatBody({ ...params, stream: true })),
  });
  if (!res.ok) {
    console.warn("[ai] upstream status", res.status);
    throw new Error("AI service unavailable. Use the Support tab or try again later.");
  }
  if (!res.body) throw new Error("AI returned no answer");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let ttftMs: number | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string }; message?: { content?: string } }[];
        };
        const chunk = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || "";
        if (!chunk) continue;
        if (ttftMs == null) ttftMs = Date.now() - started;
        text += chunk;
        params.onDelta?.(chunk, text);
      } catch {
        // ignore a partial SSE JSON line; it will arrive complete later
      }
    }
  }
  if (!text.trim()) throw new Error("AI returned no answer");
  return { text, ttftMs, totalMs: Date.now() - started };
}

/** Translate text into target language via xAI. */
export async function grokTranslate(
  text: string,
  targetLanguage: string
): Promise<string> {
  const out = await grokChat({
    temperature: 0.1,
    system: `You are a precise translator. Translate the user's message into ${targetLanguage}. Return ONLY the translation — no quotes, no commentary.`,
    user: text,
  });
  return out || text;
}

export type GrokProbe = {
  configured: boolean;
  model: string;
  ok: boolean;
  sample?: string;
  error?: string;
};

/** Lightweight health check for the AI page / voice debug. */
export async function probeGrok(): Promise<GrokProbe> {
  if (!grokConfigured()) {
    return {
      configured: false,
      model: grokModel(),
      ok: false,
      error: "XAI_API_KEY missing on the server (set in Vercel Production + redeploy)",
    };
  }
  try {
    const sample = await grokChat({
      temperature: 0.2,
      system: "Reply in one short friendly sentence.",
      user: "Say hello as Carina, the Protessera plant assistant.",
    });
    return { configured: true, model: grokModel(), ok: true, sample };
  } catch (e) {
    return {
      configured: true,
      model: grokModel(),
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
