/**
 * Sentence-buffered TTS queue policy.
 * Streamed text is held until a sentence boundary, then split into
 * ~200-character utterances so Edge's ~15s online-voice cutoff does not
 * clip a long reply. The queue never cancels in-flight speech unless
 * the caller explicitly stops.
 */

export const SPEECH_CHUNK_MAX_CHARS = 200;
export const SPEECH_VOLUME = 1;
export const SPEECH_RATE = 1;
export const SPEECH_PITCH = 1;
/** Pause/resume the synthesizer just under Edge's ~15s cutoff. */
export const EDGE_SPEECH_KEEPALIVE_MS = 10_000;

export function tidySpeechText(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/`+/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\|/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitLongUtterance(text: string, max = SPEECH_CHUNK_MAX_CHARS): string[] {
  const src = tidySpeechText(text);
  if (!src) return [];
  if (src.length <= max) return [src];
  const out: string[] = [];
  let rest = src;
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    const cut =
      Math.max(slice.lastIndexOf("; "), slice.lastIndexOf(", "), slice.lastIndexOf(" ")) ||
      max;
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function splitSentences(text: string): { complete: string[]; rest: string } {
  const src = tidySpeechText(text);
  if (!src) return { complete: [], rest: "" };
  const complete: string[] = [];
  const re = /[^.!?…]+(?:[.!?…]+["”']?|(?=$))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const piece = m[0].trim();
    last = m.index + m[0].length;
    if (!piece) continue;
    if (/[.!?…]["”']?$/.test(piece)) complete.push(piece);
    else {
      return { complete, rest: piece };
    }
  }
  const tail = src.slice(last).trim();
  return { complete, rest: tail };
}

export function packChunks(parts: string[], max = SPEECH_CHUNK_MAX_CHARS): string[] {
  const out: string[] = [];
  let buf = "";
  const pushBuf = () => {
    if (buf) out.push(buf);
    buf = "";
  };
  for (const part of parts) {
    const pieces = splitLongUtterance(part, max);
    for (const piece of pieces) {
      if (!buf) {
        buf = piece;
        continue;
      }
      if ((buf + " " + piece).length <= max) {
        buf = buf + " " + piece;
      } else {
        pushBuf();
        buf = piece;
      }
    }
  }
  pushBuf();
  return out;
}

export function chunkSpeechText(text: string, max = SPEECH_CHUNK_MAX_CHARS): string[] {
  const src = tidySpeechText(text);
  if (!src) return [];
  const { complete, rest } = splitSentences(src);
  const parts = rest ? [...complete, rest] : complete;
  return packChunks(parts.length ? parts : [src], max);
}

export function createSpeechBuffer(max = SPEECH_CHUNK_MAX_CHARS) {
  let queued = "";
  let tail = "";

  function ingest(cumulative: string): string[] {
    const text = tidySpeechText(cumulative);
    if (!text) return [];
    let remainder = text;
    if (queued) {
      if (text.startsWith(queued)) remainder = text.slice(queued.length);
      else if (queued.startsWith(text)) return [];
    }
    const { complete, rest } = splitSentences(remainder);
    tail = rest;
    const chunks = packChunks(complete, max);
    if (chunks.length) queued = tidySpeechText([queued, ...chunks].filter(Boolean).join(" "));
    return chunks;
  }

  function flush(finalText?: string): string[] {
    const extra = finalText != null ? ingest(finalText) : [];
    const last = tidySpeechText(tail);
    tail = "";
    if (!last) return extra;
    const chunks = packChunks([last], max);
    queued = tidySpeechText([queued, last].filter(Boolean).join(" "));
    return [...extra, ...chunks];
  }

  function reset() {
    queued = "";
    tail = "";
  }

  return {
    ingest,
    flush,
    reset,
    queuedText: () => queued,
    pendingTail: () => tail,
  };
}

/** Watchdog / restart policy: never boot the recognizer while TTS is held. */
export function shouldPauseRecognitionForSpeech(ttsHold: boolean): boolean {
  return !!ttsHold;
}
