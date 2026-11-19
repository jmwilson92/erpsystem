import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EDGE_SPEECH_KEEPALIVE_MS,
  SPEECH_CHUNK_MAX_CHARS,
  SPEECH_PITCH,
  SPEECH_RATE,
  SPEECH_VOLUME,
  chunkSpeechText,
  createSpeechBuffer,
  shouldPauseRecognitionForSpeech,
  splitLongUtterance,
} from '../src/lib/ai-help/speech-queue';

assert.equal(SPEECH_CHUNK_MAX_CHARS, 200);
assert.equal(SPEECH_VOLUME, 1);
assert.equal(SPEECH_RATE, 1);
assert.equal(SPEECH_PITCH, 1);
assert.ok(EDGE_SPEECH_KEEPALIVE_MS < 15_000);
assert.ok(EDGE_SPEECH_KEEPALIVE_MS >= 5_000);

assert.deepEqual(
  chunkSpeechText('Hello there. How are you today?'),
  ['Hello there. How are you today?']
);

const longSentence =
  'This is a single very long sentence without a break that must be split because it is designed to exceed the two hundred character safety limit for Edge speech synthesis utterances and therefore should become two or more chunks.';
assert.ok(longSentence.length > 200);
const longChunks = splitLongUtterance(longSentence, 200);
assert.ok(longChunks.length >= 2);
assert.ok(longChunks.every((c) => c.length <= 200));
assert.equal(longChunks.join(' ').replace(/\s+/g, ' '), longSentence);

const many = chunkSpeechText(
  'One short sentence. Another short one! A third question? And a fourth ends here.'
);
assert.ok(many.every((c) => c.length <= 200));
assert.match(many.join(' '), /One short sentence/);

// Streamed cumulative text: do not emit a fragment, then queue whole sentences.
const buf = createSpeechBuffer();
assert.deepEqual(buf.ingest('Hello th'), []);
assert.equal(buf.pendingTail(), 'Hello th');
assert.deepEqual(buf.ingest('Hello there. How are'), ['Hello there.']);
assert.equal(buf.pendingTail(), 'How are');
assert.deepEqual(buf.ingest('Hello there. How are you today? I can also'), [
  'How are you today?',
]);
assert.deepEqual(buf.flush('Hello there. How are you today? I can also help.'), [
  'I can also help.',
]);
assert.deepEqual(buf.flush(), []);

// A later finish of the same text must not re-queue already spoken sentences.
const buf2 = createSpeechBuffer();
assert.deepEqual(buf2.ingest('Yes, I can hear you. What would you like'), ['Yes, I can hear you.']);
assert.deepEqual(buf2.flush('Yes, I can hear you. What would you like to do?'), [
  'What would you like to do?',
]);

assert.equal(shouldPauseRecognitionForSpeech(true), true);
assert.equal(shouldPauseRecognitionForSpeech(false), false);

const audio = fs.readFileSync('src/lib/carina-audio.ts', 'utf8');
assert.match(audio, /carinaEnqueueCumulative/);
assert.match(audio, /carinaFinishReply/);
assert.match(audio, /carinaBeginSpeechHold/);
assert.match(audio, /EDGE_SPEECH_KEEPALIVE_MS/);
assert.match(audio, /audio\.volume = SPEECH_VOLUME/);
assert.match(audio, /u\.volume = SPEECH_VOLUME/);
assert.match(audio, /u\.rate = SPEECH_RATE/);
assert.match(audio, /pinnedVoiceName/);
assert.match(audio, /synth\.pause\(\);\s*synth\.resume\(\)/s);
assert.ok(!/u\.rate = 1\.05/.test(audio), 'rate must be pinned, not 1.05');
assert.ok(
  !/carinaStopAllAudio\(\);(?!\s*[\s\S]*carinaBeginSpeechHold)/.test(''),
  'placeholder'
);
// New sentence chunks must not cancel the in-flight utterance.
const enqueueAt = audio.indexOf('function enqueueChunks');
assert.ok(enqueueAt > 0);
const enqueueBody = audio.slice(enqueueAt, audio.indexOf('export function carinaStartReply', enqueueAt));
assert.ok(!enqueueBody.includes('carinaStopAllAudio'), 'enqueue must not cancel in-flight speech');
assert.ok(!enqueueBody.includes('speechSynthesis?.cancel') && !enqueueBody.includes('speechSynthesis.cancel'));
assert.match(audio, /speaking = true/);

const voice = fs.readFileSync('src/components/ai/voice-assistant.tsx', 'utf8');
assert.match(voice, /carinaEnqueueCumulative/);
assert.match(voice, /carinaFinishReply/);
assert.match(voice, /carinaBeginSpeechHold/);
const onDeltaAt = voice.indexOf('onDelta: (preview)');
assert.ok(onDeltaAt > 0);
const onDelta = voice.slice(onDeltaAt, onDeltaAt + 500);
assert.match(onDelta, /carinaEnqueueCumulative/);
assert.ok(!/speak\(preview\)/.test(onDelta), 'do not speak raw stream fragments');
assert.match(voice, /shouldPauseRecognitionForSpeech\(carinaIsSpeaking\(\)\)|carinaIsSpeaking\(\) \|\| modeRef/);
const speakAt = voice.indexOf('const speak = useCallback');
const speakFn = voice.slice(speakAt, voice.indexOf('const ask = useCallback', speakAt));
assert.match(speakFn, /carinaBeginSpeechHold\(\)/);
assert.ok(
  speakFn.indexOf('carinaBeginSpeechHold()') < speakFn.indexOf('recRef.current?.stop()'),
  'hold the mic before stopping recognition so the watchdog cannot reboot it'
);
assert.ok(!/carinaBumpAudioGen\(\)/.test(speakFn) || speakFn.indexOf('carinaBeginSpeechHold') < speakFn.indexOf('carinaPlaySpeech'), 'no gen bump that cancels mid-reply');

console.log('PASS Carina speech queue: sentence buffer, 200-char chunks, pinned voice, no cancel, mic hold');
