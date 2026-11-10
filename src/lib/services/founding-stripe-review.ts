/** Review suggestions only. Never cancel/release/update a Stripe object here. */
export function reviewFounderStripeState(input: {
  introPrice?: string; standardPrice?: string;
  subscription: { schedule?: string | { id?: string } | null; metadata?: Record<string, string> | null; items?: { data?: { price?: string | { id?: string }; quantity?: number }[] } };
  schedule?: { status?: string; phases?: { items?: { price?: string | { id?: string }; quantity?: number }[] }[] };
}) {
  const id = (price?: string | { id?: string }) => typeof price === "string" ? price : price?.id;
  const prices = input.subscription.items?.data?.map(i => id(i.price)) ?? [];
  const scheduleId = typeof input.subscription.schedule === "string" ? input.subscription.schedule : input.subscription.schedule?.id;
  const actions: string[] = [];
  if (input.subscription.metadata?.foundingMember !== "1") actions.push("OPTIONAL_SET_FOUNDING_METADATA");
  if (!input.introPrice || prices.length !== 1 || prices[0] !== input.introPrice) {
    actions.push(input.standardPrice && prices.length === 1 && prices[0] === input.standardPrice ? "REVIEW_MOVE_STANDARD_TO_FIRST_YEAR_PRICE" : "MANUAL_PRICE_REVIEW");
  }
  if (scheduleId) {
    const movesToStandard = input.standardPrice && input.schedule?.phases?.some(p => p.items?.some(i => id(i.price) === input.standardPrice));
    actions.push(movesToStandard ? "REVIEW_RELEASE_INTRO_SCHEDULE" : "MANUAL_SCHEDULE_REVIEW");
  }
  if (!scheduleId && prices.length === 1 && prices[0] === input.introPrice) actions.push("KEEP_CURRENT_RECURRING_PRICE");
  return { currentPriceIds: prices, scheduleId: scheduleId ?? null, scheduleStatus: input.schedule?.status ?? null, actions };
}
