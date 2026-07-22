import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { qualityComplianceSummary } from "@/lib/services/quality-programs";
import { ShieldCheck, AlertTriangle, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function QualityProgramsHub() {
  const programs = await qualityComplianceSummary();
  const totalOverdue = programs.reduce((s, p) => s + p.overdue, 0);
  const totalDueSoon = programs.reduce((s, p) => s + p.dueSoon, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quality Programs (QMS)"
        description="Calibration, tool control, HAZMAT, ESD, FOD, safety, training, audits, and counterfeit-parts prevention — one place, with recurring-due tracking."
      />

      <div className="flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-1.5 text-rose-300">
          <AlertTriangle className="h-4 w-4" /> {totalOverdue} overdue
        </span>
        <span className="flex items-center gap-1.5 text-amber-300">
          <Clock className="h-4 w-4" /> {totalDueSoon} due soon
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {programs.map((p) => {
          const tone =
            p.overdue > 0
              ? "border-rose-500/40"
              : p.dueSoon > 0
                ? "border-amber-500/40"
                : "border-slate-800";
          return (
            <Link key={p.key} href={`/quality/programs/${p.key}`}>
              <Card className={`h-full transition-colors hover:border-teal-500/50 ${tone}`}>
                <CardContent className="p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="font-medium text-slate-100">{p.name}</p>
                    <ShieldCheck className="h-4 w-4 text-teal-400" />
                  </div>
                  <p className="text-xs text-slate-400">{p.description}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded border border-slate-700 px-2 py-0.5 text-slate-400">
                      {p.total} {p.itemNoun.toLowerCase()}(s)
                    </span>
                    {p.overdue > 0 && (
                      <span className="rounded border border-rose-500/40 px-2 py-0.5 text-rose-300">
                        {p.overdue} overdue
                      </span>
                    )}
                    {p.dueSoon > 0 && (
                      <span className="rounded border border-amber-500/40 px-2 py-0.5 text-amber-300">
                        {p.dueSoon} due soon
                      </span>
                    )}
                    {p.overdue === 0 && p.dueSoon === 0 && p.total > 0 && (
                      <span className="rounded border border-emerald-500/40 px-2 py-0.5 text-emerald-300">
                        compliant
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
