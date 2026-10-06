import Link from "next/link";
import { MarketingShell } from "./marketing-shell";
import {
  demoCta,
  externalLinkAttrs,
  faqPageJsonLd,
  headingId,
  subsectionLabel,
  type Block,
  type Inline,
  type LinkInline,
} from "@/lib/compare/model";
import { prepareComparePage, type ComparePage } from "@/lib/compare/pages";

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        if (typeof node === "string") return <span key={index}>{node}</span>;
        if (node.kind === "bold") {
          return (
            <strong key={index} className="font-semibold text-slate-100">
              <InlineView nodes={node.children} />
            </strong>
          );
        }
        if (node.kind === "em") {
          return (
            <em key={index}>
              <InlineView nodes={node.children} />
            </em>
          );
        }
        return <TextLink key={index} link={node} />;
      })}
    </>
  );
}

function TextLink({ link }: { link: LinkInline }) {
  const className =
    "font-medium text-teal-400 underline decoration-teal-800/80 underline-offset-2 hover:text-teal-300";
  if (link.external) {
    const attrs = externalLinkAttrs(link);
    return (
      <a href={link.href} className={className} target={attrs.target} rel={attrs.rel}>
        {link.text}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <Link href={link.href} className={className}>
      {link.text}
    </Link>
  );
}

function CompareTable({
  block,
  labelledBy,
}: {
  block: Extract<Block, { kind: "table" }>;
  labelledBy?: string;
}) {
  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[44rem] border-collapse text-left" aria-labelledby={labelledBy}>
        <thead>
          <tr className="bg-slate-900/80">
            {block.headers.map((cell, index) => (
              <th
                key={index}
                scope="col"
                className="px-4 py-3 text-sm font-semibold text-slate-100"
              >
                <InlineView nodes={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-slate-800 align-top">
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th
                    key={cellIndex}
                    scope="row"
                    className="min-w-40 px-4 py-3 text-sm font-semibold text-slate-100"
                  >
                    <InlineView nodes={cell} />
                  </th>
                ) : (
                  <td
                    key={cellIndex}
                    className="min-w-64 px-4 py-3 text-sm leading-6 text-slate-300"
                  >
                    <InlineView nodes={cell} />
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function assignIds(blocks: Block[]): Map<number, string> {
  const ids = new Map<number, string>();
  const used = new Set<string>();
  blocks.forEach((block, index) => {
    const text =
      block.kind === "h1" || block.kind === "h2"
        ? block.text
        : block.kind === "faq"
          ? block.q
          : null;
    if (!text) return;
    const base = headingId(text);
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    ids.set(index, id);
  });
  return ids;
}

function Blocks({ blocks }: { blocks: Block[] }) {
  const ids = assignIds(blocks);

  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "hr") return null;
        if (block.kind === "h1") {
          return (
            <h1
              key={index}
              id={ids.get(index)}
              className="text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl"
            >
              {block.text}
            </h1>
          );
        }
        if (block.kind === "h2") {
          return (
            <h2
              key={index}
              id={ids.get(index)}
              className={`${index === 0 ? "" : "mt-14 "}scroll-mt-24 border-b border-slate-800 pb-2 text-2xl font-semibold tracking-tight text-slate-50`}
            >
              {block.text}
            </h2>
          );
        }
        if (block.kind === "table") {
          const labelledBy = ids.get(index - 1);
          return <CompareTable key={index} block={block} labelledBy={labelledBy} />;
        }
        if (block.kind === "ul") {
          return (
            <ul
              key={index}
              className="mt-4 list-disc space-y-3 pl-6 text-base leading-7 text-slate-300 marker:text-teal-400"
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <InlineView nodes={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "faq") {
          const id = ids.get(index);
          return (
            <section key={index} className="mt-8" aria-labelledby={id}>
              <h3 id={id} className="text-lg font-semibold text-slate-50">
                {block.q}
              </h3>
              <p className="mt-2 text-base leading-7 text-slate-300">
                <InlineView nodes={block.a} />
              </p>
            </section>
          );
        }
        const cta = demoCta(block);
        if (cta) {
          return (
            <p key={index} className="mt-6">
              <Link
                href={cta.href}
                className="inline-flex items-center rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-400"
              >
                {cta.text}
              </Link>
            </p>
          );
        }
        const label = subsectionLabel(block);
        if (label) {
          return (
            <h3 key={index} className="mt-8 text-lg font-semibold text-slate-50">
              {label}
            </h3>
          );
        }
        return (
          <p key={index} className="mt-4 text-base leading-7 text-slate-300">
            <InlineView nodes={block.kind === "p" ? block.children : []} />
          </p>
        );
      })}
    </>
  );
}

export function CompareArticle({ page }: { page: ComparePage }) {
  const prepared = prepareComparePage(page);
  const ruleAt = prepared.blocks.findIndex((block) => block.kind === "hr");
  const body = ruleAt === -1 ? prepared.blocks : prepared.blocks.slice(0, ruleAt);
  const cta = ruleAt === -1 ? [] : prepared.blocks.slice(ruleAt + 1);
  const jsonLd = JSON.stringify(faqPageJsonLd(prepared.faqs)).replace(/</g, "\\u003c");

  return (
    <MarketingShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <article className="mx-auto max-w-5xl px-6 py-14">
        <Blocks blocks={body} />
        {cta.length > 0 && (
          <div className="mt-14 rounded-2xl border border-slate-800 bg-slate-900/40 px-6 py-8 sm:px-8">
            <Blocks blocks={cta} />
          </div>
        )}
      </article>
    </MarketingShell>
  );
}
