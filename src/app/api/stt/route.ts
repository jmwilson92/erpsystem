import { NextRequest } from "next/server";
import { helpIdentity } from "@/lib/ai-help/identity";
import { reserveHelpTurn } from "@/lib/ai-help/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const STT_PROVIDER = "xai";
export const STT_MODEL = "grok-voice-transcribe-2.0";
export const STT_UPSTREAM = "https://api.x.ai/v1/stt";

function sttKey(): string {
  return (process.env.TTS_API_KEY || process.env.XAI_API_KEY)?.trim() || "";
}

async function warmUpstream(key: string): Promise<void> {
  await fetch("https://api.x.ai/v1/models", {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  }).catch(() => undefined);
}

/** Server STT for Carina listen / PTT. Official xAI STT only. */
export async function POST(req: NextRequest) {
  const identity = await helpIdentity();
  if (!identity) return new Response("Sign in or start a demo", { status: 401 });
  const { user, demo } = identity;

  const key = sttKey();
  if (!key) {
    return Response.json(
      { error: "Voice listening is unavailable; type your question instead.", provider: STT_PROVIDER },
      { status: 503 }
    );
  }

  const ctype = req.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid speech request", { status: 400 });
    }
    if (body?.warmup === true) {
      await warmUpstream(key);
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
    return new Response("Expected an audio upload", { status: 400 });
  }

  const len = Number(req.headers.get("content-length") || 0);
  if (len > 4_000_000) return new Response("Request too large", { status: 413 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response("Invalid speech request", { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size < 64) {
    return new Response("Missing audio", { status: 400 });
  }
  if (file.size > 3_500_000) return new Response("Request too large", { status: 413 });

  let language = "en";
  const raw = form.get("language") || form.get("lang");
  if (typeof raw === "string") {
    language = raw.toLowerCase().split(/[-_]/)[0];
    if (!/^[a-z]{2,3}$/.test(language)) language = "en";
  }

  try {
    await reserveHelpTurn(user.id, demo, "CarinaStt");
  } catch {
    return Response.json({ error: "Voice limit reached. Please type or try later." }, { status: 429 });
  }

  try {
    const upstream = new FormData();
    upstream.append("model", process.env.STT_MODEL?.trim() || STT_MODEL);
    upstream.append("language", language);
    upstream.append("format", "true");
    for (const term of ["Carina", "Karina", "Corina", "Catarina"]) {
      upstream.append("keyterm", term);
    }
    upstream.append("file", file, "utterance.wav");

    const res = await fetch(STT_UPSTREAM, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
      headers: { Authorization: `Bearer ${key}` },
      body: upstream,
    });
    if (!res.ok) {
      console.warn("[stt] upstream status", res.status);
      throw new Error("stt-unavailable");
    }
    const data = (await res.json()) as { text?: string; language?: string; duration?: number };
    const text = typeof data.text === "string" ? data.text.trim() : "";
    return Response.json(
      {
        text,
        language: data.language || language,
        duration: data.duration,
        provider: STT_PROVIDER,
        model: process.env.STT_MODEL?.trim() || STT_MODEL,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json(
      { error: "Voice listening is unavailable. Please type your question.", provider: STT_PROVIDER },
      { status: 502 }
    );
  }
}
