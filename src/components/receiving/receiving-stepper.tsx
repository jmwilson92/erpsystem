import { cn } from "@/lib/utils";
import { Check, ArrowRight } from "lucide-react";

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

  const activeIdx = active ? steps.indexOf(active) : -1;
  const allDone =
    active == null &&
    steps.length > 0 &&
    steps.every((s) => completed.includes(s));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-3">
      <div className="flex flex-wrap items-center gap-0 overflow-x-auto pb-0.5">
        {steps.map((key, i) => {
          const isDone = completed.includes(key);
          const isActive = active === key;

          // Connector sits between step i-1 and step i.
          // Animate only along the path up to the active step — never past it.
          let connector: "off" | "flow" | "done" = "off";
          if (i > 0) {
            if (allDone || (isDone && activeIdx > i)) {
              // Fully behind the frontier (or trip complete)
              connector = "done";
            } else if (activeIdx >= 0 && i <= activeIdx) {
              // Path into / through active — animated line, stops here
              connector = i === activeIdx ? "flow" : "done";
            } else if (allDone) {
              connector = "done";
            } else {
              connector = "off";
            }
            // Segments strictly before active are solid “done”; into active is flow
            if (activeIdx >= 0 && i < activeIdx) connector = "done";
            if (activeIdx >= 0 && i === activeIdx) connector = "flow";
            if (allDone) connector = "done";
          }

          return (
            <div key={key} className="flex items-center">
              {i > 0 && (
                <div className="relative mx-0.5 flex w-10 shrink-0 items-center sm:mx-1 sm:w-12">
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    {connector === "flow" && (
                      <div className="flow-track absolute inset-0 rounded-full text-teal-400" />
                    )}
                    {connector === "done" && (
                      <div className="absolute inset-0 rounded-full bg-teal-500/70" />
                    )}
                  </div>
                  <ArrowRight
                    className={cn(
                      "absolute -right-1 top-1/2 h-3 w-3 -translate-y-1/2",
                      connector === "off"
                        ? "text-slate-600"
                        : "text-teal-500/80"
                    )}
                  />
                </div>
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
