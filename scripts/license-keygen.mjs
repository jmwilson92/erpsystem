#!/usr/bin/env node
/**
 * Generate the Ed25519 signing key for offline licences. Run this ONCE.
 *
 *   node scripts/license-keygen.mjs
 *
 * Prints a public key to paste into src/lib/services/license.ts, and writes the
 * private key to a file this repository ignores.
 *
 * THE PRIVATE KEY IS THE WHOLE SCHEME. Anyone holding it can issue themselves a
 * perpetual licence. Keep it off shared machines, out of git, and backed up
 * somewhere you will still have in two years — losing it means every future
 * licence has to be re-signed under a new key, which means a new build, which
 * means every existing customer needs a new image.
 *
 * Refuses to overwrite an existing key file. Regenerating would invalidate every
 * licence already issued, and doing that silently is not a mistake worth
 * allowing.
 */
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const OUT = process.env.LICENSE_KEY_FILE || "license-signing-key.pem";

if (existsSync(OUT)) {
  console.error(
    `\n${OUT} already exists. Refusing to overwrite it.\n\n` +
      `Regenerating invalidates every licence already issued. If you truly want a\n` +
      `new key, move the old one aside deliberately first.\n`
  );
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

writeFileSync(OUT, privateKey.export({ type: "pkcs8", format: "pem" }), {
  mode: 0o600,
});

const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");

console.log(`
Key generated.

  Private key -> ${OUT}   (mode 600, gitignored)

  BACK THIS UP somewhere off this machine. Without it you cannot issue or renew
  a licence for anyone.

Paste this into src/lib/services/license.ts and commit it:

  export const LICENSE_PUBLIC_KEY = "${pub}";

The public key is compiled into the build on purpose — read from an environment
variable it could be swapped at "docker run" for one the customer holds the
private half of.

Then issue a licence:

  node scripts/license-issue.mjs --customer "Acme Machining" --months 12
`);
