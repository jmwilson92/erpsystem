#!/usr/bin/env node
/**
 * Validates production environment posture.
 * Usage:
 *   node scripts/assert-production-env.mjs           # enforce (exit 1 on fail)
 *   node scripts/assert-production-env.mjs --dry-run  # CI: only check script loads
 */
const dryRun = process.argv.includes("--dry-run");

function fail(msg) {
  console.error(`assert-production-env: ${msg}`);
  process.exit(1);
}

if (dryRun) {
  console.log("assert-production-env: dry-run ok");
  process.exit(0);
}

const nodeEnv = process.env.NODE_ENV || "development";
if (nodeEnv !== "production") {
  console.log(
    `assert-production-env: NODE_ENV=${nodeEnv} — skip (not production)`
  );
  process.exit(0);
}

if (process.env.DEMO_MODE !== "0" && process.env.ALLOW_DEMO_IN_PRODUCTION !== "1") {
  fail("DEMO_MODE must be 0 in production (or set ALLOW_DEMO_IN_PRODUCTION=1)");
}

if (process.env.SEED_ON_FIRST_BOOT === "1") {
  console.warn(
    "assert-production-env: WARNING SEED_ON_FIRST_BOOT=1 — demo data may load on first boot"
  );
}

if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL is required");
}

console.log("assert-production-env: production posture ok");
