/**
 * Create ForgeRP's subscription products + annual prices in Stripe, matching
 * the app's plan tiers exactly. Idempotent: re-running reuses existing prices
 * (matched by lookup_key) instead of duplicating them.
 *
 *   node scripts/stripe-setup-plans.mjs           # create + print price IDs
 *   node scripts/stripe-setup-plans.mjs --write   # also write them into .env
 *
 * Reads STRIPE_SECRET_KEY from .env. Use your sk_test_ key for the sandbox.
 */
import fs from "fs";
import path from "path";

const root = process.cwd();
const envPath = path.join(root, ".env");
const env = { ...process.env };
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

// Mirrors PLANS in src/lib/services/subscription.ts (amounts in cents).
const PLANS = [
  { key: "STARTER", name: "ForgeRP Starter", amount: 360000, envKey: "STRIPE_PRICE_STARTER", blurb: "Full ERP, single site, up to 30 users" },
  { key: "GROWTH", name: "ForgeRP Growth", amount: 840000, envKey: "STRIPE_PRICE_GROWTH", blurb: "Priority support, up to 50 users" },
  { key: "BUSINESS", name: "ForgeRP Business", amount: 1800000, envKey: "STRIPE_PRICE_BUSINESS", blurb: "Multi-site + custom modules, up to 150 users" },
];

const api = async (method, pth, params) => {
  const body =
    params &&
    new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
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
  return json;
};

if (!sk.startsWith("sk_test_")) {
  console.log("⚠  Using a LIVE key — this creates real products. Ctrl-C to abort.\n");
}

const results = {};
for (const plan of PLANS) {
  const lookupKey = `forgerp_${plan.key.toLowerCase()}_annual`;

  // Reuse an existing price with this lookup_key if present.
  const existing = await api("GET", `/prices?active=true&lookup_keys[]=${lookupKey}&limit=1`);
  let price = existing.data?.[0];

  if (price) {
    console.log(`= ${plan.key}: reusing ${price.id} ($${(price.unit_amount / 100).toLocaleString()}/yr)`);
  } else {
    const product = await api("POST", "/products", {
      name: plan.name,
      description: plan.blurb,
      "metadata[forgerp_plan]": plan.key,
    });
    price = await api("POST", "/prices", {
      product: product.id,
      unit_amount: String(plan.amount),
      currency: "usd",
      "recurring[interval]": "year",
      lookup_key: lookupKey,
      "metadata[forgerp_plan]": plan.key,
    });
    console.log(`+ ${plan.key}: created ${price.id} ($${(plan.amount / 100).toLocaleString()}/yr)`);
  }
  results[plan.envKey] = price.id;
}

const block = PLANS.map((p) => `${p.envKey}=${results[p.envKey]}`).join("\n");
console.log("\n── Add these to your .env ──\n" + block + "\n");

if (process.argv.includes("--write")) {
  let content = "";
  try { content = fs.readFileSync(envPath, "utf8"); } catch { /* new file */ }
  for (const p of PLANS) {
    const line = `${p.envKey}=${results[p.envKey]}`;
    const re = new RegExp(`^\\s*#?\\s*${p.envKey}=.*$`, "m");
    content = re.test(content) ? content.replace(re, line) : content.replace(/\n?$/, `\n${line}\n`);
  }
  fs.writeFileSync(envPath, content);
  console.log("✓ Wrote the price IDs into .env");
}
