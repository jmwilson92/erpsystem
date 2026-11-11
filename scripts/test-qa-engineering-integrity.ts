/** Unconditional engineering ancestry, progress, dependency and manufacturing hold integrity, public + tenant. */
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
  const schema = "tenant_qaengineering01";
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
  const eng = await import("../src/lib/services/engineering-work");
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
    await p.tenant.create({ data: { slug: "qa-engineering", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public",p],[schema,tenant]] as const) {
      const roles=["ADMIN","OPERATOR","HR","ACCOUNTING"];
      const pins=roles.map(() => String(randomInt(100000,999999))); assert.equal(new Set(pins).size,roles.length);
      const users=await Promise.all(roles.map((role,i)=>db.user.create({data:{name:role,email:`${role}@example.invalid`,role,passwordHash:auth.hashPassword(password),pinCode:pins[i]}})));
      const sessions=await Promise.all(users.map(u=>request(()=>scope==="public"?auth.createSession(u.id):auth.createTenantSession(u.id,scope))));
      const run=async<T>(fn:()=>Promise<T>,role="ADMIN")=>(await request(fn,sessions[roles.indexOf(role)].cookies)).value;

      const invoke = async (fn: (fd: FormData) => Promise<unknown>, data: Record<string, string>, role = "OPERATOR") => {
        try { return await run(() => fn(form(data)), role); } catch (e) { if (!/NEXT_REDIRECT/.test(String(e)) || String((e as { digest?: string }).digest).includes("/no-access")) throw e; }
      };
      const projectA = await db.project.create({ data: { number: "QA-ENG-A", name: "Synthetic A" } }), projectB = await db.project.create({ data: { number: "QA-ENG-B", name: "Synthetic B" } });
      const campaignA = await db.campaign.create({ data: { number: "CMP-A", name: "A", projectId: projectA.id } }), campaignB = await db.campaign.create({ data: { number: "CMP-B", name: "B", projectId: projectB.id } });
      const sagaA = await db.saga.create({ data: { number: "SAG-A", name: "A", projectId: projectA.id, campaignId: campaignA.id } }), sagaB = await db.saga.create({ data: { number: "SAG-B", name: "B", projectId: projectB.id, campaignId: campaignB.id } });
      const snapshot = async () => JSON.stringify({ tasks: await db.engTask.findMany({ orderBy: { id: "asc" } }), deps: await db.engDependency.findMany({ orderBy: { id: "asc" } }), alerts: await db.engAlert.findMany({ orderBy: { id: "asc" } }), issues: await db.productionEngIssue.findMany({ orderBy: { id: "asc" } }), wo: await db.workOrder.findMany({ orderBy: { id: "asc" }, include: { statusHistory: { orderBy: { id: "asc" } } } }), audit: await db.auditLog.findMany({ orderBy: { id: "asc" } }) });
      let taskSeq = 0;
      const task = async (fields: Record<string, string> = {}) => { const name = `Synthetic task ${++taskSeq}`; await invoke(a.actionCreateEngTask, { projectId: projectA.id, name, ...fields }, "ADMIN"); return db.engTask.findFirstOrThrow({ where: { name } }); };
      const inherited = await task({ projectId: "", sagaId: sagaA.id }); assert.equal(inherited.projectId, projectA.id); assert.equal(inherited.campaignId, campaignA.id);
      const loose = await task({ projectId: "", campaignId: campaignB.id }); assert.equal(loose.projectId, projectB.id);
      for (const fields of [{ projectId: projectB.id, sagaId: sagaA.id }, { campaignId: campaignB.id, sagaId: sagaA.id }, { projectId: projectB.id, campaignId: campaignA.id }, { parentId: inherited.id, projectId: projectB.id }, { dependsOnTaskIds: "missing-task" }, { dependsOnSagaIds: "missing-saga" }]) {
        const before = await snapshot(); await assert.rejects(task(fields), /ancestry|No record|not found/i); assert.equal(await snapshot(), before);
      }
      const child = await task({ parentId: inherited.id, projectId: "" }); assert.equal(child.sagaId, sagaA.id);
      const product = await db.product.create({ data: { code: "QA-SUSTAIN", name: "Synthetic sustainment" } }); await task({ productId: product.id, projectId: "" });
      const partialBefore = await snapshot(); await assert.rejects(run(() => eng.createEngTask({ name: "Missing second predecessor", projectId: projectA.id, dependsOnTaskIds: [inherited.id, "missing-task"] })), /No record|not found/i); assert.equal(await snapshot(), partialBefore);
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_task_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType"='EngTask' AND NEW."action"='CREATE' THEN RAISE EXCEPTION 'injected task audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_task_audit BEFORE INSERT ON ${scope}."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_task_audit();`);
      const auditBefore = await snapshot(); try { await assert.rejects(task({ dependsOnTaskIds: inherited.id }), /injected task audit failure/); } finally { await pg.exec(`DROP TRIGGER qa_fail_task_audit ON ${scope}."AuditLog"; DROP FUNCTION ${scope}.qa_fail_task_audit();`); } assert.equal(await snapshot(), auditBefore);
      console.log(`PASS ENG-002/004 ${scope} task/saga/campaign/parent ancestry is consistent; invalid predecessors and audit failures leave no task/dependency/alert fragments; valid campaign/product/subtask inheritance works`);
      const progress = await task();
      for (const percentComplete of ["250", "-1", "NaN", "Infinity", "nonsense"]) { const before = await snapshot(); await assert.rejects(invoke(a.actionUpdateEngTask, { id: progress.id, status: "IN_PROGRESS", percentComplete }, "ADMIN"), /finite.*0 and 100/); assert.equal(await snapshot(), before); }
      await invoke(a.actionUpdateEngTask, { id: progress.id, percentComplete: "25" }, "ADMIN"); assert.equal((await db.engTask.findUniqueOrThrow({ where: { id: progress.id } })).percentComplete, 25);
      await invoke(a.actionUpdateEngTask, { id: progress.id, status: "DONE", percentComplete: "0" }, "ADMIN"); assert.equal((await db.engTask.findUniqueOrThrow({ where: { id: progress.id } })).percentComplete, 100);
      const first = await task(), second = await task(), third = await task();
      const edge = (sourceTaskId: string, targetTaskId: string) => invoke(a.actionAddEngDependency, { sourceTaskId, targetTaskId }, "ADMIN");
      await edge(first.id, second.id); await edge(second.id, third.id);
      for (const [source, target] of [[second.id, first.id], [third.id, first.id]]) { const before = await snapshot(); await assert.rejects(edge(source, target), /cycle/); assert.equal(await snapshot(), before); }
      const blockedBefore = await snapshot(); await assert.rejects(invoke(a.actionUpdateEngTask, { id: third.id, status: "DONE" }, "ADMIN"), /blocked by/); assert.equal(await snapshot(), blockedBefore);
      await run(() => eng.addEngDependency({ sourceSagaId: sagaA.id, targetTaskId: first.id })); const mixedBefore = await snapshot(); await assert.rejects(run(() => eng.addEngDependency({ sourceTaskId: first.id, targetSagaId: sagaA.id })), /cycle/); assert.equal(await snapshot(), mixedBefore);
      await assert.rejects(run(() => eng.addEngDependency({ sourceTaskId: first.id, sourceSagaId: sagaA.id, targetTaskId: third.id })), /exactly one/);
      const batchBefore = await snapshot(); await assert.rejects(invoke(a.actionAddEngDependency, { sourceTaskId: third.id, sourceSagaId: "missing-saga", targetTaskId: progress.id }, "ADMIN"), /No record|not found/i); assert.equal(await snapshot(), batchBefore);
      const x = await task(), y = await task(); const concurrent = await Promise.allSettled([edge(x.id, y.id), edge(y.id, x.id)]); assert.equal(concurrent.filter(r => r.status === "fulfilled").length, 1);
      const concurrentTasks = await Promise.all([task(), task()]); assert.notEqual(concurrentTasks[0].number, concurrentTasks[1].number);
      console.log(`PASS ENG-001/003 ${scope} native progress rejects malformed/nonfinite/out-of-range values; DONE is100, blockers remain; two/three-node and mixed saga/task cycles reject including competing inverse edges; concurrent task numbers stay unique`);
      let woSeq = 0, issueSeq = 0;
      const wo = (status = "IN_PROGRESS") => db.workOrder.create({ data: { number: `QA-ENG-WO-${++woSeq}`, type: "TASK_ONLY", status } });
      const issue = async (workOrderId: string) => { const title = `Synthetic issue ${++issueSeq}`; await invoke(a.actionCreateProductionEngIssue, { title, workOrderId }, "ADMIN"); return db.productionEngIssue.findFirstOrThrow({ where: { title } }); };
      const status = (id: string, status: string) => invoke(a.actionUpdateProductionEngIssue, { id, status }, "ADMIN");
      const order = await wo(); const i = await issue(order.id); assert.equal((await db.workOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "ON_HOLD"); await status(i.id, "RESOLVED"); assert.equal((await db.workOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "IN_PROGRESS");
      for (const openState of ["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING_ECR"]) { await status(i.id, openState); assert.equal((await db.workOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "ON_HOLD"); assert.equal((await db.productionEngIssue.findUniqueOrThrow({ where: { id: i.id } })).resolvedAt, null); await status(i.id, "RESOLVED"); }
      const other = await issue(order.id); await status(i.id, "OPEN"); await status(i.id, "CLOSED"); assert.equal((await db.workOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "ON_HOLD"); await status(other.id, "CLOSED"); assert.equal((await db.workOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "IN_PROGRESS");
      const racingWo = await wo(), racingA = await issue(racingWo.id), racingB = await issue(racingWo.id);
      await Promise.all([status(racingA.id, "RESOLVED"), status(racingB.id, "IN_PROGRESS")]); assert.equal((await db.workOrder.findUniqueOrThrow({ where: { id: racingWo.id } })).status, "ON_HOLD");
      await Promise.all([status(racingA.id, "CLOSED"), status(racingB.id, "CLOSED")]); assert.equal((await db.workOrder.findUniqueOrThrow({ where: { id: racingWo.id } })).status, "IN_PROGRESS");
      const preheld = await wo("ON_HOLD"); const preIssue = await issue(preheld.id); await status(preIssue.id, "RESOLVED"); assert.equal((await db.workOrder.findUniqueOrThrow({ where: { id: preheld.id } })).status, "ON_HOLD");
      const planned = await wo("PLANNED"), planIssue = await issue(planned.id); await status(planIssue.id, "RESOLVED"); assert.equal((await db.workOrder.findUniqueOrThrow({ where: { id: planned.id } })).status, "PLANNED");
      const complete = await wo("COMPLETED"), terminalIssue = await issue(complete.id); await status(terminalIssue.id, "RESOLVED"); await status(terminalIssue.id, "OPEN"); assert.equal((await db.workOrder.findUniqueOrThrow({ where: { id: complete.id } })).status, "COMPLETED");
      const quality = await wo(), qi = await issue(quality.id); await db.nonConformance.create({ data: { number: "QA-ENG-NCR", title: "Other safety hold", description: "Synthetic", source: "IN_PROCESS", workOrderId: quality.id } }); await status(qi.id, "RESOLVED"); assert.equal((await db.workOrder.findUniqueOrThrow({ where: { id: quality.id } })).status, "ON_HOLD");
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_eng_hold() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."toStatus"='ON_HOLD' THEN RAISE EXCEPTION 'injected hold history failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_eng_hold BEFORE INSERT ON ${scope}."WorkOrderStatusHistory" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_eng_hold();`);
      const failureWo = await wo(); const beforeCreate = await snapshot(); try { await assert.rejects(issue(failureWo.id), /injected hold history failure/); assert.equal(await snapshot(), beforeCreate); const beforeReopen = await snapshot(); await assert.rejects(status(i.id, "IN_PROGRESS"), /injected hold history failure/); assert.equal(await snapshot(), beforeReopen); } finally { await pg.exec(`DROP TRIGGER qa_fail_eng_hold ON ${scope}."WorkOrderStatusHistory"; DROP FUNCTION ${scope}.qa_fail_eng_hold();`); }
      await status(i.id, "IN_PROGRESS"); await status(i.id, "RESOLVED");
      const part = await db.part.create({ data: { partNumber: "QA-ENG-BOM", description: "Synthetic" } }); const bom = await db.bomHeader.create({ data: { partId: part.id, revision: "A", status: "DRAFT" } });
      const production = await db.workOrder.create({ data: { number: "QA-ENG-PROD", type: "PRODUCTION", status: "IN_PROGRESS", partId: part.id, bomHeaderId: bom.id } }); const productionIssue = await issue(production.id); const bomBefore = await snapshot(); await assert.rejects(status(productionIssue.id, "RESOLVED"), /CERTIFIED BOM/); assert.equal(await snapshot(), bomBefore); await db.bomHeader.update({ where: { id: bom.id }, data: { status: "CERTIFIED" } }); await status(productionIssue.id, "RESOLVED");
      await status(i.id, "IN_PROGRESS");
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_issue_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType"='ProductionEngIssue' AND NEW."action"='UPDATE' THEN RAISE EXCEPTION 'injected issue audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_issue_audit BEFORE INSERT ON ${scope}."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_issue_audit();`);
      const issueAuditBefore = await snapshot(); try { await assert.rejects(status(i.id, "RESOLVED"), /injected issue audit failure/); } finally { await pg.exec(`DROP TRIGGER qa_fail_issue_audit ON ${scope}."AuditLog"; DROP FUNCTION ${scope}.qa_fail_issue_audit();`); } assert.equal(await snapshot(), issueAuditBefore); await status(i.id, "RESOLVED");
      console.log(`PASS ENG-005 ${scope} every reopen state reapplies hold and clears resolvedAt; all open issues must close before exact prior status restores; preexisting/quality/terminal WOs are preserved; creation/reopen history failures roll back all rows and certified-BOM release remains enforced`);
    }
  } finally { await p.$disconnect(); await tenant.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
