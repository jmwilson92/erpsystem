import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Text-to-speech for voice assistant + guided tours.
 *
 * Prefer xAI Grok TTS (natural voices: carina, ara, eve, leo, …):
 *   POST https://api.x.ai/v1/tts  { text, voice_id, language }
 *   Needs XAI_API_KEY (or TTS_API_KEY)
 *
 * Voice is fixed to Grok Carina. Language defaults to English (`en`).
 */
export async function POST(req: NextRequest) {
  let text = "";
  let language = "en";
  try {
    const body = (await req.json()) as {
      text?: string;
      language?: string;
      lang?: string;
    };
    text = body.text ?? "";
    const raw = (body.language || body.lang || "en").trim().toLowerCase();
    // Accept en, en-US, es-ES → short code for xAI
    language = raw.split(/[-_]/)[0] || "en";
    if (language.length < 2 || language.length > 3) language = "en";
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!text?.trim()) return new Response("empty", { status: 400 });

  const key = (process.env.TTS_API_KEY || process.env.XAI_API_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!key) {
    return new Response(
      JSON.stringify({
        error: "TTS not configured",
        code: "missing_key",
        hint: "Add XAI_API_KEY=xai-... to .env (local) or Vercel env (production), then restart npm run dev.",
      }),
      {
        status: 501,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // xAI keys look like "xai-...." — UUIDs / Supabase ids are a common mistake
  if (!key.startsWith("xai-")) {
    return new Response(
      JSON.stringify({
        error: "Invalid XAI_API_KEY format",
        code: "bad_key_format",
        hint: `Your key does not start with "xai-". Open https://console.x.ai → API Keys → create/copy a key that looks like xai-.... Paste into .env as XAI_API_KEY=xai-... then restart the server. (Got ${key.length}-char value starting with "${key.slice(0, 6)}…")`,
      }),
      {
        status: 501,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const voiceId = process.env.TTS_VOICE_ID?.trim() || "carina";
  const sliced = text.slice(0, 2000);
  const lastErrors: string[] = [];

  // Docs: POST https://api.x.ai/v1/tts  { text, voice_id, language }
  const ttsAttempts: Record<string, unknown>[] = [
    { text: sliced, voice_id: voiceId, language },
    { text: sliced, voice_id: voiceId, language: "auto" },
    { text: sliced, voice_id: voiceId },
    // Case variants + alternate field name used by older experiments
    { text: sliced, voice_id: voiceId.charAt(0).toUpperCase() + voiceId.slice(1), language },
    { text: sliced, voice: voiceId, language },
  ];

  for (const payload of ttsAttempts) {
    try {
      const xai = await fetch("https://api.x.ai/v1/tts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (xai.ok) {
        const buf = await xai.arrayBuffer();
        if (buf.byteLength < 32) {
          lastErrors.push("empty audio body");
          continue;
        }
        const ct = xai.headers.get("Content-Type") || "audio/mpeg";
        return new Response(buf, {
          headers: {
            "Content-Type": ct.includes("json") ? "audio/mpeg" : ct,
            "Cache-Control": "no-store",
            "X-Carina-TTS-Lang": language,
            "X-Carina-TTS-Voice": voiceId,
          },
        });
      }
      const errBody = (await xai.text()).slice(0, 280);
      lastErrors.push(`HTTP ${xai.status}: ${errBody}`);
      console.warn("[tts] xAI TTS attempt failed:", xai.status, errBody, payload);
      // Auth errors won't succeed with other shapes
      if (xai.status === 401 || xai.status === 403) break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastErrors.push(msg);
      console.warn("[tts] xAI TTS error:", e);
    }
  }

  // Optional OpenAI-compatible /audio/speech
  const url = process.env.TTS_API_URL;
  if (url) {
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.TTS_MODEL || "tts-1",
          voice: process.env.TTS_VOICE || "alloy",
          input: sliced,
          response_format: "mp3",
        }),
      });
      if (upstream.ok) {
        const buf = await upstream.arrayBuffer();
        return new Response(buf, {
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      }
    } catch {
      // fall through
    }
  }

  const joined = lastErrors.join(" | ");
  const authFail = /incorrect api key|invalid api key|unauthorized|401|403/i.test(
    joined
  );
  return new Response(
    JSON.stringify({
      error: authFail
        ? "xAI rejected your API key"
        : "TTS upstream failed",
      code: authFail ? "invalid_key" : "upstream_failed",
      hint: authFail
        ? "xAI said the key is incorrect. Create a new key at https://console.x.ai (must start with xai-), put it in .env as XAI_API_KEY=xai-..., save, and fully restart npm run dev."
        : "Check XAI_API_KEY is valid and has TTS access. Voice defaults to carina.",
      language,
      voiceId,
      detail: lastErrors.slice(0, 3),
    }),
    { status: 502, headers: { "Content-Type": "application/json" } }
  );
}
