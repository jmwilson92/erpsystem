/**
 * Instant local replies for short listening / presence checks.
 * These must never go through product-doc retrieval (that is what made
 * "can you hear me" come back as an unrelated how-to answer).
 */
const META_RE =
  /^(can you hear me(?: now)?|do you hear me|did you hear me|you hear me|are you (?:there|listening|here)(?: now)?|you (?:there|listening)|hello(?: there)?|hi(?: there)?|hey(?: there)?|are you on)$/i;

export function normalizeMetaQuestion(question: string): string {
  return question
    .trim()
    .toLowerCase()
    .replace(/[?.!,…]+/g, " ")
    .replace(/^(hey|hi|ok|okay|yo|um|uh)\s+(carina|karina|corina|katrina|carena)\s+/i, "")
    .replace(/^(carina|karina|corina|katrina|carena)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function helpMetaReply(question: string): string | null {
  const s = normalizeMetaQuestion(question);
  if (!s || s.length > 80) return null;
  if (!META_RE.test(s)) return null;
  if (/^(hello|hi|hey)(?: there)?$/.test(s)) {
    return "Hi, I’m Carina, Protessera’s AI assistant. I can hear you. How can I help?";
  }
  return "Yes, I can hear you. I’m Carina, Protessera’s AI assistant. What would you like to do?";
}
