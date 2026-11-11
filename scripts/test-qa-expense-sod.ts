/** Unconditional reimbursement no-self-approval and atomic ordinary-accountant processing, public + tenant. */
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
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
  const schema = "tenant_qaexpensesod01";
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
  const hr = await import("../src/lib/services/hr"), gaap = await import("../src/lib/services/gaap");
  const a = await import("../src/app/actions");
  const auth = await import("../src/lib/auth-core");
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
  const form = (data: Record<string, string>) => { const fd = new FormData(); for (const [key, value] of Object.entries(data)) fd.set(key, value); return fd; };
  try {
    await p.tenant.create({ data: { slug: "qa-expense-sod", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public",p],[schema,tenant]] as const) {
      const roles=["ADMIN","OPERATOR","HR","ACCOUNTING"];
      const pins=roles.map(() => String(randomInt(100000,999999))); assert.equal(new Set(pins).size,roles.length);
      const users=await Promise.all(roles.map((role,i)=>db.user.create({data:{name:role,email:`${role}@example.invalid`,role,passwordHash:auth.hashPassword(password),pinCode:pins[i]}})));
      const sessions=await Promise.all(users.map(u=>request(()=>scope==="public"?auth.createSession(u.id):auth.createTenantSession(u.id,scope))));
      const run=async<T>(fn:()=>Promise<T>,role="ADMIN")=>(await request(fn,sessions[roles.indexOf(role)].cookies)).value;

      const invoke = async (fn: (fd: FormData) => Promise<unknown>, data: Record<string, string>, role = "OPERATOR") => {
        try { return await run(() => fn(form(data)), role); } catch (e) { if (!/NEXT_REDIRECT/.test(String(e)) || String((e as { digest?: string }).digest).includes("/no-access")) throw e; }
      };
      await db.accountingSettings.create({ data: { id: "default", requireJournalSoD: true } });
      const cash = await db.account.create({ data: { code: "1000", name: "Cash", type: "ASSET" } }), expense = await db.account.create({ data: { code: "6200", name: "Employee expense", type: "EXPENSE" } });
      let seq = 0;
      const report = (role = "OPERATOR", amount = 20, status = "DRAFT") => db.expenseReport.create({ data: { number: `EXP-SOD-${++seq}`, title: "Synthetic reimbursement", userId: users[roles.indexOf(role)].id, status, lines: { create: { date: new Date(), category: "OTHER", description: "Synthetic expense", amount } } }, include: { lines: true } });
      const advance = (id: string, status: string, role = "OPERATOR", decisionNotes = "") => invoke(a.actionAdvanceExpense, { id, status, decisionNotes }, role);
      const pay = (id: string, role = "ACCOUNTING") => invoke(a.actionReimburseExpense, { id }, role);
      const snapshot = async () => JSON.stringify({ reports: await db.expenseReport.findMany({ orderBy: { id: "asc" }, include: { lines: { orderBy: { id: "asc" } } } }), journals: await db.journalEntry.findMany({ orderBy: { id: "asc" }, include: { lines: { orderBy: { id: "asc" } } } }), accounts: await db.account.findMany({ orderBy: { id: "asc" } }), audits: await db.auditLog.findMany({ orderBy: { id: "asc" } }) });
      const approved = async (role = "OPERATOR", amount = 20) => { const r = await report(role, amount); await advance(r.id, "SUBMITTED", role); await advance(r.id, "APPROVED", role === "HR" ? "ADMIN" : "HR"); return r; };
      for (const role of ["ADMIN", "HR"]) {
        const own = await report(role); await advance(own.id, "SUBMITTED", role); const before = await snapshot();
        await assert.rejects(advance(own.id, "APPROVED", role), /submitter cannot/); assert.equal(await snapshot(), before);
        await db.accountingSettings.update({ where: { id: "default" }, data: { requireJournalSoD: false } }); const noSoDBefore = await snapshot();
        await assert.rejects(advance(own.id, "APPROVED", role), /submitter cannot/); assert.equal(await snapshot(), noSoDBefore);
        await db.accountingSettings.update({ where: { id: "default" }, data: { requireJournalSoD: true } });
      }
      const onBehalf = await report(); await advance(onBehalf.id, "SUBMITTED", "ADMIN"); const beforeOnBehalf = await snapshot(); await assert.rejects(advance(onBehalf.id, "APPROVED", "ADMIN"), /submitter cannot/); assert.equal(await snapshot(), beforeOnBehalf); await advance(onBehalf.id, "APPROVED", "HR");
      await advance(onBehalf.id, "REJECTED", "HR", "New submission round does not erase submitter identity"); await advance(onBehalf.id, "SUBMITTED");
      const historicalSubmitterBefore = await snapshot(); await assert.rejects(advance(onBehalf.id, "APPROVED", "ADMIN"), /submitter cannot/); assert.equal(await snapshot(), historicalSubmitterBefore); await advance(onBehalf.id, "APPROVED", "HR");
      const adminOwned = await approved("ADMIN"); const beforeSelfPay = await snapshot(); await assert.rejects(pay(adminOwned.id, "ADMIN"), /submitter cannot/); assert.equal(await snapshot(), beforeSelfPay);
      await pay(adminOwned.id); const adminJournal = await db.journalEntry.findFirstOrThrow({ where: { source: "EXPENSE", sourceId: adminOwned.id } }); assert.equal(adminJournal.approvedById, users[2].id);
      console.log(`PASS ACCT-009 ${scope} ADMIN/HR beneficiaries and actual on-behalf submitter cannot approve themselves; admin self-authorization cannot bypass independent payment; distinct approver and ordinary accountant work`);
      const ordinary = await approved(); await pay(ordinary.id); const je = await db.journalEntry.findFirstOrThrow({ where: { source: "EXPENSE", sourceId: ordinary.id }, include: { lines: true } });
      assert.equal(je.status, "POSTED"); assert.equal(je.createdById, users[3].id); assert.equal(je.approvedById, users[2].id); assert.equal(je.lines.reduce((sum, line) => sum + line.debit, 0), 20); assert.equal((await db.expenseReport.findUniqueOrThrow({ where: { id: ordinary.id } })).status, "PAID");
      const retryBefore = await snapshot(); await assert.rejects(pay(ordinary.id), /not APPROVED/); assert.equal(await snapshot(), retryBefore);
      const competing = await approved(); const results = await Promise.allSettled([1, 2].map(() => pay(competing.id))); assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(await db.journalEntry.count({ where: { source: "EXPENSE", sourceId: competing.id } }), 1);
      const legacy = await report("OPERATOR", 20, "APPROVED"); const legacyBefore = await snapshot(); await assert.rejects(pay(legacy.id), /Submission identity|Independent expense approval/); assert.equal(await snapshot(), legacyBefore);
      await advance(legacy.id, "REJECTED", "HR", "Return legacy approval for attributable re-submission"); await advance(legacy.id, "SUBMITTED"); await advance(legacy.id, "APPROVED", "HR"); await pay(legacy.id);
      const changed = await approved(); await db.expenseLine.update({ where: { id: changed.lines[0].id }, data: { amount: 99 } }); const changedBefore = await snapshot(); await assert.rejects(pay(changed.id), /stale/); assert.equal(await snapshot(), changedBefore);
      await advance(changed.id, "REJECTED", "HR", "Review amended amount"); await advance(changed.id, "SUBMITTED"); await advance(changed.id, "APPROVED", "HR"); await pay(changed.id);
      console.log(`PASS ACCT-009 ${scope} ordinary accountant processes genuine HR approval with SoD enabled, ledger names independent approver, retries/concurrency post once; missing/stale legacy evidence fails closed and return/resubmit/reapprove restores valid route`);
      for (const [table, condition] of [["Account", "TRUE"], ["AuditLog", `NEW."action"='EXPENSE_PAID'`]] as const) {
        const r = await approved(); const before = await snapshot();
        await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_reimbursement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'injected reimbursement failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_reimbursement BEFORE ${table === "Account" ? "UPDATE" : "INSERT"} ON ${scope}."${table}" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_reimbursement();`);
        try { await assert.rejects(pay(r.id), /injected reimbursement failure/); } finally { await pg.exec(`DROP TRIGGER qa_fail_reimbursement ON ${scope}."${table}"; DROP FUNCTION ${scope}.qa_fail_reimbursement();`); }
        assert.equal(await snapshot(), before); await pay(r.id);
      }
      const missingAccount = await approved(); await db.account.update({ where: { id: cash.id }, data: { isActive: false } }); const missingBefore = await snapshot(); await assert.rejects(pay(missingAccount.id), /GL accounts/); assert.equal(await snapshot(), missingBefore); await db.account.update({ where: { id: cash.id }, data: { isActive: true } }); await pay(missingAccount.id);
      const approvalFail = await report(); await advance(approvalFail.id, "SUBMITTED"); const approvalBefore = await snapshot();
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_expense_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action"='EXPENSE_APPROVED' THEN RAISE EXCEPTION 'injected approval evidence failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_expense_approval BEFORE INSERT ON ${scope}."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_expense_approval();`);
      try { await assert.rejects(advance(approvalFail.id, "APPROVED", "HR"), /injected approval evidence failure/); } finally { await pg.exec(`DROP TRIGGER qa_fail_expense_approval ON ${scope}."AuditLog"; DROP FUNCTION ${scope}.qa_fail_expense_approval();`); } assert.equal(await snapshot(), approvalBefore);
      const empty = await report("OPERATOR", 0); await advance(empty.id, "SUBMITTED"); const emptyBefore = await snapshot(); await assert.rejects(advance(empty.id, "APPROVED", "HR"), /positive/); assert.equal(await snapshot(), emptyBefore);
      const voidKey = await approved(); await db.journalEntry.create({ data: { number: "QA-VOID-EXPENSE-KEY", description: "Synthetic inconsistent legacy void key", source: "EXPENSE", sourceId: voidKey.id, status: "VOID", idempotencyKey: `expense-reimbursement:${voidKey.id}`, createdById: users[0].id } });
      const voidBefore = await snapshot(); await assert.rejects(pay(voidKey.id), /journal already exists/); assert.equal(await snapshot(), voidBefore); assert.equal((await db.expenseReport.findUniqueOrThrow({ where: { id: voidKey.id } })).status, "APPROVED");
      const raw = await approved("ADMIN"); const rawBefore = await snapshot();
      await assert.rejects(run(() => gaap.postJournal({ description: "Raw linked expense bypass", source: "EXPENSE", sourceId: raw.id, createdById: users[0].id, lines: [{ accountId: expense.id, debit: 20 }, { accountId: cash.id, credit: 20 }] })), /reimbursement workflow/); assert.equal(await snapshot(), rawBefore);
      const pending = await db.journalEntry.create({ data: { number: "QA-RAW-EXPENSE", description: "Synthetic pending legacy expense", source: "EXPENSE", sourceId: raw.id, status: "PENDING_APPROVAL", createdById: users[0].id, lines: { create: [{ accountId: expense.id, debit: 20 }, { accountId: cash.id, credit: 20 }] } } }); const pendingBefore = await snapshot();
      await assert.rejects(run(() => gaap.approveJournal({ id: pending.id, approvedById: users[0].id })), /reimbursement workflow/); assert.equal(await snapshot(), pendingBefore);
      await assert.rejects(run(() => gaap.postJournal({ description: "Manual SoD remains", source: "MANUAL", status: "POSTED", createdById: users[3].id, lines: [{ accountId: expense.id, debit: 1 }, { accountId: cash.id, credit: 1 }] })), /Someone else/);
      console.log(`PASS ACCT-009 ${scope} posting/balance/payment-audit failures roll back all state; approval evidence is atomic; missing accounts/zero amounts/raw journal and controller bypasses denied; generic manual SoD preserved`);
    }
  } finally { await p.$disconnect(); await tenant.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
