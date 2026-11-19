/** Client helper for Carina server STT (xAI grok-voice-transcribe). */

export type SttResult = {
  text: string;
  provider: string;
  model: string;
  duration?: number;
  sttMs: number;
};

export const STT_CLIENT_PROVIDER = "xai";
export const STT_CLIENT_MODEL = "grok-voice-transcribe-2.0";

export async function transcribeUtterance(
  wav: Blob,
  opts?: { language?: string }
): Promise<SttResult> {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const body = new FormData();
  body.append("language", (opts?.language || "en").slice(0, 8));
  body.append("file", wav, "utterance.wav");
  const res = await fetch("/api/stt", { method: "POST", body, cache: "no-store" });
  const sttMs = Math.round(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - started
  );
  if (!res.ok) {
    throw new Error(res.status === 429 ? "Voice limit reached." : "stt-unavailable");
  }
  const data = (await res.json()) as {
    text?: string;
    provider?: string;
    model?: string;
    duration?: number;
  };
  return {
    text: (data.text || "").trim(),
    provider: data.provider || STT_CLIENT_PROVIDER,
    model: data.model || STT_CLIENT_MODEL,
    duration: data.duration,
    sttMs,
  };
}

export function carinaWarmStt(): Promise<void> {
  if (typeof fetch !== "function") return Promise.resolve();
  return fetch("/api/stt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ warmup: true }),
    cache: "no-store",
  })
    .then(() => undefined)
    .catch(() => undefined);
}
