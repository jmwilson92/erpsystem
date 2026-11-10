import type { ReactNode } from "react";
import { parseDocContent, safeDocHref, type DocNode } from "@/lib/docs/content";

/** React-only rendering of validated JSON. No stored HTML or dangerouslySetInnerHTML. */
function node(n: DocNode, key: number): ReactNode {
  if (n.type === "text") {
    let text: ReactNode = n.text ?? "";
    for (const [i, mark] of (n.marks ?? []).entries()) {
      const k = `${key}-${i}`;
      switch (mark.type) {
        case "bold": text = <strong key={k}>{text}</strong>; break;
        case "italic": text = <em key={k}>{text}</em>; break;
        case "strike": text = <s key={k}>{text}</s>; break;
        case "underline": text = <u key={k}>{text}</u>; break;
        case "code": text = <code key={k}>{text}</code>; break;
        case "link": text = <a key={k} href={safeDocHref(mark.attrs?.href) ?? "#"} target="_blank" rel="noopener noreferrer">{text}</a>; break;
      }
    }
    return <span key={key}>{text}</span>;
  }
  const children = n.content?.map(node);
  switch (n.type) {
    case "doc": return <div key={key}>{children}</div>;
    case "paragraph": return <p key={key}>{children ?? <br />}</p>;
    case "heading": return Number(n.attrs?.level) === 1 ? <h1 key={key}>{children}</h1> : Number(n.attrs?.level) === 3 ? <h3 key={key}>{children}</h3> : <h2 key={key}>{children}</h2>;
    case "bulletList": return <ul key={key}>{children}</ul>;
    case "orderedList": return <ol key={key} start={Number(n.attrs?.start) || 1}>{children}</ol>;
    case "listItem": return <li key={key}>{children}</li>;
    case "blockquote": return <blockquote key={key}>{children}</blockquote>;
    case "codeBlock": return <pre key={key}><code>{children}</code></pre>;
    case "hardBreak": return <br key={key} />;
    case "horizontalRule": return <hr key={key} />;
    default: return null;
  }
}
export function DocContent({ content }: { content: string }) {
  return <div className="docs-prose">{node(parseDocContent(content), 0)}</div>;
}
