/** Explicitly invoked READ-ONLY review. No --apply mode, no POST/DELETE methods.
 * Run only after approval to read the relevant Stripe account and after the DB backfill.
 * Outputs object IDs/rates, never API keys, customer emails, or raw Stripe objects.
 */
import "dotenv/config";
import { Pool } from "pg";
import { STRIPE_FIRST_YEAR_PRICE_ENV, STRIPE_STANDARD_PRICE_ENV } from "../src/lib/services/subscription-plans";
import { reviewFounderStripeState } from "../src/lib/services/founding-stripe-review";
import { assertCheckoutCurrent } from "./lib/assert-current.mjs";

async function main() {
  assertCheckoutCurrent(["prisma/schema.prisma", "src/lib/tenant-template.ts"], "Founding Stripe review");
  if (process.argv.includes("--apply")) throw new Error("This tool is read-only. Stripe changes require separate approval.");
  if (!process.env.STRIPE_SECRET_KEY || !(process.env.DIRECT_URL || process.env.DATABASE_URL)) throw new Error("Secure database and Stripe read credentials must already be configured");
  const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, max: 1 });
  async function get(path: string) {
    const response = await fetch(`https://api.stripe.com/v1${path}`, { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
    if (!response.ok) throw new Error(`Stripe read failed (${response.status}); response withheld`);
    return response.json();
  }
  try {
    const rows = (await pool.query<{ schemaName: string; plan: string | null; stripeSubscriptionId: string | null }>(`SELECT "schemaName", "plan", "stripeSubscriptionId" FROM "public"."Tenant" WHERE "foundingMember"=true AND "isDemo"=false AND "status"<>'DESTROYED'`)).rows;
    const dogfood = (await pool.query<{ plan: string; stripeSubscriptionId: string | null }>(`SELECT "plan", "stripeSubscriptionId" FROM "public"."CompanySettings" WHERE "id"='default' AND "foundingMember"=true`)).rows[0];
    if (dogfood) rows.push({ ...dogfood, schemaName: "public" });
    const seen = new Set<string>();
    for (const row of rows) {
      const sid = row.stripeSubscriptionId;
      if (!sid) continue;
      if (!/^sub_[a-zA-Z0-9]+$/.test(sid) || sid.startsWith("sub_sched")) { console.log(JSON.stringify({ schema: row.schemaName, action: "MANUAL_SUBSCRIPTION_ID_REVIEW" })); continue; }
      if (seen.has(sid)) continue;
      seen.add(sid);
      const sub = await get(`/subscriptions/${sid}`);
      const scheduleId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id;
      if (scheduleId && !/^sub_sched_[a-zA-Z0-9]+$/.test(scheduleId)) throw new Error("Unexpected schedule identifier");
      const schedule = scheduleId ? await get(`/subscription_schedules/${scheduleId}`) : undefined;
      const plan = row.plan?.toUpperCase() ?? sub.metadata?.plan;
      const introEnv = STRIPE_FIRST_YEAR_PRICE_ENV[plan];
      const standardEnv = STRIPE_STANDARD_PRICE_ENV[plan];
      console.log(JSON.stringify({ schema: row.schemaName, subscriptionId: sid, plan, ...reviewFounderStripeState({ subscription: sub, schedule, introPrice: introEnv ? process.env[introEnv] : undefined, standardPrice: standardEnv ? process.env[standardEnv] : undefined }) }));
    }
  } finally { await pool.end(); }
}
main().catch(() => { console.error("Founding Stripe review failed; credential/customer details withheld. Verify configuration and migration status."); process.exitCode = 1; });
