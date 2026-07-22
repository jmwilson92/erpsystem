/**
 * Verify Plaid + Stripe integration config against the sandbox/test APIs.
 * Reads .env (no dependency), never prints secret values.
 *
 *   node scripts/verify-integrations.mjs      (or: npm run verify:keys)
 */
import fs from "fs";
import path from "path";

const root = process.cwd();
const env = { ...process.env };
for (const f of [".env", ".env.local"]) {
  try {
    for (const line of fs.readFileSync(path.join(root, f), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* file optional */
  }
}

const mask = (v) =>
  !v ? "MISSING" : v.length <= 12 ? "set" : `${v.slice(0, 8)}…${v.slice(-4)}`;
const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const warn = (s) => `\x1b[33m⚠\x1b[0m  ${s}`;

console.log("── Config presence (values masked) ──");
for (const k of [
  "PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_STARTER", "STRIPE_PRICE_GROWTH", "STRIPE_PRICE_BUSINESS",
  "APP_URL",
]) {
  console.log(`  ${k.padEnd(24)} ${env[k] ? mask(env[k]) : "MISSING"}`);
}

async function checkStripe() {
  const sk = env.STRIPE_SECRET_KEY;
  console.log("\n── Stripe ──");
  if (!sk) return console.log(warn("STRIPE_SECRET_KEY not set — checkout falls back to in-app activation"));
  const get = async (p) => {
    const r = await fetch(`https://api.stripe.com/v1${p}`, {
      headers: { Authorization: `Bearer ${sk}` },
    });
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
  };
  const acct = await get("/account");
  if (!acct.ok) return console.log(bad(`key rejected (${acct.status}): ${acct.json?.error?.message || ""}`));
  console.log(ok("secret key valid"));
  console.log(sk.startsWith("sk_test_") ? ok("test mode") : warn("LIVE key — use sk_test_ for sandbox"));
  for (const [label, key, expect] of [
    ["Starter", "STRIPE_PRICE_STARTER", 360000],
    ["Growth", "STRIPE_PRICE_GROWTH", 840000],
    ["Business", "STRIPE_PRICE_BUSINESS", 1800000],
  ]) {
    const id = env[key];
    if (!id) { console.log(bad(`${label}: ${key} MISSING`)); continue; }
    const p = await get(`/prices/${id}`);
    if (!p.ok) { console.log(bad(`${label}: price ${id} not found (${p.status})`)); continue; }
    const amt = p.json.unit_amount;
    const rec = p.json.recurring?.interval;
    const parts = [`$${(amt / 100).toLocaleString()}/${rec || "one-time"}`];
    let good = p.json.active && rec === "year";
    if (rec !== "year") parts.push("(not yearly ⚠)");
    if (!p.json.active) parts.push("(inactive ⚠)");
    if (amt !== expect) parts.push(`(expected $${(expect / 100).toLocaleString()})`);
    console.log((good ? ok : warn)(`${label}: ${parts.join(" ")}`));
  }
  console.log(env.STRIPE_WEBHOOK_SECRET
    ? ok("webhook secret set")
    : warn("STRIPE_WEBHOOK_SECRET not set — run: stripe listen --forward-to localhost:3000/api/stripe/webhook"));
}

async function checkPlaid() {
  console.log("\n── Plaid ──");
  const id = env.PLAID_CLIENT_ID, secret = env.PLAID_SECRET;
  const host = { sandbox: "https://sandbox.plaid.com", development: "https://development.plaid.com", production: "https://production.plaid.com" }[
    (env.PLAID_ENV || "sandbox").toLowerCase()
  ] || "https://sandbox.plaid.com";
  if (!id || !secret) return console.log(warn("PLAID_CLIENT_ID / PLAID_SECRET not set — Bank Connections disabled"));
  const r = await fetch(`${host}/institutions/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: id, secret, count: 1, offset: 0, country_codes: ["US"] }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok) console.log(ok(`credentials valid (${env.PLAID_ENV || "sandbox"})`));
  else console.log(bad(`rejected (${r.status}): ${j.error_message || j.error_code || ""}`));
}

await checkStripe();
await checkPlaid();
console.log("");
