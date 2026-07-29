/**
 * Multi-factor authentication — enrolment, verification, recovery.
 *
 * NIST SP 800-171 3.5.3 wants MFA for privileged accounts and for network
 * access generally; it is also the first question on every security
 * questionnaire a B2B buyer sends. This is TOTP: no SMS (SIM-swappable, and
 * NIST deprecated it as a restricted authenticator), no email codes (the
 * mailbox is usually the thing being protected).
 *
 * Two rules this module keeps:
 *  1. **A half-finished enrolment never gates a login.** The credential only
 *     counts once the user has proved they can produce a code, so scanning a
 *     QR and closing the tab can't lock anyone out of their own ERP.
 *  2. **A code is single-use.** TOTP codes stay valid for their whole window,
 *     so the accepted step is recorded and anything at or below it is refused.
 */
import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma, controlPlaneClient, clientForSchema } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { generateSecret, otpauthUri, verifyCode } from "./totp";
import { isMissingTableError } from "@/lib/services/module-health";

/** How long a passed password check waits for its second factor. */
const CHALLENGE_MINUTES = 5;
/** Wrong codes allowed against one challenge before it's burned. */
const MAX_CHALLENGE_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;

// ─── Secret encryption ──────────────────────────────────────────

/**
 * A TOTP secret can't be hashed — verifying a code means regenerating it, so
 * the plaintext has to be recoverable. Encrypting it means a dumped database
 * on its own doesn't let anyone mint valid codes; the key lives in the
 * environment, not the database.
 */
function encryptionKey(): Buffer {
  const raw = process.env.MFA_SECRET_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      "MFA_SECRET_KEY is not set (or is too short). Set a long random value in the environment before enabling MFA — without it, second-factor secrets cannot be stored safely."
    );
  }
  // Derive a fixed 32 bytes so any passphrase works. The salt is constant
  // because the input is already high-entropy secret material, not a password.
  return scryptSync(raw, "forgerp.mfa.v1", 32);
}

/** True when the environment can store secrets — lets the UI explain itself. */
export function mfaConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  // iv.tag.ciphertext — versioned so the format can change later.
  return `v1.${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${enc.toString("hex")}`;
}

function decryptSecret(stored: string): string {
  const [v, ivHex, tagHex, dataHex] = stored.split(".");
  if (v !== "v1") throw new Error("Unrecognised MFA secret format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

// ─── Recovery codes ─────────────────────────────────────────────

function hashCode(code: string): string {
  return createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");
}

/** Human-transcribable: no 0/O/1/I, grouped for reading aloud. */
function makeRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = () =>
    Array.from(randomBytes(5))
      .map((b) => alphabet[b % alphabet.length])
      .join("");
  return `${pick()}-${pick()}`;
}

// ─── Enrolment ──────────────────────────────────────────────────

export type EnrolStart = { secret: string; uri: string; alreadyEnabled: boolean };

/**
 * Begin enrolment. Creates (or replaces) an unconfirmed credential and hands
 * back the secret for the QR code. Nothing changes about how the user logs in
 * until confirmEnrolment succeeds.
 */
export async function startEnrolment(params: {
  userId: string;
  account: string;
  issuer: string;
}): Promise<EnrolStart> {
  const existing = await prisma.mfaCredential.findUnique({
    where: { userId: params.userId },
  });
  if (existing?.confirmedAt) {
    return { secret: "", uri: "", alreadyEnabled: true };
  }

  const secret = generateSecret();
  const secretEnc = encryptSecret(secret);
  await prisma.mfaCredential.upsert({
    where: { userId: params.userId },
    create: { userId: params.userId, secretEnc },
    update: { secretEnc, confirmedAt: null, lastStep: null },
  });

  return {
    secret,
    uri: otpauthUri({ secret, account: params.account, issuer: params.issuer }),
    alreadyEnabled: false,
  };
}

/**
 * Finish enrolment by proving the authenticator works. Returns the recovery
 * codes — the only time they are ever visible, since they're stored hashed.
 */
export async function confirmEnrolment(params: {
  userId: string;
  code: string;
}): Promise<{ ok: boolean; recoveryCodes?: string[]; error?: string }> {
  const cred = await prisma.mfaCredential.findUnique({
    where: { userId: params.userId },
  });
  if (!cred) return { ok: false, error: "Start enrolment first" };
  if (cred.confirmedAt) return { ok: false, error: "Already enabled" };

  const result = verifyCode(decryptSecret(cred.secretEnc), params.code, {
    minStep: cred.lastStep,
  });
  if (!result.ok) return { ok: false, error: "That code isn't right — check your app's clock and try the current code" };

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, makeRecoveryCode);
  await prisma.mfaCredential.update({
    where: { id: cred.id },
    data: {
      confirmedAt: new Date(),
      lastStep: result.step,
      recoveryCodes: {
        deleteMany: {},
        create: codes.map((c) => ({ codeHash: hashCode(c) })),
      },
    },
  });
  await logAudit({
    entityType: "User",
    entityId: params.userId,
    action: "MFA_ENABLED",
    userId: params.userId,
  });
  return { ok: true, recoveryCodes: codes };
}

/**
 * Turn MFA off. Requires a current code or a recovery code — otherwise anyone
 * who walks up to an unlocked screen can strip the second factor off.
 */
export async function disableMfa(params: {
  userId: string;
  code: string;
}): Promise<{ ok: boolean; error?: string }> {
  const cred = await prisma.mfaCredential.findUnique({
    where: { userId: params.userId },
    include: { recoveryCodes: true },
  });
  if (!cred) return { ok: true };

  const accepted = await consumeFactor(cred, params.code);
  if (!accepted.ok) return { ok: false, error: "Enter a current code from your authenticator, or a recovery code" };

  await prisma.mfaCredential.delete({ where: { id: cred.id } });
  await logAudit({
    entityType: "User",
    entityId: params.userId,
    action: "MFA_DISABLED",
    userId: params.userId,
  });
  return { ok: true };
}

export type MfaStatus = {
  enabled: boolean;
  pending: boolean;
  recoveryRemaining: number;
  /**
   * Why MFA can't be used here, or null when it can. Two very different
   * problems with two very different fixes — collapsing them into one boolean
   * told tenants to set an environment variable when the real issue was that
   * their schema hadn't been migrated.
   */
  unavailable: null | "no_key" | "not_migrated";
};

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  const base = { enabled: false, pending: false, recoveryRemaining: 0 };

  // Check the key first: it's cheap, and it's the answer that applies to the
  // whole deployment rather than this one schema.
  if (!mfaConfigured()) return { ...base, unavailable: "no_key" };

  try {
    const cred = await prisma.mfaCredential.findUnique({
      where: { userId },
      include: { recoveryCodes: { where: { usedAt: null } } },
    });
    return {
      enabled: !!cred?.confirmedAt,
      pending: !!cred && !cred.confirmedAt,
      recoveryRemaining: cred?.recoveryCodes.length ?? 0,
      unavailable: null,
    };
  } catch (e) {
    if (isMissingTableError(e)) return { ...base, unavailable: "not_migrated" };
    throw e;
  }
}

// ─── Verification ───────────────────────────────────────────────

type CredWithCodes = {
  id: string;
  secretEnc: string;
  lastStep: number | null;
  recoveryCodes: { id: string; codeHash: string; usedAt: Date | null }[];
};

/**
 * Accept either a TOTP code or an unused recovery code, and burn whichever was
 * used. Shared by login, disable, and any future step-up check so the
 * single-use rules can't drift apart between call sites.
 */
type MfaWriter = Pick<PrismaClient, "mfaCredential" | "mfaRecoveryCode">;

async function consumeFactor(
  cred: CredWithCodes,
  code: string,
  db: MfaWriter = prisma
): Promise<{ ok: boolean; usedRecovery?: boolean }> {
  const totp = verifyCode(decryptSecret(cred.secretEnc), code, {
    minStep: cred.lastStep,
  });
  if (totp.ok) {
    await db.mfaCredential.update({
      where: { id: cred.id },
      data: { lastStep: totp.step },
    });
    return { ok: true };
  }

  const wanted = hashCode(code);
  for (const rc of cred.recoveryCodes) {
    if (rc.usedAt) continue;
    const a = Buffer.from(rc.codeHash);
    const b = Buffer.from(wanted);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      await db.mfaRecoveryCode.update({
        where: { id: rc.id },
        data: { usedAt: new Date() },
      });
      return { ok: true, usedRecovery: true };
    }
  }
  return { ok: false };
}

// ─── Login challenge ────────────────────────────────────────────

/** Does this account need a second factor? */
export async function requiresMfa(
  userId: string,
  schema: string | null
): Promise<boolean> {
  const db = schema ? clientForSchema(schema) : controlPlaneClient();
  const cred = await db.mfaCredential
    .findUnique({ where: { userId }, select: { confirmedAt: true } })
    .catch(() => null); // table missing on an unmigrated schema → no MFA
  return !!cred?.confirmedAt;
}

/**
 * Park a passed password check and hand back a one-time token. The token is
 * returned in plaintext to the caller (to put in a cookie) and stored only as
 * a hash, so the table is useless to anyone who reads it.
 */
export async function createChallenge(params: {
  userId: string;
  schema: string | null;
  userAgent?: string;
}): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await controlPlaneClient().mfaChallenge.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      userId: params.userId,
      schemaName: params.schema,
      userAgent: params.userAgent ?? null,
      expiresAt: new Date(Date.now() + CHALLENGE_MINUTES * 60_000),
    },
  });
  return token;
}

export type ChallengeResult =
  | { ok: true; userId: string; schema: string | null; userAgent: string | null }
  | { ok: false; error: string };

/**
 * Verify the second factor against a parked challenge. Consumes the challenge
 * on success, and burns it after too many wrong codes so an attacker holding
 * a stolen password can't sit and grind six digits.
 */
export async function verifyChallenge(params: {
  token: string;
  code: string;
}): Promise<ChallengeResult> {
  const cp = controlPlaneClient();
  const tokenHash = createHash("sha256").update(params.token).digest("hex");
  const challenge = await cp.mfaChallenge.findUnique({ where: { tokenHash } });

  if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
    return { ok: false, error: "That sign-in attempt expired — start again" };
  }
  if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
    return { ok: false, error: "Too many attempts — start again" };
  }

  const db = challenge.schemaName
    ? clientForSchema(challenge.schemaName)
    : controlPlaneClient();
  const cred = await db.mfaCredential.findUnique({
    where: { userId: challenge.userId },
    include: { recoveryCodes: true },
  });
  if (!cred?.confirmedAt) {
    // MFA was turned off between the two steps — nothing left to check.
    await cp.mfaChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    return {
      ok: true,
      userId: challenge.userId,
      schema: challenge.schemaName,
      userAgent: challenge.userAgent,
    };
  }

  const accepted = await consumeFactor(cred, params.code, db);
  if (!accepted.ok) {
    await cp.mfaChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    const left = MAX_CHALLENGE_ATTEMPTS - (challenge.attempts + 1);
    return {
      ok: false,
      error:
        left > 0
          ? `That code isn't right — ${left} attempt${left === 1 ? "" : "s"} left`
          : "Too many attempts — start again",
    };
  }

  await cp.mfaChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });
  await logAudit({
    entityType: "User",
    entityId: challenge.userId,
    action: accepted.usedRecovery ? "MFA_RECOVERY_USED" : "MFA_VERIFIED",
    userId: challenge.userId,
  });
  return {
    ok: true,
    userId: challenge.userId,
    schema: challenge.schemaName,
    userAgent: challenge.userAgent,
  };
}

/** Housekeeping for the nightly cron — challenges are short-lived by design. */
export async function purgeExpiredChallenges(): Promise<number> {
  const { count } = await controlPlaneClient().mfaChallenge.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } },
  });
  return count;
}
