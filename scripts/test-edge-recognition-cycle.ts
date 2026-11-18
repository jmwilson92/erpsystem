import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyRecognitionError,
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
const voice = fs.readFileSync('src/components/ai/voice-assistant.tsx', 'utf8');
const onendAt = voice.indexOf('rec.onend = ()');
assert.ok(onendAt > 0);
const onend = voice.slice(onendAt, voice.indexOf('recRef.current = rec', onendAt));
assert.match(onend, /planRecognitionEnd/);
assert.match(onend, /processWakeBeforeRestart/);
assert.match(onend, /processPttInterim/);
assert.match(onend, /keepRecAlive/);
assert.ok(!onend.includes(', 400)'), 'onend must not flush after 400ms');
assert.match(onend, /if \(plan\.keepRecAlive\)/);
assert.match(onend, /handleResultRef\.current/);
assert.match(voice, /WATCHDOG_MS/);
assert.match(voice, /shouldWatchdogReboot/);
assert.match(voice, /startingRef/);
assert.match(voice, /commitPttTranscript/);
assert.match(voice, /already started\|InvalidStateError/);
assert.ok(!/getUserMedia/.test(onend), 'mic stream must not be reacquired on each onend');
const bootAt = voice.indexOf('const bootRecognition = useCallback');
const boot = voice.slice(bootAt, voice.indexOf('const scheduleBoot = useCallback', bootAt));
assert.ok(!/getUserMedia/.test(boot), 'boot must not reacquire the mic stream');
assert.match(boot, /detachRecognition\(\{ abort: false, markDead: false \}\)/);
assert.match(fs.readFileSync('src/lib/ai-help/conversation-client.ts', 'utf8'), /fetch\("\/api\/ai\/conversation"/);
assert.ok(
  !/reconnect/i.test(fs.readFileSync('src/lib/ai-help/conversation-client.ts', 'utf8')),
  'SSE client must not drive a reconnecting UI loop'
);

console.log('PASS Edge onend/no-speech cycle keeps listening, commits wake/PTT, no abort or backoff');
