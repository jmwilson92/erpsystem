/**
 * Always-on mic pipeline: one getUserMedia stream, energy VAD, WAV clips
 * for server STT. No browser Web Speech API.
 */
import { createBargeDetector } from "@/lib/ai-help/barge-in";
import { createEnergyVad, rmsFromFloat32 } from "@/lib/ai-help/mic-vad";
import { concatInt16, downsampleTo16k, durationMsOfPcm, encodeWav } from "@/lib/ai-help/pcm-wav";

export type ListenUtterance = {
  wav: Blob;
  durationMs: number;
  reason: "vad" | "ptt" | "max";
  vadEndedAt: number;
};

export type ListenHandle = {
  stop: () => void;
  /** Close the current PTT (or VAD) buffer and emit it as an utterance. */
  flush: (reason: "vad" | "ptt" | "max") => void;
  level: () => number;
};

export function startMicListen(
  stream: MediaStream,
  opts: {
    getSpeaking?: () => boolean;
    getPtt?: () => boolean;
    onLevel?: (rms: number) => void;
    onVad?: (event: "start" | "end" | "clip" | "barge") => void;
    onUtterance?: (utt: ListenUtterance) => void;
    onBargeIn?: () => void;
  }
): ListenHandle {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error("This browser cannot capture microphone audio.");

  const ctx = new AC();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);
  void ctx.resume();

  const vad = createEnergyVad();
  const barge = createBargeDetector();
  const chunks: Int16Array[] = [];
  let capturing = false;
  let barging = false;
  let lastLevel = 0;
  let stopped = false;
  let wasSpeaking = false;

  const begin = () => {
    chunks.length = 0;
    capturing = true;
  };

  const flush = (reason: ListenUtterance["reason"]) => {
    if (!capturing && reason !== "ptt") {
      chunks.length = 0;
      return;
    }
    capturing = false;
    const pcm = concatInt16(chunks);
    chunks.length = 0;
    vad.reset();
    barge.reset();
    barging = false;
    const durationMs = durationMsOfPcm(pcm);
    if (durationMs < 180 && reason !== "ptt") return;
    if (!pcm.length) return;
    const wav = encodeWav(pcm);
    opts.onUtterance?.({
      wav,
      durationMs,
      reason,
      vadEndedAt: Date.now(),
    });
  };

  proc.onaudioprocess = (ev) => {
    if (stopped) return;
    const input = ev.inputBuffer.getChannelData(0);
    const rms = rmsFromFloat32(input);
    lastLevel = rms;
    opts.onLevel?.(rms);

    const speaking = !!opts.getSpeaking?.();
    const ptt = !!opts.getPtt?.();
    const pcm = downsampleTo16k(input, ev.inputBuffer.sampleRate || ctx.sampleRate);
    const dtMs = (input.length / (ev.inputBuffer.sampleRate || ctx.sampleRate)) * 1000;

    if (speaking && !wasSpeaking) barge.reset();
    if (!speaking) {
      barging = false;
      if (wasSpeaking) barge.reset();
    }
    wasSpeaking = speaking;

    if (ptt) {
      barging = false;
      if (!capturing) begin();
      chunks.push(pcm);
      return;
    }

    // Keep VAD running on the AEC'd stream while she talks. Echo is ignored
    // until user energy stays above the adaptive floor for ~250ms.
    if (speaking && !barging) {
      const evnt = barge.pushRms(rms, dtMs);
      if (evnt === "barge") {
        barging = true;
        begin();
        vad.forceStart();
        chunks.push(pcm);
        opts.onVad?.("barge");
        opts.onBargeIn?.();
      }
      return;
    }


    const evnt = vad.pushRms(rms, dtMs);
    if (evnt === "start") {
      begin();
      chunks.push(pcm);
      opts.onVad?.("start");
      return;
    }
    if (capturing) chunks.push(pcm);
    if (evnt === "end" || evnt === "clip") {
      opts.onVad?.(evnt);
      flush(evnt === "clip" ? "max" : "vad");
    }
  };

  return {
    stop() {
      stopped = true;
      capturing = false;
      chunks.length = 0;
      vad.reset();
      barge.reset();
      barging = false;
      try {
        proc.disconnect();
        src.disconnect();
        mute.disconnect();
      } catch {
        // ignore
      }
      void ctx.close().catch(() => undefined);
    },
    flush,
    level: () => lastLevel,
  };
}

export function voiceInputSupported(): boolean {
  if (typeof window === "undefined") return false;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return !!AC && !!navigator.mediaDevices?.getUserMedia;
}
