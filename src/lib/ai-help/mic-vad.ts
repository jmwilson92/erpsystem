/**
 * Energy-based VAD used to segment the always-on mic before server STT.
 * Pure policy — no Web Audio here so unit tests can drive it with RMS frames.
 */

export const VAD_TARGET_RATE = 16_000;
export const VAD_START_RMS = 0.022;
export const VAD_END_RMS = 0.011;
export const VAD_START_MS = 120;
export const VAD_END_MS = 700;
export const VAD_MIN_MS = 280;
export const VAD_MAX_MS = 12_000;

export type VadEvent = "start" | "end" | "clip";

export type EnergyVad = {
  pushRms: (rms: number, dtMs: number) => VadEvent | null;
  inSpeech: () => boolean;
  speechMs: () => number;
  forceStart: () => void;
  reset: () => void;
};

export function rmsFromFloat32(frame: Float32Array | ArrayLike<number>): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i];
    sum += s * s;
  }
  return Math.sqrt(sum / frame.length);
}

export function createEnergyVad(opts?: {
  startRms?: number;
  endRms?: number;
  startMs?: number;
  endMs?: number;
  minMs?: number;
  maxMs?: number;
}): EnergyVad {
  const startRms = opts?.startRms ?? VAD_START_RMS;
  const endRms = opts?.endRms ?? VAD_END_RMS;
  const startMs = opts?.startMs ?? VAD_START_MS;
  const endMs = opts?.endMs ?? VAD_END_MS;
  const minMs = opts?.minMs ?? VAD_MIN_MS;
  const maxMs = opts?.maxMs ?? VAD_MAX_MS;

  let speaking = false;
  let aboveMs = 0;
  let belowMs = 0;
  let speechMs = 0;

  return {
    pushRms(rms: number, dtMs: number) {
      const dt = Math.max(0, dtMs);
      if (!speaking) {
        if (rms >= startRms) {
          aboveMs += dt;
          if (aboveMs >= startMs) {
            speaking = true;
            belowMs = 0;
            speechMs = aboveMs;
            aboveMs = 0;
            return "start";
          }
        } else {
          aboveMs = 0;
        }
        return null;
      }
      speechMs += dt;
      if (rms < endRms) {
        belowMs += dt;
        if (belowMs >= endMs && speechMs - belowMs >= minMs) {
          speaking = false;
          aboveMs = 0;
          belowMs = 0;
          speechMs = 0;
          return "end";
        }
      } else {
        belowMs = 0;
      }
      if (speechMs >= maxMs) {
        speaking = false;
        aboveMs = 0;
        belowMs = 0;
        speechMs = 0;
        return "clip";
      }
      return null;
    },
    inSpeech: () => speaking,
    speechMs: () => speechMs,
    forceStart() {
      speaking = true;
      aboveMs = 0;
      belowMs = 0;
      speechMs = Math.max(speechMs, minMs);
    },
    reset() {
      speaking = false;
      aboveMs = 0;
      belowMs = 0;
      speechMs = 0;
    },
  };
}
