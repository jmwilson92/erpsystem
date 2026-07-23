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
import {
  prisma,
  clientForSchema,
  controlPlaneClient,
  currentRequestSchema,
  TENANT_COOKIE,
} from "./db";
import type { PrismaClient } from "@prisma/client";
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

type SessionDb = Pick<PrismaClient, "authSession">;

/**
 * Create a session row and set the session cookie. The AuthSession row is
 * written through `db` — for a tenant login that's a schema-scoped client, so
 * the session physically lives in the customer's schema and is only resolvable
 * while routed there (this is what makes the forge-tenant routing cookie safe).
 *
 * `tenantCookie`: a schema name sets forge-tenant (customer login), `null`
 * clears it (dogfood login), `undefined` leaves it untouched (in-context calls
 * like a signed-in password change, which must keep the current routing).
 */
async function issueSession(
  db: SessionDb,
  userId: string,
  opts: { tenantCookie?: string | null; userAgent?: string } = {}
) {
  const token = randomBytes(32).toString("hex");
  await db.authSession.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
      userAgent: opts.userAgent?.slice(0, 200) || null,
    },
  });
  const jar = await cookies();
  const cookieOpts = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 86_400,
  };
  jar.set(SESSION_COOKIE, token, cookieOpts);
  if (typeof opts.tenantCookie === "string") {
    jar.set(TENANT_COOKIE, opts.tenantCookie, cookieOpts);
  } else if (opts.tenantCookie === null) {
    jar.delete(TENANT_COOKIE);
  }
  return token;
}

/** Create a session in the current (proxy-routed) schema; keeps existing routing. */
export async function createSession(userId: string, userAgent?: string) {
  return issueSession(prisma, userId, { userAgent });
}

/** Create a session inside a specific tenant schema and pin routing to it. */
export async function createTenantSession(
  userId: string,
  schema: string,
  userAgent?: string
) {
  return issueSession(clientForSchema(schema), userId, {
    tenantCookie: schema,
    userAgent,
  });
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
    // The proxy routes to the current schema, so the session row is deleted from
    // wherever it lives (tenant or public).
    await prisma.authSession
      .deleteMany({ where: { tokenHash: sha256(token) } })
      .catch(() => null);
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(TENANT_COOKIE);
}

// ─── Login / bootstrap ──────────────────────────────────────────

export async function loginWithPassword(params: {
  email: string;
  password: string;
  userAgent?: string;
}) {
  const email = params.email.trim().toLowerCase();
  assertLoginNotRateLimited(email);

  // Uniform error — never reveal which part was wrong
  const fail = () => {
    recordLoginFailure(email);
    throw new Error("Invalid e-mail or password");
  };

  // Resolve the customer's workspace from the control-plane directory. An email
  // that isn't a registered tenant login is a public/dogfood account.
  const directory = await controlPlaneClient()
    .tenantLogin.findUnique({ where: { email } })
    .catch(() => null);
  const schema = directory?.schemaName ?? null;
  const db: Pick<PrismaClient, "user"> = schema
    ? clientForSchema(schema)
    : controlPlaneClient();

  const user = await db.user.findFirst({ where: { email: { equals: email } } });
  if (!user || !user.isActive || !user.passwordHash) fail();
  if (!verifyPassword(params.password, user!.passwordHash!)) fail();

  clearLoginFailures(email);
  if (schema) {
    await createTenantSession(user!.id, schema, params.userAgent);
  } else {
    // Dogfood/public login — clear any stale tenant cookie so routing is public.
    await issueSession(controlPlaneClient(), user!.id, {
      tenantCookie: null,
      userAgent: params.userAgent,
    });
  }
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

// ─── Customer onboarding (claim a provisioned tenant) ───────────

/**
 * Claim a freshly provisioned tenant: validate the one-time setup token, set the
 * admin's first password inside the tenant's own schema, consume the token, and
 * log the customer straight in (session created in-schema, forge-tenant pinned).
 */
export async function claimTenant(params: {
  token: string;
  password: string;
  name?: string;
  userAgent?: string;
}) {
  const { tenantBySetupToken, clearSetupToken } = await import("./services/tenancy");
  const tenant = await tenantBySetupToken(params.token);
  if (!tenant) throw new Error("This setup link is invalid or has expired");
  assertPasswordStrength(params.password);

  const db = clientForSchema(tenant.schemaName);
  const email = (tenant.billingEmail || "").trim().toLowerCase();
  const existing = email
    ? await db.user.findFirst({ where: { email } })
    : await db.user.findFirst({ where: { role: "ADMIN" } });
  if (!existing) throw new Error("No admin account found for this workspace");

  const user = await db.user.update({
    where: { id: existing.id },
    data: {
      passwordHash: hashPassword(params.password),
      isActive: true,
      role: "ADMIN",
      ...(params.name?.trim() ? { name: params.name.trim() } : {}),
    },
  });

  await clearSetupToken(tenant.id);
  await createTenantSession(user.id, tenant.schemaName, params.userAgent);
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

  // Which schema owns this invite? An admin inviting from inside a tenant is
  // already routed there; a logged-out password reset resolves the tenant from
  // the login directory by email. Otherwise it's a public/dogfood invite.
  let schemaName = await currentRequestSchema();
  if (schemaName === "public") {
    const dir = await controlPlaneClient()
      .tenantLogin.findUnique({ where: { email } })
      .catch(() => null);
    if (dir) schemaName = dir.schemaName;
  }
  const db = dbForSchema(schemaName);

  await db.userInvite.create({
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

  // Record which schema this invite lives in so the logged-out accept flow can
  // find it (the invitee has no tenant cookie).
  await controlPlaneClient()
    .inviteLookup.create({ data: { tokenHash: sha256(token), schemaName } })
    .catch(() => undefined);

  const link = `${params.baseUrl || ""}/invite/${token}`;
  // Send through the email center (demo transport logs it; SMTP delivers)
  try {
    const { sendEmail } = await import("./services/email");
    const company = await db.companySettings.findUnique({
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

/** Which schema holds this invite token (from the control-plane lookup). */
async function inviteSchema(token: string): Promise<string> {
  const lookup = await controlPlaneClient()
    .inviteLookup.findUnique({ where: { tokenHash: sha256(token) } })
    .catch(() => null);
  return lookup?.schemaName || "public";
}

/** A client bound to the schema that holds this invite (public or a tenant). */
function dbForSchema(schema: string) {
  return schema === "public" ? controlPlaneClient() : clientForSchema(schema);
}

export async function getInviteByToken(token: string) {
  const schema = await inviteSchema(token);
  const invite = await dbForSchema(schema)
    .userInvite.findUnique({ where: { tokenHash: sha256(token) } })
    .catch(() => null);
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return null;
  }
  return invite;
}

/**
 * Accept an invite / reset: set the password, activate, and log them in — all
 * inside the schema that owns the invite. For a tenant invite this creates the
 * user in the tenant's schema, registers their login in the directory, and pins
 * their session to that tenant, so a teammate an admin invites can actually sign
 * in to that instance.
 */
export async function acceptInvite(params: {
  token: string;
  password: string;
  name?: string;
}) {
  const schema = await inviteSchema(params.token);
  const db = dbForSchema(schema);
  const invite = await db.userInvite.findUnique({
    where: { tokenHash: sha256(params.token) },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw new Error("Invite link is invalid or has expired");
  }
  assertPasswordStrength(params.password);

  const existing = await db.user.findFirst({ where: { email: invite.email } });
  const user = existing
    ? await db.user.update({
        where: { id: existing.id },
        data: {
          passwordHash: hashPassword(params.password),
          isActive: true,
          // Apply invite role so re-invites / role changes take effect
          role: invite.role || existing.role,
          ...(params.name?.trim() ? { name: params.name.trim() } : {}),
        },
      })
    : await db.user.create({
        data: {
          email: invite.email,
          name: params.name?.trim() || invite.name || invite.email.split("@")[0],
          role: invite.role,
          passwordHash: hashPassword(params.password),
        },
      });

  await db.userInvite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date() },
  });
  await controlPlaneClient()
    .inviteLookup.deleteMany({ where: { tokenHash: sha256(params.token) } })
    .catch(() => undefined);

  if (schema === "public") {
    await createSession(user.id);
  } else {
    // Register the teammate's login and sign them into their tenant.
    const tenant = await controlPlaneClient()
      .tenant.findUnique({ where: { schemaName: schema } })
      .catch(() => null);
    const { registerTenantLogin } = await import("./services/tenancy");
    await registerTenantLogin(invite.email, schema, tenant?.id || "");
    await createTenantSession(user.id, schema);
  }
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
