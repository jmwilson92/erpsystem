import Link from "next/link";
import { Clock, AlertTriangle } from "lucide-react";

/**
 * Trial countdown shown at the top of every page while the instance is on a
 * free trial. Calm blue with a week+ left, amber inside a week, red in the
 * final two days.
 */
export function TrialBanner({ daysLeft }: { daysLeft: number }) {
  const urgent = daysLeft <= 2;
  const warn = daysLeft <= 7;

  const tone = urgent
    ? "border-rose-500/50 bg-rose-500/10 text-rose-200"
    : warn
      ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
      : "border-sky-500/40 bg-sky-500/10 text-sky-200";
  const Icon = urgent ? AlertTriangle : Clock;

  const label =
    daysLeft <= 0
      ? "Your trial ends today"
      : daysLeft === 1
        ? "1 day left in your trial"
        : `${daysLeft} days left in your trial`;

  return (
    <div
      className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 ${tone}`}
    >
      <p className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4 shrink-0" />
        <span>
          <span className="font-semibold">{label}.</span>{" "}
          {urgent
            ? "Add a plan now to keep your data and access."
            : "Enjoying ForgeRP? Pick a plan any time."}
        </span>
      </p>
      <Link
        href="/billing"
        className="rounded-lg border border-current px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
      >
        Choose a plan
      </Link>
    </div>
  );
}
