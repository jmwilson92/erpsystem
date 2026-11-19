/**
 * Turn assistant text into something a TTS engine should read naturally.
 * Applied at the TTS boundary so on-screen replies can keep their formatting.
 */

const ID_WORDS: Record<string, string> = {
  WO: "work order",
  PR: "purchase request",
  PO: "purchase order",
  SO: "sales order",
  NCR: "nonconformance",
  RMA: "return",
  INV: "invoice",
  PN: "part number",
  PRJ: "project",
  BDGT: "budget",
  BOM: "bill of materials",
  EXP: "expense",
  QTE: "quote",
  RFQ: "request for quote",
  NCRR: "nonconformance",
};

export function expandSpokenAbbreviations(text: string): string {
  return text
    .replace(/\bN\/A\b/gi, "not applicable")
    .replace(/\ba\.k\.a\.?/gi, "also known as")
    .replace(/\be\.g\./gi, "for example")
    .replace(/\bi\.e\./gi, "that is")
    .replace(/\betc\./gi, "et cetera")
    .replace(/\bvs\./gi, "versus");
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`+/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "");
}

/** Italic _phrases_, but not snake_case tokens like IN_WORK. */
function stripItalicUnderscores(text: string): string {
  return text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,!?;:)]|$)/g, "$1$2");
}

function speakIds(text: string): string {
  return text.replace(/\b([A-Z]{2,5})-0*([0-9]+)\b/g, (_m, prefix: string, digits: string) => {
    const words = ID_WORDS[prefix] || prefix.split("").join(" ");
    return `${words} ${parseInt(digits, 10)}`;
  });
}

function speakSnakeCase(text: string): string {
  return text.replace(/\b[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)+\b/g, (m) =>
    m.replace(/_/g, " ").toLowerCase()
  );
}

/** Plain spoken wording, safe to send to TTS more than once. */
export function normalizeSpeechText(input: string): string {
  let s = String(input || "").replace(/\r/g, "");
  s = stripMarkdown(s);
  s = speakIds(s);
  s = speakSnakeCase(s);
  s = stripItalicUnderscores(s);
  s = expandSpokenAbbreviations(s);
  s = s.replace(/_/g, " ");
  s = s.replace(/[–—]/g, " ");
  s = s.replace(/(\w)-(\w)/g, "$1 $2");
  s = s.replace(/-(?!\w)|(?<!\w)-/g, " ");
  s = s.replace(/[\/\\]/g, " ");
  s = s.replace(/[()[\]{}]/g, " ");
  s = s.replace(/[*#|~<>]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
