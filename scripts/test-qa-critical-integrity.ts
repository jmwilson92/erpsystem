/** MRB physical-route and exact material-conservation regressions in public/tenant fixtures. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
  const schema = "tenant_qaintegrity01";
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
  const serials = await import("../src/lib/services/serials"), serialActions = await import("../src/app/serial-wo-actions");
  const auth = await import("../src/lib/auth-core"), a = await import("../src/app/actions"), f = await import("../src/lib/services/order-fulfillment");
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
    assert(!/^\s*["']use server["'];?\s*$/m.test(readFileSync("src/lib/audit.ts","utf8")),"AUTH-023 raw actor-selected audit helpers must never be RPCs");
    for(const name of readdirSync("src/lib/services").filter(n => n.endsWith(".ts"))) assert(!/^\s*["']use server["'];?\s*$/m.test(readFileSync("src/lib/services/"+name,"utf8")),`Internal service exposed as actor-id RPC: ${name}`);
    await p.tenant.create({ data: { slug: "qa-critical-integrity", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public",p],[schema,tenant]] as const) {
      const roles=["ADMIN","OPERATOR","ACCOUNTING","CM"];
      const pins=roles.map(() => String(randomInt(100000,999999))); assert.equal(new Set(pins).size,roles.length);
      const users=await Promise.all(roles.map((role,i)=>db.user.create({data:{name:role,email:`${role}@example.invalid`,role,passwordHash:auth.hashPassword(password),pinCode:pins[i]}})));
      const sessions=await Promise.all(users.map(u=>request(()=>scope==="public"?auth.createSession(u.id):auth.createTenantSession(u.id,scope))));
      const run=async<T>(fn:()=>Promise<T>,role="ADMIN")=>(await request(fn,sessions[roles.indexOf(role)].cookies)).value;
      const invoke=async(fn:(fd:FormData)=>Promise<unknown>,data:Record<string,string>,role="ADMIN")=>{try{return await run(()=>fn(form(data)),role)}catch(e){if(!/NEXT_REDIRECT/.test(String(e)) || String((e as {digest?: string}).digest).includes("/no-access"))throw e}};
      const customer=await db.customer.create({data:{code:"QA",name:"Synthetic customer"}});
      const so=await db.salesOrder.create({data:{number:"QA-DEPOSIT",customerId:customer.id,depositRequired:true,depositAmount:500,depositStatus:"PENDING",creditHold:true}});
      const beforeDeposit=JSON.stringify(await db.salesOrder.findUnique({where:{id:so.id}})), auditBefore=await db.auditLog.count();
      await assert.rejects(invoke(a.actionUpdateDepositStatus,{salesOrderId:so.id,depositStatus:"WAIVED"},"OPERATOR"),/NEXT_REDIRECT|permission|authorized/i);
      assert.equal(JSON.stringify(await db.salesOrder.findUnique({where:{id:so.id}})),beforeDeposit);assert.equal(await db.auditLog.count(),auditBefore);
      await invoke(a.actionUpdateDepositStatus,{salesOrderId:so.id,depositStatus:"WAIVED"},"ACCOUNTING");assert.equal((await db.salesOrder.findUniqueOrThrow({where:{id:so.id}})).creditHold,false);
      await assert.rejects(invoke(a.actionUpdateDepositStatus,{salesOrderId:so.id,depositStatus:"BANANA"},"ACCOUNTING"),/Invalid/);
      const registry=await db.cmNumberRegistry.create({data:{number:"QA-DRAWING",title:"Synthetic drawing",category:"DRAWING",status:"ACTIVE"}});
      const beforeRegistry=JSON.stringify(await db.cmNumberRegistry.findUnique({where:{id:registry.id}}));
      await assert.rejects(invoke(a.actionUpdateRegistryStatus,{id:registry.id,status:"OBSOLETE"},"OPERATOR"),/NEXT_REDIRECT|permission|authorized/i);
      assert.equal(JSON.stringify(await db.cmNumberRegistry.findUnique({where:{id:registry.id}})),beforeRegistry);
      await invoke(a.actionUpdateRegistryStatus,{id:registry.id,status:"OBSOLETE"},"CM");assert.equal((await db.cmNumberRegistry.findUniqueOrThrow({where:{id:registry.id}})).status,"OBSOLETE");
      console.log(`PASS AUTH-021/022/023 ${scope} real operator cannot waive deposits or retire registry entries; authorized accounting/CM work; raw audit/helpers remain internal`);
      const makeProcedure=(number:string,status="RELEASED",isLocked=true)=>db.testProcedure.create({data:{number,title:number,status,isLocked,steps:{create:{stepNumber:1,parameter:"Voltage",minValue:4,maxValue:6,units:"V"}}},include:{steps:true}});
      const tp=await makeProcedure("QA-TEST-A"),other=await makeProcedure("QA-TEST-B");
      const sign=(data:Record<string,string>)=>invoke(a.actionRecordTestSignOff,{testProcedureId:tp.id,stepId:tp.steps[0].id,pinCode:pins[1],measuredValue:"5",...data},"OPERATOR");
      const signsBefore=await db.testProcedureSignOff.count();
      await assert.rejects(sign({stepId:other.steps[0].id}),/belong/);assert.equal(await db.testProcedureSignOff.count(),signsBefore);
      for(const [measuredValue,result,expected] of [["99","PASS","FAIL"],["99","NA","FAIL"],["4","","PASS"],["6","","PASS"],["5","FAIL","FAIL"]]) {
        await sign({measuredValue,result});const row=await db.testProcedureSignOff.findFirstOrThrow({orderBy:{signedAt:"desc"}});assert.equal(row.result,expected);assert.equal(row.userId,users[1].id);assert(row.pinVerified);
      }
      const goodCount=await db.testProcedureSignOff.count();
      for(const measuredValue of ["not a number","","NaN","Infinity","-Infinity"])await assert.rejects(sign({measuredValue}),/numeric measurement/);
      await assert.rejects(sign({result:"BANANA"}),/Invalid test result/);
      await assert.rejects(sign({pinCode:pins[0]}),/PIN|pin/);
      const draft=await makeProcedure("QA-DRAFT","DRAFT",false),unlocked=await makeProcedure("QA-UNLOCKED","RELEASED",false);
      for(const proc of [draft,unlocked])await assert.rejects(sign({testProcedureId:proc.id,stepId:proc.steps[0].id}),/released locked/);
      assert.equal(await db.testProcedureSignOff.count(),goodCount);
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_sign_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType"='TestProcedure' THEN RAISE EXCEPTION 'injected signature audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_sign_audit BEFORE INSERT ON ${scope}."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_sign_audit();`);
      try{await assert.rejects(sign({}),/injected signature audit failure/)}finally{await pg.exec(`DROP TRIGGER qa_fail_sign_audit ON ${scope}."AuditLog";DROP FUNCTION ${scope}.qa_fail_sign_audit();`)}
      assert.equal(await db.testProcedureSignOff.count(),goodCount);
      console.log(`PASS TPS-001/002/003/004 ${scope} own-PIN native signatures require matching released/locked procedure and finite measurement; limits override claimed PASS; audit failure rolls back signature`);
      const part=await db.part.create({data:{partNumber:"QA-TOP",description:"Synthetic serialized assembly",isSerialized:true}});
      let woSeq=0;const makeWo=()=>db.workOrder.create({data:{number:`QA-WO-${++woSeq}`,partId:part.id,quantity:2,status:"IN_PROGRESS"}});
      const wa=await makeWo(),wb=await makeWo();
      await invoke(serialActions.actionIssueTopUnitSerial,{workOrderId:wa.id,unitIndex:"1",serial:" top-one "});
      const top=await db.serialNumber.findUniqueOrThrow({where:{serial:"TOP-ONE"}});
      await invoke(serialActions.actionIssueTopUnitSerial,{workOrderId:wb.id,unitIndex:"1",serial:"TOP-ONE"});
      assert.equal((await db.serialNumber.findUniqueOrThrow({where:{id:top.id}})).workOrderId,wa.id);assert.equal(await db.workOrderUnit.count({where:{workOrderId:wb.id}}),0);
      await assert.rejects(run(()=>serials.assignUnitSerial({workOrderId:wa.id,unitIndex:2,serial:top.serial})),/another active unit/);
      for(const index of [0,1.5,3])await assert.rejects(run(()=>serials.assignUnitSerial({workOrderId:wa.id,unitIndex:index,serial:"MUST-NOT-MINT"})),/Unit index/);
      assert.equal(await db.serialNumber.count({where:{serial:"MUST-NOT-MINT"}}),0);
      await db.workOrderUnit.update({where:{workOrderId_unitIndex:{workOrderId:wa.id,unitIndex:1}},data:{status:"COMPLETE"}});
      await invoke(serialActions.actionIssueTopUnitSerial,{workOrderId:wa.id,unitIndex:"1",serial:top.serial});assert.equal((await db.workOrderUnit.findUniqueOrThrow({where:{workOrderId_unitIndex:{workOrderId:wa.id,unitIndex:1}}})).status,"COMPLETE");
      for(const serial of ["RACE-MINT","RACE-EXISTING"]) {
        const w1=await makeWo(),w2=await makeWo();if(serial==="RACE-EXISTING")await db.serialNumber.create({data:{serial,partId:part.id,status:"IN_STOCK"}});
        const outcomes=await Promise.allSettled([w1,w2].map(w=>run(()=>serials.assignUnitSerial({workOrderId:w.id,unitIndex:1,serial}))));assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,1);
        const sn=await db.serialNumber.findUniqueOrThrow({where:{serial}});assert.equal(await db.workOrderUnit.count({where:{serialId:sn.id}}),1);
      }
      console.log(`PASS SERIAL-003 ${scope} native second-WO theft denied unchanged; one SN per active unit; mint/existing races once; invalid unit indices create no identities; retry retains completed unit status`);
      const wh=await db.warehouse.create({data:{code:"QA",name:"Synthetic warehouse"}}),rcv=await db.location.create({data:{warehouseId:wh.id,code:"RCV",name:"Receiving",type:"RECEIVING"}}),stock=await db.location.create({data:{warehouseId:wh.id,code:"STOCK",name:"Storage",type:"STORAGE"}});
      const qaPart=await db.part.create({data:{partNumber:"QA-INSPECT",description:"Mandatory incoming QA/Test",requiresGdtInspection:true,requiresFunctionalTest:true}});
      const item=await db.inventoryItem.create({data:{partId:qaPart.id,locationId:rcv.id,quantityOnHand:3}});
      let insSeq=0;const inspect=(inventoryItemId:string,type:string,status:string)=>db.inspection.create({data:{number:`QA-INS-${++insSeq}`,inventoryItemId,partId:qaPart.id,type,status,quantity:3}});
      const gdt=await inspect(item.id,"GDT","PENDING");
      const putaway=()=>invoke(a.actionPutAwayItemWithLocation,{inventoryItemId:item.id,targetLocationCode:stock.code});
      const snapshot=async()=>JSON.stringify({item:await db.inventoryItem.findUnique({where:{id:item.id}}),material:await db.materialTransaction.count(),traces:await db.traceEvent.count(),photos:await db.receivingPhoto.count()});
      for(const status of ["PENDING","IN_PROGRESS","FAILED","BANANA"]) {await db.inspection.update({where:{id:gdt.id},data:{status}});const before=await snapshot();await assert.rejects(putaway(),/inspection/);assert.equal(await snapshot(),before);}
      await db.inspection.update({where:{id:gdt.id},data:{status:"PASSED"}});await assert.rejects(putaway(),/visual/);
      await inspect(item.id,"VISUAL","PASSED");await assert.rejects(putaway(),/functional/);
      await inspect(item.id,"FUNCTIONAL","PASSED");const beforePut=await snapshot();
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_putaway() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType"='PUTAWAY' THEN RAISE EXCEPTION 'injected putaway trace failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER qa_fail_putaway BEFORE INSERT ON ${scope}."TraceEvent" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_putaway();`);
      try{await assert.rejects(run(()=>f.putAwayInventory({inventoryItemId:item.id,targetLocationCode:stock.code,capturePhotos:false})),/injected putaway trace failure/)}finally{await pg.exec(`DROP TRIGGER qa_fail_putaway ON ${scope}."TraceEvent";DROP FUNCTION ${scope}.qa_fail_putaway();`)}
      assert.equal(await snapshot(),beforePut);await putaway();const stored=await db.inventoryItem.findUniqueOrThrow({where:{id:item.id}});assert.equal(stored.locationId,stock.id);assert.equal(stored.quantityAvailable,3);
      const released=await db.inventoryItem.create({data:{partId:qaPart.id,locationId:rcv.id,quantityOnHand:3,quantityAvailable:3}});await inspect(released.id,"GDT","FAILED");await inspect(released.id,"FUNCTIONAL","PENDING");
      const ncr=await db.nonConformance.create({data:{number:"QA-NCR",title:"Fixture nonconformance",description:"Synthetic",source:"RECEIVING",partId:qaPart.id,quantity:3}}),mrb=await db.mrbCase.create({data:{number:"QA-MRB",ncrId:ncr.id,status:"DISPOSITIONED"}});
      await db.mrbDisposition.create({data:{mrbCaseId:mrb.id,disposition:"USE_AS_IS",quantity:3,justification:"Explicit authorized fixture release",decidedById:users[0].id}});
      await db.materialTransaction.create({data:{inventoryItemId:released.id,partId:qaPart.id,type:"RELEASE",quantity:3,reference:mrb.number}});
      await run(()=>f.putAwayInventory({inventoryItemId:released.id,capturePhotos:false}));
      const newer=await inspect(released.id,"GDT","PENDING");await db.inspection.update({where:{id:newer.id},data:{updatedAt:new Date(Date.now()+1000)}});
      await assert.rejects(run(()=>f.putAwayInventory({inventoryItemId:released.id,capturePhotos:false})),/inspection/);
      console.log(`PASS STOCK-001 ${scope} native putaway rejects pending/failed/unknown/missing required QA/Test before side effects; positive release works; trace failure rolls back; authorized MRB history is preserved but a later inspection blocks`);
      const program=await db.qualityProgram.create({data:{key:"calibration",name:"Calibration"}}),tool=await db.qualityItem.create({data:{programId:program.id,identifier:"QA-GAGE",name:"Synthetic gage"}});
      await db.mrbCase.update({where:{id:mrb.id},data:{calToolId:tool.id,calToolDisposition:"PENDING"}});
      const calBefore=JSON.stringify({mrb:await db.mrbCase.findUnique({where:{id:mrb.id}}),tool:await db.qualityItem.findUnique({where:{id:tool.id}}),audits:await db.auditLog.count()});
      const incidents = await import("../src/lib/services/quality-incidents");
      await assert.rejects(run(()=>incidents.setCalToolDisposition({mrbCaseId:mrb.id,disposition:"BANANA" as never})),/Invalid calibration/);
      // This native action reports service rejection through a toast+redirect.
      await invoke(a.actionSetCalToolDisposition,{mrbCaseId:mrb.id,disposition:"BANANA"});
      assert.equal(JSON.stringify({mrb:await db.mrbCase.findUnique({where:{id:mrb.id}}),tool:await db.qualityItem.findUnique({where:{id:tool.id}}),audits:await db.auditLog.count()}),calBefore);
      await invoke(a.actionSetCalToolDisposition,{mrbCaseId:mrb.id,disposition:"PULL_FOR_RECAL"});assert.equal((await db.qualityItem.findUniqueOrThrow({where:{id:tool.id}})).status,"OUT_OF_SERVICE");
      await invoke(a.actionSavePayrollPolicy,{timesheetFrequency:"BIWEEKLY",weekStartsOn:"2",ptoAccrualHoursPerPeriod:"6"},"ACCOUNTING");
      const policy=await db.payrollPolicy.findUniqueOrThrow({where:{id:"default"}});assert.equal(policy.timesheetFrequency,"BIWEEKLY");assert.equal(policy.weekStartsOn,2);assert.equal(policy.ptoAccrualHoursPerPeriod,6);
      await invoke(a.actionSavePayrollPolicy,{timesheetFrequency:"SEMIMONTHLY",weekStartsOn:"0",ptoAccrualHoursPerPeriod:"4"},"ACCOUNTING");assert.equal((await db.payrollPolicy.findUniqueOrThrow({where:{id:"default"}})).timesheetFrequency,"SEMIMONTHLY");
      await assert.rejects(invoke(a.actionSavePayrollPolicy,{timesheetFrequency:"BANANA"},"ACCOUNTING"),/Invalid/);
      await assert.rejects(invoke(a.actionSavePayrollPolicy,{weekStartsOn:"not numeric"},"ACCOUNTING"),/finite/);
      console.log(`PASS MRB-008/PAY-001 ${scope} native calibration decision enum rejects unchanged and legal pull works; first payroll save persists submitted settings exactly like updates`);
    }
  } finally {await p.$disconnect();await tenant.$disconnect();await socket.stop();await pg.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
