/** Payroll/budget authority and approval/GL rollback regressions, public and tenant fixtures. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
  const schema = "tenant_qabudget01";
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
  const auth = await import("../src/lib/auth-core"), access = await import("../src/lib/auth"), a = await import("../src/app/actions");
  const budgets = await import("../src/lib/services/budgets"), policy = await import("../src/lib/services/pr-approval"), recurring = await import("../src/lib/services/recurring-journals");
  const password = "Synthetic-QA-" + randomBytes(20).toString("hex");
  async function request<T>(fn: () => Promise<T>, cookies: Record<string, string> = {}) {
    const store = createRequestStoreForAPI(new NextRequest("http://127.0.0.1/invite/qa", { headers: { cookie: Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join("; ") } }), { pathname: "/invite/qa", search: "" }, { tags: [], expirationsByCacheKind: new Map() }, undefined, undefined);
    const work = createWorkStore({ page: "/invite/[token]/page", buildId: "qa-local", previouslyRevalidatedTags: [], renderOpts: {
      supportsDynamicResponse: true, isPossibleServerAction: true, assetPrefix: "", incrementalCache: {} as never,
      experimental: { isRoutePPREnabled: false, cacheComponents: false, authInterrupts: false },
      waitUntil: () => {}, onClose: () => {},
    } as Parameters<typeof createWorkStore>[0]["renderOpts"] });
    const value = await workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, fn));
    return { value, cookies: Object.fromEntries(store.mutableCookies.getAll().filter(c => c.value).map(c => [c.name, c.value])) };
  }
  const form = (data: Record<string,string>) => { const f = new FormData(); for (const [k,v] of Object.entries(data)) f.set(k,v); return f; };
  try {
    await p.tenant.create({ data: { slug: "qa-budget-approvals", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public", p], [schema, tenant]] as const) {
      const users = await Promise.all(["ADMIN", "OPERATOR", "HR", "PURCHASING"].map(role => db.user.create({ data: { name: role, email: `${role}@example.invalid`, role, passwordHash: auth.hashPassword(password) } })));
      const [admin, operator, hr] = users;
      const sessions = await Promise.all(users.map(u => request(() => scope === "public" ? auth.createSession(u.id) : auth.createTenantSession(u.id, scope))));
      const [adminCookies, operatorCookies, hrCookies] = sessions.map(s => s.cookies);
      const run = async <T>(fn: () => Promise<T>, cookies = adminCookies) => (await request(fn, cookies)).value;
      const invoke = async (fn: (f: FormData) => Promise<unknown>, data: Record<string,string>, cookies = adminCookies) => {
        try { return await run(() => fn(form(data)), cookies); } catch(e) { if (!/NEXT_REDIRECT/.test(String(e))) throw e; }
      };
      await run(() => (import("../src/lib/services/permissions")).then(m => m.ensurePermissionCatalog()));
      assert(!(await run(() => access.userHasPermission(operator.id, "budgets.manage"))));
      assert(!(await run(() => access.userHasPermission(operator.id, "admin.users.manage"))));
      const budget = await db.budget.create({ data: { number: "QA-BUDGET", name: "Enacted budget", status: "ENACTED", ownerId: admin.id, totalAmount: 1000 } });
      const snapshot = async () => JSON.stringify({ budgets: await db.budget.findMany(), charges: await db.budgetCharge.findMany(), journals: await db.journalEntry.findMany(), accounts: await db.account.findMany(), users: await db.user.findMany(), policies: await db.approvalPolicy.findMany(), steps: await db.approvalPolicyStep.findMany() });
      for (const [fn,data] of [
        [a.actionUpdateBudget, { budgetId: budget.id, totalAmount: "999999", ownerId: operator.id }],
        [a.actionPostBudgetCharge, { budgetId: budget.id, category: "OTHER", amount: "99" }],
        [a.actionSetUserCompensation, { userId: operator.id, hourlyRate: "9999", annualSalary: "999999" }],
      ] as [(f: FormData) => Promise<unknown>, Record<string,string>][]) {
        const before = await snapshot(); await assert.rejects(run(() => fn(form(data)), operatorCookies), /NEXT_REDIRECT/); assert.equal(await snapshot(), before);
      }
      await invoke(a.actionUpdateBudget, { budgetId: budget.id, totalAmount: "2000", ownerId: hr.id });
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).totalAmount, 2000);
      await invoke(a.actionSetUserCompensation, { userId: operator.id, hourlyRate: "25", annualSalary: "52000" }, hrCookies);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: operator.id } })).hourlyRate, 25);
      console.log(`PASS AUTH-019/020 ${scope} operator cannot change budget/post charges/alter own payroll; admin and HR controls pass`);
      let before = await snapshot();
      await assert.rejects(run(() => budgets.postBudgetCharge({ budgetId: budget.id, category: "OTHER", amount: 37 })), /GL accounts/);
      assert.equal(await snapshot(), before);
      const expense = await db.account.create({ data: { code: "5000", name: "Expense", type: "EXPENSE" } });
      await db.account.create({ data: { code: "2100", name: "Clearing", type: "LIABILITY" } });
      const failJournal = `CREATE FUNCTION ${scope}.qa_fail_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected required journal failure'; END $$; CREATE TRIGGER qa_fail_journal BEFORE INSERT ON ${scope}."JournalEntry" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_journal();`;
      before = await snapshot(); await pg.exec(failJournal);
      try { await assert.rejects(run(() => budgets.postBudgetCharge({ budgetId: budget.id, category: "OTHER", amount: 37 })), /injected required journal failure/); }
      finally { await pg.exec(`DROP TRIGGER qa_fail_journal ON ${scope}."JournalEntry"; DROP FUNCTION ${scope}.qa_fail_journal();`); }
      assert.equal(await snapshot(), before);
      // Reject final actuals after the journal and charge were written: all must roll back.
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_actuals() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."actualTotal" <> OLD."actualTotal" THEN RAISE EXCEPTION 'injected actuals failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_actuals BEFORE UPDATE ON ${scope}."Budget" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_actuals();`);
      try { await assert.rejects(run(() => budgets.postBudgetCharge({ budgetId: budget.id, category: "OTHER", amount: 37 })), /injected actuals failure/); }
      finally { await pg.exec(`DROP TRIGGER qa_fail_actuals ON ${scope}."Budget"; DROP FUNCTION ${scope}.qa_fail_actuals();`); }
      assert.equal(await snapshot(), before);
      await invoke(a.actionPostBudgetCharge, { budgetId: budget.id, category: "OTHER", amount: "19" });
      const charge = await db.budgetCharge.findFirstOrThrow(); assert(charge.journalEntryId);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).actualTotal, 19);
      assert.equal((await db.account.findUniqueOrThrow({ where: { id: expense.id } })).balance, 19);
      const duplicates = await Promise.all([0,1].map(() => run(() => budgets.postBudgetCharge({ budgetId: budget.id, category: "LABOR", amount: 10, hours: 1, timeEntryId: "qa-time-reference" }))));
      assert.equal(duplicates[0].id, duplicates[1].id);
      await Promise.all([2,3].map(amount => run(() => budgets.postBudgetCharge({ budgetId: budget.id, category: "OTHER", amount }))));
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).actualTotal, 34);
      console.log(`PASS BUDGET-001 ${scope} missing/failed GL and final-actuals failures roll back all rows/balances; concurrent totals and time-entry deduplication pass`);
      const steps = [{ stepOrder: 1, name: "Independent approval", minAmount: 0, approverRole: "PURCHASING" }];
      const prior = await run(() => policy.saveApprovalPolicy({ name: "Prior default", isDefault: true, steps }));
      const target = await run(() => policy.saveApprovalPolicy({ name: "Target policy", steps }));
      const policyBefore = JSON.stringify({ policies: await db.approvalPolicy.findMany({ orderBy: { id: "asc" } }), steps: await db.approvalPolicyStep.findMany({ orderBy: { id: "asc" } }) });
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_policy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name='Reject update' THEN RAISE EXCEPTION 'injected policy failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_policy BEFORE UPDATE ON ${scope}."ApprovalPolicy" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_policy();`);
      try { await assert.rejects(run(() => policy.saveApprovalPolicy({ id: target.id, name: "Reject update", isDefault: true, steps })), /injected policy failure/); }
      finally { await pg.exec(`DROP TRIGGER qa_fail_policy ON ${scope}."ApprovalPolicy"; DROP FUNCTION ${scope}.qa_fail_policy();`); }
      assert.equal(JSON.stringify({ policies: await db.approvalPolicy.findMany({ orderBy: { id: "asc" } }), steps: await db.approvalPolicyStep.findMany({ orderBy: { id: "asc" } }) }), policyBefore);
      assert((await db.approvalPolicy.findUniqueOrThrow({ where: { id: prior.id } })).isDefault);
      const pr = await db.purchaseRequest.create({ data: { number: "QA-POLICY-PR", status: "SUBMITTED", totalEstimate: 50, requestedById: operator.id } });
      await run(() => policy.startPrApprovalWorkflow({ purchaseRequestId: pr.id, policyId: target.id, userId: operator.id }));
      assert.notEqual((await db.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })).status, "APPROVED");
      assert(await db.approval.count({ where: { entityId: pr.id } }));
      const empty = await db.approvalPolicy.create({ data: { name: "Legacy broken", entityType: "PurchaseRequest", isActive: true } });
      const waiting = await db.purchaseRequest.create({ data: { number: "QA-BROKEN-PR", status: "SUBMITTED", totalEstimate: 50, requestedById: operator.id } });
      for (const id of ["missing-policy", empty.id]) await assert.rejects(run(() => policy.startPrApprovalWorkflow({ purchaseRequestId: waiting.id, policyId: id, userId: operator.id })), /active approval policy/);
      assert.equal((await db.purchaseRequest.findUniqueOrThrow({ where: { id: waiting.id } })).status, "SUBMITTED");
      await assert.rejects(run(() => policy.saveApprovalPolicy({ name: "Invalid active", isDefault: true, steps: [] })), /requires approval steps/);
      console.log(`PASS PR-001 ${scope} failed policy edit preserves defaults and steps; normal approval is required and missing/empty policy fails closed`);
      const dueAt = new Date(Date.now() - 60_000);
      const accounts = await db.account.findMany({ orderBy: { code: "asc" } });
      const template = await db.recurringJournal.create({ data: { name: "QA recurring", frequency: "MONTHLY", dayOfMonth: 1, nextRunAt: dueAt, linesJson: JSON.stringify([{ accountId: expense.id, debit: 7 }, { accountId: accounts.find(a => a.type === "LIABILITY")!.id, credit: 7 }]) } });
      const recurringBefore = JSON.stringify({ template: await db.recurringJournal.findUnique({ where: { id: template.id } }), accounts: await db.account.findMany(), count: await db.journalEntry.count() });
      await pg.exec(failJournal);
      try { assert.equal((await run(() => recurring.runDueRecurringJournals(admin.id))).length, 0); }
      finally { await pg.exec(`DROP TRIGGER qa_fail_journal ON ${scope}."JournalEntry"; DROP FUNCTION ${scope}.qa_fail_journal();`); }
      assert.equal(JSON.stringify({ template: await db.recurringJournal.findUnique({ where: { id: template.id } }), accounts: await db.account.findMany(), count: await db.journalEntry.count() }), recurringBefore);
      const runs = await Promise.all([0,1].map(() => run(() => recurring.runDueRecurringJournals(admin.id))));
      assert.equal(runs.flat().length, 1); assert.equal(await db.journalEntry.count({ where: { sourceId: template.id } }), 1);
      const next = await db.recurringJournal.findUniqueOrThrow({ where: { id: template.id } }); assert(next.lastRunAt && next.nextRunAt! > new Date());
      assert.equal((await run(() => recurring.runDueRecurringJournals(admin.id))).length, 0);
      console.log(`PASS ACCT-011 ${scope} failed occurrence retains exact schedule/balances; retry and concurrent runners post once then advance`);
    }
  } finally { await p.$disconnect(); await tenant.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
