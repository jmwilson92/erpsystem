import { PageHeader } from "@/components/shared/page-header";
import { TOURS } from "@/lib/guides";
import { GuideLauncher } from "@/components/guides/guide-launcher";
import { Compass } from "lucide-react";

export const dynamic = "force-dynamic";

export default function GuidesPage() {
  const byCategory = TOURS.reduce<Record<string, typeof TOURS>>((acc, t) => {
    (acc[t.category] ||= []).push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="Guides & interactive tours"
        description="Step-by-step walkthroughs that spotlight the screen and explain what to do — and why. Turn on the speaker to have them read aloud."
      />

      {Object.entries(byCategory).map(([category, tours]) => (
        <div key={category}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            <Compass className="h-4 w-4 text-teal-400" />
            {category}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tours.map((t) => (
              <div
                key={t.id}
                className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/50 p-4"
              >
                <div>
                  <p className="font-medium text-slate-100">{t.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{t.description}</p>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    {t.steps.length} steps · ~{t.minutes} min
                  </span>
                  <GuideLauncher tourId={t.id} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
