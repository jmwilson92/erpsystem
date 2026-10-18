import { headers } from "next/headers";

/**
 * Base URL for Stripe success/cancel redirects.
 * APP_URL wins. Otherwise use the request the browser is actually on, so
 * preview hosts and custom domains return to the right place.
 */
export async function requestAppUrl(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const referer = h.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* ignore */
    }
  }
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}
