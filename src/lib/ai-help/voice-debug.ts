/** ?voiceDebug=1 overlay + ring buffer for Carina voice diagnostics. */

export const VOICE_DEBUG_PARAM = "voiceDebug";
export const VOICE_DEBUG_RING = 80;

export type VoiceDebugEvent = {
  at: number;
  event: string;
  detail?: string;
};

export function shouldShowVoiceDebug(search: string | undefined | null): boolean {
  if (!search) return false;
  const q = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(q).get(VOICE_DEBUG_PARAM) === "1";
}

function fmtTime(at: number) {
  const d = new Date(at);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

export function createVoiceDebugLog(limit = VOICE_DEBUG_RING) {
  const events: VoiceDebugEvent[] = [];
  function push(event: string, detail?: string) {
    events.push({ at: Date.now(), event, detail: detail?.slice(0, 240) });
    if (events.length > limit) events.splice(0, events.length - limit);
  }
  return {
    push,
    list: () => events.slice(),
    format: () =>
      events
        .map((e) => (e.detail ? `${fmtTime(e.at)} ${e.event} ${e.detail}` : `${fmtTime(e.at)} ${e.event}`))
        .join("\n"),
  };
}

export const MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
