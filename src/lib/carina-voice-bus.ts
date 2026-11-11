/**
 * Cross-component voice coordination.
 * Only the shell VoiceAssistant owns SpeechRecognition; the /ai settings page
 * and help bubble request start/stop via events. Survives client-side navigation.
 */

export const CARINA_LISTEN_KEY = "forge-carina-want-listen";

export function enableCarinaVoiceEvent() {
  return new CustomEvent("forge:carina-enable-voice");
}

export function stopCarinaVoiceEvent() {
  return new CustomEvent("forge:carina-stop-voice");
}

export function carinaListenChangedEvent(
  listening: boolean,
  extra?: { recAlive?: boolean }
) {
  return new CustomEvent("forge:carina-listen-changed", {
    detail: { listening, recAlive: extra?.recAlive },
  });
}

export function carinaRecAliveEvent(recAlive: boolean) {
  return new CustomEvent("forge:carina-rec-alive", {
    detail: { recAlive },
  });
}

export function persistWantListen(want: boolean) {
  try {
    if (want) sessionStorage.setItem(CARINA_LISTEN_KEY, "1");
    else sessionStorage.removeItem(CARINA_LISTEN_KEY);
  } catch {
    // ignore
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(carinaListenChangedEvent(want));
  }
}

export function readWantListen(): boolean {
  try {
    return sessionStorage.getItem(CARINA_LISTEN_KEY) === "1";
  } catch {
    return false;
  }
}


export function carinaVoiceStatusEvent(detail: {
  listening: boolean;
  recAlive: boolean;
  error: string | null;
  supported: boolean;
}) {
  return new CustomEvent("forge:carina-voice-status", { detail });
}

export function carinaPttDownEvent() {
  return new CustomEvent("forge:carina-ptt-down");
}

export function carinaPttUpEvent() {
  return new CustomEvent("forge:carina-ptt-up");
}

export function speechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/** Non-blocking temporary highlight (page stays clickable). */
export function carinaPointEvent(detail: {
  selector: string;
  route?: string;
  label?: string;
  /** How long to show the ring (ms) */
  ms?: number;
}) {
  return new CustomEvent("forge:carina-point", { detail });
}
