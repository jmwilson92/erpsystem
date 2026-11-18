/**
 * Build the question we actually send from speech results.
 * Prefer committed finals; only keep an interim tail when it extends them.
 * Never returns the wake name alone.
 */
export function composeUtterance(finalText: string, interimText: string): string {
  const finals = finalText.replace(/\s+/g, " ").trim();
  const interim = interimText.replace(/\s+/g, " ").trim();
  if (!finals) return interim;
  if (!interim) return finals;
  const f = finals.toLowerCase();
  const i = interim.toLowerCase();
  if (i === f || f.includes(i)) return finals;
  if (i.startsWith(f)) return interim;
  // Overlapping tail: "can you" + "you hear me" → "can you hear me"
  const fWords = finals.split(" ");
  for (let n = Math.min(fWords.length, interim.split(" ").length); n >= 1; n--) {
    const tail = fWords.slice(-n).join(" ").toLowerCase();
    if (i.startsWith(tail)) {
      return (finals + " " + interim.slice(tail.length)).replace(/\s+/g, " ").trim();
    }
  }
  return (finals + " " + interim).replace(/\s+/g, " ").trim();
}

/** Fold an unfinalized interim into the rolling final buffer (Edge one-shot sessions). */
export function promoteInterim(finalText: string, interimText: string): string {
  return composeUtterance(finalText, interimText);
}
