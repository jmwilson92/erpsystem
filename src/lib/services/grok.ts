/**
 * Shared xAI Grok helpers (OpenAI-compatible chat completions).
 * Requires XAI_API_KEY. Default model: grok-4.5 (override with XAI_MODEL).
 */

const XAI_BASE = "https://api.x.ai/v1";

export function grokConfigured() {
  return !!process.env.XAI_API_KEY;
}

export function grokModel() {
  return process.env.XAI_MODEL || "grok-4.5";
}

export async function grokChat(params: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not configured");

  const res = await fetch(`${XAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: grokModel(),
      temperature: params.temperature ?? 0.3,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Grok API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() || "";
}

/** Translate text into target language via Grok. */
export async function grokTranslate(
  text: string,
  targetLanguage: string
): Promise<string> {
  const out = await grokChat({
    temperature: 0.1,
    system: `You are a precise translator. Translate the user's message into ${targetLanguage}. Return ONLY the translation — no quotes, no commentary, no romanization notes unless the user asked for them.`,
    user: text,
  });
  return out || text;
}
