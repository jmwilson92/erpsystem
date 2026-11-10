import { planPriceView } from "@/lib/services/subscription-plans";

/**
 * First-year price, with the standard price after year one on the next line.
 * Amounts come from the plan catalog — do not pass dollar strings in.
 */
export function PlanPriceBlock({
  planKey,
  seats,
  foundingMember = false,
  className = "",
  amountClassName = "text-3xl font-bold",
  suffixClassName = "text-sm font-medium text-slate-500",
  detailClassName = "mt-1 text-xs text-slate-500",
}: {
  planKey: string;
  /** Shop only. Omit to show the $10 + $2 formula and the 10-user example. */
  seats?: number;
  foundingMember?: boolean;
  className?: string;
  amountClassName?: string;
  suffixClassName?: string;
  detailClassName?: string;
}) {
  const view = planPriceView(planKey, seats == null ? undefined : { seats });
  if (foundingMember) {
    if (view.primarySuffix.includes("first year")) view.primarySuffix = planKey.toUpperCase() === "SHOP" ? "/mo · founding rate" : "/year · founding rate";
    view.note = view.note?.replace("in the first year", "for life") ?? null;
    if (view.afterYearOne) view.afterYearOne = "These recurring rates are locked for life.";
  }
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
