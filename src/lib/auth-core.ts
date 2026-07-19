/**
 * Real authentication core — email + password, HttpOnly cookie sessions,
 * invites, and password resets. No external auth dependency: scrypt from
 * node:crypto, tokens stored only as SHA-256 hashes.
 *
 * Identity resolution order (see getCurrentUser in auth.ts):
 *   1. Valid auth session cookie  → the logged-in user
 *   2. DEMO_MODE (default on)     → demo persona switcher cookie
 * Set DEMO_MODE=0 in production to require login everywhere.
 *
 * Seats are UNLIMITED by design — nothing in this module (or anywhere
 * else) counts users. Organization size is a pricing conversation, not
 * a product limit.
 */
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { prisma } from "./db";
import { cookies } from "next/headers";
import { logAudit } from "./audit";

export const SESSION_COOKIE = "forge-session";
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;

export function demoModeEnabled() {
  return process.env.DEMO_MODE !== "0";
}

// ─── Login rate limit (in-process; good enough for single-instance beta) ──

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function loginKey(email: string) {
  return email.trim().toLowerCase();
}

/** Throws if this e-mail is temporarily locked out after failed logins. */
export function assertLoginNotRateLimited(email: string) {
  const key = loginKey(email);
  const now = Date.now();
  const row = loginAttempts.get(key);
  if (!row) return;
  if (now > row.resetAt) {
    loginAttempts.delete(key);
    return;
  }
  if (row.count >= LOGIN_MAX_ATTEMPTS) {
    const mins = Math.ceil((row.resetAt - now) / 60_000);
    throw new Error(
      `Too many failed sign-in attempts. Try again in ${mins} minute(s).`
    );
  }
}

export function recordLoginFailure(email: string) {
  const key = loginKey(email);
  const now = Date.now();
  const row = loginAttempts.get(key);
  if (!row || now > row.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  row.count += 1;
}

export function clearLoginFailures(email: string) {
  loginAttempts.delete(loginKey(email));
}

// ─── Passwords (scrypt) ─────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length &&
    timingSafeEqual(candidate, expected)
  );
}

function assertPasswordStrength(password: string) {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ─── Sessions ───────────────────────────────────────────────────

export async function createSession(userId: string, userAgent?: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.authSession.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
      userAgent: userAgent?.slice(0, 200) || null,
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 86_400,
  });
  return token;
}

/** Resolve the logged-in user from the session cookie (null if none). */
export async function getSessionUser() {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const session = await prisma.authSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) return null;
    if (!session.user.isActive) return null;
    // Sliding expiry — refresh at most once an hour
    if (Date.now() - session.lastSeenAt.getTime() > 3_600_000) {
      await prisma.authSession
        .update({
          where: { id: session.id },
          data: {
            lastSeenAt: new Date(),
            expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
          },
        })
        .catch(() => null);
    }
    return session.user;
  } catch {
    return null; // outside request scope
  }
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.authSession
      .deleteMany({ where: { tokenHash: sha256(token) } })
      .catch(() => null);
  }
  jar.delete(SESSION_COOKIE);
}

// ─── Login / bootstrap ──────────────────────────────────────────

export async function loginWithPassword(params: {
  email: string;
  password: string;
  userAgent?: string;
}) {
  const email = params.email.trim().toLowerCase();
  assertLoginNotRateLimited(email);

  const user = await prisma.user.findFirst({
    where: { email: { equals: email } },
  });
  // Uniform error — never reveal which part was wrong
  const fail = () => {
    recordLoginFailure(email);
    throw new Error("Invalid e-mail or password");
  };
  if (!user || !user.isActive || !user.passwordHash) fail();
  if (!verifyPassword(params.password, user!.passwordHash!)) fail();

  clearLoginFailures(email);
  await createSession(user!.id, params.userAgent);
  await logAudit({
    entityType: "User",
    entityId: user!.id,
    action: "LOGIN",
    userId: user!.id,
  });
  return user!;
}

/** True when no account has a password yet — first-boot claim allowed. */
export async function needsBootstrap() {
  const activated = await prisma.user.count({
    where: { passwordHash: { not: null } },
  });
  return activated === 0;
}

/**
 * First-boot: claim the instance by setting the first password. Attaches
 * to the existing user with that e-mail (any role) or creates a new
 * ADMIN. Only works while NO account has a password.
 */
export async function bootstrapFirstAdmin(params: {
  email: string;
  name?: string;
  password: string;
}) {
  if (!(await needsBootstrap())) {
    throw new Error("This instance already has activated accounts — log in instead");
  }
  assertPasswordStrength(params.password);
  const email = params.email.trim().toLowerCase();
  const existing = await prisma.user.findFirst({ where: { email } });
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash: hashPassword(params.password), role: "ADMIN", isActive: true },
      })
    : await prisma.user.create({
        data: {
          email,
          name: params.name?.trim() || email.split("@")[0],
          role: "ADMIN",
          passwordHash: hashPassword(params.password),
        },
      });
  await createSession(user.id);
  await logAudit({
    entityType: "User",
    entityId: user.id,
    action: "INSTANCE_CLAIMED",
    userId: user.id,
  });
  return user;
}

// ─── Invites & resets ───────────────────────────────────────────

export async function createInvite(params: {
  email: string;
  name?: string | null;
  role?: string;
  kind?: "INVITE" | "RESET";
  invitedById?: string;
  baseUrl?: string;
}) {
  const email = params.email.trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) throw new Error("Valid e-mail required");
  const token = randomBytes(24).toString("hex");
  const kind = params.kind || "INVITE";

  await prisma.userInvite.create({
    data: {
      tokenHash: sha256(token),
      email,
      name: params.name?.trim() || null,
      role: params.role || "OPERATOR",
      kind,
      invitedById: params.invitedById || null,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    },
  });

  const link = `${params.baseUrl || ""}/invite/${token}`;
  // Send through the email center (demo transport logs it; SMTP delivers)
  try {
    const { sendEmail } = await import("./services/email");
    const company = await prisma.companySettings.findUnique({
      where: { id: "default" },
    });
    await sendEmail({
      to: email,
      subject:
        kind === "RESET"
          ? `Reset your ${company?.name || "ForgeRP"} password`
          : `You're invited to ${company?.name || "ForgeRP"}`,
      body: [
        kind === "RESET"
          ? "A password reset was requested for your account."
          : `You've been invited to join ${company?.name || "ForgeRP"}.`,
        "",
        `Open this link to set your password (valid ${INVITE_DAYS} days):`,
        link,
        "",
        "If you didn't expect this, ignore this e-mail.",
      ].join("\n"),
      entityType: "UserInvite",
      entityLabel: email,
      userId: params.invitedById,
    });
  } catch {
    /* email logging is best-effort — the link below still works */
  }

  await logAudit({
    entityType: "User",
    entityId: email,
    action: kind === "RESET" ? "PASSWORD_RESET_SENT" : "INVITE_SENT",
    userId: params.invitedById,
    metadata: { email, role: params.role },
  });
  return { token, link };
}

export async function getInviteByToken(token: string) {
  const invite = await prisma.userInvite.findUnique({
    where: { tokenHash: sha256(token) },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return null;
  }
  return invite;
}

/** Accept an invite / reset: set the password, activate, log them in. */
export async function acceptInvite(params: {
  token: string;
  password: string;
  name?: string;
}) {
  const invite = await getInviteByToken(params.token);
  if (!invite) throw new Error("Invite link is invalid or has expired");
  assertPasswordStrength(params.password);

  const existing = await prisma.user.findFirst({
    where: { email: invite.email },
  });
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash: hashPassword(params.password),
          isActive: true,
          // Apply invite role so re-invites / role changes take effect
          role: invite.role || existing.role,
          ...(params.name?.trim() ? { name: params.name.trim() } : {}),
        },
      })
    : await prisma.user.create({
        data: {
          email: invite.email,
          name: params.name?.trim() || invite.name || invite.email.split("@")[0],
          role: invite.role,
          passwordHash: hashPassword(params.password),
        },
      });

  await prisma.userInvite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date() },
  });
  await createSession(user.id);
  await logAudit({
    entityType: "User",
    entityId: user.id,
    action: invite.kind === "RESET" ? "PASSWORD_RESET" : "INVITE_ACCEPTED",
    userId: user.id,
  });
  return user;
}

/** Signed-in password change (requires the current password). */
export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}) {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) throw new Error("User not found");
  if (
    user.passwordHash &&
    !verifyPassword(params.currentPassword, user.passwordHash)
  ) {
    throw new Error("Current password is incorrect");
  }
  assertPasswordStrength(params.newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(params.newPassword) },
  });
  // Kill other sessions for safety
  await prisma.authSession.deleteMany({ where: { userId: user.id } });
  await createSession(user.id);
  await logAudit({
    entityType: "User",
    entityId: user.id,
    action: "PASSWORD_CHANGED",
    userId: user.id,
  });
}
