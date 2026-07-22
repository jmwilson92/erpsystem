import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Text-to-speech proxy for guided-tour narration. Provider-agnostic: point it
 * at any OpenAI-compatible /audio/speech endpoint (xAI/Grok, OpenAI, etc.) via
 * env. When unconfigured it returns 501 and the client falls back to the
 * browser's built-in speech synthesis, so voice always works.
 *
 *   TTS_API_URL   e.g. https://api.x.ai/v1/audio/speech
 *   TTS_API_KEY   provider key (falls back to XAI_API_KEY)
 *   TTS_MODEL     default "tts-1"
 *   TTS_VOICE     default "alloy"
 */
export async function POST(req: NextRequest) {
  const url = process.env.TTS_API_URL;
  const key = process.env.TTS_API_KEY || process.env.XAI_API_KEY;
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "TTS not configured" }), {
      status: 501,
      headers: { "Content-Type": "application/json" },
    });
  }

  let text = "";
  try {
    const body = (await req.json()) as { text?: string };
    text = body.text ?? "";
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!text?.trim()) return new Response("empty", { status: 400 });

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
        input: text.slice(0, 2000),
        response_format: "mp3",
      }),
    });
    if (!upstream.ok) {
      return new Response("tts upstream error", { status: 502 });
    }
    const buf = await upstream.arrayBuffer();
    return new Response(buf, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("tts proxy error", { status: 502 });
  }
}
