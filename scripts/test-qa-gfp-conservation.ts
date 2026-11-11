/** Exact government-property consumption, exclusive custody, and identity-bound audit evidence. */
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
  const schema = "tenant_qagfpconserve01";
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
  const gfp = await import("../src/lib/services/gfp");
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
    await p.tenant.create({ data: { slug: "qa-gfp-conservation", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public",p],[schema,tenant]] as const) {
      const roles=["ADMIN","OPERATOR","ACCOUNTING","CM"];
      const pins=roles.map(() => String(randomInt(100000,999999))); assert.equal(new Set(pins).size,roles.length);
      const users=await Promise.all(roles.map((role,i)=>db.user.create({data:{name:role,email:`${role}@example.invalid`,role,passwordHash:auth.hashPassword(password),pinCode:pins[i]}})));
      const sessions=await Promise.all(users.map(u=>request(()=>scope==="public"?auth.createSession(u.id):auth.createTenantSession(u.id,scope))));
      const run=async<T>(fn:()=>Promise<T>,role="ADMIN")=>(await request(fn,sessions[roles.indexOf(role)].cookies)).value;
      const invoke=async(fn:(fd:FormData)=>Promise<unknown>,data:Record<string,string>,role="ADMIN")=>{try{return await run(()=>fn(form(data)),role)}catch(e){if(!/NEXT_REDIRECT/.test(String(e)) || String((e as {digest?: string}).digest).includes("/no-access"))throw e}};

      const warehouse=await db.warehouse.create({data:{code:"GOV",name:"Synthetic government stock"}}), location=await db.location.create({data:{code:"GOV-STOCK",name:"Government storage",type:"STORAGE",warehouseId:warehouse.id}});
      const part=await db.part.create({data:{partNumber:"GOV-MATERIAL",description:"Synthetic consumable material"}});let seq=0;
      const material=async(quantity=10)=>{const item=await db.inventoryItem.create({data:{partId:part.id,locationId:location.id,quantityOnHand:quantity,quantityAvailable:quantity,ownership:"GOVERNMENT",unitCost:17,lotNumber:"GOV-LOT"}});return db.governmentProperty.create({data:{assetTag:`GOV-${++seq}`,description:"Synthetic material",propertyType:"MATERIAL",classification:"MATERIAL",inventoryItemId:item.id}})};
      const makeRequest=async(propertyId:string,quantity:number)=>run(()=>gfp.requestGfpConsumption({propertyId,quantity,requestedById:users[1].id}));
      const decide=(consumptionId:string,approve=true)=>invoke(a.actionDecideGfpConsumption,{consumptionId,approve:String(approve),approvalNotes:approve?"Approved actual quantity":"Rejected invalid legacy request",pinCode:pins[0]});
      const snapshot=async()=>JSON.stringify({property:await db.governmentProperty.findMany({orderBy:{id:"asc"}}),stock:await db.inventoryItem.findMany({orderBy:{id:"asc"}}),requests:await db.gfpConsumption.findMany({orderBy:{id:"asc"}}),custody:await db.gfpCheckout.findMany({orderBy:{id:"asc"}}),audits:await db.gfpAuditRecord.findMany({orderBy:{id:"asc"}}),evidence:await db.complianceCheck.findMany({orderBy:{id:"asc"}}),movement:await db.materialTransaction.findMany({orderBy:{id:"asc"}}),trace:await db.traceEvent.findMany({orderBy:{id:"asc"}}),log:await db.auditLog.count()});
      const prop=await material();
      for(const quantity of ["-2","0","NaN","Infinity","11"]){const before=await snapshot();await assert.rejects(invoke(a.actionRequestGfpConsumption,{propertyId:prop.id,quantity},"OPERATOR"),/positive|finite|exceeds/);assert.equal(await snapshot(),before)}
      await invoke(a.actionCheckoutGfp,{propertyId:prop.id},"OPERATOR");
      await invoke(a.actionRequestGfpConsumption,{propertyId:prop.id,quantity:"2"},"OPERATOR");
      const rec=await db.gfpConsumption.findFirstOrThrow({where:{propertyId:prop.id}});
      await decide(rec.id);
      const reduced=await db.inventoryItem.findUniqueOrThrow({where:{id:prop.inventoryItemId!}}), active=await db.governmentProperty.findUniqueOrThrow({where:{id:prop.id}});
      assert.equal(reduced.quantityOnHand,8);assert.equal(reduced.quantityAvailable,8);assert.equal(active.status,"CHECKED_OUT");assert.equal(active.checkedOutToId,users[1].id);
      const issue=await db.materialTransaction.findFirstOrThrow({where:{reference:rec.id}});assert.equal(issue.quantity,2);assert.equal(issue.unitCost,17);assert.equal(issue.lotNumber,"GOV-LOT");assert.equal(issue.type,"ISSUE");
      const retryBefore=await snapshot();await assert.rejects(decide(rec.id),/not pending/);assert.equal(await snapshot(),retryBefore);
      const rest=await makeRequest(prop.id,8);await decide(rest.id);assert.equal((await db.inventoryItem.findUniqueOrThrow({where:{id:prop.inventoryItemId!}})).quantityOnHand,0);assert.equal((await db.governmentProperty.findUniqueOrThrow({where:{id:prop.id}})).status,"CONSUMED");assert.equal(await db.gfpCheckout.count({where:{propertyId:prop.id,status:"OPEN"}}),0);
      console.log(`PASS GFP-002/003 ${scope} native partial approval consumes exactly2 of10 preserving8 and holder; full consumes remainder and closes custody; invalid requests/retry leave all state unchanged`);
      const scarce=await material(3),requests=await Promise.all([makeRequest(scarce.id,2),makeRequest(scarce.id,2)]);
      const competing=await Promise.allSettled(requests.map(r=>decide(r.id)));assert.equal(competing.filter(x=>x.status==="fulfilled").length,1);assert.equal((await db.inventoryItem.findUniqueOrThrow({where:{id:scarce.inventoryItemId!}})).quantityOnHand,1);assert.equal(await db.gfpConsumption.count({where:{propertyId:scarce.id,status:"CONSUMED"}}),1);
      const failing=await material(5),bad=await makeRequest(failing.id,2);const beforeFailure=await snapshot();
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_gfp_trace() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType"='GFP_CONSUMED' THEN RAISE EXCEPTION 'injected GFP trace failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_gfp_trace BEFORE INSERT ON ${scope}."TraceEvent" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_gfp_trace();`);
      try{await assert.rejects(decide(bad.id),/injected GFP trace failure/)}finally{await pg.exec(`DROP TRIGGER qa_fail_gfp_trace ON ${scope}."TraceEvent";DROP FUNCTION ${scope}.qa_fail_gfp_trace();`)}assert.equal(await snapshot(),beforeFailure);
      await db.inventoryItem.update({where:{id:failing.inventoryItemId!},data:{quantityQuarantine:1}});const heldBefore=await snapshot();await assert.rejects(decide(bad.id),/released government/);assert.equal(await snapshot(),heldBefore);
      await decide(bad.id,false);assert.equal((await db.gfpConsumption.findUniqueOrThrow({where:{id:bad.id}})).status,"REJECTED");
      const legacy=await db.gfpConsumption.create({data:{propertyId:failing.id,quantity:-4,status:"PENDING_APPROVAL"}});await assert.rejects(decide(legacy.id),/positive|finite/);assert.equal((await db.gfpConsumption.findUniqueOrThrow({where:{id:legacy.id}})).status,"PENDING_APPROVAL");await decide(legacy.id,false);
      const asset=await db.governmentProperty.create({data:{assetTag:"GOV-ASSET",description:"Indivisible equipment",propertyType:"GFP"}});
      for(const quantity of [-1,0,0.5,2,Infinity])await assert.rejects(makeRequest(asset.id,quantity),/positive|finite|whole unit/);
      const one=await makeRequest(asset.id,1);await decide(one.id);assert.equal((await db.governmentProperty.findUniqueOrThrow({where:{id:asset.id}})).status,"CONSUMED");
      const linked=await material(1);await db.inventoryItem.update({where:{id:linked.inventoryItemId!},data:{ownership:"COMPANY"}});await assert.rejects(makeRequest(linked.id,1),/government/);
      const noStock=await db.governmentProperty.create({data:{assetTag:"GOV-UNLINKED",description:"Missing linked stock",propertyType:"MATERIAL",classification:"MATERIAL"}});await assert.rejects(makeRequest(noStock.id,1),/linked inventory/);

      const auditFailProperty=await material(3),auditFailRequest=await makeRequest(auditFailProperty.id,1),beforeLogFailure=await snapshot();
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_gfp_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType"='GfpConsumption' THEN RAISE EXCEPTION 'injected GFP audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_gfp_log BEFORE INSERT ON ${scope}."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_gfp_log();`);
      try{await assert.rejects(decide(auditFailRequest.id),/injected GFP audit failure/)}finally{await pg.exec(`DROP TRIGGER qa_fail_gfp_log ON ${scope}."AuditLog";DROP FUNCTION ${scope}.qa_fail_gfp_log();`)}assert.equal(await snapshot(),beforeLogFailure);
      const serialized=await material(1);await db.serialNumber.createMany({data:[{serial:"GOV-PHYSICAL",partId:part.id,status:"IN_STOCK"},{serial:"UNRELATED-GOV",partId:part.id,status:"IN_STOCK"}]});
      await db.inventoryItem.update({where:{id:serialized.inventoryItemId!},data:{serialNumber:"GOV-PHYSICAL"}});await db.governmentProperty.update({where:{id:serialized.id},data:{serialNumber:"UNRELATED-GOV"}});
      await assert.rejects(makeRequest(serialized.id,0.5),/whole physical unit/);const serializedRequest=await makeRequest(serialized.id,1);await decide(serializedRequest.id);assert.equal((await db.serialNumber.findUniqueOrThrow({where:{serial:"GOV-PHYSICAL"}})).status,"CONSUMED");assert.equal((await db.serialNumber.findUniqueOrThrow({where:{serial:"UNRELATED-GOV"}})).status,"IN_STOCK");
      console.log(`PASS GFP-002/003 ${scope} competing approvals consume once, stale/held/company stock denied, issue+trace+approval rollback together; authorized indivisible asset remains consumable and invalid legacy request rejectable`);
      const custody=await db.governmentProperty.create({data:{assetTag:"GOV-CUSTODY",description:"Single holder",propertyType:"GFP"}});
      const checkouts=await Promise.allSettled(["ADMIN","OPERATOR"].map(role=>invoke(a.actionCheckoutGfp,{propertyId:custody.id},role)));assert.equal(checkouts.filter(x=>x.status==="fulfilled").length,1);assert.equal(await db.gfpCheckout.count({where:{propertyId:custody.id,status:"OPEN"}}),1);
      const open=await db.gfpCheckout.findFirstOrThrow({where:{propertyId:custody.id,status:"OPEN"}});assert.equal((await db.governmentProperty.findUniqueOrThrow({where:{id:custody.id}})).checkedOutToId,open.checkedOutById);
      const unavailable=await db.governmentProperty.create({data:{assetTag:"GOV-LOST",description:"Lost asset",propertyType:"GFP",status:"LOST"}});await assert.rejects(run(()=>gfp.checkoutGfp({propertyId:unavailable.id,checkedOutById:users[0].id})),/unavailable/);
      console.log(`PASS GFP-004 ${scope} simultaneous native/service checkout yields exactly one OPEN custody record and matching holder; unavailable property cannot be checked out`);
      const auditA=await db.governmentProperty.create({data:{assetTag:"GOV-AUDIT-A",description:"Audit A",propertyType:"GFP"}}),auditB=await db.governmentProperty.create({data:{assetTag:"GOV-AUDIT-B",description:"Audit B",propertyType:"GFP"}});
      const pending=await db.gfpAuditRecord.create({data:{propertyId:auditB.id,scheduledFor:new Date(),status:"SCHEDULED"}}),beforeMismatch=await snapshot();
      await assert.rejects(invoke(a.actionCompleteGfpAudit,{propertyId:auditA.id,auditId:pending.id,result:"PASS"}),/belong/);assert.equal(await snapshot(),beforeMismatch);
      await assert.rejects(invoke(a.actionCompleteGfpAudit,{propertyId:auditB.id,auditId:pending.id,result:"BANANA"}),/Invalid/);assert.equal(await snapshot(),beforeMismatch);
      await invoke(a.actionCompleteGfpAudit,{propertyId:auditB.id,auditId:pending.id,result:"PASS",findings:"Original immutable evidence"});
      const afterAudit=await snapshot();await invoke(a.actionCompleteGfpAudit,{propertyId:auditB.id,auditId:pending.id,result:"FAIL",findings:"Retry must not rewrite"});assert.equal(await snapshot(),afterAudit);
      assert.equal(await db.gfpAuditRecord.count({where:{propertyId:auditB.id,status:"SCHEDULED"}}),1);assert.equal(await db.complianceCheck.count({where:{propertyId:auditB.id}}),1);assert.equal((await db.gfpAuditRecord.findUniqueOrThrow({where:{id:pending.id}})).result,"PASS");
      const next=await db.gfpAuditRecord.findFirstOrThrow({where:{propertyId:auditB.id,status:"SCHEDULED"}});const auditRace=await Promise.allSettled([1,2].map(()=>invoke(a.actionCompleteGfpAudit,{propertyId:auditB.id,auditId:next.id,result:"PASS"})));assert(auditRace.some(r=>r.status==="fulfilled"));assert.equal(await db.gfpAuditRecord.count({where:{propertyId:auditB.id,status:"SCHEDULED"}}),1);assert.equal(await db.complianceCheck.count({where:{propertyId:auditB.id}}),2);
      const rollbackPending=await db.gfpAuditRecord.findFirstOrThrow({where:{propertyId:auditB.id,status:"SCHEDULED"}}),beforeAuditFailure=await snapshot();
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_gfp_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected GFP evidence failure'; END $$; CREATE TRIGGER qa_fail_gfp_evidence BEFORE INSERT ON ${scope}."ComplianceCheck" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_gfp_evidence();`);
      try{await assert.rejects(invoke(a.actionCompleteGfpAudit,{propertyId:auditB.id,auditId:rollbackPending.id,result:"PASS"}),/injected GFP evidence failure/)}finally{await pg.exec(`DROP TRIGGER qa_fail_gfp_evidence ON ${scope}."ComplianceCheck";DROP FUNCTION ${scope}.qa_fail_gfp_evidence();`)}assert.equal(await snapshot(),beforeAuditFailure);
      console.log(`PASS GFP-001/005 ${scope} native audit rejects mismatched identity; sequential/concurrent retries preserve evidence and one next audit; compliance failure rolls back audit+schedule+property`);
    }
  }finally{await p.$disconnect();await tenant.$disconnect();await socket.stop();await pg.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
