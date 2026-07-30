#!/usr/bin/env node
/**
 * Fail the build if the client bundle can reach a third party.
 *
 * The air-gapped claim is only as good as the shipped JavaScript. A guard that
 * lives in a code review is a guard that lasts until the next hurried import, so
 * this greps the built client chunks for hostnames that must not be there and
 * exits non-zero if it finds one.
 *
 * Client bundles only. Server-side hosts (Resend, Stripe, Plaid, xAI) legitimately
 * appear in server code and are unreachable without their keys — air-gapped mode
 * refuses to boot when those keys are set, which is enforced in
 * src/lib/airgap.ts and asserted in src/instrumentation.ts.
 *
 * IMPORTANT: this must run against an AIRGAP=1 build. A hosted build legitimately
 * ships va.vercel-scripts.com and cdn.plaid.com, so running it after a normal
 * `npm run build` fails by design. Use `npm run verify:airgap`, which builds and
 * checks as one step so the two cannot drift apart.
 *
 * Usage:
 *   npm run verify:airgap                          # build + check (do this)
 *   node scripts/assert-airgap-build.mjs --list     # show what it scanned
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

// Kept in sync with FORBIDDEN_CLIENT_HOSTS in src/lib/airgap.ts. Duplicated
// rather than imported because this runs as plain node against a built tree,
// with no TypeScript loader available.
const FORBIDDEN = [
  "photon.komoot.io",
  "cdn.plaid.com",
  "vitals.vercel-insights.com",
  "va.vercel-scripts.com",
];

const CLIENT_DIRS = [".next/static"];

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(js|mjs|css)$/.test(entry)) out.push(p);
  }
  return out;
}

const files = CLIENT_DIRS.flatMap(walk);

if (files.length === 0) {
  console.error(
    "assert-airgap-build: no client bundle found under .next/static — run `npm run build` first."
  );
  process.exit(1);
}

if (process.argv.includes("--list")) {
  console.log(`scanned ${files.length} client files`);
}

const hits = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const host of FORBIDDEN) {
    if (src.includes(host)) hits.push({ file: f, host });
  }
}

if (hits.length > 0) {
  console.error("");
  console.error("══════════════════════════════════════════════════════════════");
  console.error("  FAIL: third-party hosts found in the client bundle");
  console.error("");
  for (const h of hits) console.error(`    ${h.host}  in  ${h.file}`);
  console.error("");
  console.error("  An air-gapped deployment must not ship code that can call");
  console.error("  out. Proxy it through a server route that honours");
  console.error("  geocodingEnabled()/airgapEnabled(), the way /api/geocode does.");
  console.error("══════════════════════════════════════════════════════════════");
  console.error("");
  process.exit(1);
}

console.log(
  `assert-airgap-build: ok — none of ${FORBIDDEN.length} forbidden hosts in ${files.length} client files`
);
