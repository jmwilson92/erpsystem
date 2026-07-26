/**
 * Single global audio channel for Carina + guided tours.
 * Prevents overlapping TTS / speechSynthesis (talking over herself).
 */

let gen = 0;
let currentAudio: HTMLAudioElement | null = null;
let speaking = false;

export function carinaAudioGen(): number {
  return gen;
}

export function carinaBumpAudioGen(): number {
  gen += 1;
  return gen;
}

export function carinaIsAudioCurrent(g: number): boolean {
  return g === gen;
}

export function carinaIsSpeaking(): boolean {
  return speaking;
}

export function carinaStopAllAudio(): void {
  gen += 1;
  speaking = false;
  try {
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
  } catch {
    // ignore
  }
  if (currentAudio) {
    try {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
      currentAudio.removeAttribute("src");
      currentAudio.load();
    } catch {
      // ignore
    }
    currentAudio = null;
  }
}

/** Play Carina TTS (or browser fallback). Only one utterance at a time. */
export async function carinaPlaySpeech(
  text: string,
  opts?: { language?: string; voiceId?: string }
): Promise<void> {
  const spoken = text
    .replace(/\*\*/g, "")
    .replace(/`+/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\|/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
  if (!spoken) return;

  carinaStopAllAudio();
  const g = carinaBumpAudioGen();
  speaking = true;

  const finish = () => {
    if (g === gen) speaking = false;
  };

  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: spoken.slice(0, 1800),
        voiceId: opts?.voiceId || "carina",
        language: opts?.language || "en",
      }),
    });
    if (g !== gen) return;
    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (g !== gen) return;
      if (buf.byteLength > 32) {
        const blob = new Blob([buf], {
          type: res.headers.get("Content-Type") || "audio/mpeg",
        });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio = audio;
        await new Promise<void>((resolve) => {
          audio.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          void audio.play().catch(() => resolve());
        });
        finish();
        return;
      }
    }
  } catch {
    // fallback below
  }

  if (g !== gen) return;
  if (typeof window !== "undefined" && window.speechSynthesis) {
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(spoken);
      u.rate = 1.05;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }
  finish();
}
