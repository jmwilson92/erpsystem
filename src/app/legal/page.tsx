import Link from "next/link";
import { LEGAL_DOCS, LEGAL_COMPANY, LAST_UPDATED } from "@/lib/legal-content";
import { FileText, ArrowRight } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export const dynamic = "force-dynamic";

export default function LegalHubPage() {
  return (
    <MarketingShell>
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-12 text-slate-300">
      <div>
        <h1 className="text-2xl font-bold text-slate-50">
          {LEGAL_COMPANY} — Legal &amp; Compliance
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          The agreements and policies governing the hosted service. Last updated{" "}
          {LAST_UPDATED}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {LEGAL_DOCS.map((doc) => (
          <Link
            key={doc.slug}
            href={`/legal/${doc.slug}`}
            className="group flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 hover:border-teal-500/50"
          >
            <div className="flex gap-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-teal-400" />
              <div>
                <p className="font-medium text-slate-100">{doc.title}</p>
                <p className="mt-0.5 text-xs text-slate-400">{doc.summary}</p>
              </div>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-600 group-hover:text-teal-400" />
          </Link>
        ))}
      </div>

      <p className="border-t border-slate-800 pt-4 text-xs text-slate-600">
        <Link href="/login" className="text-teal-500 hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </div>
    </MarketingShell>
  );
}
