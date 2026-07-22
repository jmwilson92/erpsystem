import Link from "next/link";
import { notFound } from "next/navigation";
import { getLegalDoc, LEGAL_DOCS, LEGAL_COMPANY, LAST_UPDATED } from "@/lib/legal-content";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return LEGAL_DOCS.map((d) => ({ slug: d.slug }));
}

export default async function LegalDocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = getLegalDoc(slug);
  if (!doc) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-12 text-sm leading-6 text-slate-300">
      <div>
        <Link href="/legal" className="text-xs text-teal-500 hover:underline">
          ← All legal documents
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-50">{doc.title}</h1>
        <p className="mt-1 text-xs text-slate-500">
          {LEGAL_COMPANY} · Last updated {LAST_UPDATED}
        </p>
      </div>

      {doc.sections.map((s, i) => (
        <section key={i} className="space-y-2">
          <h2 className="text-base font-semibold text-slate-100">{s.heading}</h2>
          {s.paragraphs.map((p, j) => (
            <p key={j}>{p}</p>
          ))}
        </section>
      ))}

      <p className="border-t border-slate-800 pt-4 text-xs text-slate-600">
        This document is a template and not legal advice. Have counsel review
        before relying on it.
      </p>
    </div>
  );
}
