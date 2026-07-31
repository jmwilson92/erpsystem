/**
 * Offline licensing for on-premise installs.
 *
 * An air-gapped site cannot phone home, so a license has to be a self-contained
 * artifact the deployment can check by itself: a small JSON payload signed with
 * an Ed25519 key we hold, verified against a public key compiled into the build.
 *
 * WHAT THIS IS AND IS NOT. Local enforcement is a clear contractual line and a
 * speed bump, not DRM. Anyone with the container image can patch this file out.
 * That is true of every on-premise licensing scheme, and pretending otherwise
 * leads to hostile designs that punish honest customers for a determined party's
 * benefit. The value here is that running past expiry becomes an unambiguous,
 * deliberate act rather than something that happens by drift.
 *
 * Enforcement is deliberately gentle and then firm:
 *   valid            → nothing happens
 *   expiring soon    → warned at boot and in the app
 *   expired, grace   → warned harder; everything still works
 *   past grace       → the server refuses to start
 *
 * Refusing to START, rather than blocking writes at runtime, is a deliberate
 * choice. Blocking writes would mean intercepting server actions in middleware,
 * which this codebase already knows returns HTML to a `next-action` POST and
 * surfaces as "an unexpected response was received from the server" — a broken
 * ERP with a confusing error is worse for a manufacturer than a stopped one with
 * a clear log line. A stopped container is diagnosable in seconds.
 *
 * The grace window exists because a shop's ERP going dark stops production, and
 * the most likely cause of an expired license is an invoice sitting in someone's
 * inbox — not piracy.
 */

/**
 * Ed25519 public key (base64 SPKI DER) that licenses are verified against.
 *
 * Empty means licensing is not enforced — the hosted SaaS and local development,
 * where a license would be meaningless. Run `npm run license:keygen` and paste
 * the printed public key here; keep the private key off this machine and out of
 * this repository.
 *
 * Compiled in rather than read from the environment on purpose: an environment
 * variable can be overridden at `docker run`, which would let anyone substitute
 * their own key and sign themselves a license.
 */
export const LICENSE_PUBLIC_KEY = "";

/** Days a deployment keeps running after expiry before it refuses to start. */
function graceDays(): number {
  const n = Number(process.env.LICENSE_GRACE_DAYS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
}

/** How long before expiry the warnings start. */
const WARN_WITHIN_DAYS = 30;

export type LicensePayload = {
  /** Who it was issued to. Shown in the app so an admin can confirm it. */
  customer: string;
  /** ISO date. */
  issued: string;
  /** ISO date. Enforcement hangs off this. */
  expires: string;
  /** Free-form tier label — informational, not enforced. */
  plan?: string;
  notes?: string;
};

export type LicenseState =
  /** No public key compiled in — hosted SaaS or development. */
  | "not_required"
  /** Required, but LICENSE_KEY is unset. */
  | "missing"
  /** Malformed, or the signature does not verify. */
  | "invalid"
  | "ok"
  /** Expired, still inside the grace window. */
  | "grace"
  /** Past expiry + grace. The server will not start. */
  | "expired";

export type LicenseStatus = {
  state: LicenseState;
  payload: LicensePayload | null;
  /** Negative once expired. Null when there is no valid payload. */
  daysLeft: number | null;
  /** Set for missing/invalid/expired — safe to show an admin. */
  reason: string | null;
  /** True while valid but close enough to expiry to warn. */
  warn: boolean;
};

const DAY_MS = 86_400_000;

/** Stable key order so the bytes signed and the bytes verified always match. */
export function canonicalPayload(p: LicensePayload): string {
  return JSON.stringify({
    customer: p.customer,
    expires: p.expires,
    issued: p.issued,
    notes: p.notes ?? "",
    plan: p.plan ?? "",
  });
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function licenseRequired(): boolean {
  return LICENSE_PUBLIC_KEY.trim().length > 0;
}

/**
 * Read and check the configured license. Never throws — a licensing bug must not
 * be the thing that takes down a customer's ERP, so every failure resolves to a
 * state the caller can reason about.
 *
 * Async because node:crypto is imported lazily rather than at module scope.
 * Next compiles instrumentation.ts for the EDGE runtime as well as Node, and
 * webpack traces imports statically — so a top-level `node:crypto` fails the
 * build with "Reading from node:crypto is not handled by plugins" no matter what
 * runtime guard sits in front of it. Importing inside the function keeps this
 * module edge-safe and only loads crypto where it can actually run.
 */
export async function getLicenseStatus(
  now: Date = new Date()
): Promise<LicenseStatus> {
  const none = { payload: null, daysLeft: null, warn: false };

  if (!licenseRequired()) {
    return { state: "not_required", reason: null, ...none };
  }

  const token = process.env.LICENSE_KEY?.trim();
  if (!token) {
    return {
      state: "missing",
      reason: "LICENSE_KEY is not set.",
      ...none,
    };
  }

  let payload: LicensePayload;
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) throw new Error("expected <payload>.<signature>");

    const json = b64urlDecode(body).toString("utf8");
    payload = JSON.parse(json) as LicensePayload;
    if (!payload?.customer || !payload?.expires) {
      throw new Error("missing customer or expires");
    }

    const { verify: verifySignature, createPublicKey } = await import(
      "node:crypto"
    );
    const key = createPublicKey({
      key: Buffer.from(LICENSE_PUBLIC_KEY, "base64"),
      format: "der",
      type: "spki",
    });
    // Verified over the CANONICAL form, not the transmitted bytes: re-serialising
    // means a payload edited in transit cannot verify even if it round-trips
    // through JSON with different key order or spacing.
    const ok = verifySignature(
      null,
      Buffer.from(canonicalPayload(payload), "utf8"),
      key,
      b64urlDecode(sig)
    );
    if (!ok) throw new Error("signature does not verify");
  } catch (e) {
    return {
      state: "invalid",
      reason: `License is not valid: ${e instanceof Error ? e.message : String(e)}`,
      ...none,
    };
  }

  const expires = new Date(`${payload.expires}T23:59:59Z`);
  if (Number.isNaN(expires.getTime())) {
    return {
      state: "invalid",
      reason: `License expiry "${payload.expires}" is not a date.`,
      ...none,
    };
  }

  const daysLeft = Math.ceil((expires.getTime() - now.getTime()) / DAY_MS);

  if (daysLeft >= 0) {
    return {
      state: "ok",
      payload,
      daysLeft,
      reason: null,
      warn: daysLeft <= WARN_WITHIN_DAYS,
    };
  }

  const graceLeft = graceDays() + daysLeft;
  if (graceLeft >= 0) {
    return {
      state: "grace",
      payload,
      daysLeft,
      reason:
        `License for ${payload.customer} expired ${-daysLeft} day(s) ago. ` +
        `This deployment stops starting in ${graceLeft} day(s).`,
      warn: true,
    };
  }

  return {
    state: "expired",
    payload,
    daysLeft,
    reason:
      `License for ${payload.customer} expired on ${payload.expires}, ` +
      `beyond the ${graceDays()}-day grace period.`,
    warn: true,
  };
}

/**
 * A single line describing the licensing posture, for the boot log.
 *
 * Stated on every start so an operator can see it in `docker logs` without
 * knowing where to look — the same reason air-gapped mode announces itself.
 */
export function licenseBootLine(s: LicenseStatus): string {
  switch (s.state) {
    case "not_required":
      return "[protessera] licensing not enforced on this build";
    case "ok":
      return s.warn
        ? `[protessera] WARNING: license for ${s.payload?.customer} expires in ${s.daysLeft} day(s)`
        : `[protessera] licensed to ${s.payload?.customer} until ${s.payload?.expires}`;
    case "grace":
      return `[protessera] WARNING: ${s.reason}`;
    default:
      return `[protessera] ${s.reason}`;
  }
}
