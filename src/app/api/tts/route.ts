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
 * Optional override for OpenAI-compatible speech endpoints:
 *   TTS_API_URL, TTS_MODEL, TTS_VOICE
 *
 * Voice is fixed to Grok Carina (product default).
 */
export async function POST(req: NextRequest) {
  let text = "";
  const voiceId = "carina";
  try {
    const body = (await req.json()) as { text?: string };
    text = body.text ?? "";
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!text?.trim()) return new Response("empty", { status: 400 });

  const key = process.env.TTS_API_KEY || process.env.XAI_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: "TTS not configured — set XAI_API_KEY" }), {
      status: 501,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sliced = text.slice(0, 2000);

  // 1) Native xAI TTS (best quality — Carina, Ara, Eve, …)
  try {
    const xai = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: sliced,
        voice_id: voiceId,
        language: "en",
      }),
    });
    if (xai.ok) {
      const buf = await xai.arrayBuffer();
      return new Response(buf, {
        headers: {
          "Content-Type": xai.headers.get("Content-Type") || "audio/mpeg",
          "Cache-Control": "no-store",
        },
      });
    }
    // fall through to optional OpenAI-compatible endpoint
    console.warn("[tts] xAI TTS failed:", xai.status, (await xai.text()).slice(0, 200));
  } catch (e) {
    console.warn("[tts] xAI TTS error:", e);
  }

  // 2) Optional OpenAI-compatible /audio/speech
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
          headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
        });
      }
    } catch {
      // fall through
    }
  }

  return new Response(
    JSON.stringify({
      error: "TTS upstream failed",
      hint: "Set XAI_API_KEY for Grok TTS (voice_id: carina, ara, eve, leo, rex, sal, …)",
    }),
    { status: 502, headers: { "Content-Type": "application/json" } }
  );
}
