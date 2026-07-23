import Link from "next/link";
import { Clock, AlertTriangle } from "lucide-react";
import { PLANS } from "@/lib/services/subscription";

/**
 * Trial countdown shown at the top of every page while on a free trial. The day
 * count is recomputed server-side on every load, so it ticks down day by day.
 * Calm blue with a week+ left, amber inside a week, red in the final two days.
 *
 * When a paid plan is already selected with a card on file (self-serve signup),
 * there's nothing to pick — it auto-charges at trial end — so we show when the
 * charge lands and a "Manage billing" link (cancel/change) instead of "pick a
 * plan". The in-app beta trial (no plan chosen yet) still prompts to pick one.
 */
export function TrialBanner({
  daysLeft,
  plan,
  provider,
  endsAt,
}: {
  daysLeft: number;
  plan?: string | null;
  provider?: string | null;
  endsAt?: string | null;
}) {
  const urgent = daysLeft <= 2;
  const warn = daysLeft <= 7;

  const tone = urgent
    ? "border-rose-500/50 bg-rose-500/10 text-rose-200"
    : warn
      ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
      : "border-sky-500/40 bg-sky-500/10 text-sky-200";
  const Icon = urgent ? AlertTriangle : Clock;

  const planDef = PLANS.find((p) => p.key === plan && p.key !== "ENTERPRISE");
  const planChosen = provider === "stripe" && !!planDef;
  const chargeDate = endsAt
    ? new Date(endsAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const label =
    daysLeft <= 0
      ? "Your trial ends today"
      : daysLeft === 1
        ? "1 day left in your trial"
        : `${daysLeft} days left in your trial`;

  const sub = planChosen
    ? urgent
      ? `Your ${planDef!.name} plan begins${chargeDate ? ` ${chargeDate}` : " soon"} — cancel before then to avoid the charge.`
      : `You're on the ${planDef!.name} plan${chargeDate ? `; billing begins ${chargeDate}` : ""}. No charge until then.`
    : urgent
      ? "Add a plan now to keep your data and access."
      : "Enjoying ForgeRP? Pick a plan any time.";

  return (
    <div
      className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 ${tone}`}
    >
      <p className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4 shrink-0" />
        <span>
          <span className="font-semibold">{label}.</span> {sub}
        </span>
      </p>
      <Link
        href="/billing"
        className="rounded-lg border border-current px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
      >
        {planChosen ? "Manage billing" : "Choose a plan"}
      </Link>
    </div>
  );
}
