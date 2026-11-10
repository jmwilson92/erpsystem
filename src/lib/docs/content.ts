import { z } from "zod";

export type DocNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocNode[];
};
const nodeTypes = new Set(["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "hardBreak", "horizontalRule"]);
const markTypes = new Set(["bold", "italic", "strike", "code", "underline", "link"]);

export function safeDocHref(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  // No protocol-relative links, javascript/data URLs, control chars or backslashes.
  if (/[\x00-\x20\\]/.test(value)) return;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (/^https?:\/\//i.test(value)) {
    try { const u = new URL(value); if (u.hostname) return u.href; } catch { /* invalid */ }
  }
}

/** Strip unknown attributes; reject unknown nodes, oversized and deeply nested trees. */
export function parseDocContent(raw: string): DocNode {
  if (raw.length > 250_000) throw new Error("Page content is limited to 250 KB");
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new Error("Invalid editor document"); }
  let count = 0;
  function clean(value: unknown, depth: number): DocNode {
    if (++count > 10_000 || depth > 24) throw new Error("Document is too complex");
    const n = z.object({ type: z.string(), text: z.string().optional(), attrs: z.record(z.string(), z.unknown()).optional(), marks: z.array(z.object({ type: z.string(), attrs: z.record(z.string(), z.unknown()).optional() })).max(8).optional(), content: z.array(z.unknown()).optional() }).parse(value);
    if (!nodeTypes.has(n.type)) throw new Error("Unsupported editor node");
    const out: DocNode = { type: n.type };
    if (n.type === "text") out.text = n.text ?? "";
    if (n.type === "heading") out.attrs = { level: Math.min(3, Math.max(1, Number(n.attrs?.level) || 2)) };
    if (n.type === "orderedList") out.attrs = { start: Math.max(1, Number(n.attrs?.start) || 1) };
    if (n.marks) out.marks = n.marks.filter(m => markTypes.has(m.type)).map(m => m.type === "link" ? { type: "link", attrs: { href: safeDocHref(m.attrs?.href) ?? "#", target: "_blank", rel: "noopener noreferrer" } } : { type: m.type });
    if (n.content) out.content = n.content.map(c => clean(c, depth + 1));
    return out;
  }
  const doc = clean(input, 0);
  if (doc.type !== "doc") throw new Error("Document root required");
  return doc;
}

export function docText(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const text = (node.content ?? []).map(docText).join("");
  return ["paragraph", "heading", "listItem", "codeBlock"].includes(node.type) ? `${text}\n` : text;
}

const paragraph = (text: string): DocNode => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const heading = (text: string): DocNode => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
export const DOC_TEMPLATES = [
  { key: "blank", name: "Blank page", sections: [] },
  { key: "sop", name: "Controlled procedure / SOP", sections: ["Purpose", "Scope", "Responsibilities", "Procedure", "Acceptance criteria", "References"] },
  { key: "decision", name: "Engineering decision", sections: ["Context", "Options considered", "Decision", "Consequences", "Verification"] },
  { key: "meeting", name: "Meeting notes", sections: ["Attendees", "Agenda", "Discussion", "Decisions", "Action items"] },
  { key: "runbook", name: "Runbook", sections: ["Overview", "Prerequisites", "Steps", "Validation", "Recovery"] },
] as const;
export function templateContent(key: string): DocNode {
  const t = DOC_TEMPLATES.find(t => t.key === key) ?? DOC_TEMPLATES[0];
  return { type: "doc", content: t.sections.length ? t.sections.flatMap(s => [heading(s), paragraph("")]) : [paragraph("")] };
}

/** Bounded line diff, used for a readable history comparison rather than raw JSON. */
export function diffDocLines(before: string, after: string): { kind: "same" | "added" | "removed"; text: string }[] {
  const a = before.split("\n").slice(0, 500), b = after.split("\n").slice(0, 500);
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: ReturnType<typeof diffDocLines> = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ kind: "same", text: a[i++] }); j++; }
    else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) out.push({ kind: "added", text: b[j++] });
    else out.push({ kind: "removed", text: a[i++] });
  }
  return out;
}
