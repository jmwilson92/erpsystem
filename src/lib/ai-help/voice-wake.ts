/** Fuzzy wake-word matching for Carina. Shared by listen + tests. */

export const CARINA_WAKE_ALIASES =
  /\b(carina|karina|corina|corrina|korina|careena|kareena|coreena|karrina|karinna|carinna|katrina|catarina|catarína|caterina|carena|karena|kerina|karrena|serina|sarina|marina|farina|carine|karine|karen|carrie|kari|cara)\b/i;

export function normalizeHeard(s: string) {
  return s
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function includesWake(text: string, wake: string) {
  const w = wake.trim().toLowerCase();
  if (w.length < 2) return false;
  const t = normalizeHeard(text);
  if (!t) return false;
  if (t.includes(w)) return true;

  if (w === "carina" || w === "karina") {
    if (CARINA_WAKE_ALIASES.test(t)) {
      if (/\bkaren\b/.test(t) && !/\b(carina|karina|corina|careena|catarina)\b/.test(t)) {
        const words = t.split(" ");
        if (words.length > 4 && !/^(hey|hi|ok|okay|yo)\b/.test(t)) return false;
      }
      return true;
    }
    if (/\b(care|car|kar|cat)\s*(arina|ina|ena|rena)\b/.test(t)) return true;
  }

  const first = w.split(/\s+/)[0];
  if (first.length >= 4 && new RegExp(`\\b${escapeRe(first)}\\b`).test(t)) return true;
  return false;
}

export function stripWake(text: string, wake: string) {
  let out = text;
  const w = wake.trim();
  const first = w.split(/\s+/)[0] || w;
  if (first.toLowerCase() === "carina" || first.toLowerCase() === "karina") {
    out = out.replace(
      /\b(hey|hi|ok|okay|yo)?\s*(carina|karina|corina|corrina|korina|careena|kareena|coreena|karrina|karinna|carinna|katrina|catarina|caterina|carena|karena|kerina|karrena|serina|sarina|marina|farina|carine|karine|karen|carrie|kari|cara)\b[,.!?]?/gi,
      " "
    );
    out = out.replace(/\b(care|car|kar|cat)\s*(arina|ina|ena|rena)\b[,.!?]?/gi, " ");
  }
  out = out
    .replace(new RegExp(`\\b${escapeRe(w)}\\b[,.!?]?`, "ig"), " ")
    .replace(new RegExp(`\\b${escapeRe(first)}\\b[,.!?]?`, "ig"), " ")
    .replace(/^(hey|ok|okay|hi|hello|yo|um|uh)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

export function isLikelyEcho(heard: string, spoken: string, wake: string) {
  const h = normalizeHeard(heard);
  const s = normalizeHeard(spoken);
  if (!h || !s) return false;
  if (s.includes(h) && h.length >= 8) return true;
  const hWords = h.split(" ").filter((x) => x.length > 2);
  if (hWords.length >= 3) {
    const sSet = new Set(s.split(" "));
    const hits = hWords.filter((x) => sSet.has(x)).length;
    if (hits / hWords.length >= 0.7) return true;
  }
  const after = normalizeHeard(stripWake(heard, wake));
  if (after.length >= 10 && s.includes(after)) return true;
  return false;
}
