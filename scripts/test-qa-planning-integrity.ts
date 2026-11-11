/** Forecast parent identity and terminal requisition release integrity, public + tenant. */
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
  const schema = "tenant_qaplanning01";
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
  const planning = await import("../src/lib/services/planning");
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
    await p.tenant.create({ data: { slug: "qa-planning", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public",p],[schema,tenant]] as const) {
      const roles=["ADMIN","OPERATOR","HR","ACCOUNTING"];
      const pins=roles.map(() => String(randomInt(100000,999999))); assert.equal(new Set(pins).size,roles.length);
      const users=await Promise.all(roles.map((role,i)=>db.user.create({data:{name:role,email:`${role}@example.invalid`,role,passwordHash:auth.hashPassword(password),pinCode:pins[i]}})));
      const sessions=await Promise.all(users.map(u=>request(()=>scope==="public"?auth.createSession(u.id):auth.createTenantSession(u.id,scope))));
      const run=async<T>(fn:()=>Promise<T>,role="ADMIN")=>(await request(fn,sessions[roles.indexOf(role)].cookies)).value;

      const invoke = async (fn: (fd: FormData) => Promise<unknown>, data: Record<string, string>, role = "OPERATOR") => {
        try { return await run(() => fn(form(data)), role); } catch (e) { if (!/NEXT_REDIRECT/.test(String(e)) || String((e as { digest?: string }).digest).includes("/no-access")) throw e; }
      };
      const part = await db.part.create({ data: { partNumber: "QA-PLAN-BUY", description: "Synthetic buy part", sourcingMethod: "PURCHASE", standardCost: 10 } });
      const snapshot = async () => JSON.stringify({ forecasts: await db.forecast.findMany({ orderBy: { id: "asc" }, include: { lines: { orderBy: { id: "asc" } } } }), sheets: await db.materialRequisition.findMany({ orderBy: { id: "asc" }, include: { lines: { orderBy: { id: "asc" } } } }), prs: await db.purchaseRequest.findMany({ orderBy: { id: "asc" }, include: { lines: { orderBy: { id: "asc" } } } }), wo: await db.workOrder.findMany({ orderBy: { id: "asc" } }), settings: await db.companySettings.findMany(), audit: await db.auditLog.findMany({ orderBy: { id: "asc" } }) });
      const fa = await db.forecast.create({ data: { number: "QA-FA", name: "A", status: "ACTIVE", lines: { create: { partId: part.id, quantity: 2 } } }, include: { lines: true } }), fb = await db.forecast.create({ data: { number: "QA-FB", name: "B", status: "ACTIVE", lines: { create: { partId: part.id, quantity: 3 } } }, include: { lines: true } });
      const upsert = (forecastId: string, lineId = "", quantity = "999") => invoke(a.actionUpsertForecastLine, { forecastId, lineId, partId: part.id, quantity, notes: "Synthetic edit" }, "ADMIN");
      let before = await snapshot(); await upsert(fb.id, fa.lines[0].id); assert.equal(await snapshot(), before);
      await assert.rejects(run(() => planning.upsertForecastLine({ forecastId: fb.id, lineId: fa.lines[0].id, partId: part.id, quantity: 999 })), /belong/);
      for (const state of ["CLOSED", "CANCELLED"]) {
        await db.forecast.update({ where: { id: fa.id }, data: { status: state } }); before = await snapshot();
        await upsert(fb.id, fa.lines[0].id); await upsert(fa.id, fa.lines[0].id); await upsert(fa.id); assert.equal(await snapshot(), before);
      }
      await db.forecast.update({ where: { id: fa.id }, data: { status: "ACTIVE" } }); before = await snapshot();
      await invoke(a.actionRemoveForecastLine, { forecastId: fb.id, lineId: fa.lines[0].id }, "ADMIN"); assert.equal(await snapshot(), before);
      await upsert(fb.id, fb.lines[0].id, "7"); assert.equal((await db.forecastLine.findUniqueOrThrow({ where: { id: fb.lines[0].id } })).quantity, 7);
      await upsert(fb.id, "", "4"); assert.equal(await db.forecastLine.count({ where: { forecastId: fb.id } }), 2);
      await invoke(a.actionRemoveForecastLine, { forecastId: fb.id, lineId: fb.lines[0].id }, "ADMIN"); assert.equal(await db.forecastLine.count({ where: { id: fb.lines[0].id } }), 0);
      const race = await Promise.allSettled([run(() => planning.updateForecast({ forecastId: fa.id, status: "CLOSED" })), run(() => planning.upsertForecastLine({ forecastId: fa.id, lineId: fa.lines[0].id, partId: part.id, quantity: 11 }))]); assert.equal(race[0].status, "fulfilled"); assert.equal((await db.forecast.findUniqueOrThrow({ where: { id: fa.id } })).status, "CLOSED"); before = await snapshot(); await upsert(fa.id, fa.lines[0].id); assert.equal(await snapshot(), before);
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_forecast_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType"='Forecast' THEN RAISE EXCEPTION 'injected forecast audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_forecast_audit BEFORE INSERT ON ${scope}."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_forecast_audit();`);
      before = await snapshot(); try { await assert.rejects(run(() => planning.updateForecast({ forecastId: fb.id, status: "CLOSED" })), /injected forecast audit failure/); const line = await db.forecastLine.findFirstOrThrow({ where: { forecastId: fb.id } }); await assert.rejects(run(() => planning.removeForecastLine({ forecastId: fb.id, lineId: line.id })), /injected forecast audit failure/); } finally { await pg.exec(`DROP TRIGGER qa_fail_forecast_audit ON ${scope}."AuditLog"; DROP FUNCTION ${scope}.qa_fail_forecast_audit();`); } assert.equal(await snapshot(), before);
      console.log(`PASS PLAN-002 ${scope} supplied active forecast cannot edit/delete another parent's line; closed/cancelled lines cannot mutate or gain lines; valid edits/add/delete work; close/edit serialize and update/delete audit failures roll back`);
      let seq = 0;
      const sheet = (status: string, action = "BUY") => db.materialRequisition.create({ data: { number: `QA-MRS-${++seq}`, status, lines: { create: { partId: part.id, requiredQty: 5, shortQty: 5, action } } }, include: { lines: true } });
      const release = (id: string) => invoke(a.actionReleaseMaterialRequisition, { materialRequisitionId: id }, "ADMIN");
      for (const state of ["CLOSED", "CANCELLED", "INVALID"]) {
        for (const action of ["BUY", "BUILD"]) { const m = await sheet(state, action); before = await snapshot(); await assert.rejects(release(m.id), /terminal.*cannot be released/); assert.equal(await snapshot(), before); }
      }
      const m = await sheet("DRAFT"); await release(m.id); const released = await db.materialRequisition.findUniqueOrThrow({ where: { id: m.id }, include: { lines: true, purchaseRequests: { include: { lines: true } } } }); assert.equal(released.status, "IN_PROGRESS"); assert.equal(released.purchaseRequests.length, 1); assert.equal(released.purchaseRequests[0].lines[0].quantity, 5); assert.equal(released.lines[0].purchaseRequestId, released.purchaseRequests[0].id);
      await release(m.id); assert.equal(await db.purchaseRequest.count({ where: { materialRequisitionId: m.id } }), 1);
      await db.materialRequisition.update({ where: { id: m.id }, data: { status: "CLOSED" } }); before = await snapshot(); await assert.rejects(release(m.id), /terminal.*cannot be released/); assert.equal(await snapshot(), before);
      const empty = await db.materialRequisition.create({ data: { number: "QA-MRS-EMPTY", status: "DRAFT" } }); await release(empty.id); assert.equal((await db.materialRequisition.findUniqueOrThrow({ where: { id: empty.id } })).status, "RELEASED");
      console.log(`PASS PLAN-003 ${scope} terminal/invalid BUY and BUILD sheets reject before PR/WO/notes/settings/audit writes; existing obligations remain unchanged; valid draft BUY creates and links one PR, sequential retry does not duplicate it, empty draft releases normally`);
    }
  } finally { await p.$disconnect(); await tenant.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
