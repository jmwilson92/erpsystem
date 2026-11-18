/** Calendar bounds, staffing serialization/authority and protected asset custody, public + tenant. */
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
  const schema = "tenant_qacalendar01";
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
  const schedule = await import("../src/lib/services/schedule");
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
    await p.tenant.create({ data: { slug: "qa-calendar", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public",p],[schema,tenant]] as const) {
      const roles=["ADMIN","OPERATOR","HR","ACCOUNTING","PRODUCTION"];
      const pins=roles.map(() => String(randomInt(100000,999999))); assert.equal(new Set(pins).size,roles.length);
      const users=await Promise.all(roles.map((role,i)=>db.user.create({data:{name:role,email:`${role}@example.invalid`,role,passwordHash:auth.hashPassword(password),pinCode:pins[i]}})));
      const sessions=await Promise.all(users.map(u=>request(()=>scope==="public"?auth.createSession(u.id):auth.createTenantSession(u.id,scope))));
      const run=async<T>(fn:()=>Promise<T>,role="ADMIN")=>(await request(fn,sessions[roles.indexOf(role)].cookies)).value;

      const invoke = async (fn: (fd: FormData) => Promise<unknown>, data: Record<string, string>, role = "OPERATOR") => {
        try { return await run(() => fn(form(data)), role); } catch (e) { if (!/NEXT_REDIRECT/.test(String(e)) || String((e as { digest?: string }).digest).includes("/no-access")) throw e; }
      };
      const person=users[1], admin=users[0];
      const centerA=await db.workCenter.create({data:{code:"QA-CAL-A",name:"Synthetic A",area:"MANUFACTURING"}}), centerB=await db.workCenter.create({data:{code:"QA-CAL-B",name:"Synthetic B",area:"MANUFACTURING"}});
      const snapshot=async()=>JSON.stringify({settings:await db.companySettings.findMany({orderBy:{id:"asc"}}),centers:await db.workCenter.findMany({orderBy:{id:"asc"}}),staff:await db.workCenterStaff.findMany({orderBy:{id:"asc"}}),assets:await db.asset.findMany({orderBy:{id:"asc"}}),checkouts:await db.assetCheckout.findMany({orderBy:{id:"asc"}}),audit:await db.auditLog.findMany({orderBy:{id:"asc"}})});
      const staff=(id:string,role="ADMIN",hours="8")=>invoke(a.actionAssignWorkCenterStaff,{workCenterId:id,userId:person.id,hoursPerDay:hours,actorId:person.id},role);
      const remove=(id:string,role="ADMIN")=>invoke(a.actionRemoveWorkCenterStaff,{workCenterId:id,userId:person.id,actorId:person.id},role);
      const settings=(fields:Record<string,string>={})=>invoke(a.actionSavePlanningSettings,{calendarMode:"FIXED_SHIFT",fixedShiftHours:"8",customShiftHours:"8",...fields},"ADMIN");
      const station=(fields:Record<string,string>={})=>invoke(a.actionSaveWorkCenter,{code:"QA-NEW",name:"Synthetic station",area:"MANUFACTURING",capacityHoursPerDay:"8",efficiency:"0.85",isDefault:"true",...fields},"ADMIN");
      let assetSeq=0;const asset=(status="AVAILABLE")=>db.asset.create({data:{assetTag:`QA-CAL-${++assetSeq}`,name:"Synthetic custody asset",status}});
      const checkout=(id:string,role="ADMIN",fields:Record<string,string>={})=>invoke(a.actionCheckoutAsset,{assetId:id,userId:person.id,...fields},role),checkin=(id:string)=>invoke(a.actionCheckinAsset,{assetId:id,returnNote:"Synthetic return"},"ADMIN");
      const negative=process.env.QA_NEGATIVE_ID;
      if(negative){
        if(negative==="SCHED-001"){const end=schedule.addWorkingMinutes(new Date(2026,10,13,9),60);assert.equal(end.getDay(),1);}
        else if(negative==="SCHED-002")await assert.rejects(settings({fixedShiftHours:"-7"}));
        else if(negative==="WC-001")await assert.rejects(station({capacityHoursPerDay:"-100",efficiency:"3"}));
        else if(negative==="WC-003"){await staff(centerA.id);const before=await snapshot();await assert.rejects(staff("missing-center"));assert.equal(await snapshot(),before);}
        else if(negative==="ASSET-001"){const retired=await asset("RETIRED");await assert.rejects(checkin(retired.id));}
        else if(negative==="AUTH-026"){await staff(centerA.id);const before=await snapshot();await assert.rejects(staff(centerB.id,"OPERATOR"));assert.equal(await snapshot(),before);}
        else throw Error("Unknown negative control");
        continue;
      }
      for(const [start,minutes,day,hour,minute] of [[new Date(2026,10,13,9),60,16,1,0],[new Date(2026,10,13,8),480,16,8,0],[new Date(2026,10,13,7,30),60,16,0,30],[new Date(2026,10,14,9),60,16,1,0],[new Date(2026,10,13,9),600,17,2,0],[new Date(2027,2,12,9),60,15,1,0],[new Date(2026,10,16,3),60,16,4,0]] as const){const end=schedule.addWorkingMinutes(start,minutes,{mode:"FIXED_SHIFT",hoursPerDay:8});assert.ok(schedule.isWorkingDay(end));assert.equal(end.getDate(),day);assert.equal(end.getHours(),hour);assert.equal(end.getMinutes(),minute);}
      await settings({customShiftHours:"10"});
      for(const field of ["fixedShiftHours","customShiftHours"])for(const value of ["-7","0","25","NaN","Infinity","malformed"]){const before=await snapshot();await assert.rejects(settings({[field]:value}),/Shift hours/);assert.equal(await snapshot(),before);}
      let before=await snapshot();await assert.rejects(settings({calendarMode:"BOGUS"}),/calendar mode/);assert.equal(await snapshot(),before);await settings({fixedShiftHours:"24",customShiftHours:"0.5"});await settings();
      console.log(`PASS SCHED-001/002 ${scope} Friday after-shift/boundary/partial-day, weekend, multi-day and DST paths skip nonworking days; native malformed/nonfinite/nonpositive/over24 shifts and invalid modes reject without writes; valid8/24/fractional shifts persist`);
      for(const field of ["capacityHoursPerDay","efficiency"])for(const value of field==="capacityHoursPerDay"?["-100","0","25","NaN","Infinity"]:["-1","0","3","NaN","Infinity"]){before=await snapshot();await assert.rejects(station({[field]:value}),/Station capacity|Station efficiency/);assert.equal(await snapshot(),before);}
      await station({code:"QA-MIN",capacityHoursPerDay:"0.5",efficiency:"0.05"});await station({code:"QA-MAX",capacityHoursPerDay:"24",efficiency:"1"});assert.equal(await db.workCenter.count({where:{isDefault:true,area:"MANUFACTURING"}}),1);
      await staff(centerA.id);before=await snapshot();await assert.rejects(staff("missing-center"));assert.equal(await snapshot(),before);const inactive=await db.workCenter.create({data:{code:"QA-INACTIVE",name:"Inactive",area:"MANUFACTURING",isActive:false}});before=await snapshot();await assert.rejects(staff(inactive.id),/inactive station/);assert.equal(await snapshot(),before);
      for(const hours of ["-1","0","25","NaN","Infinity"]){before=await snapshot();await assert.rejects(staff(centerB.id,"ADMIN",hours),/Staff hours/);assert.equal(await snapshot(),before);}
      before=await snapshot();await assert.rejects(staff(centerB.id,"OPERATOR"));await assert.rejects(remove(centerA.id,"OPERATOR"));assert.equal(await snapshot(),before);
      const anonymousCookies=Object.fromEntries(Object.entries(sessions[0].cookies).filter(([key])=>key!==auth.SESSION_COOKIE));before=await snapshot();await assert.rejects(request(()=>a.actionAssignWorkCenterStaff(form({workCenterId:centerB.id,userId:person.id,hoursPerDay:"8"})),anonymousCookies));await assert.rejects(request(()=>a.actionRemoveWorkCenterStaff(form({workCenterId:centerA.id,userId:person.id})),anonymousCookies));assert.equal(await snapshot(),before);
      const moved=await staff(centerB.id,"PRODUCTION") as {movedFrom:{code:string}};assert.equal(moved.movedFrom.code,centerA.code);await Promise.all([staff(centerA.id),staff(centerB.id)]);assert.equal(await db.workCenterStaff.count({where:{userId:person.id,isActive:true}}),1);
      await Promise.all([invoke(a.actionAssignWorkCenterStaff,{workCenterId:centerA.id,userId:users[4].id,hoursPerDay:"8"},"ADMIN"),invoke(a.actionAssignWorkCenterStaff,{workCenterId:centerB.id,userId:admin.id,hoursPerDay:"8"},"PRODUCTION")]);
      assert.equal(await db.workCenterStaff.count({where:{userId:users[4].id,isActive:true}}),1);assert.equal(await db.workCenterStaff.count({where:{userId:admin.id,isActive:true}}),1);
      const audits=await db.auditLog.findMany({where:{entityType:"WorkCenterStaff",action:"ASSIGNED"},orderBy:{id:"asc"}});assert.ok(audits.some(x=>x.userId===admin.id));assert.ok(audits.every(x=>x.userId!==person.id));
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_staff() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType"='WorkCenterStaff' THEN RAISE EXCEPTION 'injected staffing audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_staff BEFORE INSERT ON ${scope}."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_staff();`);
      before=await snapshot();try{await assert.rejects(staff(centerA.id),/injected staffing audit failure/);const active=await db.workCenterStaff.findFirstOrThrow({where:{userId:person.id,isActive:true}});await assert.rejects(remove(active.workCenterId),/injected staffing audit failure/);}finally{await pg.exec(`DROP TRIGGER qa_fail_staff ON ${scope}."AuditLog"; DROP FUNCTION ${scope}.qa_fail_staff();`);}assert.equal(await snapshot(),before);
      console.log(`PASS WC-001/003/AUTH-026 ${scope} native station numeric bounds preserve defaults on rejection; invalid/inactive transfers and audit failures preserve original staffing, racing moves retain one active station; anonymous/operator assignment/removal deny and real production-coordinator/admin operations bind audit actor`);
      const retired=await asset("RETIRED"),maintenance=await asset("MAINTENANCE");await db.assetCheckout.create({data:{assetId:retired.id,userId:person.id}});before=await snapshot();await assert.rejects(checkin(retired.id),/Retired/);await assert.rejects(checkin(maintenance.id),/maintenance/);await assert.rejects(checkout(retired.id),/retired/);await assert.rejects(checkout(maintenance.id),/not available/);assert.equal(await snapshot(),before);
      const usable=await asset();before=await snapshot();await assert.rejects(checkout(usable.id,"ADMIN",{offsite:"true"}),/in-house only/);assert.equal(await snapshot(),before);const races=await Promise.allSettled([checkout(usable.id),checkout(usable.id)]);assert.equal(races.filter(x=>x.status==="fulfilled").length,1);assert.equal(await db.assetCheckout.count({where:{assetId:usable.id,checkedInAt:null}}),1);await Promise.all([checkin(usable.id),checkin(usable.id)]);assert.equal(await db.assetCheckout.count({where:{assetId:usable.id,checkedInAt:null}}),0);assert.equal(await db.auditLog.count({where:{entityType:"Asset",entityId:usable.id,action:"ASSET_CHECKED_IN"}}),1);before=await snapshot();await checkin(usable.id);assert.equal(await snapshot(),before);
      for(const direction of ["OUT","IN"])for(const table of ["AssetCheckout","Asset","AuditLog"]){const item=await asset();if(direction==="IN")await checkout(item.id);before=await snapshot();const event=table==="AssetCheckout"?(direction==="OUT"?"INSERT":"UPDATE"):table==="Asset"?"UPDATE":"INSERT",condition=table==="AuditLog"?`NEW."entityType"='Asset' AND NEW."action"='ASSET_CHECKED_${direction}'`:"TRUE";await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'injected asset mutation failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_asset BEFORE ${event} ON ${scope}."${table}" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_asset();`);try{await assert.rejects(direction==="OUT"?checkout(item.id):checkin(item.id),/injected asset mutation failure/);}finally{await pg.exec(`DROP TRIGGER qa_fail_asset ON ${scope}."${table}"; DROP FUNCTION ${scope}.qa_fail_asset();`);}assert.equal(await snapshot(),before);if(direction==="OUT")await checkout(item.id);else await checkin(item.id);}
      console.log(`PASS ASSET-001 ${scope} retired/maintenance custody cannot reactivate; valid checkout/return, offsite policy and concurrent/repeated returns preserve one history event; checkout/history/status/audit failures roll back both custody directions`);
    }
  } finally { await p.$disconnect(); await tenant.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
