/**
 * Small markdown model for the comparison articles.
 * Covers the constructs in the approved drafts: headings, paragraphs,
 * lists, tables, emphasis, links, and FAQ pairs.
 */

export type LinkInline = {
  kind: "link";
  text: string;
  href: string;
  external: boolean;
};

export type Inline =
  | string
  | { kind: "bold"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | LinkInline;

export type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "p"; children: Inline[] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "table"; headers: Inline[][]; rows: Inline[][][] }
  | { kind: "faq"; q: string; a: Inline[] }
  | { kind: "hr" };

const INTERNAL_HOSTS = new Set(["protessera.com", "www.protessera.com"]);

export function classifyHref(href: string): { href: string; external: boolean } {
  if (href.startsWith("/") || href.startsWith("#") || href.startsWith("mailto:")) {
    return { href, external: false };
  }
  try {
    const url = new URL(href);
    if (INTERNAL_HOSTS.has(url.hostname)) {
      const path = `${url.pathname}${url.search}${url.hash}`;
      return { href: path || "/", external: false };
    }
  } catch {
    return { href, external: false };
  }
  return { href, external: true };
}

/** External competitor links open in a new tab and carry rel="noopener". */
export function externalLinkAttrs(link: LinkInline): { target?: "_blank"; rel?: string } {
  if (!link.external) return {};
  return { target: "_blank", rel: "noopener noreferrer" };
}

function parseInlines(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let textStart = 0;
  const pushText = (end: number) => {
    if (end > textStart) out.push(src.slice(textStart, end));
  };

  while (i < src.length) {
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end !== -1) {
        pushText(i);
        out.push({ kind: "bold", children: parseInlines(src.slice(i + 2, end)) });
        i = end + 2;
        textStart = i;
        continue;
      }
    }
    if (src[i] === "*" && src[i + 1] !== "*") {
      const end = src.indexOf("*", i + 1);
      if (end !== -1) {
        pushText(i);
        out.push({ kind: "em", children: parseInlines(src.slice(i + 1, end)) });
        i = end + 1;
        textStart = i;
        continue;
      }
    }
    if (src[i] === "[") {
      const close = src.indexOf("]", i + 1);
      if (close !== -1 && src[close + 1] === "(") {
        const paren = src.indexOf(")", close + 2);
        if (paren !== -1) {
          pushText(i);
          const text = src.slice(i + 1, close);
          const rawHref = src.slice(close + 2, paren);
          const classified = classifyHref(rawHref);
          out.push({
            kind: "link",
            text,
            href: classified.href,
            external: classified.external,
          });
          i = paren + 1;
          textStart = i;
          continue;
        }
      }
    }
    i += 1;
  }
  pushText(src.length);
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseTable(lines: string[]): Block {
  const parsed = lines.map((line) => splitRow(line)).filter((cells) => !isSeparator(cells));
  const [headers = [], ...rows] = parsed;
  return {
    kind: "table",
    headers: headers.map((cell) => parseInlines(cell)),
    rows: rows.map((row) => row.map((cell) => parseInlines(cell))),
  };
}

export function parseCompareDocument(markdown: string): Block[] {
  const chunks = markdown.replace(/\r\n/g, "\n").trim().split(/\n\n+/);
  const out: Block[] = [];
  for (const raw of chunks) {
    const block = raw.trim();
    if (!block) continue;
    if (block === "---") {
      out.push({ kind: "hr" });
      continue;
    }
    if (block.startsWith("## ")) {
      out.push({ kind: "h2", text: block.slice(3).trim() });
      continue;
    }
    if (block.startsWith("# ")) {
      out.push({ kind: "h1", text: block.slice(2).trim() });
      continue;
    }
    const lines = block.split("\n").map((line) => line.trim());
    if (lines.every((line) => line.startsWith("|"))) {
      out.push(parseTable(lines));
      continue;
    }
    if (lines.every((line) => line.startsWith("- "))) {
      out.push({
        kind: "ul",
        items: lines.map((line) => parseInlines(line.slice(2).trim())),
      });
      continue;
    }
    if (lines.length >= 2 && /^\*\*[^*]+\*\*$/.test(lines[0])) {
      out.push({
        kind: "faq",
        q: lines[0].slice(2, -2),
        a: parseInlines(lines.slice(1).join(" ").trim()),
      });
      continue;
    }
    out.push({ kind: "p", children: parseInlines(lines.join(" ").trim()) });
  }
  return out;
}

export function inlineToText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      if (typeof node === "string") return node;
      if (node.kind === "link") return node.text;
      return inlineToText(node.children);
    })
    .join("");
}

export function visibleText(blocks: Block[]): string {
  const parts: string[] = [];
  const push = (value: string) => {
    const text = value.replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
  };
  const pushInlines = (nodes: Inline[]) => push(inlineToText(nodes));
  for (const block of blocks) {
    switch (block.kind) {
      case "h1":
      case "h2":
        push(block.text);
        break;
      case "p":
        pushInlines(block.children);
        break;
      case "ul":
        for (const item of block.items) pushInlines(item);
        break;
      case "table":
        for (const row of [block.headers, ...block.rows]) {
          for (const cell of row) pushInlines(cell);
        }
        break;
      case "faq":
        push(block.q);
        pushInlines(block.a);
        break;
      case "hr":
        break;
      default:
        break;
    }
  }
  return parts.join("\n");
}

export type FaqEntry = { q: string; a: string };

export function faqEntries(blocks: Block[]): FaqEntry[] {
  return blocks.flatMap((block) => {
    if (block.kind !== "faq") return [];
    return [{ q: block.q, a: inlineToText(block.a).replace(/\s+/g, " ").trim() }];
  });
}

export function faqPageJsonLd(faqs: FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}

export function walkLinks(blocks: Block[]): LinkInline[] {
  const out: LinkInline[] = [];
  const visit = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (typeof node === "string") continue;
      if (node.kind === "link") out.push(node);
      else visit(node.children);
    }
  };
  for (const block of blocks) {
    if (block.kind === "p") visit(block.children);
    else if (block.kind === "ul") for (const item of block.items) visit(item);
    else if (block.kind === "faq") visit(block.a);
    else if (block.kind === "table") {
      for (const row of [block.headers, ...block.rows]) {
        for (const cell of row) visit(cell);
      }
    }
  }
  return out;
}

export function demoCta(block: Block): LinkInline | null {
  if (block.kind !== "p" || block.children.length !== 1) return null;
  const only = block.children[0];
  if (typeof only === "string" || only.kind !== "bold" || only.children.length !== 1) {
    return null;
  }
  const link = only.children[0];
  if (typeof link === "string" || link.kind !== "link") return null;
  if (link.external || link.href !== "/demo") return null;
  return link;
}

/** A paragraph that is only a bold label, used as a subsection title. */
export function subsectionLabel(block: Block): string | null {
  if (block.kind !== "p" || block.children.length !== 1) return null;
  const only = block.children[0];
  if (typeof only === "string" || only.kind !== "bold" || only.children.length !== 1) {
    return null;
  }
  const text = only.children[0];
  return typeof text === "string" ? text : null;
}

export function headingId(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "section";
}
