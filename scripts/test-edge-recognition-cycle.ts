import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyRecognitionError,
  collectRecognitionTranscripts,
  commitPttTranscript,
  commitSessionTranscript,
  isBenignRecognitionEnd,
  planRecognitionEnd,
  recognitionRestartDelay,
  shouldAbortRecognizer,
  shouldShowReconnecting,
  shouldWatchdogReboot,
  simulateEdgeSessionCycle,
} from '../src/lib/ai-help/recognition-cycle';

// Edge one-shot: interim "Carina" then no-speech then onend.
// Must keep listening, commit the wake word, not abort, not back off.
const wake = simulateEdgeSessionCycle({
  events: [
    { type: 'start' },
    { type: 'interim', text: 'Carina' },
    { type: 'error', error: 'no-speech' },
    { type: 'end' },
  ],
});
assert.deepEqual(
  wake.ui.filter((s, i, a) => s !== a[i - 1]),
  ['listening'],
  'Edge no-speech/onend must not flash reconnecting'
);
assert.equal(wake.finalText, 'Carina');
assert.equal(wake.abortedRestarts, 0);
assert.equal(wake.networkFails, 0);
assert.ok(wake.started >= 2, 'planned restart should start a new session');
const endPlan = wake.plans.find((p) => p.processWakeBeforeRestart);
assert.ok(endPlan, 'wake-word match must run before the restart');
assert.equal(endPlan!.committedFinal, 'Carina');
assert.equal(endPlan!.keepRecAlive, true);
assert.equal(endPlan!.showReconnecting, false);
assert.equal(endPlan!.restartDelayMs, 100);
assert.equal(endPlan!.abortBeforeRestart, false);

// ANY speech — not just the wake word — then an immediate one-shot onend.
// This is what the live Edge repro does; silence stays on listening.
const anySpeech = simulateEdgeSessionCycle({
  events: [
    { type: 'start' },
    { type: 'interim', text: 'hello there' },
    { type: 'end' },
  ],
});
assert.ok(anySpeech.ui.every((s) => s === 'listening'), 'any speech must not flash reconnecting');
assert.equal(anySpeech.finalText, 'hello there');
assert.equal(anySpeech.abortedRestarts, 0);
assert.equal(anySpeech.plans.at(-1)?.keepRecAlive, true);
assert.equal(anySpeech.plans.at(-1)?.showReconnecting, false);

// Edge-like / malformed result lists must not throw (a throw in onresult
// ends the session and looks like reconnecting on the first syllable).
assert.deepEqual(collectRecognitionTranscripts(undefined), { finalText: '', interimText: '' });
assert.deepEqual(collectRecognitionTranscripts({}), { finalText: '', interimText: '' });
assert.deepEqual(collectRecognitionTranscripts({ results: null }), { finalText: '', interimText: '' });
const speech = collectRecognitionTranscripts({
  results: [{ 0: { transcript: ' hello ' }, isFinal: false, length: 1 }],
});
assert.deepEqual(speech, { finalText: '', interimText: 'hello' });
const finalish = collectRecognitionTranscripts({
  results: [
    { 0: { transcript: 'WO-10042' }, isFinal: true, length: 1 },
    { 0: { transcript: 'status' }, length: 1 }, // missing isFinal → interim
  ],
});
assert.equal(finalish.finalText, 'WO-10042');
assert.equal(finalish.interimText, 'status');
const getterThrow = {
  results: {
    length: 1,
    0: new Proxy({}, { get() { throw new Error('edge result getter'); } }),
  },
};
assert.deepEqual(collectRecognitionTranscripts(getterThrow), { finalText: '', interimText: '' });

// Empty no-speech cycle (idle listening) also stays on listening.
const idle = simulateEdgeSessionCycle({
  events: [
    { type: 'start' },
    { type: 'error', error: 'no-speech' },
    { type: 'end' },
  ],
});
assert.ok(idle.ui.every((s) => s === 'listening'));
assert.equal(idle.plans.at(-1)?.restartDelayMs, 100);
assert.equal(idle.abortedRestarts, 0);

// PTT: interim-only utterance must be committed on onend, no reconnecting, no abort.
const ptt = simulateEdgeSessionCycle({
  ptt: true,
  events: [
    { type: 'start' },
    { type: 'interim', text: 'how many open work orders' },
    { type: 'error', error: 'no-speech' },
    { type: 'end' },
  ],
});
assert.ok(ptt.ui.every((s) => s === 'listening'), 'PTT must not flash reconnecting');
assert.equal(ptt.pttBuf, 'how many open work orders');
assert.equal(ptt.abortedRestarts, 0);
assert.equal(ptt.plans.at(-1)?.processWakeBeforeRestart, false);
assert.equal(ptt.plans.at(-1)?.processPttInterim, true);

// PTT finals plus a trailing interim are merged, not dropped.
assert.equal(
  commitPttTranscript('status of', '', 'status of WO-10042'),
  'status of WO-10042'
);

// Real network failure: reconnecting + backoff, abort allowed.
const net = planRecognitionEnd({
  reason: 'network',
  edge: true,
  networkFails: 0,
  ptt: false,
  wantListen: true,
  speaking: false,
});
assert.equal(net.showReconnecting, true);
assert.equal(net.keepRecAlive, false);
assert.equal(net.abortBeforeRestart, true);
assert.equal(net.incrementNetworkFails, true);
assert.equal(net.restartDelayMs, 350);
assert.equal(recognitionRestartDelay(2, true), 700);

// Aborted from a double-start is benign — no backoff, no reconnecting flash.
assert.equal(isBenignRecognitionEnd(classifyRecognitionError('aborted')), true);
const aborted = planRecognitionEnd({
  reason: 'aborted',
  edge: true,
  networkFails: 0,
  ptt: true,
  wantListen: true,
  speaking: false,
  interimText: 'hello',
  pttBuf: '',
});
assert.equal(aborted.showReconnecting, false);
assert.equal(aborted.incrementNetworkFails, false);
assert.equal(aborted.pttBuf, 'hello');

assert.equal(shouldShowReconnecting('onend', true), false);
assert.equal(shouldShowReconnecting('no-speech', true), false);
assert.equal(shouldShowReconnecting('network', true), true);
assert.equal(shouldAbortRecognizer('onend', false), false);
assert.equal(shouldAbortRecognizer('onend', true), true);
assert.equal(commitSessionTranscript('Carina can you', 'hear me'), 'Carina can you hear me');

// Watchdog must not reboot during a planned restart or in-flight start.
assert.equal(
  shouldWatchdogReboot({
    wantListen: true,
    speaking: false,
    thinking: false,
    restartPending: true,
    starting: false,
    recExists: false,
    recAlive: true,
  }),
  false
);
assert.equal(
  shouldWatchdogReboot({
    wantListen: true,
    speaking: false,
    thinking: false,
    restartPending: false,
    starting: true,
    recExists: true,
    recAlive: true,
  }),
  false
);
assert.equal(
  shouldWatchdogReboot({
    wantListen: true,
    speaking: false,
    thinking: false,
    restartPending: false,
    starting: false,
    recExists: false,
    recAlive: false,
  }),
  true
);

// Source wiring: onend uses the shared planner, does not flush at 400ms,
// and does not mark the mic dead on a normal end.
// Live listen path is server STT + energy VAD, not Edge Web Speech.
const voice = fs.readFileSync('src/components/ai/voice-assistant.tsx', 'utf8');
assert.match(voice, /startMicListen/);
assert.match(voice, /transcribeUtterance/);
assert.match(voice, /grok-voice-transcribe-2\.0/);
assert.ok(!/getSpeechRecognition|webkitSpeechRecognition|new Ctor\(/.test(voice), 'browser Web Speech must not be used');
assert.match(voice, /flush\("ptt"\)/);
assert.match(voice, /vadEnd→stt/);
assert.match(voice, /Copy logs/);
assert.match(fs.readFileSync('src/lib/ai-help/conversation-client.ts', 'utf8'), /fetch\("\/api\/ai\/conversation"/);
assert.ok(
  !/reconnect/i.test(fs.readFileSync('src/lib/ai-help/conversation-client.ts', 'utf8')),
  'SSE client must not drive a reconnecting UI loop'
);

console.log('PASS energy VAD + server STT listen path; no browser Web Speech');
