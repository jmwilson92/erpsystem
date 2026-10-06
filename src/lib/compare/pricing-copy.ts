/**
 * Price and trial phrases for the comparison pages.
 * Every dollar amount is read from the plan catalog. The surrounding words
 * stay the approved copy.
 */
import {
  TRIAL_DAYS,
  firstYearBillingCycles,
  formatPlanMoney,
  getPlan,
  shopFirstYearMonthly,
  type PlanDef,
} from "../services/subscription-plans";

const EN_DASH = "\u2013";

function plan(key: string): PlanDef {
  const found = getPlan(key);
  if (!found) throw new Error(`Missing plan ${key}`);
  return found;
}

function money(amount: number | null | undefined): string {
  if (amount == null) throw new Error("Missing plan price");
  return formatPlanMoney(amount);
}

/** Starter names the unit; Growth and Business keep the approved shorter form. */
function flatAnnualClause(): string {
  const starter = plan("STARTER");
  const growth = plan("GROWTH");
  const business = plan("BUSINESS");
  return [
    `${starter.name} (up to ${starter.maxSeats} users) is ${money(starter.firstYearPrice)} for the first year, then ${money(starter.price)}/yr`,
    `${growth.name} (up to ${growth.maxSeats}) is ${money(growth.firstYearPrice)}, then ${money(growth.price)}/yr`,
    `${business.name} (up to ${business.maxSeats}) is ${money(business.firstYearPrice)}, then ${money(business.price)}/yr`,
  ].join(". ");
}

/** Protessera cell in the comparison-table pricing row. */
export function pricingTableCell(): string {
  const shop = plan("SHOP");
  const min = shop.minSeats;
  const max = shop.maxSeats;
  const first = money(shop.firstYearPrice);
  const extra = money(shop.firstYearAdditionalPerSeat);
  const standard = money(shop.pricePerSeatMonthly);
  return `Published. Shop plan (${min}${EN_DASH}${max} users): first year ${first}/month for the first user + ${extra}/month per additional user, then ${standard}/user/month. Flat annual plans for larger teams, with a lower first-year price`;
}

/** Sentence that follows "Pricing is published…" in Setup and pricing. */
export function pricingSetupSentence(): string {
  const shop = plan("SHOP");
  const min = shop.minSeats;
  const max = shop.maxSeats;
  const first = money(shop.firstYearPrice);
  const extra = money(shop.firstYearAdditionalPerSeat);
  const standard = money(shop.pricePerSeatMonthly);
  const atMax = money(shopFirstYearMonthly(max ?? 10));
  const months = firstYearBillingCycles("SHOP");
  const enterpriseMin = (plan("BUSINESS").maxSeats ?? 0) + 1;
  return `The Shop plan (${min}${EN_DASH}${max} users) costs **${first} a month for the first user plus ${extra} a month for each additional user** for the first ${months} months, so ${atMax} a month at ${max} users. After that it's **${standard} per user per month**. Larger teams pay a flat annual price: ${flatAnnualClause()}. Enterprise (${enterpriseMin}+ users, including self-hosting) is quoted. Every paid plan includes the full product; tiers differ by seat count, not by locked modules.`;
}

/** Shared price answer inside both pricing FAQs. */
export function pricingFaqLead(): string {
  const shop = plan("SHOP");
  const min = shop.minSeats;
  const max = shop.maxSeats;
  const first = money(shop.firstYearPrice);
  const extra = money(shop.firstYearAdditionalPerSeat);
  const standard = money(shop.pricePerSeatMonthly);
  const atMax = money(shopFirstYearMonthly(max ?? 10));
  return `The Shop plan (${min}${EN_DASH}${max} users) is ${first} a month for the first user plus ${extra} a month per additional user for the first year (${atMax} a month at ${max} users), then ${standard} per user per month. Flat annual plans for larger teams also have a lower first-year price.`;
}

export function materializeCompareCopy(raw: string): string {
  return raw
    .replaceAll("{{PRICING_TABLE}}", pricingTableCell())
    .replaceAll("{{PRICING_SETUP}}", pricingSetupSentence())
    .replaceAll("{{PRICING_FAQ}}", pricingFaqLead())
    .replaceAll("{{TRIAL_DAYS}}", String(TRIAL_DAYS));
}
