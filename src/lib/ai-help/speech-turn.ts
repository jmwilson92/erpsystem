/**
 * Sentence-index queue for one spoken reply. Each sentence is emitted once,
 * even if the same cumulative text is enqueued and flushed again.
 */
import { splitSentences, tidySpeechText } from "@/lib/ai-help/speech-queue";

export function sentencesOf(text: string, flush = false): string[] {
  const { complete, rest } = splitSentences(tidySpeechText(text || ""));
  if (flush && rest) return [...complete, rest];
  return complete;
}

export function unspokenSentences(
  all: string[],
  alreadyCount: number,
  spokenKeys?: Set<string>
): { nextCount: number; fresh: string[] } {
  const fresh: string[] = [];
  const keys = spokenKeys ?? new Set<string>();
  for (let i = Math.max(0, alreadyCount); i < all.length; i++) {
    const key = all[i].toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || keys.has(key)) continue;
    keys.add(key);
    fresh.push(all[i]);
  }
  return { nextCount: all.length, fresh };
}

export function createReplyQueue() {
  let spokenCount = 0;
  const spokenKeys = new Set<string>();
  let last = "";

  return {
    reset() {
      spokenCount = 0;
      spokenKeys.clear();
      last = "";
    },
    spokenCount: () => spokenCount,
    pushCumulative(text: string, flush = false): string[] {
      if (text) last = text;
      const all = sentencesOf(last, flush);
      const { nextCount, fresh } = unspokenSentences(all, spokenCount, spokenKeys);
      spokenCount = nextCount;
      return fresh;
    },
  };
}
