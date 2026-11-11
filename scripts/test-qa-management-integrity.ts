/** Atomic management mutations and once-only maintenance completion, public + tenant. */
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
  const schema = "tenant_qamanagement01";
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
  const fleet = await import("../src/lib/services/fleet"), maintenance = await import("../src/lib/services/maintenance");
  const fActions = await import("../src/app/fleet/actions"), mActions = await import("../src/app/maintenance/actions");
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
    await p.tenant.create({ data: { slug: "qa-management", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public",p],[schema,tenant]] as const) {
      const roles=["ADMIN","OPERATOR","HR","ACCOUNTING"];
      const pins=roles.map(() => String(randomInt(100000,999999))); assert.equal(new Set(pins).size,roles.length);
      const users=await Promise.all(roles.map((role,i)=>db.user.create({data:{name:role,email:`${role}@example.invalid`,role,passwordHash:auth.hashPassword(password),pinCode:pins[i]}})));
      const sessions=await Promise.all(users.map(u=>request(()=>scope==="public"?auth.createSession(u.id):auth.createTenantSession(u.id,scope))));
      const run=async<T>(fn:()=>Promise<T>,role="ADMIN")=>(await request(fn,sessions[roles.indexOf(role)].cookies)).value;

      const invoke = async (fn: (fd: FormData) => Promise<unknown>, data: Record<string, string>, role = "OPERATOR") => {
        try { return await run(() => fn(form(data)), role); } catch (e) { if (!/NEXT_REDIRECT/.test(String(e)) || String((e as { digest?: string }).digest).includes("/no-access")) throw e; }
      };
      const product = await db.product.create({ data: { code: "QA-MGMT", name: "Synthetic product" } }), project = await db.project.create({ data: { number: "QA-MGMT", name: "Synthetic project" } });
      const vehicle = await db.vehicle.create({ data: { unitNumber: "QA-MGMT", odometer: 1000 } }), equipment = await db.equipment.create({ data: { assetTag: "QA-MGMT", name: "Synthetic machine", meter: 100 } });
      const snapshot = async () => JSON.stringify({ variants: await db.productVariant.findMany({ orderBy: { id: "asc" } }), tasks: await db.projectTask.findMany({ orderBy: { id: "asc" } }), vehicle: await db.vehicle.findMany(), fleet: await db.vehicleMaintenance.findMany({ orderBy: { id: "asc" } }), fuel: await db.fuelLog.findMany({ orderBy: { id: "asc" } }), equipment: await db.equipment.findMany(), jobs: await db.equipmentMaintenance.findMany({ orderBy: { id: "asc" } }), meter: await db.meterReading.findMany({ orderBy: { id: "asc" } }), audit: await db.auditLog.findMany({ orderBy: { id: "asc" } }) });
      const variant = (code: string, fields: Record<string,string> = {}) => invoke(a.actionAddProductVariant, { productId: product.id, code, name: code, isDefault: "true", ...fields }, "ADMIN");
      const negative = process.env.QA_NEGATIVE_ID;
      if (negative) {
        if (negative === "PLM-001") { await variant("BASE"); const prior = await snapshot(); await assert.rejects(variant("BASE")); assert.equal(await snapshot(), prior); }
        else if (negative === "PMO-001") { const task = await db.projectTask.create({data:{projectId:project.id,name:"Negative progress"}}); await assert.rejects(invoke(a.actionUpdatePmoTask,{id:task.id,projectId:project.id,percentComplete:"250"},"ADMIN")); }
        else if (negative === "FLEET-001") { const job = await db.vehicleMaintenance.create({data:{vehicleId:vehicle.id,intervalDistance:5000}}); const fd = {id:job.id,vehicleId:vehicle.id,completedOdometer:"1200"}; await invoke(fActions.actionCompleteMaintenance,fd,"ADMIN"); await invoke(fActions.actionCompleteMaintenance,fd,"ADMIN"); assert.equal(await db.vehicleMaintenance.count({where:{status:"SCHEDULED"}}),1); }
        else if (negative === "MAINT-001") { const job = await db.equipmentMaintenance.create({data:{equipmentId:equipment.id,intervalMeter:100}}); const fd = {id:job.id,equipmentId:equipment.id,completedMeter:"150"}; await invoke(mActions.actionCompleteMaintenance,fd,"ADMIN"); await invoke(mActions.actionCompleteMaintenance,fd,"ADMIN"); assert.equal(await db.equipmentMaintenance.count({where:{status:"SCHEDULED"}}),1); }
        else if (negative === "FLEET-002") await assert.rejects(invoke(fActions.actionAddFuel,{vehicleId:vehicle.id,gallons:"-10",cost:"40"},"ADMIN"));
        else throw new Error("Unknown negative-control ID");
        continue;
      }
      await variant("BASE"); let before = await snapshot(); await assert.rejects(variant("BASE"), /Unique constraint/); assert.equal(await snapshot(), before); before = await snapshot(); await assert.rejects(variant("INVALID", { topLevelPartId: "missing-part" }), /Foreign key|constraint/i); assert.equal(await snapshot(), before);
      await Promise.all([variant("SECOND"),variant("THIRD")]); assert.equal(await db.productVariant.count({ where: { productId: product.id, isDefault: true } }), 1);
      const task = await db.projectTask.create({ data: { projectId: project.id, name: "Synthetic task" } });
      for (const percentComplete of ["250", "-1", "NaN", "Infinity", "malformed"]) { before = await snapshot(); await assert.rejects(invoke(a.actionUpdatePmoTask, { id: task.id, projectId: project.id, status: "IN_PROGRESS", percentComplete }, "ADMIN"), /finite.*0 and 100/); assert.equal(await snapshot(), before); }
      await invoke(a.actionUpdatePmoTask, { id: task.id, projectId: project.id, percentComplete: "25" }, "ADMIN"); assert.equal((await db.projectTask.findUniqueOrThrow({ where: { id: task.id } })).percentComplete, 25); await invoke(a.actionUpdatePmoTask, { id: task.id, projectId: project.id, status: "DONE", percentComplete: "0" }, "ADMIN"); assert.equal((await db.projectTask.findUniqueOrThrow({ where: { id: task.id } })).percentComplete, 100);
      console.log(`PASS PLM-001/PMO-001 ${scope} duplicate/invalid default variant inserts roll back and concurrent defaults serialize to one; native task progress rejects malformed/nonfinite/out-of-range values while valid progress and DONE100 work`);
      const completeFleet = (id: string, reading = "1200") => invoke(fActions.actionCompleteMaintenance, { id, vehicleId: vehicle.id, completedOdometer: reading, cost: "10" }, "ADMIN");
      const completeEquipment = (id: string, reading = "150") => invoke(mActions.actionCompleteMaintenance, { id, equipmentId: equipment.id, completedMeter: reading, cost: "10", downtimeMinutes: "1" }, "ADMIN");
      const f = await db.vehicleMaintenance.create({ data: { vehicleId: vehicle.id, intervalDistance: 5000 } }); await Promise.all([completeFleet(f.id),completeFleet(f.id)]); before = await snapshot(); await completeFleet(f.id,"9999"); assert.equal(await snapshot(),before); const nextFleet = await db.vehicleMaintenance.findMany({ where: { vehicleId: vehicle.id, status: "SCHEDULED" } }); assert.equal(nextFleet.length,1); assert.equal(nextFleet[0].dueOdometer,6200); assert.equal((await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).odometer,1200);
      const e = await db.equipmentMaintenance.create({ data: { equipmentId: equipment.id, intervalMeter: 100 } }); await Promise.all([completeEquipment(e.id),completeEquipment(e.id)]); before = await snapshot(); await completeEquipment(e.id,"9999"); assert.equal(await snapshot(),before); const nextEquipment = await db.equipmentMaintenance.findMany({ where: { equipmentId: equipment.id, status: "SCHEDULED" } }); assert.equal(nextEquipment.length,1); assert.equal(nextEquipment[0].dueMeter,250); assert.equal((await db.equipment.findUniqueOrThrow({ where: { id: equipment.id } })).meter,150);
      const cancelled = await db.vehicleMaintenance.create({ data: { vehicleId: vehicle.id, status: "CANCELLED" } }), skipped = await db.equipmentMaintenance.create({ data: { equipmentId: equipment.id, status: "SKIPPED" } }); before = await snapshot(); await assert.rejects(completeFleet(cancelled.id),/Only scheduled/); await assert.rejects(completeEquipment(skipped.id),/Only scheduled/); assert.equal(await snapshot(),before);
      const stale = await db.equipmentMaintenance.create({ data: { equipmentId: equipment.id, intervalMeter: 100 } }); await completeEquipment(stale.id,"100"); assert.equal((await db.equipment.findUniqueOrThrow({ where: { id: equipment.id } })).meter,150);
      for (const [kind, table, condition] of [["fleet","VehicleMaintenance", `NEW."status"='SCHEDULED'`],["equipment","EquipmentMaintenance",`NEW."status"='SCHEDULED'`],["fleet","AuditLog",`NEW."entityType"='VehicleMaintenance' AND NEW."action"='COMPLETED'`],["equipment","AuditLog",`NEW."entityType"='EquipmentMaintenance' AND NEW."action"='COMPLETED'`],["equipment","MeterReading","TRUE"]] as const) {
        const job = kind === "fleet" ? await db.vehicleMaintenance.create({ data: { vehicleId: vehicle.id, intervalDistance: 5000 } }) : await db.equipmentMaintenance.create({ data: { equipmentId: equipment.id, intervalMeter: 100 } }); before = await snapshot();
        await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'injected completion failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_completion BEFORE INSERT ON ${scope}."${table}" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_completion();`);
        try { await assert.rejects(kind === "fleet" ? completeFleet(job.id,"1500") : completeEquipment(job.id,"200"), /injected completion failure/); } finally { await pg.exec(`DROP TRIGGER qa_fail_completion ON ${scope}."${table}"; DROP FUNCTION ${scope}.qa_fail_completion();`); } assert.equal(await snapshot(),before); if (kind === "fleet") await completeFleet(job.id,"1500"); else await completeEquipment(job.id,"200");
      }
      console.log(`PASS FLEET-001/MAINT-001 ${scope} repeated/concurrent completions create exactly one successor with6200/250 target; completed evidence is immutable, cancelled/skipped work cannot resurrect; stale meters remain forward-only and successor/audit/meter failures roll back completion and readings`);
      const fuel = (gallons: string, cost = "40", odometer = "1800") => invoke(fActions.actionAddFuel, { vehicleId: vehicle.id, gallons, cost, odometer }, "ADMIN"); await fuel("10");
      for (const gallons of ["-10","0"]) { before = await snapshot(); await assert.rejects(fuel(gallons), /Fuel quantity/); assert.equal(await snapshot(),before); }
      before = await snapshot(); await assert.rejects(fuel("10","-1"),/Fuel quantity/); await assert.rejects(run(() => fleet.addFuelLog({ vehicleId: vehicle.id, gallons: Infinity, cost: 40 })),/Fuel quantity/); assert.equal(await snapshot(),before);
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_odometer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected odometer failure'; END $$; CREATE TRIGGER qa_fail_odometer BEFORE UPDATE ON ${scope}."Vehicle" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_odometer();`); before = await snapshot(); try { await assert.rejects(fuel("10","40","9999"),/injected odometer failure/); } finally { await pg.exec(`DROP TRIGGER qa_fail_odometer ON ${scope}."Vehicle"; DROP FUNCTION ${scope}.qa_fail_odometer();`); } assert.equal(await snapshot(),before);
      await Promise.all([run(() => fleet.recordOdometer(vehicle.id,2100)),run(() => fleet.recordOdometer(vehicle.id,2000))]); assert.equal((await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).odometer,2100);
      await Promise.allSettled([run(() => maintenance.recordMeter({ equipmentId:equipment.id,value:300 })),run(() => maintenance.recordMeter({ equipmentId:equipment.id,value:250 }))]); assert.equal((await db.equipment.findUniqueOrThrow({ where: { id:equipment.id } })).meter,300);
      console.log(`PASS FLEET-002 ${scope} native negative/zero fuel and invalid costs reject without rows; fuel/odometer update is atomic and concurrent odometer/meter readings cannot roll back`);
    }
  } finally { await p.$disconnect(); await tenant.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
