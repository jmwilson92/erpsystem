/**
 * Shared SpeechRecognition restart / UI policy.
 *
 * Edge runs one-shot sessions (continuous=false). A normal end, no-speech,
 * or aborted-from-end is not a disconnect — the UI must stay on "listening"
 * and the next session must start without aborting (which drops audio).
 * Backoff and "reconnecting" are reserved for real service failures.
 */
import { promoteInterim } from "@/lib/ai-help/utterance";

export const RESTART_MS = 180;
export const EDGE_RESTART_MS = 100;
export const WATCHDOG_MS = 3000;

export type RecognitionEndReason =
  | "onend"
  | "no-speech"
  | "aborted"
  | "network"
  | "service-not-allowed"
  | "not-allowed"
  | "audio-capture"
  | "start-error"
  | "other";

export function isBenignRecognitionEnd(reason: RecognitionEndReason): boolean {
  return reason === "onend" || reason === "no-speech" || reason === "aborted";
}

export function classifyRecognitionError(error: string | undefined): RecognitionEndReason {
  if (!error) return "onend";
  if (
    error === "no-speech" ||
    error === "aborted" ||
    error === "network" ||
    error === "service-not-allowed" ||
    error === "not-allowed" ||
    error === "audio-capture"
  ) {
    return error;
  }
  return "other";
}

/** True only for real service failures, not a normal one-shot end. */
export function shouldShowReconnecting(reason: RecognitionEndReason, listening: boolean): boolean {
  if (!listening) return false;
  return !isBenignRecognitionEnd(reason);
}

/** Keep the listening indicator up across a planned one-shot restart. */
export function keepRecAliveOnEnd(reason: RecognitionEndReason, wantListen: boolean): boolean {
  return wantListen && isBenignRecognitionEnd(reason);
}

/**
 * Abort only when stopping or recovering from a real error.
 * Aborting a live or just-ended Edge session drops the last audio and
 * often triggers another aborted/network cycle.
 */
export function shouldAbortRecognizer(reason: RecognitionEndReason, stopping: boolean): boolean {
  if (stopping) return true;
  return !isBenignRecognitionEnd(reason);
}

/** Exponential backoff only after network / service failures. */
export function recognitionRestartDelay(networkFails: number, edge: boolean): number {
  if (networkFails > 0) {
    return Math.min(5000, 350 * 2 ** Math.min(networkFails - 1, 4));
  }
  return edge ? EDGE_RESTART_MS : RESTART_MS;
}

export function shouldIncrementNetworkFails(reason: RecognitionEndReason): boolean {
  return reason === "network" || reason === "service-not-allowed";
}

export function shouldProcessWakeBeforeRestart(ptt: boolean, reason: RecognitionEndReason): boolean {
  if (ptt) return false;
  return isBenignRecognitionEnd(reason);
}

export function commitSessionTranscript(finalText: string, interimText: string): string {
  return promoteInterim(finalText, interimText);
}

/**
 * Edge often ends a PTT session with only an interim transcript. Fold it
 * into the held buffer before the recognizer is replaced.
 */
export function commitPttTranscript(pttBuf: string, finalText: string, interimText: string): string {
  const committed = commitSessionTranscript(finalText, interimText);
  if (!committed) return (pttBuf || "").replace(/\s+/g, " ").trim();
  const prev = (pttBuf || "").replace(/\s+/g, " ").trim();
  if (!prev) return committed;
  if (committed.startsWith(prev) || prev.includes(committed)) {
    return committed.length >= prev.length ? committed : prev;
  }
  return (prev + " " + committed).replace(/\s+/g, " ").trim();
}

export type RecognitionEndPlan = {
  showReconnecting: boolean;
  keepRecAlive: boolean;
  abortBeforeRestart: boolean;
  restartDelayMs: number | null;
  incrementNetworkFails: boolean;
  processWakeBeforeRestart: boolean;
  processPttInterim: boolean;
  committedFinal: string;
  pttBuf: string;
};

export function planRecognitionEnd(input: {
  reason: RecognitionEndReason;
  edge: boolean;
  networkFails: number;
  ptt: boolean;
  wantListen: boolean;
  speaking: boolean;
  finalText?: string;
  interimText?: string;
  pttBuf?: string;
  stopping?: boolean;
}): RecognitionEndPlan {
  const reason = input.reason;
  const committedFinal = commitSessionTranscript(input.finalText || "", input.interimText || "");
  const pttBuf = input.ptt
    ? commitPttTranscript(input.pttBuf || "", input.finalText || "", input.interimText || "")
    : (input.pttBuf || "").trim();
  const incrementNetworkFails = shouldIncrementNetworkFails(reason);
  const networkFails = incrementNetworkFails ? input.networkFails + 1 : input.networkFails;
  const canRestart = input.wantListen && !input.speaking && !input.stopping && reason !== "not-allowed";
  return {
    showReconnecting: shouldShowReconnecting(reason, input.wantListen),
    keepRecAlive: keepRecAliveOnEnd(reason, input.wantListen),
    abortBeforeRestart: shouldAbortRecognizer(reason, !!input.stopping),
    restartDelayMs: canRestart ? recognitionRestartDelay(networkFails, input.edge) : null,
    incrementNetworkFails,
    processWakeBeforeRestart: shouldProcessWakeBeforeRestart(input.ptt, reason),
    processPttInterim: input.ptt && isBenignRecognitionEnd(reason),
    committedFinal,
    pttBuf,
  };
}

export function shouldWatchdogReboot(state: {
  wantListen: boolean;
  speaking: boolean;
  thinking: boolean;
  restartPending: boolean;
  starting: boolean;
  recExists: boolean;
  recAlive: boolean;
}): boolean {
  if (!state.wantListen) return false;
  if (state.speaking || state.thinking) return false;
  if (state.restartPending || state.starting) return false;
  if (state.recAlive && state.recExists) return false;
  return true;
}

/** Simulated Edge one-shot + no-speech cycle for tests. */
export function simulateEdgeSessionCycle(input: {
  events: Array<
    | { type: "start" }
    | { type: "interim"; text: string }
    | { type: "final"; text: string }
    | { type: "error"; error: string }
    | { type: "end" }
  >;
  ptt?: boolean;
  pttBuf?: string;
  finalText?: string;
  interimText?: string;
  wantListen?: boolean;
  networkFails?: number;
}): {
  ui: Array<"listening" | "reconnecting" | "off">;
  plans: RecognitionEndPlan[];
  finalText: string;
  interimText: string;
  pttBuf: string;
  networkFails: number;
  started: number;
  abortedRestarts: number;
} {
  const ui: Array<"listening" | "reconnecting" | "off"> = [];
  const plans: RecognitionEndPlan[] = [];
  let finalText = input.finalText || "";
  let interimText = input.interimText || "";
  let pttBuf = input.pttBuf || "";
  let networkFails = input.networkFails || 0;
  let started = 0;
  let abortedRestarts = 0;
  let recAlive = false;
  const wantListen = input.wantListen !== false;
  const ptt = !!input.ptt;
  const pushUi = () => {
    ui.push(!wantListen ? "off" : recAlive ? "listening" : "reconnecting");
  };

  for (const ev of input.events) {
    if (ev.type === "start") {
      started += 1;
      recAlive = true;
      networkFails = 0;
      pushUi();
      continue;
    }
    if (ev.type === "interim") {
      interimText = ev.text;
      if (ptt) pttBuf = commitPttTranscript(pttBuf, "", ev.text);
      pushUi();
      continue;
    }
    if (ev.type === "final") {
      finalText = commitSessionTranscript(finalText, ev.text);
      interimText = "";
      if (ptt) pttBuf = commitPttTranscript(pttBuf, ev.text, "");
      pushUi();
      continue;
    }
    const reason =
      ev.type === "error" ? classifyRecognitionError(ev.error) : "onend";
    if (ev.type === "end") {
      finalText = commitSessionTranscript(finalText, interimText);
      interimText = "";
    }
    const plan = planRecognitionEnd({
      reason,
      edge: true,
      networkFails,
      ptt,
      wantListen,
      speaking: false,
      finalText,
      interimText: ev.type === "end" ? "" : interimText,
      pttBuf,
    });
    plans.push(plan);
    if (plan.incrementNetworkFails) networkFails += 1;
    finalText = plan.committedFinal || finalText;
    if (plan.processPttInterim) pttBuf = plan.pttBuf;
    recAlive = plan.keepRecAlive;
    if (plan.abortBeforeRestart && plan.restartDelayMs != null) abortedRestarts += 1;
    if (plan.restartDelayMs != null) started += 1;
    pushUi();
  }

  return { ui, plans, finalText, interimText, pttBuf, networkFails, started, abortedRestarts };
}
