/**
 * Adaptive barge-in detector: fire when user speech stays above the
 * current echo floor for ~250ms while Carina is talking.
 */

export const BARGE_MIN_MS = 250;
export const BARGE_FLOOR_RMS = 0.03;
export const BARGE_ECHO_RATIO = 2.2;
export const BARGE_ECHO_OFFSET = 0.012;
export const BARGE_ECHO_ALPHA = 0.08;

export function bargeThreshold(
  echoRms: number,
  opts?: { floor?: number; ratio?: number; offset?: number }
): number {
  const floor = opts?.floor ?? BARGE_FLOOR_RMS;
  const ratio = opts?.ratio ?? BARGE_ECHO_RATIO;
  const offset = opts?.offset ?? BARGE_ECHO_OFFSET;
  return Math.max(floor, echoRms * ratio + offset);
}

export function createBargeDetector(opts?: {
  minMs?: number;
  floor?: number;
  ratio?: number;
  offset?: number;
  alpha?: number;
}) {
  const minMs = opts?.minMs ?? BARGE_MIN_MS;
  const alpha = opts?.alpha ?? BARGE_ECHO_ALPHA;
  let echo = 0.01;
  let aboveMs = 0;
  let triggered = false;

  return {
    pushRms(rms: number, dtMs: number): "barge" | null {
      const threshold = bargeThreshold(echo, opts);
      if (rms < threshold) {
        echo = echo * (1 - alpha) + Math.max(0, rms) * alpha;
        aboveMs = 0;
        return null;
      }
      if (triggered) return null;
      aboveMs += Math.max(0, dtMs);
      if (aboveMs >= minMs) {
        triggered = true;
        return "barge";
      }
      return null;
    },
    reset() {
      echo = 0.01;
      aboveMs = 0;
      triggered = false;
    },
    echoLevel: () => echo,
    threshold: () => bargeThreshold(echo, opts),
    triggered: () => triggered,
  };
}
