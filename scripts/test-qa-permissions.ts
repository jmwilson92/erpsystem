/** Privilege boundary regressions; ephemeral Postgres only, no tenant writes. */
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";
async function main() {
  const pg = await PGlite.create(); await pg.exec(TENANT_TABLES_SQL + "\n" + TENANT_FKS_SQL);
  const server = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0 }); await server.start();
  process.env.DATABASE_URL = `postgresql://postgres@${server.getServerConn()}/postgres`;
  process.env.DATABASE_POOL_MAX = "1"; process.env.DEMO_MODE = "1"; process.env.DEMO_USER_ROLE = "ADMIN";
  globalThis.fetch = async () => { throw new Error("External network disabled"); };
  const { prisma: p } = await import("../src/lib/db"), a = await import("../src/app/actions"), auth = await import("../src/lib/auth"), perm = await import("../src/lib/services/permissions");
  const form = (data: Record<string,string>) => { const fd = new FormData(); for (const [k,v] of Object.entries(data)) fd.set(k,v); return fd; };
  const call = async (fn: (fd: FormData) => Promise<void>, data: Record<string,string>) => { try { await fn(form(data)); } catch(e) { if (!/NEXT_REDIRECT|outside.*request|incrementalCache|static generation store/i.test(String(e))) throw e; } };
  try {
    const admin = await p.user.create({ data: { name: "QA Admin", email: "admin@example.invalid", role: "ADMIN" } });
    const operator = await p.user.create({ data: { name: "QA Operator", email: "operator@example.invalid", role: "OPERATOR" } });
    const accountant = await p.user.create({ data: { name: "QA Accountant", email: "accountant@example.invalid", role: "ACCOUNTING" } });
    await perm.ensurePermissionCatalog();
    const group = await perm.createPermissionGroup({ name: "Privileged QA", code: "QA_PRIV" });
    await perm.toggleGroupPermission({ groupId: group.id, permissionCode: "admin.permissions", enabled: true });
    await p.companySettings.create({ data: { id: "default", name: "Original" } });
    const account = await p.account.create({ data: { code: "5000", name: "Expense", type: "EXPENSE" } });
    const snapshots = async () => JSON.stringify({ grants: await p.userPermission.findMany({ orderBy: { id: "asc" } }), groups: await p.userPermissionGroup.findMany({ orderBy: { id: "asc" } }), company: await p.companySettings.findMany(), accounts: await p.account.findMany(), journals: await p.journalEntry.count(), users: await p.user.findMany({ orderBy: { id: "asc" } }) });
    const cases: [string, (fd: FormData) => Promise<void>, Record<string,string>][] = [
      ["AUTH-011 self promotion", a.actionWizardAddPerson, { name: "Operator", email: operator.email, role: "ADMIN" }],
      ["AUTH-011 create administrator", a.actionWizardAddPerson, { name: "Injected", email: "injected@example.invalid", role: "ADMIN" }],
      ["Setup completion", a.actionCompleteSetup, {}],
      ["AUTH-006", a.actionGrantUserPermission, { userId: operator.id, permissionCode: "admin.permissions", allowed: "true" }],
      ["AUTH-007 assign", a.actionAssignUserGroup, { userId: operator.id, groupId: group.id }],
      ["AUTH-007 remove", a.actionRemoveUserGroup, { userId: admin.id, groupId: group.id }],
      ["AUTH-008", a.actionSaveCompanyProfile, { name: "Unauthorized" }],
      ["AUTH-009 categorize", a.actionCategorizeBankTxn, { transactionId: "missing", categoryAccountId: account.id }],
      ["AUTH-009 reconcile", a.actionReconcileBankTxn, { transactionId: "missing" }],
      ["AUTH-010 create", a.actionCreateAccount, { code: "EVIL", name: "Unauthorized", balance: "12345" }],
      ["AUTH-010 update", a.actionUpdateAccount, { id: account.id, name: "Unauthorized", isActive: "false" }],
    ];
    for (const role of ["OPERATOR", "EXECUTIVE"]) {
      process.env.DEMO_USER_ROLE = role;
      if (role === "EXECUTIVE") await p.user.create({ data: { name: "Executive", email: "executive@example.invalid", role: "EXECUTIVE" } });
      for (const [name, fn, data] of cases) {
        const before = await snapshots(); await assert.rejects(fn(form(data)), /NEXT_REDIRECT/); assert.equal(await snapshots(), before, name + " wrote before denying");
        assert.equal(await auth.userHasPermission(operator.id, "admin.permissions"), false);
      }
    }
    console.log("PASS AUTH-006/007/008/009/010/011 server action boundaries deny operator and unrelated executive before writes");
    process.env.DEMO_USER_ROLE = "ADMIN";
    await call(a.actionWizardAddPerson, { name: "Wizard user", email: "wizard@example.invalid", role: "OPERATOR" });
    await call(a.actionWizardAddPerson, { name: "Wizard accountant", email: "wizard@example.invalid", role: "ACCOUNTING" });
    assert.equal((await p.user.findUniqueOrThrow({ where: { email: "wizard@example.invalid" } })).role, "ACCOUNTING");
    await call(a.actionCompleteSetup, {});
    assert.equal((await p.companySettings.findUniqueOrThrow({ where: { id: "default" } })).setupCompleted, true);
    console.log("PASS AUTH-011 authorized setup creates/edits people and completes; denied role self-promotion/create leave every row unchanged");
    await call(a.actionGrantUserPermission, { userId: operator.id, permissionCode: "budgets.manage", allowed: "true" });
    assert.equal(await auth.userHasPermission(operator.id, "budgets.manage"), true);
    await call(a.actionAssignUserGroup, { userId: operator.id, groupId: group.id });
    assert.equal(await auth.userHasPermission(operator.id, "admin.permissions"), true);
    await call(a.actionRemoveUserGroup, { userId: operator.id, groupId: group.id });
    assert.equal(await auth.userHasPermission(operator.id, "admin.permissions"), false);
    await call(a.actionSaveCompanyProfile, { name: "Authorized", departments: "Engineering" });
    assert.equal((await p.companySettings.findUniqueOrThrow({ where: { id: "default" } })).name, "Authorized");
    process.env.DEMO_USER_ROLE = "ACCOUNTING";
    await call(a.actionCreateAccount, { code: "6000", name: "Authorized", type: "EXPENSE" });
    await call(a.actionUpdateAccount, { id: account.id, name: "Authorized edit" });
    assert.equal((await p.account.findUniqueOrThrow({ where: { id: account.id } })).name, "Authorized edit");
    assert(await auth.userHasPermission(accountant.id, "accounting.account.create"));
    console.log("PASS authorized permission administration, company profile and accounting chart writes remain available");
    process.env.DEMO_USER_ROLE = "ADMIN";
    const grant = await p.userPermission.findFirstOrThrow({ where: { userId: operator.id, permission: { code: "budgets.manage" } } });
    await p.userPermission.update({ where: { id: grant.id }, data: { expiresAt: new Date("2000-01-01") } });
    assert.equal(await auth.userHasPermission(operator.id, "budgets.manage"), false);
    await call(a.actionGrantUserPermission, { userId: operator.id, permissionCode: "budgets.manage", allowed: "true" });
    assert.equal((await p.userPermission.findUniqueOrThrow({ where: { id: grant.id } })).expiresAt, null);
    assert.equal(await auth.userHasPermission(operator.id, "budgets.manage"), true);
    console.log("PASS PERM-001 permanent regrant clears stale temporary expiry");
    const req = await p.permissionRequest.create({ data: { userId: operator.id, permissionCode: "accounting.controller", note: "QA" } });
    await assert.rejects(a.actionDecidePermissionRequest(form({ id: req.id, decision: "QA_INVALID" })), /Unknown permission/);
    assert.equal((await p.permissionRequest.findUniqueOrThrow({ where: { id: req.id } })).status, "PENDING");
    assert.equal(await auth.userHasPermission(operator.id, "accounting.controller"), false);
    await call(a.actionDecidePermissionRequest, { id: req.id, decision: "DENY" });
    assert.equal((await p.permissionRequest.findUniqueOrThrow({ where: { id: req.id } })).status, "DENIED");
    console.log("PASS PERM-002 unknown decision rejects without granting; valid deny still works");
  } finally { await p.$disconnect(); await server.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
