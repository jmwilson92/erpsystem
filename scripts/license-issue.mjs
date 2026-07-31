#!/usr/bin/env node
/**
 * Issue a signed licence for an on-premise customer.
 *
 *   node scripts/license-issue.mjs --customer "Acme Machining" --months 12
 *   node scripts/license-issue.mjs --customer "Acme" --expires 2027-06-30 --plan enterprise
 *
 * Prints a LICENSE_KEY the customer puts in their .env. Nothing is stored here —
 * re-run it to reissue, and keep your own record of who has what.
 *
 * Requires the private key from scripts/license-keygen.mjs.
 */
import { createPrivateKey, sign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i < 0 ? undefined : process.argv[i + 1];
}

const KEY_FILE = process.env.LICENSE_KEY_FILE || "license-signing-key.pem";
const customer = arg("--customer");
const plan = arg("--plan") || "onprem";
const notes = arg("--notes") || "";
const months = Number(arg("--months") || 12);
const expiresArg = arg("--expires");

if (!customer) {
  console.error(`
usage: node scripts/license-issue.mjs --customer "Name" [--months 12 | --expires YYYY-MM-DD]
                                      [--plan onprem] [--notes "PO 1234"]
`);
  process.exit(1);
}

if (!existsSync(KEY_FILE)) {
  console.error(
    `\n${KEY_FILE} not found. Run: node scripts/license-keygen.mjs\n` +
      `(or set LICENSE_KEY_FILE if your key lives elsewhere)\n`
  );
  process.exit(1);
}

const iso = (d) => d.toISOString().slice(0, 10);

let expires;
if (expiresArg) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresArg)) {
    console.error(`--expires must be YYYY-MM-DD, got "${expiresArg}"`);
    process.exit(1);
  }
  expires = expiresArg;
} else {
  if (!Number.isFinite(months) || months <= 0) {
    console.error(`--months must be a positive number, got "${months}"`);
    process.exit(1);
  }
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + months);
  expires = iso(d);
}

// An already-expired licence is almost certainly a typo, and the customer would
// hit a grace-period warning on day one. Say so rather than issue it.
if (new Date(`${expires}T23:59:59Z`) <= new Date()) {
  console.error(`\nExpiry ${expires} is in the past. Nothing would accept this.\n`);
  process.exit(1);
}

const payload = {
  customer,
  issued: iso(new Date()),
  expires,
  plan,
  notes,
};

/** Must match canonicalPayload() in src/lib/services/license.ts, key for key. */
const canonical = JSON.stringify({
  customer: payload.customer,
  expires: payload.expires,
  issued: payload.issued,
  notes: payload.notes ?? "",
  plan: payload.plan ?? "",
});

const key = createPrivateKey(readFileSync(KEY_FILE));
const signature = sign(null, Buffer.from(canonical, "utf8"), key);

const b64url = (b) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const token = `${b64url(canonical)}.${b64url(signature)}`;

console.log(`
Licence issued
──────────────
  Customer : ${customer}
  Plan     : ${plan}
  Issued   : ${payload.issued}
  Expires  : ${expires}${notes ? `\n  Notes    : ${notes}` : ""}

Give the customer this line for their .env:

LICENSE_KEY=${token}

They restart with:  docker compose -f docker-compose.release.yml up -d
`);
