/**
 * TOTP (RFC 6238) over node:crypto — no third-party dependency.
 *
 * The algorithm is small enough that owning it beats taking a dependency for
 * something on the authentication path. Everything here is pure and
 * synchronous; storage and policy live in mfa.ts.
 *
 * Defaults are the ones every authenticator app assumes: SHA-1, 6 digits,
 * 30-second steps. They are not "weak SHA-1" in the collision sense — HMAC-SHA1
 * is unbroken, and deviating would break Google Authenticator, 1Password, and
 * every hardware token your customers already own.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;
/**
 * Accept one step either side of now. Covers ordinary clock drift between a
 * phone and the server without widening the window enough to matter: a stolen
 * code is usable for at most ~90 seconds, and replay is blocked separately by
 * recording the last accepted step.
 */
export const TOTP_SKEW_STEPS = 1;

// ─── Base32 (RFC 4648, no padding) ──────────────────────────────
// Authenticator apps expect base32 secrets, so this is the wire format.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character in TOTP secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 20 bytes — the RFC 4226 recommendation, and what every app expects. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

// ─── Code generation ────────────────────────────────────────────

export function currentStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

/** The 6-digit code for a given counter step. */
export function codeForStep(secretBase32: string, step: number): string {
  const key = base32Decode(secretBase32);
  const counter = Buffer.alloc(8);
  // Big-endian 64-bit counter. Split across two 32-bit writes because the step
  // fits comfortably in the low word for any date we care about.
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step >>> 0, 4);

  const digest = createHmac("sha1", key).update(counter).digest();
  // Dynamic truncation, RFC 4226 §5.3.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export type VerifyResult = { ok: false } | { ok: true; step: number };

/**
 * Check a code against the window around now.
 *
 * Returns the step that matched so the caller can persist it — a code stays
 * valid for its whole 30-second window, so without recording which step was
 * used, an attacker who observes a code can replay it inside that window.
 *
 * `minStep` lets the caller refuse anything at or below the last accepted
 * step, which is what actually enforces single use.
 */
export function verifyCode(
  secretBase32: string,
  code: string,
  opts: { atMs?: number; minStep?: number | null } = {}
): VerifyResult {
  const cleaned = (code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return { ok: false };

  const now = currentStep(opts.atMs ?? Date.now());
  for (let d = -TOTP_SKEW_STEPS; d <= TOTP_SKEW_STEPS; d++) {
    const step = now + d;
    if (opts.minStep != null && step <= opts.minStep) continue; // already used
    const expected = codeForStep(secretBase32, step);
    // Constant-time: both are fixed-length ASCII digits.
    const a = Buffer.from(expected);
    const b = Buffer.from(cleaned);
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true, step };
  }
  return { ok: false };
}

/**
 * otpauth:// URI for the QR code. Issuer appears in the app's list, so it
 * wants to be the company name rather than "ForgeRP" for a tenant.
 */
export function otpauthUri(params: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account)}`;
  const q = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}
