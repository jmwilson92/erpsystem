/** ?voiceDebug=1 overlay + ring buffer for Carina voice diagnostics. */

export const VOICE_DEBUG_PARAM = "voiceDebug";
export const VOICE_DEBUG_RING = 20;

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

export function createVoiceDebugLog(limit = VOICE_DEBUG_RING) {
  const events: VoiceDebugEvent[] = [];
  function push(event: string, detail?: string) {
    events.push({ at: Date.now(), event, detail: detail?.slice(0, 160) });
    if (events.length > limit) events.splice(0, events.length - limit);
  }
  return {
    push,
    list: () => events.slice(),
    format: () =>
      events
        .map((e) => {
          const t = new Date(e.at).toLocaleTimeString("en-US", { hour12: false });
          return e.detail ? `${t} ${e.event} ${e.detail}` : `${t} ${e.event}`;
        })
        .join("\n"),
  };
}

export const MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
