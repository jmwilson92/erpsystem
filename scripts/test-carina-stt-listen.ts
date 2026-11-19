import assert from "node:assert/strict";
import fs from "node:fs";
import { createEnergyVad, rmsFromFloat32 } from "../src/lib/ai-help/mic-vad";
import { downsampleTo16k, encodeWav, durationMsOfPcm } from "../src/lib/ai-help/pcm-wav";
import { includesWake, stripWake } from "../src/lib/ai-help/voice-wake";
import { STT_CLIENT_MODEL, STT_CLIENT_PROVIDER } from "../src/lib/carina-stt";

assert.equal(STT_CLIENT_PROVIDER, "xai");
assert.equal(STT_CLIENT_MODEL, "grok-voice-transcribe-2.0");

// Wake: fuzzy, including catarina
assert.equal(includesWake("hey Carina how many work orders", "Carina"), true);
assert.equal(includesWake("Catarina can you hear me", "Carina"), true);
assert.equal(includesWake("karina list the in work ones", "Carina"), true);
assert.equal(includesWake("how many work orders do I have", "Carina"), false);
assert.match(stripWake("Carina how many work orders do I have", "Carina"), /how many work orders/i);

// Energy VAD: silence → speech → silence yields start then end
const vad = createEnergyVad({ startMs: 100, endMs: 300, minMs: 200, maxMs: 5000 });
const silent = 0.001;
const loud = 0.05;
assert.equal(rmsFromFloat32(new Float32Array([0.1, -0.1, 0.1, -0.1])) > 0.09, true);
assert.equal(vad.pushRms(silent, 50), null);
assert.equal(vad.pushRms(loud, 50), null);
assert.equal(vad.pushRms(loud, 60), "start");
assert.equal(vad.inSpeech(), true);
assert.equal(vad.pushRms(loud, 200), null);
assert.equal(vad.pushRms(silent, 200), null);
assert.equal(vad.pushRms(silent, 200), "end");
assert.equal(vad.inSpeech(), false);

// WAV encode + downsample
const tone = new Float32Array(16000);
for (let i = 0; i < tone.length; i++) tone[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.25;
const pcm = downsampleTo16k(tone, 16000);
assert.equal(pcm.length, 16000);
assert.equal(durationMsOfPcm(pcm), 1000);
const wav = encodeWav(pcm);
assert.ok(wav.size > 44);
assert.equal(wav.type, "audio/wav");

const route = fs.readFileSync("src/app/api/stt/route.ts", "utf8");
assert.match(route, /https:\/\/api\.x\.ai\/v1\/stt/);
assert.match(route, /grok-voice-transcribe-2\.0/);
assert.match(route, /warmup/);
const warmup = route.slice(route.indexOf("if (body?.warmup === true)"), route.indexOf("Expected an audio"));
assert.ok(warmup.includes("warmUpstream"), "warmup branch");
assert.ok(!warmup.includes("reserveHelpTurn"), "warmup must not spend a help-turn quota");

const listen = fs.readFileSync("src/lib/carina-listen.ts", "utf8");
assert.match(listen, /createEnergyVad/);
assert.ok(!/SpeechRecognition|webkitSpeechRecognition/.test(listen));

const voice = fs.readFileSync("src/components/ai/voice-assistant.tsx", "utf8");
assert.ok(!/getSpeechRecognition|webkitSpeechRecognition|new Ctor\(/.test(voice), "browser Web Speech must be gone");
assert.match(voice, /startMicListen/);
assert.match(voice, /transcribeUtterance/);
assert.match(voice, /carinaWarmStt/);
assert.match(voice, /Copy logs/);
assert.match(voice, /vadEnd→stt/);
assert.match(voice, /data-voice-debug/);
assert.match(voice, /flush\("ptt"\)/);
assert.match(voice, /MIC_AUDIO_CONSTRAINTS/);

const overlay = voice.slice(voice.indexOf("data-voice-debug"));
assert.match(overlay, /text-\[13px\]/);
assert.match(overlay, /resize/);
assert.match(overlay, /micPct/);

console.log("PASS Carina server STT listen: xAI grok-voice-transcribe-2.0, energy VAD, no Web Speech");
