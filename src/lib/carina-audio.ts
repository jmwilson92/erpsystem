/**
 * Single global audio channel for Carina + guided tours.
 * Streamed text is buffered into whole sentences and queued without
 * cancelling in-flight speech. Recognition must stay paused for the
 * whole hold (including TTS fetch), then resume after the last onend.
 */
import {
  EDGE_SPEECH_KEEPALIVE_MS,
  SPEECH_PITCH,
  SPEECH_RATE,
  SPEECH_VOLUME,
  chunkSpeechText,
  createSpeechBuffer,
  tidySpeechText,
} from "@/lib/ai-help/speech-queue";

let gen = 0;
let currentAudio: HTMLAudioElement | null = null;
let speaking = false;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let pinnedVoiceName: string | null = null;
const buffer = createSpeechBuffer();
let playTail: Promise<void> = Promise.resolve();

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

function clearKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function startKeepAlive() {
  clearKeepAlive();
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  keepAliveTimer = setInterval(() => {
    try {
      const synth = window.speechSynthesis;
      if (!synth.speaking) return;
      // Edge drops online voices around 15s unless we nudge the pump.
      synth.pause();
      synth.resume();
    } catch {
      // ignore
    }
  }, EDGE_SPEECH_KEEPALIVE_MS);
}

export function carinaStopAllAudio(): void {
  gen += 1;
  speaking = false;
  clearKeepAlive();
  buffer.reset();
  try {
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
  } catch {
    // ignore
  }
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
  playTail = Promise.resolve();
}

/** Hold the mic as soon as a reply will be spoken, including TTS fetch. */
export function carinaBeginSpeechHold(): void {
  speaking = true;
}

async function voicesReady(): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  if (window.speechSynthesis.getVoices().length) return;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    const t = window.setTimeout(done, 600);
    window.speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        window.clearTimeout(t);
        done();
      },
      { once: true }
    );
  });
}

function pinnedVoice(lang?: string): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !window.speechSynthesis) return undefined;
  const voices = window.speechSynthesis.getVoices();
  if (pinnedVoiceName) {
    const pinned = voices.find((v) => v.name === pinnedVoiceName);
    if (pinned) return pinned;
  }
  const langBase = (lang || "en").toLowerCase().slice(0, 2);
  const inLang = voices.filter((v) => (v.lang || "").toLowerCase().startsWith(langBase));
  const pool = inLang.length ? inLang : voices;
  const preferred =
    pool.find((v) =>
      /aria|jenny|sonia|sara|zira|natasha|google us english|microsoft (aria|jenny|sonia)/i.test(
        v.name
      )
    ) ||
    pool.find((v) => v.localService) ||
    pool[0];
  if (preferred) pinnedVoiceName = preferred.name;
  return preferred;
}

function applyPinnedVoice(u: SpeechSynthesisUtterance, lang?: string) {
  u.volume = SPEECH_VOLUME;
  u.rate = SPEECH_RATE;
  u.pitch = SPEECH_PITCH;
  u.lang = lang || "en-US";
  const voice = pinnedVoice(u.lang);
  if (voice) u.voice = voice;
}

type PreparedChunk =
  | { kind: "audio"; buf: ArrayBuffer; type: string }
  | { kind: "synth"; text: string }
  | { kind: "skip" };

/** Prefetch TTS so the next sentence is ready before the current one ends. */
async function prepareChunk(
  text: string,
  opts: { language?: string; voiceId?: string } | undefined,
  g: number
): Promise<PreparedChunk> {
  const spoken = tidySpeechText(text);
  if (!spoken || g !== gen) return { kind: "skip" };

  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: spoken.slice(0, 1800),
        voiceId: opts?.voiceId || "carina",
        language: opts?.language || "en",
      }),
    });
    if (g !== gen) return { kind: "skip" };
    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (g !== gen) return { kind: "skip" };
      if (buf.byteLength > 32) {
        return {
          kind: "audio",
          buf,
          type: res.headers.get("Content-Type") || "audio/mpeg",
        };
      }
    }
  } catch {
    // fallback below
  }

  if (g !== gen) return { kind: "skip" };
  return { kind: "synth", text: spoken };
}

async function playPrepared(
  prepared: PreparedChunk,
  opts: { language?: string; voiceId?: string } | undefined,
  g: number
): Promise<void> {
  if (g !== gen || prepared.kind === "skip") return;

  if (prepared.kind === "audio") {
    const url = URL.createObjectURL(new Blob([prepared.buf], { type: prepared.type }));
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
    return;
  }

  if (typeof window === "undefined" || !window.speechSynthesis) return;
  await voicesReady();
  if (g !== gen) return;
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(prepared.text);
    applyPinnedVoice(u, opts?.language);
    u.onend = () => resolve();
    u.onerror = () => resolve();
    startKeepAlive();
    window.speechSynthesis.speak(u);
  });
}

function enqueueChunks(
  chunks: string[],
  opts: { language?: string; voiceId?: string } | undefined
) {
  if (!chunks.length) return;
  speaking = true;
  const g = gen;
  for (const chunk of chunks) {
    // Start the TTS fetch immediately so it overlaps the previous utterance.
    const prepared = prepareChunk(chunk, opts, g);
    playTail = playTail.then(async () => {
      if (g !== gen) return;
      speaking = true;
      await playPrepared(await prepared, opts, g);
    });
  }
}

/** Start a new spoken reply. Cancels only a previous reply, not later sentence chunks. */
export function carinaStartReply(): void {
  carinaStopAllAudio();
  carinaBeginSpeechHold();
}

/** Queue newly completed sentences from a cumulative stream. Never cancels. */
export function carinaEnqueueCumulative(
  cumulative: string,
  opts?: { language?: string; voiceId?: string }
): number {
  carinaBeginSpeechHold();
  const chunks = buffer.ingest(cumulative);
  enqueueChunks(chunks, opts);
  return chunks.length;
}

/** Flush leftover text, wait for the queue to finish, then release the mic hold. */
export async function carinaFinishReply(
  finalText?: string,
  opts?: { language?: string; voiceId?: string }
): Promise<void> {
  carinaBeginSpeechHold();
  const g = gen;
  const chunks = buffer.flush(finalText);
  enqueueChunks(chunks, opts);
  await playTail;
  clearKeepAlive();
  if (g === gen) speaking = false;
}

/**
 * Play a complete reply (tours, one-shot speak). Interrupts a prior reply,
 * then queues sentence chunks without cancelling between them.
 */
export async function carinaPlaySpeech(
  text: string,
  opts?: { language?: string; voiceId?: string }
): Promise<void> {
  const spoken = tidySpeechText(text);
  if (!spoken) return;
  carinaStartReply();
  // Prefer the already-chunked full text over stream ingest of the same string.
  const chunks = chunkSpeechText(spoken);
  enqueueChunks(chunks, opts);
  // Mark the buffer as already queued so a later finish of the same text is a no-op.
  buffer.flush(spoken);
  const g = gen;
  await playTail;
  clearKeepAlive();
  if (g === gen) speaking = false;
}
