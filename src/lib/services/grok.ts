/**
 * Shared xAI Grok helpers (OpenAI-compatible chat completions).
 * Requires XAI_API_KEY.
 */

const XAI_BASE = "https://api.x.ai/v1";

/** Try these in order if XAI_MODEL is unset or fails */
const MODEL_FALLBACKS = [
  process.env.XAI_MODEL,
  "grok-4.5",
  "grok-4",
  "grok-3",
  "grok-2-latest",
  "grok-2",
].filter(Boolean) as string[];

export function grokConfigured() {
  return !!process.env.XAI_API_KEY?.trim();
}

export function grokModel() {
  return MODEL_FALLBACKS[0] || "grok-4.5";
}

export async function grokChat(params: {
  system: string;
  user: string;
  temperature?: number;
  messages?: { role: "system" | "user" | "assistant"; content: string }[];
}): Promise<string> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) throw new Error("XAI_API_KEY is not configured on the server");

  const messages =
    params.messages ??
    ([
      { role: "system" as const, content: params.system },
      { role: "user" as const, content: params.user },
    ] as const);

  let lastErr = "Grok request failed";
  for (const model of MODEL_FALLBACKS) {
    try {
      const res = await fetch(`${XAI_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          temperature: params.temperature ?? 0.3,
          messages,
        }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 240);
        lastErr = `Grok ${model} → HTTP ${res.status}: ${body}`;
        console.error("[grok]", lastErr);
        // try next model on 404/400 model errors
        if (res.status === 404 || res.status === 400) continue;
        throw new Error(lastErr);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content) return content;
      lastErr = `Grok ${model} returned empty content`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.error("[grok] attempt failed:", model, lastErr);
    }
  }
  throw new Error(lastErr);
}

/** Translate text into target language via Grok. */
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
      user: "Say hello as Carina, the ForgeRP plant assistant.",
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
