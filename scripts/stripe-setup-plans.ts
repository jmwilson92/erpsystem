/**
 * Create Protessera's subscription products + prices in Stripe.
 * Amounts come from src/lib/services/subscription-plans.ts. Idempotent:
 * re-running reuses an existing price with the same lookup_key.
 *
 *   npx tsx scripts/stripe-setup-plans.ts           # create + print price IDs
 *   npx tsx scripts/stripe-setup-plans.ts --write   # also write them into .env
 *
 * Reads STRIPE_SECRET_KEY from the environment or .env. Use sk_test_ first.
 *
 * Standard prices (year two+) keep their existing lookup keys so current
 * subscribers are not given a new price:
 *   Shop $30/seat/month, Starter $3,600/year, Growth $8,400/year, Business $18,000/year.
 *
 * First-year prices (new checkouts only):
 *   Shop graduated monthly: $10 for the first seat, $2 for each additional seat.
 *   Starter $250/year, Growth $500/year, Business $1,000/year.
 */
import fs from "fs";
import path from "path";
import {
  PLANS,
  STRIPE_FIRST_YEAR_PRICE_ENV,
  STRIPE_LOOKUP_KEYS,
  STRIPE_STANDARD_PRICE_ENV,
  firstYearPeriodPriceForPlan,
  getPlan,
  priceCents,
} from "../src/lib/services/subscription-plans";

const root = process.cwd();
const envPath = path.join(root, ".env");
const env: Record<string, string | undefined> = { ...process.env };
try {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* .env optional */
}

const sk = env.STRIPE_SECRET_KEY;
if (!sk) {
  console.error("✗ STRIPE_SECRET_KEY not set in .env — add your sk_test_ key first.");
  process.exit(1);
}

type PriceSpec = {
  key: string;
  name: string;
  envKey: string;
  lookupKey: string;
  interval: "month" | "year";
  blurb: string;
  perSeat: boolean;
  /** Flat unit amount in cents. Omitted for the graduated Shop first-year price. */
  unitAmount?: number;
  graduated?: { firstUnitCents: number; additionalUnitCents: number };
};

function specs(): PriceSpec[] {
  const out: PriceSpec[] = [];
  for (const plan of PLANS) {
    if (plan.pricing === "custom") continue;
    const standardEnv = STRIPE_STANDARD_PRICE_ENV[plan.key];
    const introEnv = STRIPE_FIRST_YEAR_PRICE_ENV[plan.key];
    const standardLookup =
      STRIPE_LOOKUP_KEYS[plan.key as keyof typeof STRIPE_LOOKUP_KEYS];
    const introLookup =
      STRIPE_LOOKUP_KEYS[`${plan.key}_FIRST_YEAR` as keyof typeof STRIPE_LOOKUP_KEYS];
    out.push({
      key: plan.key,
      name: `Protessera ${plan.name}`,
      envKey: standardEnv,
      lookupKey: standardLookup,
      interval: plan.interval,
      blurb: `${plan.blurb} Standard price after year one.`,
      perSeat: plan.pricing === "per_seat",
      unitAmount: priceCents(plan.pricing === "per_seat" ? (plan.pricePerSeat ?? 0) : plan.price),
    });
    const intro = getPlan(plan.key)!;
    if (plan.pricing === "per_seat") {
      out.push({
        key: `${plan.key}_FIRST_YEAR`,
        name: `Protessera ${plan.name}`,
        envKey: introEnv,
        lookupKey: introLookup,
        interval: "month",
        blurb: `First year: $${intro.firstYearPrice} for the first user and $${intro.firstYearAdditionalPerSeat} for each additional user per month.`,
        perSeat: true,
        graduated: {
          firstUnitCents: priceCents(intro.firstYearPrice ?? 0),
          additionalUnitCents: priceCents(intro.firstYearAdditionalPerSeat ?? 0),
        },
      });
    } else {
      out.push({
        key: `${plan.key}_FIRST_YEAR`,
        name: `Protessera ${plan.name}`,
        envKey: introEnv,
        lookupKey: introLookup,
        interval: "year",
        blurb: `First year ${plan.name}: $${firstYearPeriodPriceForPlan(plan.key)} , then $${plan.price}/year.`,
        perSeat: false,
        unitAmount: priceCents(intro.firstYearPrice ?? 0),
      });
    }
  }
  return out;
}

const api = async (
  method: string,
  pth: string,
  params?: Record<string, string | undefined>
) => {
  const body =
    params &&
    new URLSearchParams(
      Object.entries(params).filter((entry): entry is [string, string] => entry[1] != null)
    ).toString();
  const r = await fetch(`https://api.stripe.com/v1${pth}`, {
    method,
    headers: {
      Authorization: `Bearer ${sk}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json?.error?.message || `Stripe ${r.status}`);
  return json as {
    id?: string;
    data?: { id: string; product: string; unit_amount: number | null; billing_scheme?: string; tiers?: { up_to: number | null; unit_amount: number | null }[] }[];
    product?: string;
    unit_amount?: number | null;
    billing_scheme?: string;
    tiers?: { up_to: number | null; unit_amount: number | null }[];
  };
};

if (!sk.startsWith("sk_test_")) {
  console.log("⚠  Using a LIVE key — this creates real products. Ctrl-C to abort.\n");
}

const results: Record<string, string> = {};
const productByPlan: Record<string, string> = {};

for (const plan of specs()) {
  const existing = await api(
    "GET",
    `/prices?active=true&lookup_keys[]=${encodeURIComponent(plan.lookupKey)}&limit=1&expand[]=data.tiers`
  );
  let price = existing.data?.[0];

  if (price) {
    const label = plan.graduated
      ? `graduated $${plan.graduated.firstUnitCents / 100} + $${plan.graduated.additionalUnitCents / 100}`
      : `$${(plan.unitAmount ?? 0) / 100}/${plan.interval === "month" ? "mo" : "yr"}`;
    console.log(`= ${plan.key}: reusing ${price.id} (${label})`);
    if (plan.graduated) {
      const tiers = price.tiers ?? [];
      const ok =
        price.billing_scheme === "tiered" &&
        tiers[0]?.up_to === 1 &&
        tiers[0]?.unit_amount === plan.graduated.firstUnitCents &&
        (tiers[1]?.up_to == null) &&
        tiers[1]?.unit_amount === plan.graduated.additionalUnitCents;
      if (!ok) {
        console.log(
          `  ⚠  ${plan.lookupKey} does not match the catalog tiers. Stripe prices are immutable — archive it and rerun if the amount is wrong.`
        );
      }
    } else if (price.unit_amount !== plan.unitAmount) {
      console.log(
        `  ⚠  ${plan.lookupKey} is $${(price.unit_amount ?? 0) / 100}, catalog expects $${(plan.unitAmount ?? 0) / 100}. Stripe prices are immutable — archive it and rerun if the amount is wrong.`
      );
    }
    const baseKey = plan.key.replace(/_FIRST_YEAR$/, "");
    if (typeof price.product === "string") productByPlan[baseKey] = price.product;
  } else {
    const baseKey = plan.key.replace(/_FIRST_YEAR$/, "");
    let productId = productByPlan[baseKey];
    if (!productId) {
      const product = await api("POST", "/products", {
        name: plan.name,
        description: plan.blurb,
        "metadata[forgerp_plan]": baseKey,
        "metadata[per_seat]": plan.perSeat ? "1" : "0",
      });
      if (!product.id) throw new Error(`Stripe did not return a product for ${plan.key}`);
      productId = product.id;
    }
    if (!productId) throw new Error(`No Stripe product for ${plan.key}`);
    productByPlan[baseKey] = productId;

    const params: Record<string, string | undefined> = {
      product: productId,
      currency: "usd",
      "recurring[interval]": plan.interval,
      lookup_key: plan.lookupKey,
      "metadata[forgerp_plan]": baseKey,
      "metadata[per_seat]": plan.perSeat ? "1" : "0",
      "metadata[first_year]": plan.key.endsWith("_FIRST_YEAR") ? "1" : "0",
    };
    if (plan.graduated) {
      params.billing_scheme = "tiered";
      params.tiers_mode = "graduated";
      params["tiers[0][up_to]"] = "1";
      params["tiers[0][unit_amount]"] = String(plan.graduated.firstUnitCents);
      params["tiers[1][up_to]"] = "inf";
      params["tiers[1][unit_amount]"] = String(plan.graduated.additionalUnitCents);
    } else {
      params.unit_amount = String(plan.unitAmount);
    }
    const created = await api("POST", "/prices", params);
    price = { id: created.id!, product: productId, unit_amount: plan.unitAmount ?? null };
    const label = plan.graduated
      ? `graduated $${plan.graduated.firstUnitCents / 100} + $${plan.graduated.additionalUnitCents / 100}/mo`
      : `$${(plan.unitAmount ?? 0) / 100}/${plan.interval === "month" ? "mo" : "yr"}`;
    console.log(`+ ${plan.key}: created ${created.id} (${label})`);
  }
  if (price?.id) results[plan.envKey] = price.id;
}

const block = Object.entries(results)
  .map(([k, v]) => `${k}=${v}`)
  .join("\n");
console.log("\n── Add these to your .env ──\n" + block + "\n");

if (process.argv.includes("--write")) {
  let content = "";
  try {
    content = fs.readFileSync(envPath, "utf8");
  } catch {
    /* new file */
  }
  for (const [envKey, id] of Object.entries(results)) {
    const line = `${envKey}=${id}`;
    const re = new RegExp(`^\\s*#?\\s*${envKey}=.*$`, "m");
    content = re.test(content)
      ? content.replace(re, line)
      : content.replace(/\n?$/, `\n${line}\n`);
  }
  fs.writeFileSync(envPath, content);
  console.log("✓ Wrote the price IDs into .env");
}
