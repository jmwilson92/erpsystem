import assert from "node:assert/strict";
import fs from "node:fs";
import { tidySpeechText } from "../src/lib/ai-help/speech-queue";
import { SPEECH_VOLUME, TTS_FETCH_MAX_CHARS, splitTtsFetches } from "../src/lib/carina-audio";
import { shouldShowVoiceDebug, MIC_AUDIO_CONSTRAINTS } from "../src/lib/ai-help/voice-debug";
import {
  looksLikeRecordChange,
  helpSafetyReply,
  helpSystem,
} from "../src/lib/ai-help/answer";
import { unparsedActionReply, UNPARSED_ACTION_REPLY } from "../src/lib/services/carina-voice-actions";

assert.equal(SPEECH_VOLUME, 1);
assert.equal(TTS_FETCH_MAX_CHARS, 1800);
assert.equal(MIC_AUDIO_CONSTRAINTS.echoCancellation, true);
assert.equal(MIC_AUDIO_CONSTRAINTS.noiseSuppression, true);
assert.equal(MIC_AUDIO_CONSTRAINTS.autoGainControl, true);

assert.equal(shouldShowVoiceDebug(""), false);
assert.equal(shouldShowVoiceDebug("?foo=1"), false);
assert.equal(shouldShowVoiceDebug("?voiceDebug=1"), true);
assert.equal(shouldShowVoiceDebug("voiceDebug=1&x=2"), true);
assert.equal(shouldShowVoiceDebug("?voiceDebug=0"), false);

assert.deepEqual(splitTtsFetches("Hello there. How are you today?"), [
  "Hello there. How are you today?",
]);
const long = `${"This is a long sentence for the plant assistant to speak. ".repeat(40)}End.`;
assert.ok(long.length > 1800);
const parts = splitTtsFetches(long);
assert.ok(parts.length >= 2);
assert.ok(parts.every((c) => c.length <= 1800));
assert.match(tidySpeechText(parts.join(" ")), /End/);

assert.ok(looksLikeRecordChange("Create a work order for Atlas"));
assert.equal(looksLikeRecordChange("How do I create a work order?"), false);
assert.equal(helpSafetyReply("Create a work order for Atlas", { voiceActions: true }), null);
assert.match(helpSafetyReply("Create a work order for Atlas") || "", /read-only help/i);
assert.equal(unparsedActionReply("How many open work orders do I have?"), null);
assert.equal(unparsedActionReply("Create a work order for Atlas"), UNPARSED_ACTION_REPLY);
assert.match(unparsedActionReply("create a payroll run") || "", /payroll|salary|wage/i);
assert.match(helpSystem([], "/", "English", { voiceActions: true }), /confirm-gated/i);

const audio = fs.readFileSync("src/lib/carina-audio.ts", "utf8");
assert.match(audio, /speechSynthesis/);
assert.ok(!/speechSynthesis\.speak|window\.speechSynthesis/.test(audio), "no browser TTS fallback");
assert.ok(!/pause\(\);\s*\n\s*synth\.resume/.test(audio) && !/synth\.pause\(\)/.test(audio), "no pause/resume keep-alive");
assert.match(audio, /new Audio/);
assert.match(audio, /audio\.volume = SPEECH_VOLUME/);
assert.match(audio, /concatBuffers|playOneAudio/);

const voice = fs.readFileSync("src/components/ai/voice-assistant.tsx", "utf8");
assert.match(voice, /startPttRecognition/);
assert.match(voice, /stopPttRecognition/);
assert.match(voice, /pttRecRef/);
assert.match(voice, /streamRef/);
assert.match(voice, /MIC_AUDIO_CONSTRAINTS/);
assert.ok(!/getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/.test(voice.split("startListening")[1].slice(0, 2000)));
const speakFn = voice.slice(voice.indexOf("const speak = useCallback"), voice.indexOf("const ask = useCallback"));
assert.ok(!speakFn.includes("recRef.current?.stop()"), "speak() must not stop the recognizer / mic");
assert.match(voice, /carinaIsSpeaking\(\) && !pttRef/);
assert.match(voice, /shouldShowVoiceDebug/);
assert.match(voice, /data-voice-debug/);
assert.match(voice, /onDelta:/);
assert.match(voice, /carinaEnqueueCumulative/);
assert.match(voice, /carinaFinishReply/);
assert.match(voice, /carinaWarmTts/);
assert.match(voice, /carinaStartReply/);
const enqueueAt = voice.indexOf("carinaEnqueueCumulative(preview");
assert.ok(enqueueAt > 0);
const afterEnqueue = voice.slice(enqueueAt, enqueueAt + 3500);
assert.match(afterEnqueue, /carinaFinishReply\(result\.text/);
assert.ok(!/else \{\s*await speak\(result\.text\);\s*\}/.test(afterEnqueue), "must not cancel streamed TTS with a full-reply speak()");


console.log("PASS Carina voice rework: one server TTS element, persistent mic, separate PTT, action toggle safety");
