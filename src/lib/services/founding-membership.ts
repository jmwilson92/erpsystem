/** March 9, 2027 is PST (UTC−8); DST starts March 14 that year.
 * Exclusive boundary includes the entire 23:59 minute, not just 23:59:00.
 */
export const FOUNDING_CUTOFF_EXCLUSIVE = "2027-03-10T08:00:00.000Z";
export const FOUNDING_OFFER_LABEL = "March 9, 2027, 11:59 PM PT";

export function qualifiesForFounding(start: Date): boolean {
  const time = start.getTime();
  return Number.isFinite(time) && time > 0 && time < Date.parse(FOUNDING_CUTOFF_EXCLUSIVE);
}

export type FoundingMembership = { foundingMember: boolean; foundingQualifiedAt?: Date };
export function foundingMembership(start: Date): FoundingMembership {
  return qualifiesForFounding(start)
    ? { foundingMember: true, foundingQualifiedAt: start }
    : { foundingMember: false };
}

/** Stripe timestamps/metadata are read server-side, never from customer form inputs. */
export function subscriptionFoundingMembership(subscription: {
  created?: number;
  metadata?: Record<string, string> | null;
}, existing?: FoundingMembership): FoundingMembership {
  const raw = subscription.metadata?.foundingQualifiedAt;
  const qualified = raw ? new Date(raw) : undefined;
  const started = typeof subscription.created === "number" ? new Date(subscription.created * 1000) : undefined;
  const foundingMember = existing?.foundingMember === true || subscription.metadata?.foundingMember === "1" || !!(started && qualifiesForFounding(started));
  return {
    foundingMember,
    foundingQualifiedAt: existing?.foundingQualifiedAt ?? (qualified && qualifiesForFounding(qualified) ? qualified : started && qualifiesForFounding(started) ? started : undefined),
  };
}

/** Sticky grants: absence/false in a later webhook must never revoke a founder. */
export function foundingGrant(membership: FoundingMembership) {
  return membership.foundingMember ? {
    foundingMember: true as const,
    ...(membership.foundingQualifiedAt ? { foundingQualifiedAt: membership.foundingQualifiedAt } : {}),
  } : {};
}
