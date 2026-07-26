/**
 * Carina AI rate limits — abuse protection for free surfaces only.
 *
 * Paid ERP (APP / TENANT): no cap. AI cost is baked into the annual plan.
 * Landing / marketing / bare demo splash: tight limit so guests can't burn tokens.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult =
  | { ok: true; remaining: number | null }
  | { ok: false; retryAfterSec: number; message: string };

function take(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  if (b.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return {
      ok: false,
      retryAfterSec,
      message: `Demo AI limit reached. Try again in about ${Math.ceil(retryAfterSec / 60)} minute(s), or start a paid ForgeRP plan for unlimited plant AI.`,
    };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count };
}

/**
 * @param source LANDING | MARKETING | DEMO | APP | TENANT
 */
export function checkCarinaRateLimit(params: {
  source?: string | null;
  userId?: string | null;
  guestKey?: string | null;
}): RateLimitResult {
  const source = (params.source || "APP").toUpperCase();

  // Paying / in-product ERP — unlimited (cost in plan price)
  if (source === "APP" || source === "TENANT") {
    return { ok: true, remaining: null };
  }

  // Free public surfaces only
  if (
    source === "DEMO" ||
    source === "LANDING" ||
    source === "MARKETING"
  ) {
    const id = params.guestKey || params.userId || "anon";
    // ~20 turns / hour / browser is enough to try Carina without wallet drain
    return take(`public:${id}`, 20, 60 * 60 * 1000);
  }

  // Unknown source — treat as free surface to be safe
  const id = params.guestKey || params.userId || "anon";
  return take(`other:${id}`, 20, 60 * 60 * 1000);
}
