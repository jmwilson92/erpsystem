/**
 * Air-gapped / on-premise mode (AIRGAP=1).
 *
 * For an ITAR or CUI deployment the product claim is that nothing leaves the
 * customer's boundary. That claim is worth nothing if it rests on remembering
 * not to configure things, so this module enforces it two ways:
 *
 *  1. Features that reach a third party are switched off (see the guards below).
 *  2. Boot fails outright if an external integration is configured, rather than
 *     starting and leaking on the first address keystroke or outbound email.
 *
 * Deliberately fail-closed and deliberately loud. A customer's security officer
 * can read the boot log and see the mode asserted; a silent fallback would leave
 * them trusting a claim nobody verified.
 *
 * This does NOT make a deployment compliant. Compliance is a property of the
 * customer's whole environment, assessed by their C3PAO. This makes the
 * software's own behaviour defensible and demonstrable, which is the part we own.
 */

/** True when this deployment must make no third-party network request. */
export function airgapEnabled(): boolean {
  return process.env.AIRGAP === "1";
}

/**
 * Environment variables that, if set, mean traffic would leave the boundary.
 *
 * Keyed by the service so the boot error can name what to remove. Kept in one
 * place so adding an integration forces a decision about air-gapped mode rather
 * than quietly punching a hole in it.
 */
export const EXTERNAL_INTEGRATION_ENV: Record<string, readonly string[]> = {
  "Resend (outbound email)": ["RESEND_API_KEY"],
  "Stripe (billing)": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  "xAI / Grok (assistant + text-to-speech)": ["XAI_API_KEY", "GROK_API_KEY"],
  "Plaid (bank feeds)": ["PLAID_CLIENT_ID", "PLAID_SECRET"],
  "Vercel Analytics": ["VERCEL_ANALYTICS_ID"],
};

/**
 * Which configured integrations conflict with air-gapped mode.
 * Returns [] when the environment is clean (or when AIRGAP is off).
 */
export function conflictingIntegrations(): { service: string; vars: string[] }[] {
  if (!airgapEnabled()) return [];
  const found: { service: string; vars: string[] }[] = [];
  for (const [service, vars] of Object.entries(EXTERNAL_INTEGRATION_ENV)) {
    const set = vars.filter((v) => {
      const val = process.env[v];
      return typeof val === "string" && val.trim().length > 0;
    });
    if (set.length > 0) found.push({ service, vars: set });
  }
  return found;
}

/**
 * Third-party address type-ahead (OpenStreetMap Photon).
 *
 * Off in air-gapped mode. This one matters more than it looks: it fired on every
 * keystroke of a customer address, so it was the most casual CUI egress in the
 * app. The address field keeps working — it degrades to a plain textarea.
 */
export function geocodingEnabled(): boolean {
  return !airgapEnabled();
}

/** Product analytics ship to a third party, so they are off on-premise. */
export function analyticsEnabled(): boolean {
  return !airgapEnabled();
}

/**
 * Hostnames the built client bundle must never contain in air-gapped mode.
 *
 * Used by scripts/assert-airgap-build.mjs so a future import cannot quietly
 * reintroduce egress. Server-side hosts (Resend, Stripe, Plaid, xAI) are
 * covered by the boot assertion instead — they are unreachable without keys,
 * and their strings legitimately appear in server code.
 */
export const FORBIDDEN_CLIENT_HOSTS = [
  "photon.komoot.io",
  "cdn.plaid.com",
  "vitals.vercel-insights.com",
  "va.vercel-scripts.com",
] as const;
