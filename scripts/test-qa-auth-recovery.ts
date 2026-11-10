/** Recovery/MFA security regressions. Private loopback DB and real Next request stores only. */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";
async function main() {
  Object.assign(globalThis, { AsyncLocalStorage });
  const pg = await PGlite.create();
  const ddl = execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { PATH: process.env.PATH, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", DATABASE_URL: "postgresql://postgres@127.0.0.1:1/unused", DIRECT_URL: "postgresql://postgres@127.0.0.1:1/unused" },
  });
  await pg.exec(ddl);
  const schema = "tenant_qaauth01";
  await pg.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};` + TENANT_TABLES_SQL + TENANT_FKS_SQL + "SET search_path TO public;");
  const socket = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0, maxConnections: 16 });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres@${socket.getServerConn()}/postgres`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.DATABASE_POOL_MAX = "1"; process.env.DEMO_MODE = "0";
  process.env.MFA_SECRET_KEY = randomBytes(32).toString("hex");
  globalThis.fetch = async () => { throw new Error("External requests disabled in recovery tests"); };
  const { createRequestStoreForAPI } = await import("next/dist/server/async-storage/request-store");
  const { createWorkStore } = await import("next/dist/server/async-storage/work-store");
  const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external");
  const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external");
  const { NextRequest } = await import("next/dist/server/web/spec-extension/request");
  const { controlPlaneClient, clientForSchema } = await import("../src/lib/db");
  const p = controlPlaneClient(), tenant = clientForSchema(schema);
  const auth = await import("../src/lib/auth-core"), mfa = await import("../src/lib/services/mfa"), totp = await import("../src/lib/services/totp");
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const password = "Synthetic-QA-" + randomBytes(20).toString("hex");
  const nextPassword = "Synthetic-Recovered-" + randomBytes(20).toString("hex");
  async function request<T>(fn: () => Promise<T>, cookies: Record<string, string> = {}) {
    const store = createRequestStoreForAPI(new NextRequest("http://127.0.0.1/invite/qa", { headers: { cookie: Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join("; ") } }), { pathname: "/invite/qa", search: "" }, { tags: [], expirationsByCacheKind: new Map() }, undefined, undefined);
    const work = createWorkStore({ page: "/invite/[token]/page", buildId: "qa-local", previouslyRevalidatedTags: [], renderOpts: {
      supportsDynamicResponse: true, isPossibleServerAction: true, assetPrefix: "",
      experimental: { isRoutePPREnabled: false, cacheComponents: false, authInterrupts: false },
      waitUntil: () => {}, onClose: () => {},
    } as Parameters<typeof createWorkStore>[0]["renderOpts"] });
    const value = await workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, fn));
    return { value, cookies: Object.fromEntries(store.mutableCookies.getAll().filter(c => c.value).map(c => [c.name, c.value])) };
  }
  async function token(db: typeof p, email: string, kind = "RESET", role = "ADMIN", scope = "public") {
    const raw = randomBytes(32).toString("hex");
    const invite = await db.userInvite.create({ data: { email, role, kind, tokenHash: hash(raw), expiresAt: new Date(Date.now() + 600_000) } });
    await p.inviteLookup.create({ data: { tokenHash: hash(raw), schemaName: scope } });
    return { raw, invite };
  }
  try {
    await p.tenant.create({ data: { slug: "qa-auth-recovery", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public", p], [schema, tenant]] as const) {
      const u = await db.user.create({ data: { email: `${scope}@example.invalid`, name: "QA recovery", role: "ADMIN", passwordHash: auth.hashPassword(password) } });
      const old = await request(() => scope === "public" ? auth.createSession(u.id) : auth.createTenantSession(u.id, scope));
      const reset = await token(db, u.email, "RESET", "ADMIN", scope);
      await db.user.update({ where: { id: u.id }, data: { role: "OPERATOR" } });
      const accepted = await request(() => auth.acceptInvite({ token: reset.raw, password: nextPassword, name: "Do not rename during RESET" }));
      const now = await db.user.findUniqueOrThrow({ where: { id: u.id } });
      assert.equal(now.role, "OPERATOR"); assert.equal(now.name, "QA recovery"); assert(auth.verifyPassword(nextPassword, now.passwordHash!));
      assert.equal(await db.authSession.count({ where: { tokenHash: hash(old.cookies[auth.SESSION_COOKIE]) } }), 0);
      assert.equal((await request(() => auth.getSessionUser(), old.cookies)).value, null);
      assert.equal((await request(() => auth.getSessionUser(), accepted.cookies)).value?.id, u.id);
      await assert.rejects(request(() => auth.acceptInvite({ token: reset.raw, password })), /invalid|expired/);
      console.log(`PASS AUTH-012/013 ${scope === "public" ? "public" : "tenant"} reset preserves current role/profile and invalidates old sessions; valid new login routes correctly`);
      const enroll = await request(() => mfa.startEnrolment({ userId: u.id, account: u.email, issuer: "QA" }), accepted.cookies);
      const secret = enroll.value.secret;
      const confirmed = await request(() => mfa.confirmEnrolment({ userId: u.id, code: totp.codeForStep(secret, totp.currentStep()) }), accepted.cookies);
      assert(confirmed.value.ok); const codes = confirmed.value.recoveryCodes!;
      const resetMfa = await token(db, u.email, "RESET", "ADMIN", scope);
      const pending = await request(() => auth.acceptInvite({ token: resetMfa.raw, password }));
      assert(!pending.cookies[auth.SESSION_COOKIE]); assert(pending.cookies[auth.MFA_COOKIE]); assert(!pending.cookies["forge-tenant"]);
      assert.equal(await db.authSession.count({ where: { userId: u.id } }), 0);
      assert.equal((await request(() => auth.getSessionUser(), pending.cookies)).value, null);
      const completed = await request(() => auth.completeMfaLogin({ code: codes[0] }), pending.cookies);
      assert(completed.value.ok); assert(completed.cookies[auth.SESSION_COOKIE]);
      assert.equal((await request(() => auth.getSessionUser(), completed.cookies)).value?.role, "OPERATOR");
      if (scope !== "public") assert.equal(completed.cookies["forge-tenant"], scope);
      assert(!(await request(() => auth.completeMfaLogin({ code: codes[0] }), pending.cookies)).value.ok);
      console.log(`PASS AUTH-014 ${scope === "public" ? "public" : "tenant"} recovery parks MFA without a session; legitimate factor completes schema-correct login once`);
      const challenge = () => mfa.createChallenge({ userId: u.id, schema: scope === "public" ? null : scope });
      const pair = [await challenge(), await challenge()];
      const recovery = await Promise.all(pair.map(token => mfa.verifyChallenge({ token, code: codes[1] })));
      assert.equal(recovery.filter(r => r.ok).length, 1);
      assert((await mfa.verifyChallenge({ token: pair[recovery.findIndex(r => !r.ok)], code: codes[2] })).ok);
      const authenticator = totp.codeForStep(secret, totp.currentStep() + 1);
      const steps = await Promise.all([await challenge(), await challenge()].map(token => mfa.verifyChallenge({ token, code: authenticator })));
      assert.equal(steps.filter(r => r.ok).length, 1);
      console.log(`PASS MFA-001 ${scope === "public" ? "public" : "tenant"} concurrent recovery/TOTP claims succeed once; failed challenge can retry an unused factor`);
      const single = await challenge(), used = await db.mfaRecoveryCode.count({ where: { credential: { userId: u.id }, usedAt: { not: null } } });
      const same = await Promise.all([codes[3], codes[4]].map(code => mfa.verifyChallenge({ token: single, code })));
      assert.equal(same.filter(r => r.ok).length, 1);
      assert.equal(await db.mfaRecoveryCode.count({ where: { credential: { userId: u.id }, usedAt: { not: null } } }), used + 1);
      const locked = await challenge();
      const failures = await Promise.all(Array.from({ length: 7 }, () => mfa.verifyChallenge({ token: locked, code: "invalid" })));
      assert.equal(failures.filter(r => r.ok).length, 0);
      // Concurrent calls rejected while another attempt owns the challenge do
      // not validate a guess. Fill any remaining budget with sequential guesses.
      while ((await p.mfaChallenge.findUniqueOrThrow({ where: { tokenHash: hash(locked) } })).attempts < 5) {
        assert(!(await mfa.verifyChallenge({ token: locked, code: "invalid" })).ok);
      }
      assert.equal((await p.mfaChallenge.findUniqueOrThrow({ where: { tokenHash: hash(locked) } })).attempts, 5);
      assert(!(await mfa.verifyChallenge({ token: locked, code: codes[5] })).ok);
      assert.equal(await db.auditLog.count({ where: { userId: u.id, action: "PASSWORD_RESET" } }), 2);
      assert(await db.auditLog.count({ where: { userId: u.id, action: "MFA_RECOVERY_USED" } }) >= 1);
      if (scope !== "public") assert.equal(await p.auditLog.count({ where: { userId: u.id } }), 0);
      const unavailable = await challenge();
      const key = process.env.MFA_SECRET_KEY;
      process.env.MFA_SECRET_KEY = randomBytes(32).toString("hex");
      try { await assert.rejects(mfa.verifyChallenge({ token: unavailable, code: codes[6] })); }
      finally { process.env.MFA_SECRET_KEY = key; }
      assert(!(await mfa.verifyChallenge({ token: unavailable, code: codes[6] })).ok);
      assert((await mfa.verifyChallenge({ token: await challenge(), code: codes[6] })).ok);
      console.log(`PASS MFA-002 ${scope === "public" ? "public" : "tenant"} challenge yields one success and burns one factor; concurrent wrong attempts stop at five`);
    }
    const email = "new-invite@example.invalid", invite = await token(p, email, "INVITE", "HR");
    await assert.rejects(request(() => auth.acceptInvite({ token: invite.raw, password: "weak" })));
    const created = await request(() => auth.acceptInvite({ token: invite.raw, password }));
    assert.equal(created.value.role, "HR"); assert(created.cookies[auth.SESSION_COOKIE]);
    const race = await token(p, email, "RESET", "ADMIN");
    const attempts = await Promise.allSettled([request(() => auth.acceptInvite({ token: race.raw, password })), request(() => auth.acceptInvite({ token: race.raw, password: nextPassword }))]);
    assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
    const rollback = await token(p, email, "RESET", "ADMIN");
    const active = await p.user.findUniqueOrThrow({ where: { email } });
    const sessionsBefore = await p.authSession.count({ where: { userId: active.id } });
    await pg.exec(`CREATE FUNCTION qa_fail_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected session revoke failure'; END $$; CREATE TRIGGER qa_fail_revoke BEFORE DELETE ON "AuthSession" FOR EACH ROW EXECUTE FUNCTION qa_fail_revoke();`);
    await assert.rejects(request(() => auth.acceptInvite({ token: rollback.raw, password: nextPassword })), /injected session revoke failure/);
    assert.equal((await p.userInvite.findUniqueOrThrow({ where: { id: rollback.invite.id } })).acceptedAt, null);
    assert((await p.user.findUniqueOrThrow({ where: { email } })).passwordHash === active.passwordHash);
    assert.equal(await p.authSession.count({ where: { userId: active.id } }), sessionsBefore);
    await pg.exec('DROP TRIGGER qa_fail_revoke ON "AuthSession"; DROP FUNCTION qa_fail_revoke();');
    await request(() => auth.acceptInvite({ token: rollback.raw, password: nextPassword }));
    const inactive = await p.user.create({ data: { email: "inactive@example.invalid", name: "Disabled", role: "OPERATOR", isActive: false, passwordHash: auth.hashPassword(password) } });
    const disabledReset = await token(p, inactive.email, "RESET", "ADMIN");
    await assert.rejects(request(() => auth.acceptInvite({ token: disabledReset.raw, password: nextPassword })), /cannot be reset/);
    assert.equal((await p.user.findUniqueOrThrow({ where: { id: inactive.id } })).isActive, false);
    assert.equal((await p.userInvite.findUniqueOrThrow({ where: { id: disabledReset.invite.id } })).acceptedAt, null);
    console.log("PASS credential/token/session mutations roll back on revocation failure; reset never reactivates disabled account");
    console.log("PASS valid invite onboarding remains signed in; reset token is atomically single-use under concurrent redemption");
  } finally {
    await tenant.$disconnect(); await p.$disconnect(); await socket.stop(); await pg.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
