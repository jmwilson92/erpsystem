/** HR ownership, bounded evidence and calendar-day payroll, public + tenant. */
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";
async function main() {
  process.env.TZ = "America/Los_Angeles";
  Object.assign(globalThis, { AsyncLocalStorage });
  const pg = await PGlite.create();
  const ddl = execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { PATH: process.env.PATH, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", DATABASE_URL: "postgresql://postgres@127.0.0.1:1/unused", DIRECT_URL: "postgresql://postgres@127.0.0.1:1/unused" },
  });
  await pg.exec(ddl);
  const schema = "tenant_qahrintegrity01";
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
  const hr = await import("../src/lib/services/hr"), timesheets = await import("../src/lib/services/timesheets");
  const calendar = await import("../src/lib/calendar-date");
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
    await p.tenant.create({ data: { slug: "qa-hr-integrity", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public",p],[schema,tenant]] as const) {
      const roles=["ADMIN","OPERATOR","HR","CM"];
      const pins=roles.map(() => String(randomInt(100000,999999))); assert.equal(new Set(pins).size,roles.length);
      const users=await Promise.all(roles.map((role,i)=>db.user.create({data:{name:role,email:`${role}@example.invalid`,role,passwordHash:auth.hashPassword(password),pinCode:pins[i]}})));
      const sessions=await Promise.all(users.map(u=>request(()=>scope==="public"?auth.createSession(u.id):auth.createTenantSession(u.id,scope))));
      const run=async<T>(fn:()=>Promise<T>,role="ADMIN")=>(await request(fn,sessions[roles.indexOf(role)].cookies)).value;

      const invoke = async (fn: (fd: FormData) => Promise<unknown>, data: Record<string, string>, role = "OPERATOR") => {
        try { return await run(() => fn(form(data)), role); } catch (e) {
          if (!/NEXT_REDIRECT/.test(String(e)) || String((e as { digest?: string }).digest).includes("/no-access")) throw e;
        }
      };
      await db.user.update({ where: { id: users[2].id }, data: { managerId: users[3].id } });
      const snapshot = async () => JSON.stringify({ leave: await db.ptoRequest.findMany({ orderBy: { id: "asc" } }), goal: await db.employeeGoal.findMany({ orderBy: { id: "asc" } }), expenses: await db.expenseReport.findMany({ orderBy: { id: "asc" } }), reviews: await db.performanceReview.findMany({ orderBy: { id: "asc" } }), entries: await db.timeEntry.findMany({ orderBy: { id: "asc" } }), sheets: await db.timesheet.findMany({ orderBy: { id: "asc" } }), log: await db.auditLog.findMany({ orderBy: { id: "asc" } }) });
      const leave = { userId: users[2].id, type: "UNPAID", startDate: "2026-11-09", endDate: "2026-11-10", hours: "4" };
      const beforeForeign = await snapshot();
      await assert.rejects(invoke(a.actionRequestPto, leave), /Not authorized/);
      await assert.rejects(request(() => a.actionRequestPto(form(leave))), /Sign in required/);
      assert.equal(await snapshot(), beforeForeign);
      await invoke(a.actionRequestPto, { ...leave, userId: users[1].id });
      await invoke(a.actionRequestPto, leave, "CM");
      const managedLeave = await db.ptoRequest.findFirstOrThrow({ where: { userId: users[2].id } });
      const managedAudit = await db.auditLog.findFirstOrThrow({ where: { entityId: managedLeave.id } }); assert.equal(managedAudit.userId, users[3].id);
      const decisionBefore = await snapshot();
      await assert.rejects(request(() => a.actionDecidePto(form({ id: managedLeave.id, decision: "APPROVED" }))), /Sign in required/);
      await assert.rejects(request(() => a.actionDecideTimeEntry(form({ id: "untrusted-entry", decision: "APPROVED" }))), /Sign in required/);
      await assert.rejects(invoke(a.actionDecidePto, { id: managedLeave.id, decision: "APPROVED" }), /Not authorized/);
      assert.equal(await snapshot(), decisionBefore);
      await invoke(a.actionDecidePto, { id: managedLeave.id, decision: "APPROVED" }, "CM");
      assert.equal((await db.ptoRequest.findUniqueOrThrow({ where: { id: managedLeave.id } })).status, "APPROVED");
      assert.equal(managedLeave.startDate.getDate(), 9); assert.equal(managedLeave.startDate.getDay(), 1); assert.equal(managedLeave.startDate.getHours(), 0);
      console.log(`PASS HR-002 ${scope} unrelated/anonymous leave impersonation leaves state unchanged; self and real direct manager requests work with real actor audit`);
      for (const invalid of [{ startDate: "2026-11-20", endDate: "2026-11-10" }, { startDate: "2026-02-30" }, { endDate: "not-a-date" }, { hours: "Infinity" }, { hours: "NaN" }]) {
        const before = await snapshot(); await assert.rejects(invoke(a.actionRequestPto, { ...leave, userId: users[1].id, ...invalid }), /date|finite/i); assert.equal(await snapshot(), before);
      }
      for (const hours of [-1, 0, Infinity, NaN]) await assert.rejects(run(() => hr.createPtoRequest({ actor: users[1], userId: users[1].id, type: "UNPAID", startDate: new Date(2026, 10, 9), endDate: new Date(2026, 10, 10), hours })), /finite|positive/);
      console.log(`PASS HR-003 ${scope} reversed/impossible/invalid dates and nonfinite/nonpositive hours rejected before any leave/evidence writes`);
      const goal = await db.employeeGoal.create({ data: { userId: users[2].id, title: "Synthetic skill", progress: 10 } });
      const goalBefore = await snapshot(); await assert.rejects(invoke(a.actionUpdateGoalProgress, { id: goal.id, progress: "99" }), /Not authorized/); assert.equal(await snapshot(), goalBefore);
      await invoke(a.actionUpdateGoalProgress, { id: goal.id, progress: "25" }, "HR"); assert.equal((await db.employeeGoal.findUniqueOrThrow({ where: { id: goal.id } })).progress, 25);
      await invoke(a.actionUpdateGoalProgress, { id: goal.id, progress: "100" }, "CM"); assert.equal((await db.employeeGoal.findUniqueOrThrow({ where: { id: goal.id } })).status, "COMPLETED");
      const beforeNan = await snapshot(); await assert.rejects(invoke(a.actionUpdateGoalProgress, { id: goal.id, progress: "NaN" }, "CM"), /finite/); assert.equal(await snapshot(), beforeNan);
      console.log(`PASS HR-001 ${scope} foreign goal denial, legitimate owner/manager progress and finite evidence checks`);
      const foreignExpense = await db.expenseReport.create({ data: { number: "QA-FOREIGN", userId: users[2].id, title: "Foreign report" } });
      const ownExpense = await db.expenseReport.create({ data: { number: "QA-OWN", userId: users[1].id, title: "Own report" } });
      const expenseBefore = await snapshot(); await assert.rejects(invoke(a.actionAdvanceExpense, { id: foreignExpense.id, status: "SUBMITTED" }), /Not authorized/); await assert.rejects(request(() => a.actionAdvanceExpense(form({ id: foreignExpense.id, status: "SUBMITTED" }))), /Sign in required/); assert.equal(await snapshot(), expenseBefore);
      await invoke(a.actionAdvanceExpense, { id: ownExpense.id, status: "SUBMITTED" }); await invoke(a.actionAdvanceExpense, { id: foreignExpense.id, status: "SUBMITTED" }, "CM");
      assert.equal((await db.expenseReport.findUniqueOrThrow({ where: { id: foreignExpense.id } })).status, "SUBMITTED");
      console.log(`PASS HR-005 ${scope} foreign/anonymous expense submission denied; owner and authorized direct manager retain valid submission`);
      const review = await db.performanceReview.create({ data: { employeeId: users[2].id, reviewerId: users[3].id, period: "Synthetic review", status: "IN_PROGRESS" } });
      const reviewForm = { employeeId: users[2].id, period: "Synthetic review", overallRating: "250", ratingRationale: "Synthetic rationale" };
      for (const rating of ["250", "0", "-1", "5.1", "NaN", "Infinity"]) {
        for (const id of ["", review.id]) { const before = await snapshot(); await assert.rejects(invoke(a.actionSavePerformanceReview, { ...reviewForm, id, overallRating: rating }, "CM"), /1 to 5/); assert.equal(await snapshot(), before); }
      }
      for (const rating of ["1", "3.5", "5"]) { await invoke(a.actionSavePerformanceReview, { ...reviewForm, id: review.id, overallRating: rating }, "CM"); assert.equal((await db.performanceReview.findUniqueOrThrow({ where: { id: review.id } })).overallRating, Number(rating)); }
      await db.performanceReview.update({ where: { id: review.id }, data: { status: "COMPLETED" } }); const completedBefore = await snapshot(); await assert.rejects(invoke(a.actionSavePerformanceReview, { ...reviewForm, id: review.id, overallRating: "4" }, "CM"), /completed/); assert.equal(await snapshot(), completedBefore);
      console.log(`PASS HR-006 ${scope} both native create/edit score paths reject out-of-scale/nonfinite evidence; legitimate1–5 scores preserved; completed reviews immutable`);
      await db.payrollPolicy.create({ data: { id: "default", timesheetFrequency: "WEEKLY", weekStartsOn: 1, periodAnchor: new Date(2026, 0, 5), holidays: JSON.stringify([{ date: "2026-11-09", name: "Synthetic Monday" }]) } });
      const project = await db.project.create({ data: { number: "QA-PAYROLL", name: "Synthetic charged time" } });
      await invoke(a.actionAddTimesheetEntry, { projectId: project.id, date: "2026-11-09", hours: "4", type: "REGULAR", description: "Selected Monday" });
      const monday = await db.timeEntry.findFirstOrThrow({ where: { userId: users[1].id, description: "Selected Monday" } });
      const correct = await run(() => timesheets.getOrCreateTimesheet(users[1].id, new Date(2026, 10, 9, 12)));
      assert.equal(monday.timesheetId, correct.id); assert.equal(monday.date.getDay(), 1); assert.equal(monday.date.getDate(), 9); assert.equal(monday.date.getHours(), 0);
      const holiday = await db.timeEntry.findFirstOrThrow({ where: { timesheetId: correct.id, type: "HOLIDAY" } }); assert.equal(holiday.date.getDate(), 9);
      for (const [anchor, selected] of [["2026-10-26", "2026-11-02"], ["2026-03-02", "2026-03-09"]]) {
        const bounds = timesheets.periodForDate({ timesheetFrequency: "BIWEEKLY", weekStartsOn: 1, periodAnchor: calendar.parseCalendarDate(anchor) }, calendar.parseCalendarDate(selected));
        assert.equal(bounds.periodStart.getTime(), calendar.parseCalendarDate(anchor).getTime()); const days = timesheets.periodDays(bounds.periodStart, bounds.periodEnd); assert.equal(days.length, 14); assert(days.every(date => date.getHours() === 0)); assert.equal(new Set(days.map(date => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`)).size, 14);
      }
      const beforeBadDay = await snapshot(); await assert.rejects(invoke(a.actionAddTimesheetEntry, { date: "2026-02-30", hours: "4" }), /Invalid calendar date/); assert.equal(await snapshot(), beforeBadDay);
      console.log(`PASS HR-004 ${scope} native Monday and configured holiday use correct local payroll week; DST-crossing biweekly periods contain14 unique midnight calendar days; malformed day rejected`);
      const failBefore = await snapshot();
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_hr_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected HR audit failure'; END $$; CREATE TRIGGER qa_fail_hr_audit BEFORE INSERT ON ${scope}."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_hr_audit();`);
      try {
        await assert.rejects(invoke(a.actionRequestPto, { ...leave, userId: users[1].id }), /injected HR audit failure/);
        await assert.rejects(invoke(a.actionUpdateGoalProgress, { id: goal.id, progress: "20" }, "CM"), /injected HR audit failure/);
        const fresh = await db.expenseReport.create({ data: { number: "QA-ROLLBACK", userId: users[1].id, title: "Rollback report" } });
        const expenseFailBefore = await snapshot(); await assert.rejects(invoke(a.actionAdvanceExpense, { id: fresh.id, status: "SUBMITTED" }), /injected HR audit failure/); assert.equal(await snapshot(), expenseFailBefore); await db.expenseReport.delete({ where: { id: fresh.id } });
      } finally { await pg.exec(`DROP TRIGGER qa_fail_hr_audit ON ${scope}."AuditLog"; DROP FUNCTION ${scope}.qa_fail_hr_audit();`); }
      assert.equal(await snapshot(), failBefore);
      console.log(`PASS HR ownership mutations ${scope} leave/goal/expense and actor audit evidence roll back together`);
    }
    for (const timezone of ["UTC", "America/Los_Angeles", "America/New_York", "Pacific/Auckland"]) { process.env.TZ = timezone; const date = calendar.parseCalendarDate("2026-11-09"); assert.equal(date.getDay(), 1); assert.equal(date.getDate(), 9); assert.equal(date.getHours(), 0); }
    process.env.TZ = "America/Los_Angeles";
  } finally { await p.$disconnect(); await tenant.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
