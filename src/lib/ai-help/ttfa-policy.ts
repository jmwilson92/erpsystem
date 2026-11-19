/**
 * Time-to-first-audio policy for Carina spoken replies.
 *
 * whole-reply: wait until the full answer is ready, then TTS the entire text
 *   before any audio starts. This is what #179 shipped (one element, no chop).
 * first-sentence: start TTS as soon as the first sentence arrives, and play it
 *   as soon as that fetch returns. Later sentences prefetch while it plays.
 */

export type TtfaMode = "whole-reply" | "first-sentence";

export type TtfaInput = {
  mode: TtfaMode;
  /** When each sentence's text is available, in ms from the user turn start. */
  sentenceAvailableAtMs: number[];
  /** Server TTS fetch time for each sentence (first-sentence mode). */
  sentenceTtsMs: number[];
  /** Single TTS fetch of the concatenated reply (whole-reply mode). */
  wholeReplyTtsMs: number;
};

export type TtfaResult = {
  mode: TtfaMode;
  timeToFirstAudioMs: number;
};

export function timeToFirstAudioMs(input: TtfaInput): TtfaResult {
  const available = input.sentenceAvailableAtMs;
  if (!available.length) return { mode: input.mode, timeToFirstAudioMs: 0 };
  if (input.mode === "whole-reply") {
    return {
      mode: input.mode,
      timeToFirstAudioMs: Math.max(...available) + input.wholeReplyTtsMs,
    };
  }
  return {
    mode: input.mode,
    timeToFirstAudioMs: available[0] + (input.sentenceTtsMs[0] || 0),
  };
}

/**
 * Representative three-sentence help reply, used to report before/after.
 * Times are milliseconds from the start of the assistant turn (after the
 * question is committed): first sentence often arrives near model TTFT,
 * the rest stream in, and xAI TTS of a short sentence is faster than the
 * full reply.
 */
export const TYPICAL_HELP_REPLY_TTFA = {
  sentenceAvailableAtMs: [1200, 2100, 3000],
  sentenceTtsMs: [550, 700, 500],
  wholeReplyTtsMs: 1400,
} as const;
