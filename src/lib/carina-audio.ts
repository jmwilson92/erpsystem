/**
 * Single global audio channel for Carina + guided tours.
 * Stream TTS by sentence: start the first-sentence fetch as soon as that
 * text is ready, play it at a fixed volume, and prefetch the rest. No
 * speechSynthesis and no pause/resume keep-alive.
 */
import { normalizeSpeechText } from "@/lib/ai-help/speech-normalize";
import { createReplyQueue } from "@/lib/ai-help/speech-turn";
import {
  splitSentences,
  tidySpeechText,
} from "@/lib/ai-help/speech-queue";

export const SPEECH_VOLUME = 1;
/** /api/tts truncates at 1800 characters; keep fetches at or under that. */
export const TTS_FETCH_MAX_CHARS = 1800;

export type CarinaSpeakTimings = {
  timeToFirstAudioMs: number | null;
  firstSentenceChars: number;
};

let gen = 0;
let currentAudio: HTMLAudioElement | null = null;
let speaking = false;
let playTail: Promise<void> = Promise.resolve();
let replyStartedAt = 0;
let firstAudioAt: number | null = null;
let firstSentenceChars = 0;
const replyQueue = createReplyQueue();
let activeTurnId = 0;
let lastTimings: CarinaSpeakTimings = { timeToFirstAudioMs: null, firstSentenceChars: 0 };
let warmupInFlight: Promise<void> | null = null;

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

export function carinaLastSpeakTimings(): CarinaSpeakTimings {
  return lastTimings;
}

export function carinaStopAllAudio(): void {
  gen += 1;
  speaking = false;
  replyQueue.reset();
  playTail = Promise.resolve();
  firstAudioAt = null;
  firstSentenceChars = 0;
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

export type CarinaSpeakOpts = { language?: string; voiceId?: string; turnId?: number };

function isCurrentTurn(turnId?: number): boolean {
  return turnId == null || turnId === activeTurnId;
}

export function carinaActiveTurnId(): number {
  return activeTurnId;
}

/** Start a new spoken reply. Cancels only a previous reply, not later sentences. */
export function carinaStartReply(turnId?: number): void {
  carinaStopAllAudio();
  activeTurnId = turnId ?? activeTurnId + 1;
  carinaBeginSpeechHold();
  replyStartedAt = nowMs();
  firstAudioAt = null;
  firstSentenceChars = 0;
  lastTimings = { timeToFirstAudioMs: null, firstSentenceChars: 0 };
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Split tidy text into fetch-sized pieces. */
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
      text: normalizeSpeechText(text).slice(0, TTS_FETCH_MAX_CHARS),
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

async function playOneAudio(buf: ArrayBuffer, type: string, g: number): Promise<void> {
  if (g !== gen) return;
  if (firstAudioAt == null) {
    firstAudioAt = nowMs();
    lastTimings = {
      timeToFirstAudioMs: Math.max(0, Math.round(firstAudioAt - replyStartedAt)),
      firstSentenceChars,
    };
  }
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

/** Keep the first spoken sentence in its own TTS fetch so audio can start sooner. */
export function peelFirstSentence(chunks: string[]): string[] {
  if (chunks.length === 0) return chunks;
  const { complete, rest } = splitSentences(chunks[0]);
  if (!complete.length) return chunks;
  const first = complete[0];
  const leftover = tidySpeechText([complete.slice(1).join(" "), rest, ...chunks.slice(1)].filter(Boolean).join(" "));
  return leftover ? [first, ...splitTtsFetches(leftover)] : [first];
}

function enqueueChunks(chunks: string[], opts: { language?: string; voiceId?: string } | undefined) {
  if (!chunks.length) return;
  speaking = true;
  const g = gen;
  const queue = firstSentenceChars ? chunks : peelFirstSentence(chunks);
  for (const chunk of queue) {
    if (!firstSentenceChars) firstSentenceChars = chunk.length;
    // Start the fetch immediately so it overlaps playback of the previous sentence
    // and the rest of the token stream.
    const prepared = fetchTtsChunk(chunk, opts, g).catch(() => null);
    playTail = playTail.then(async () => {
      if (g !== gen) return;
      speaking = true;
      const buf = await prepared;
      if (!buf || g !== gen) return;
      await playOneAudio(buf, "audio/mpeg", g);
    });
  }
}

/** Queue newly completed sentences from a cumulative stream. Dedupes by index. */
export function carinaEnqueueCumulative(
  cumulative: string,
  opts?: CarinaSpeakOpts
): number {
  if (!isCurrentTurn(opts?.turnId)) return 0;
  carinaBeginSpeechHold();
  const chunks = replyQueue.pushCumulative(cumulative, false);
  enqueueChunks(chunks, opts);
  return chunks.length;
}

/** Flush leftover text, wait for the queue, then release the mic hold. */
export async function carinaFinishReply(
  finalText?: string,
  opts?: CarinaSpeakOpts
): Promise<CarinaSpeakTimings> {
  if (!isCurrentTurn(opts?.turnId)) return lastTimings;
  carinaBeginSpeechHold();
  const g = gen;
  const chunks = replyQueue.pushCumulative(finalText || "", true);
  enqueueChunks(chunks, opts);
  await playTail;
  if (g === gen && isCurrentTurn(opts?.turnId)) speaking = false;
  return lastTimings;
}

/**
 * Play a complete reply (tours, one-shot, meta). Starts first-sentence TTS
 * immediately instead of waiting to concatenate the whole audio.
 */
export async function carinaPlaySpeech(
  text: string,
  opts?: CarinaSpeakOpts
): Promise<CarinaSpeakTimings> {
  const spoken = tidySpeechText(text);
  if (!spoken) return lastTimings;
  carinaStartReply(opts?.turnId);
  const chunks = splitTtsFetches(spoken);
  enqueueChunks(chunks, opts);
  // Mark the same sentences as already queued so a later finish is a no-op.
  replyQueue.pushCumulative(spoken, true);
  const g = gen;
  await playTail;
  if (g === gen) speaking = false;
  return lastTimings;
}

/** Open the TTS route / upstream TLS so the first real sentence is not a cold start. */
export function carinaWarmTts(): Promise<void> {
  if (typeof fetch !== "function") return Promise.resolve();
  if (warmupInFlight) return warmupInFlight;
  warmupInFlight = fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ warmup: true }),
    cache: "no-store",
  })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      warmupInFlight = null;
    });
  return warmupInFlight;
}
