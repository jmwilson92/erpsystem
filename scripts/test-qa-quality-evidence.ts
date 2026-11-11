/** Configured quality evidence, lifecycle validation and transactional station defaults. */
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
  const schema = "tenant_qaqualityevidence01";
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
  const inspections = await import("../src/lib/services/inspections"), audits = await import("../src/lib/services/audits"), quality = await import("../src/lib/services/quality-programs");
  const auth = await import("../src/lib/auth-core"), a = await import("../src/app/actions");
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
  const form = (data: Record<string,string>) => { const fd = new FormData(); for (const [k,v] of Object.entries(data)) fd.set(k,v); return fd; };
  try {
    await p.tenant.create({ data: { slug: "qa-quality-evidence", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public",p],[schema,tenant]] as const) {
      const roles=["ADMIN","OPERATOR","ACCOUNTING","CM"];
      const pins=roles.map(() => String(randomInt(100000,999999))); assert.equal(new Set(pins).size,roles.length);
      const users=await Promise.all(roles.map((role,i)=>db.user.create({data:{name:role,email:`${role}@example.invalid`,role,passwordHash:auth.hashPassword(password),pinCode:pins[i]}})));
      const sessions=await Promise.all(users.map(u=>request(()=>scope==="public"?auth.createSession(u.id):auth.createTenantSession(u.id,scope))));
      const run=async<T>(fn:()=>Promise<T>,role="ADMIN")=>(await request(fn,sessions[roles.indexOf(role)].cookies)).value;
      const invoke=async(fn:(fd:FormData)=>Promise<unknown>,data:Record<string,string>,role="ADMIN")=>{try{return await run(()=>fn(form(data)),role)}catch(e){if(!/NEXT_REDIRECT/.test(String(e)) || String((e as {digest?: string}).digest).includes("/no-access"))throw e}};


      const program=await db.qualityProgram.create({data:{key:"esd",name:"Synthetic ESD",defaultIntervalDays:30}}),foreign=await db.qualityProgram.create({data:{key:"fod",name:"Synthetic FOD"}});
      const item=await db.qualityItem.create({data:{programId:program.id,identifier:"STATION-A",name:"Station A",status:"OUT_OF_SERVICE"}}),other=await db.qualityItem.create({data:{programId:foreign.id,identifier:"STATION-B",name:"Station B",status:"OUT_OF_SERVICE"}});
      const snapshot=async()=>JSON.stringify({items:await db.qualityItem.findMany({orderBy:{id:"asc"}}),history:await db.qualityInspection.findMany({orderBy:{id:"asc"}}),events:await db.qualityEvent.findMany({orderBy:{id:"asc"}}),findings:await db.auditFinding.findMany({orderBy:{id:"asc"}}),stations:await db.workCenter.findMany({orderBy:{id:"asc"}}),humidity:await db.humidityReading.findMany({orderBy:{id:"asc"}}),log:await db.auditLog.count()});
      const mismatchBefore=await snapshot();
      await assert.rejects(run(()=>quality.recordQualityEvent({programId:program.id,itemId:other.id,result:"PASS",userId:users[0].id})),/belong/);
      await invoke(a.actionRecordQualityEvent,{programId:program.id,programKey:"esd",itemId:other.id,result:"PASS"});assert.equal(await snapshot(),mismatchBefore);
      await invoke(a.actionRecordQualityEvent,{programId:program.id,programKey:"esd",itemId:item.id,result:"PASS"});assert.equal((await db.qualityItem.findUniqueOrThrow({where:{id:item.id}})).status,"ACTIVE");assert.equal(await db.qualityEvent.count(),1);
      await db.qualityItem.update({where:{id:item.id},data:{status:"OUT_OF_SERVICE"}});
      const checks=[{label:"Ground bond"},{label:"Wrist strap"}];await db.qualityProgram.update({where:{id:program.id},data:{inspectionTemplate:JSON.stringify(checks)}});
      for(const results of [[],[{label:"Ground bond",ok:true}],[{label:"Ground bond",ok:true},{label:"Ground bond",ok:true}],[{label:"Ground bond",ok:true},{label:"Unrelated",ok:true}],[{label:"Ground bond",ok:"yes"},{label:"Wrist strap",ok:true}],{}]){
        const before=await snapshot();await invoke(a.actionPerformInspection,{programId:program.id,programKey:"esd",itemId:item.id,results:JSON.stringify(results)});assert.equal(await snapshot(),before);
      }
      const correct=checks.map(c=>({...c,ok:true}));
      const genericBefore=await snapshot();await invoke(a.actionRecordQualityEvent,{programId:program.id,programKey:"esd",itemId:item.id,result:"PASS"});assert.equal(await snapshot(),genericBefore);
      await assert.rejects(invoke(a.actionPerformInspection,{programId:program.id,programKey:"esd",itemId:item.id,results:JSON.stringify(correct)},"OPERATOR"),/NEXT_REDIRECT/);assert.equal(await snapshot(),genericBefore);
      await invoke(a.actionPerformInspection,{programId:program.id,programKey:"esd",itemId:item.id,results:JSON.stringify([{label:"Ground bond",ok:false},{label:"Wrist strap",ok:true}])});assert.equal((await db.qualityItem.findUniqueOrThrow({where:{id:item.id}})).status,"OUT_OF_SERVICE");assert.equal((await db.qualityInspection.findFirstOrThrow()).passed,false);
      await invoke(a.actionPerformInspection,{programId:program.id,programKey:"esd",itemId:item.id,results:JSON.stringify(correct)});assert.equal((await db.qualityItem.findUniqueOrThrow({where:{id:item.id}})).status,"ACTIVE");assert.equal(await db.qualityInspection.count(),2);
      const identityBefore=await snapshot();await invoke(a.actionPerformInspection,{programId:program.id,programKey:"esd",itemId:other.id,results:JSON.stringify(correct)});assert.equal(await snapshot(),identityBefore);
      console.log(`PASS QA-005/006 ${scope} native cross-program and incomplete/duplicate/untyped evidence do not mutate history or failed stations; full boolean checklist fails/recovers appropriately; generic event cannot bypass required checks`);
      const auditProgram=await db.qualityProgram.create({data:{key:"audits",name:"Synthetic audit",defaultIntervalDays:30,inspectionTemplate:JSON.stringify([{label:"Control records"}])}}),area=await db.qualityItem.create({data:{programId:auditProgram.id,identifier:"AUDIT-AREA",name:"Audit area",status:"OUT_OF_SERVICE"}});
      const auditForm=(results:unknown)=>({programId:auditProgram.id,programKey:"audits",itemId:area.id,results:JSON.stringify(results)});
      const invalidBefore=await snapshot();await invoke(a.actionSaveAudit,auditForm([{label:"Control records",finding:"NCR",reinspectBy:"not-a-date"}]));assert.equal(await snapshot(),invalidBefore);
      for(const date of ["2026-02-30","2026-13-01"])await assert.rejects(run(()=>audits.saveAudit({programId:auditProgram.id,itemId:area.id,results:[{label:"Control records",finding:"NCR",reinspectBy:date}],userId:users[0].id})),/Invalid reinspection/);
      assert.equal(await snapshot(),invalidBefore);
      const ncr=[{label:"Control records",finding:"NCR",note:"Synthetic missing record",correctiveAction:"Restore record",reinspectBy:"2026-11-30"}];
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_finding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected finding failure'; END $$; CREATE TRIGGER qa_fail_finding BEFORE INSERT ON ${scope}."AuditFinding" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_finding();`);
      try{await assert.rejects(run(()=>audits.saveAudit({programId:auditProgram.id,itemId:area.id,results:ncr as Parameters<typeof audits.saveAudit>[0]["results"],userId:users[0].id})),/injected finding failure/)}finally{await pg.exec(`DROP TRIGGER qa_fail_finding ON ${scope}."AuditFinding";DROP FUNCTION ${scope}.qa_fail_finding();`)}assert.equal(await snapshot(),invalidBefore);
      await invoke(a.actionSaveAudit,auditForm(ncr));const finding=await db.auditFinding.findFirstOrThrow();assert.equal(finding.status,"OPEN");assert.equal((await db.qualityItem.findUniqueOrThrow({where:{id:area.id}})).status,"OUT_OF_SERVICE");
      await invoke(a.actionUpdateAuditFinding,{findingId:finding.id,status:"CLOSED"});const closed=await db.auditFinding.findUniqueOrThrow({where:{id:finding.id}});assert(closed.closedAt);
      const closedBefore=await snapshot();await invoke(a.actionUpdateAuditFinding,{findingId:finding.id,status:"QA_INVALID"});assert.equal(await snapshot(),closedBefore);
      await invoke(a.actionUpdateAuditFinding,{findingId:finding.id,correctiveAction:"Evidence retained on notes update"});assert.equal((await db.auditFinding.findUniqueOrThrow({where:{id:finding.id}})).closedAt?.getTime(),closed.closedAt?.getTime());
      await invoke(a.actionUpdateAuditFinding,{findingId:finding.id,status:"REINSPECT"});assert.equal((await db.auditFinding.findUniqueOrThrow({where:{id:finding.id}})).closedAt,null);
      console.log(`PASS QA-003/004 ${scope} native invalid status/date preserves closed finding/history; valid transitions and note-only closedAt retention work; injected finding failure rolls back whole audit run`);
      await db.qualityItem.update({where:{id:item.id},data:{status:"OUT_OF_SERVICE"}});const beforeLogFailure=await snapshot();
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_quality_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType"='QualityInspection' THEN RAISE EXCEPTION 'injected quality audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_quality_log BEFORE INSERT ON ${scope}."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_quality_log();`);
      try{await assert.rejects(run(()=>inspections.saveInspection({programId:program.id,itemId:item.id,results:correct,userId:users[0].id})),/injected quality audit failure/)}finally{await pg.exec(`DROP TRIGGER qa_fail_quality_log ON ${scope}."AuditLog";DROP FUNCTION ${scope}.qa_fail_quality_log();`)}assert.equal(await snapshot(),beforeLogFailure);
      await invoke(a.actionSaveWorkCenter,{code:"DEFAULT-A",name:"Default A",area:"MANUFACTURING",isDefault:"true"});await invoke(a.actionSaveWorkCenter,{code:"OTHER-B",name:"Other B",area:"MANUFACTURING"});const defaultBefore=await snapshot();
      await assert.rejects(invoke(a.actionSaveWorkCenter,{code:"OTHER-B",name:"Duplicate B",area:"MANUFACTURING",isDefault:"true"}),/unique|constraint/i);assert.equal(await snapshot(),defaultBefore);assert.equal((await db.workCenter.findFirstOrThrow({where:{area:"MANUFACTURING",isDefault:true}})).code,"DEFAULT-A");
      await invoke(a.actionSaveWorkCenter,{code:"NEXT-C",name:"Next C",area:"MANUFACTURING",isDefault:"true"});assert.equal(await db.workCenter.count({where:{area:"MANUFACTURING",isDefault:true}}),1);assert.equal((await db.workCenter.findFirstOrThrow({where:{area:"MANUFACTURING",isDefault:true}})).code,"NEXT-C");
      for(const relativeHumidity of ["-5","101","NaN","Infinity"]){const before=await snapshot();await invoke(a.actionRecordHumidity,{location:"Synthetic station",relativeHumidity});assert.equal(await snapshot(),before)}
      for(const relativeHumidity of ["0","50","100"])await invoke(a.actionRecordHumidity,{location:"Synthetic station",relativeHumidity});assert.equal(await db.humidityReading.count(),3);
      console.log(`PASS WC-002/ESD-001 ${scope} duplicate default station failure preserves prior default; valid default change works; native humidity rejects nonfinite/outside0–100 and accepts boundaries; failed quality audit log rolls back station release`);
    }
  }finally{await p.$disconnect();await tenant.$disconnect();await socket.stop();await pg.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
