import { planPriceView } from "@/lib/services/subscription-plans";

/**
 * First-year price, with the standard price after year one on the next line.
 * Amounts come from the plan catalog — do not pass dollar strings in.
 */
export function PlanPriceBlock({
  planKey,
  seats,
  className = "",
  amountClassName = "text-3xl font-bold",
  suffixClassName = "text-sm font-medium text-slate-500",
  detailClassName = "mt-1 text-xs text-slate-500",
}: {
  planKey: string;
  /** Shop only. Omit to show the $10 + $2 formula and the 10-user example. */
  seats?: number;
  className?: string;
  amountClassName?: string;
  suffixClassName?: string;
  detailClassName?: string;
}) {
  const view = planPriceView(planKey, seats == null ? undefined : { seats });
  return (
    <div className={className}>
      <p>
        <span className={amountClassName}>{view.primaryAmount}</span>
        {view.primarySuffix ? (
          <span className={suffixClassName}>{view.primarySuffix}</span>
        ) : null}
      </p>
      {view.note ? <p className={detailClassName}>{view.note}</p> : null}
      {view.afterYearOne ? (
        <p className={detailClassName}>{view.afterYearOne}</p>
      ) : null}
    </div>
  );
}
