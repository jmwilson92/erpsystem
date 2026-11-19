import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TYPICAL_HELP_REPLY_TTFA,
  timeToFirstAudioMs,
} from "../src/lib/ai-help/ttfa-policy";
import { peelFirstSentence as peelAudio } from "../src/lib/carina-audio";
import { shouldSkipHelpRetrieval } from "../src/lib/ai-help/answer";

const before = timeToFirstAudioMs({ mode: "whole-reply", ...TYPICAL_HELP_REPLY_TTFA });
const after = timeToFirstAudioMs({ mode: "first-sentence", ...TYPICAL_HELP_REPLY_TTFA });

assert.equal(before.timeToFirstAudioMs, 3000 + 1400);
assert.equal(after.timeToFirstAudioMs, 1200 + 550);
assert.ok(after.timeToFirstAudioMs < before.timeToFirstAudioMs);
const savedMs = before.timeToFirstAudioMs - after.timeToFirstAudioMs;
assert.equal(savedMs, 2650);

console.log("TTFA before (whole-reply):", before.timeToFirstAudioMs, "ms");
console.log("TTFA after (first-sentence):", after.timeToFirstAudioMs, "ms");
console.log("TTFA saved:", savedMs, "ms");

assert.deepEqual(peelAudio(["Hello there. How are you today? I can help."]), [
  "Hello there.",
  "How are you today? I can help.",
]);
assert.deepEqual(peelAudio(["Just one sentence."]), ["Just one sentence."]);

assert.equal(shouldSkipHelpRetrieval("How do I create a work order?", { voiceActions: true }), false);
assert.equal(shouldSkipHelpRetrieval("complete work order WO-123", { voiceActions: false }), false);
assert.equal(shouldSkipHelpRetrieval("complete work order WO-123", { voiceActions: true }), true);
assert.equal(shouldSkipHelpRetrieval("tie WO-123 to project PRJ-1", { voiceActions: true }), true);
assert.equal(shouldSkipHelpRetrieval("cycle count part PN-1 at BIN-A to 12", { voiceActions: true }), true);

const tts = fs.readFileSync("src/app/api/tts/route.ts", "utf8");
assert.match(tts, /warmup/);
assert.ok(
  tts.includes("if (body?.warmup === true)") || tts.includes("body?.warmup === true"),
  "warmup branch"
);
assert.match(tts, /async function warmUpstream/);
assert.match(tts, /api\.x\.ai\/v1\/models/);
const warmupBlock = tts.slice(tts.indexOf("if (body?.warmup"), tts.indexOf("let text"));
assert.ok(!warmupBlock.includes("reserveHelpTurn"), "warmup must not spend a help-turn quota");

const audio = fs.readFileSync("src/lib/carina-audio.ts", "utf8");
assert.match(audio, /carinaEnqueueCumulative/);
assert.match(audio, /carinaWarmTts/);
assert.match(audio, /peelFirstSentence/);
assert.match(audio, /fetchTtsChunk/);
assert.ok(!/speechSynthesis\.speak|window\.speechSynthesis/.test(audio));
assert.ok(!/synth\.pause\(\)/.test(audio));

const answer = fs.readFileSync("src/lib/ai-help/answer.ts", "utf8");
assert.match(answer, /const skipRetrieve=shouldSkipHelpRetrieval\(question,opts\);/);
assert.match(answer, /const entries=skipRetrieve\?\[\]:retrieveHelp/);

const ai = fs.readFileSync("src/lib/services/ai.ts", "utf8");
assert.match(ai, /if \(acted\.text\) opts\?\.onDelta\?\.\(acted\.text\)/);

const voice = fs.readFileSync("src/components/ai/voice-assistant.tsx", "utf8");
assert.match(voice, /void carinaWarmTts\(\)/);
assert.match(voice, /carinaEnqueueCumulative\(preview/);
assert.match(voice, /carinaStartReply/);

console.log("PASS Carina TTFA: first-sentence TTS, action skip-retrieve, warmup");
