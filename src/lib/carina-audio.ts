/**
 * Single global audio channel for Carina + guided tours.
 * Each reply is one server-TTS audio element at a fixed volume.
 * No speechSynthesis, and no pause/resume keep-alive (those caused
 * mid-reply pauses and sudden volume jumps on Edge).
 */
import { tidySpeechText } from "@/lib/ai-help/speech-queue";

export const SPEECH_VOLUME = 1;
/** /api/tts truncates at 1800 characters; stitch longer replies into one blob. */
export const TTS_FETCH_MAX_CHARS = 1800;

let gen = 0;
let currentAudio: HTMLAudioElement | null = null;
let speaking = false;

export function carinaAudioGen(): number {
  return gen;
}

export function carinaBumpAudioGen(): number {
  gen += 1;
  return gen;
}

export function carinaIsAudioCurrent(g: number): boolean {
  return g === gen;
}

export function carinaIsSpeaking(): boolean {
  return speaking;
}

export function carinaStopAllAudio(): void {
  gen += 1;
  speaking = false;
  if (currentAudio) {
    try {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
      currentAudio.removeAttribute("src");
      currentAudio.load();
    } catch {
      // ignore
    }
    currentAudio = null;
  }
}

/** Hold the mic as soon as a reply will be spoken, including the TTS fetch. */
export function carinaBeginSpeechHold(): void {
  speaking = true;
}

/** Start a new spoken reply. Cancels only a previous reply. */
export function carinaStartReply(): void {
  carinaStopAllAudio();
  carinaBeginSpeechHold();
}

/** Split tidy text into fetch-sized pieces without splitting mid-utterance playback. */
export function splitTtsFetches(text: string, max = TTS_FETCH_MAX_CHARS): string[] {
  const src = tidySpeechText(text);
  if (!src) return [];
  if (src.length <= max) return [src];
  const out: string[] = [];
  let rest = src;
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    const cut =
      Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "), slice.lastIndexOf(" ")) ||
      max;
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

async function fetchTtsChunk(
  text: string,
  opts: { language?: string; voiceId?: string } | undefined,
  g: number
): Promise<ArrayBuffer | null> {
  if (g !== gen) return null;
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text.slice(0, TTS_FETCH_MAX_CHARS),
      voiceId: opts?.voiceId || "carina",
      language: opts?.language || "en",
    }),
  });
  if (g !== gen) return null;
  if (!res.ok) throw new Error("tts-unavailable");
  const buf = await res.arrayBuffer();
  if (g !== gen) return null;
  if (buf.byteLength <= 32) throw new Error("tts-empty");
  return buf;
}

function concatBuffers(parts: ArrayBuffer[]): ArrayBuffer {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), offset);
    offset += p.byteLength;
  }
  return out.buffer;
}

async function playOneAudio(buf: ArrayBuffer, type: string, g: number): Promise<void> {
  if (g !== gen) return;
  const url = URL.createObjectURL(new Blob([buf], { type: type || "audio/mpeg" }));
  const audio = new Audio(url);
  audio.volume = SPEECH_VOLUME;
  currentAudio = audio;
  await new Promise<void>((resolve) => {
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    void audio.play().catch(() => resolve());
  });
}

/**
 * Play a complete reply as a single audio element at a fixed volume.
 * Fetches may be stitched, but the listener hears one element, not a queue.
 */
export async function carinaPlaySpeech(
  text: string,
  opts?: { language?: string; voiceId?: string }
): Promise<void> {
  const chunks = splitTtsFetches(text);
  if (!chunks.length) return;
  carinaStartReply();
  const g = gen;
  try {
    const bufs: ArrayBuffer[] = [];
    for (const chunk of chunks) {
      if (g !== gen) return;
      const buf = await fetchTtsChunk(chunk, opts, g);
      if (!buf) return;
      bufs.push(buf);
    }
    if (g !== gen) return;
    await playOneAudio(concatBuffers(bufs), "audio/mpeg", g);
  } catch {
    // Server TTS is required. Do not fall back to speechSynthesis — that
    // path caused choppy, volume-jumping playback on Edge.
    if (g === gen) speaking = false;
    return;
  }
  if (g === gen) speaking = false;
}

/** Ignored: replies are spoken once when finished, not as streamed fragments. */
export function carinaEnqueueCumulative(_cumulative: string, _opts?: { language?: string; voiceId?: string }): number {
  carinaBeginSpeechHold();
  return 0;
}

/** Play the finished reply as one audio element. */
export async function carinaFinishReply(
  finalText?: string,
  opts?: { language?: string; voiceId?: string }
): Promise<void> {
  if (!finalText?.trim()) {
    speaking = false;
    return;
  }
  await carinaPlaySpeech(finalText, opts);
}
