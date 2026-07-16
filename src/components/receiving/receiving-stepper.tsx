import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export type StepKey = "DOCK" | "QA" | "TEST" | "PUTAWAY" | "STOCKED";

export function ReceivingStepper({
  steps,
  active,
  completed,
}: {
  /** Ordered steps that apply to this traveler (skip QA/Test if not needed). */
  steps: StepKey[];
  active: StepKey | null;
  completed: StepKey[];
}) {
  const labels: Record<StepKey, string> = {
    DOCK: "Dock",
    QA: "QA",
    TEST: "Test",
    PUTAWAY: "Put away",
    STOCKED: "Stocked",
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-3">
      <div className="flex flex-wrap items-center gap-1 sm:gap-0">
        {steps.map((key, i) => {
          const isDone = completed.includes(key);
          const isActive = active === key;
          return (
            <div key={key} className="flex items-center">
              {i > 0 && (
                <div
                  className={cn(
                    "mx-1 hidden h-0.5 w-6 sm:block",
                    isDone || isActive ? "bg-teal-500/60" : "bg-slate-700"
                  )}
                />
              )}
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  isDone &&
                    "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
                  isActive &&
                    !isDone &&
                    "border-teal-500/50 bg-teal-500/15 text-teal-200 animate-pulse-soft",
                  !isDone &&
                    !isActive &&
                    "border-slate-700 bg-slate-950/50 text-slate-500"
                )}
              >
                {isDone ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <span className="font-mono text-[10px] opacity-70">
                    {i + 1}
                  </span>
                )}
                {labels[key]}
              </div>
            </div>
          );
        })}
      </div>
      {(active === "QA" || active === "TEST") && (
        <p className="mt-2 text-[11px] text-amber-200/80">
          Tests do not free inventory — put away only after pass, back at the
          dock.
        </p>
      )}
    </div>
  );
}
