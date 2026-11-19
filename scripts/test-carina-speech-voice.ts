import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeSpeechText, expandSpokenAbbreviations } from "../src/lib/ai-help/speech-normalize";
import { createReplyQueue, sentencesOf } from "../src/lib/ai-help/speech-turn";
import { createBargeDetector, BARGE_MIN_MS, bargeThreshold } from "../src/lib/ai-help/barge-in";
import { helpSystem, HELP_MAX_TOKENS, HELP_VOICE_MAX_TOKENS, VOICE_REPLY_POLICY } from "../src/lib/ai-help/answer";

// --- Speech normalizer ---
assert.equal(expandSpokenAbbreviations("See e.g. the board"), "See for example the board");
assert.match(normalizeSpeechText("Status is **IN_WORK** (see WO-00008)."), /in work/);
assert.match(normalizeSpeechText("Check WO-00008 and PR-00012."), /work order 8/);
assert.match(normalizeSpeechText("Check WO-00008 and PR-00012."), /purchase request 12/);
assert.ok(!/WO-0|PR-0|_/.test(normalizeSpeechText("Check WO-00008 and PR-00012.")));
assert.match(normalizeSpeechText("Use filters, e.g. status, i.e. open, etc."), /for example/);
assert.match(normalizeSpeechText("Use filters, e.g. status, i.e. open, etc."), /that is/);
assert.match(normalizeSpeechText("Use filters, e.g. status, i.e. open, etc."), /et cetera/);
assert.equal(normalizeSpeechText("[Work orders](/work-orders) are ready."), "Work orders are ready.");
assert.ok(!/_/.test(normalizeSpeechText("the `item_status` field")));
assert.match(normalizeSpeechText("the `item_status` field"), /item status/);
assert.ok(!normalizeSpeechText("# Heading\n- bullet one").includes("#"));
assert.ok(!/\bunderscore\b|\bdash\b/.test(normalizeSpeechText("IN_WORK — WO-00008").toLowerCase()));

const messy =
  "There are **12** work orders IN_WORK (see WO-00008 / WO-00009), e.g. the ones you opened. _Note_ more caveats.";
const spoken = normalizeSpeechText(messy);
assert.match(spoken, /work order 8/);
assert.match(spoken, /in work/);
assert.match(spoken, /for example/);
assert.ok(!/_|\*|\/|\(/.test(spoken));

// Idempotent
assert.equal(normalizeSpeechText(spoken), spoken);

// --- Sentence index dedupe (no first-sentence + full-reply double speak) ---
const a = "Hello there. There are 12 work orders in work. Want details?";
const q = createReplyQueue();
assert.deepEqual(q.pushCumulative("Hello there."), ["Hello there."]);
assert.deepEqual(q.pushCumulative("Hello there. There are 12 work orders in work."), [
  "There are 12 work orders in work.",
]);
assert.deepEqual(q.pushCumulative(a, true), ["Want details?"]);
assert.deepEqual(q.pushCumulative(a, true), [], "flush of the same text must not replay any sentence");
assert.equal(q.spokenCount(), sentencesOf(a, true).length);

const packed = createReplyQueue();
assert.deepEqual(
  packed.pushCumulative("Hello there. How are you today?"),
  ["Hello there.", "How are you today?"]
);
assert.deepEqual(packed.pushCumulative("Hello there. How are you today?", true), []);

const stale = createReplyQueue();
stale.pushCumulative("First sentence only.");
stale.reset();
assert.deepEqual(stale.pushCumulative("First sentence only."), ["First sentence only."]);

// --- Barge-in: echo stays quiet; sustained louder energy fires once after ~250ms ---
const det = createBargeDetector();
const echo = 0.02;
for (let i = 0; i < 20; i++) {
  assert.equal(det.pushRms(echo, 20), null, "echo-level energy must not barge in");
}
assert.ok(det.threshold() > echo);
const spike = det.threshold() + 0.02;
assert.equal(det.pushRms(spike, 80), null, "brief spike is not enough");
assert.equal(det.pushRms(echo, 20), null);
assert.equal(det.pushRms(spike, 120), null);
assert.equal(det.pushRms(spike, 130), "barge");
assert.equal(det.pushRms(spike, 200), null, "already triggered");
assert.ok(BARGE_MIN_MS === 250);
assert.ok(bargeThreshold(0.01) >= 0.03);

// --- Voice prompt + token cap ---
assert.equal(HELP_MAX_TOKENS, 400);
assert.equal(HELP_VOICE_MAX_TOKENS, 180);
assert.ok(HELP_VOICE_MAX_TOKENS < HELP_MAX_TOKENS);
const typed = helpSystem([], "/", "English");
assert.match(typed, /up to 5 sentences/);
assert.ok(!typed.includes("VOICE MODE"));
const voiceSys = helpSystem([], "/", "English", { voice: true, voiceActions: true });
assert.match(voiceSys, /VOICE MODE/);
assert.match(voiceSys, /plain spoken/);
assert.match(voiceSys, /1-2 short sentences/);
assert.match(voiceSys, /Want details\?/);
assert.ok(!/up to 5 sentences/.test(voiceSys));
assert.match(VOICE_REPLY_POLICY, /plain spoken text/);

const sampleVerbose =
  "There are 12 work orders in work, including several that have been waiting since last week. You could also filter by site if you want more context. I should mention a few caveats about status codes as well.";
const sentences = sampleVerbose.split(/(?<=[.!?])\s+/);
assert.ok(sentences.length > 2, "fixture is a verbose reply the voice prompt should reject");
assert.ok(voiceSys.includes("Do not add extra context, caveats, or suggestions"));

// Wiring: TTS route + audio fetch + barge/interrupt
const tts = fs.readFileSync("src/app/api/tts/route.ts", "utf8");
assert.match(tts, /normalizeSpeechText/);
const audio = fs.readFileSync("src/lib/carina-audio.ts", "utf8");
assert.match(audio, /normalizeSpeechText/);
assert.match(audio, /createReplyQueue/);
assert.match(audio, /isCurrentTurn/);
assert.match(audio, /pushCumulative/);
const listen = fs.readFileSync("src/lib/carina-listen.ts", "utf8");
assert.match(listen, /createBargeDetector/);
assert.match(listen, /onBargeIn/);
assert.ok(!/Hold capture while she talks/.test(listen));
const voice = fs.readFileSync("src/components/ai/voice-assistant.tsx", "utf8");
assert.match(voice, /interruptTurn\("barge"\)/);
assert.match(voice, /interruptTurn\("ptt"\)/);
assert.match(voice, /turnId: myTurn/);
assert.match(voice, /voice: true/);
assert.match(voice, /signal: ac\.signal/);
assert.match(voice, /result\.aborted/);
const route = fs.readFileSync("src/app/api/ai/conversation/route.ts", "utf8");
assert.match(route, /voice: !!body\.voice/);
const client = fs.readFileSync("src/lib/ai-help/conversation-client.ts", "utf8");
assert.match(client, /signal: opts\.signal/);
assert.match(client, /voice: opts\.voice/);

console.log("PASS Carina speech voice: normalizer, no-duplicate sentence queue, barge-in, short voice prompt");
