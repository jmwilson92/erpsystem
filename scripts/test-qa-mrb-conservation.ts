/** MRB physical-route and exact material-conservation regressions in public/tenant fixtures. */
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
  const schema = "tenant_qamrb01";
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
  const auth = await import("../src/lib/auth-core"), a = await import("../src/app/actions"), supply = await import("../src/lib/services/supply-chain"), f = await import("../src/lib/services/order-fulfillment"), receiving = await import("../src/lib/services/receiving");
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
  const pin = randomBytes(8).toString("hex");
  try {
    await p.tenant.create({ data: { slug: "qa-mrb-conservation", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public", p], [schema, tenant]] as const) {
      const roles = ["ADMIN", "CM", "ENGINEERING"];
      const users = await Promise.all(roles.map(role => db.user.create({ data: { name: role, email: `${role}@example.invalid`, role, passwordHash: auth.hashPassword(password), pinCode: pin } })));
      const sessions = await Promise.all(users.map(u => request(() => scope === "public" ? auth.createSession(u.id) : auth.createTenantSession(u.id, scope))));
      const run = async <T>(fn: () => Promise<T>, role = "ADMIN") => (await request(fn, sessions[roles.indexOf(role)].cookies)).value;
      const invoke = async (fn: (fd: FormData) => Promise<unknown>, data: Record<string,string>, role = "ADMIN") => { try { return await run(() => fn(form(data)), role); } catch(e) { if (!/NEXT_REDIRECT/.test(String(e))) throw e; } };
      const admin = users[0];
      const wh = await db.warehouse.create({ data: { code: "QA", name: "Synthetic warehouse" } });
      const loc = await db.location.create({ data: { warehouseId: wh.id, code: "STOCK", name: "Stock", type: "STORAGE" } });
      const quarantine = await db.location.create({ data: { warehouseId: wh.id, code: "QUAR", name: "Held stock", type: "QUARANTINE" } });
      for (const [code,area] of [["ASM-01","MANUFACTURING"],["QA-01","QA"],["TST-01","TEST"],["RCV-01","RECEIVING"]]) await db.workCenter.create({ data: { code, name: code, area, isDefault: true, isActive: true } });
      const supplier = await db.supplier.create({ data: { code: "QA-VENDOR", name: "Synthetic approved vendor", isApprovedVendor: true } });
      let seq = 0;
      async function fixture(quantities = [5], serialized = false) {
        const id = ++seq;
        const part = await db.part.create({ data: { partNumber: `MRB-PART-${id}`, description: "Synthetic held material", isSerialized: serialized } });
        const ncr = await db.nonConformance.create({ data: { number: `QA-NCR-${id}`, title: "Failed QA", description: "Synthetic hold", source: "RECEIVING", partId: part.id, supplierId: supplier.id, quantity: quantities.reduce((a,b) => a+b,0) } });
        const mrb = await db.mrbCase.create({ data: { number: `QA-MRB-${id}`, ncrId: ncr.id } });
        for (const [index,quantity] of quantities.entries()) {
          const serial = serialized ? `MRB-SERIAL-${id}-${index}` : null;
          if (serial) await db.serialNumber.create({ data: { serial, partId: part.id, ownership: "GOVERNMENT", status: "QUARANTINE", lotNumber: "ORIGINAL-LOT" } });
          await db.inventoryItem.create({ data: { partId: part.id, locationId: quarantine.id, quantityOnHand: quantity, quantityQuarantine: quantity, mrbCaseId: mrb.id, ownership: "GOVERNMENT", unitCost: 43.25, lotNumber: "ORIGINAL-LOT", serialNumber: serial } });
        }
        return { part, ncr, mrb };
      }
      const totals = async (partId: string) => (await db.inventoryItem.aggregate({ where: { partId }, _sum: { quantityOnHand: true, quantityAvailable: true, quantityQuarantine: true } }))._sum;
      const decide = (id: string, disposition: "SCRAP"|"USE_AS_IS"|"RETURN_TO_SUPPLIER"|"REWORK"|"REPAIR", quantity: number) => run(() => supply.dispositionMrb({ mrbCaseId: id, disposition, quantity, justification: "Synthetic authorized decision", decidedById: admin.id }));
      for (const disposition of ["USE_AS_IS", "RETURN_TO_SUPPLIER"] as const) {
        const x = await fixture([1,4]);
        const before = JSON.stringify({ totals: await totals(x.part.id), shipments: await db.shipment.count(), decisions: await db.mrbDisposition.count(), workOrders: await db.workOrder.count() });
        for (const quantity of [500, -1, 0, Infinity, NaN]) await assert.rejects(decide(x.mrb.id, disposition, quantity), /exceeds|positive/);
        assert.equal(JSON.stringify({ totals: await totals(x.part.id), shipments: await db.shipment.count(), decisions: await db.mrbDisposition.count(), workOrders: await db.workOrder.count() }), before);
        const authorized = await decide(x.mrb.id, disposition, 2);
        const after = await totals(x.part.id); assert.equal(after.quantityOnHand, disposition === "USE_AS_IS" ? 5 : 3); assert.equal(after.quantityQuarantine, 3);
        assert.equal(after.quantityAvailable, disposition === "USE_AS_IS" ? 2 : 0);
        assert.equal((await db.mrbCase.findUniqueOrThrow({ where: { id: x.mrb.id } })).status, "OPEN");
        assert.equal((await db.materialTransaction.aggregate({ where: { reference: x.mrb.number, type: disposition === "USE_AS_IS" ? "RELEASE" : "TRANSFER" }, _sum: { quantity: true } }))._sum.quantity, 2);
        if (disposition === "RETURN_TO_SUPPLIER") {
          const fresh = await db.inventoryItem.create({ data: { partId: x.part.id, locationId: loc.id, quantityOnHand: 7, quantityAvailable: 7 } });
          const beforePack = JSON.stringify(await totals(x.part.id));
          const shipmentId = authorized.returnShipmentId!;
          await run(() => f.verifyShipmentPackingList({ shipmentId, userId: admin.id }));
          for(let retry=0;retry<2;retry++) await run(() => f.packShipment({ shipmentId, packPhotos: [{ url: "data:image/png;base64,UUE=" }], userId: admin.id }));
          assert.equal(JSON.stringify(await totals(x.part.id)),beforePack,"MRB return packing must not issue unrelated fresh stock again");
          const forged = await db.shipment.create({ data: { number: `FORGED-${x.mrb.id}`, mrbCaseId: x.mrb.id, status: "PICKING", lines: { create: { partId: x.part.id, description: "Unapproved return", quantity: 2 } } } });
          await run(() => f.verifyShipmentPackingList({ shipmentId: forged.id, userId: admin.id }));
          await assert.rejects(run(() => f.packShipment({ shipmentId: forged.id, packPhotos: [{ url: "data:image/png;base64,UUE=" }] })), /committed authorized/);
          assert.equal(JSON.stringify(await totals(x.part.id)),beforePack);
          assert.notEqual((await db.shipment.findUniqueOrThrow({ where: { id: forged.id } })).status,"PACKED");
          await db.inventoryItem.delete({ where: { id: fresh.id } });
        }
        await decide(x.mrb.id, disposition, 3); assert.equal((await totals(x.part.id)).quantityQuarantine, 0);
        assert.equal((await totals(x.part.id)).quantityOnHand, disposition === "USE_AS_IS" ? 5 : 0);
      }
      console.log(`PASS MRB-004/006/007 ${scope} partial multi-hold supplier return and use-as-is move exactly requested units, retain remainder, reject invalid/oversized quantities before side effects`);
      const rollback = await fixture();
      const decisionBefore = JSON.stringify({ stock: await db.inventoryItem.findMany({ where: { partId: rollback.part.id } }), shipments: await db.shipment.count(), decisions: await db.mrbDisposition.count() });
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_mrb() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected disposition failure'; END $$; CREATE TRIGGER qa_fail_mrb BEFORE INSERT ON ${scope}."MrbDisposition" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_mrb();`);
      try { await assert.rejects(decide(rollback.mrb.id,"RETURN_TO_SUPPLIER",2), /injected disposition failure/); }
      finally { await pg.exec(`DROP TRIGGER qa_fail_mrb ON ${scope}."MrbDisposition"; DROP FUNCTION ${scope}.qa_fail_mrb();`); }
      assert.equal(JSON.stringify({ stock: await db.inventoryItem.findMany({ where: { partId: rollback.part.id } }), shipments: await db.shipment.count(), decisions: await db.mrbDisposition.count() }), decisionBefore);
      // Genuine WI -> two own-seat votes -> dock receipt -> failed QA -> rework
      // -> signed BUILD/QA/TEST -> Receiving -> putaway; no forced WO/step state.
      const part = await db.part.create({ data: { partNumber: "MRB-NATIVE-ROUTE", description: "Five-unit physical route", requiresGdtInspection: true } });
      await invoke(a.actionCreateWorkInstruction, { documentNumber: "MRB-NATIVE-WI", revision: "A", title: "Repair and inspect", partId: part.id, step_title_0: "Perform repair", step_instructions_0: "Synthetic operation", step_type_0: "BUILD" });
      const wi = await db.workInstruction.findUniqueOrThrow({ where: { documentNumber_revision: { documentNumber: "MRB-NATIVE-WI", revision: "A" } } });
      for (const [stepType,uom] of [["QA","mm"],["TEST","V"]]) await invoke(a.actionAddWiStep, { workInstructionId: wi.id, title: stepType, instructions: "Measure five", stepType, measureUom: uom, expectedValue: "5" });
      await invoke(a.actionAdvanceWiStatus, { id: wi.id, toStatus: "IN_REVIEW" });
      await invoke(a.actionSubmitWiToCm, { id: wi.id });
      const cr = await db.changeRequest.findFirstOrThrow({ where: { workInstructionId: wi.id } });
      await invoke(a.actionAssignEcrApprovers, { changeRequestId: cr.id, approverUserId1: users[1].id, approverUserId2: users[2].id });
      for (const role of ["CM","ENGINEERING"]) { const seat = await db.cmBoardMember.findFirstOrThrow({ where: { changeRequestId: cr.id, userId: users[roles.indexOf(role)].id } }); await invoke(a.actionVoteCm, { memberId: seat.id, vote: "APPROVE" }, role); }
      assert.equal((await db.workInstruction.findUniqueOrThrow({ where: { id: wi.id } })).status,"RELEASED");
      const po = await db.purchaseOrder.create({ data: { number: "QA-NATIVE-PO", status: "APPROVED", supplierId: supplier.id, lines: { create: { partId: part.id, description: "Five raw units", quantity: 5, unitCost: 0 } } }, include: { lines: true } });
      const traveler = await run(() => receiving.createReceivingTravelerForPo({ purchaseOrderId: po.id, userId: admin.id }));
      await invoke(a.actionScanIntoReceivingTraveler, { travelerId: traveler.id });
      await invoke(a.actionReceivePo, { purchaseOrderId: po.id, travelerId: traveler.id, receivingAck: "true", putawayLocationCode: loc.code, ["qty_"+po.lines[0].id]: "5", packing_doc_0: "data:application/pdf;base64,UUE=", coc_doc_0: "data:application/pdf;base64,UUE=" });
      await invoke(a.actionDeliverTravelerToStation, { travelerId: traveler.id, area: "QA" });
      await invoke(a.actionScanOutReceivingTraveler, { travelerId: traveler.id });
      const inspection = await db.inspection.findFirstOrThrow({ where: { purchaseOrderId: po.id, status: "PENDING" } });
      await invoke(a.actionCompleteReceivingInspection, { inspectionId: inspection.id, result: "FAIL", doc_0: "data:application/pdf;base64,UUE=" });
      const ncr = await db.nonConformance.findFirstOrThrow({ where: { inspectionId: inspection.id } });
      const mrb = await db.mrbCase.findFirstOrThrow({ where: { ncrId: ncr.id } });
      await invoke(a.actionDispositionMrb, { mrbCaseId: mrb.id, disposition: "REWORK", quantity: "5", justification: "Repair and repeat QA/test" });
      const decision = await db.mrbDisposition.findFirstOrThrow({ where: { mrbCaseId: mrb.id } });
      const wo = await db.workOrder.findUniqueOrThrow({ where: { id: decision.reworkWorkOrderId! } });
      assert.equal(await db.workOrderStepCompletion.count({ where: { workOrderId: wo.id, status: "PENDING" } }),3);
      await assert.rejects(run(() => f.completeWorkOrderToStock({ workOrderId: wo.id })), /step|Receiving|putaway/);
      await invoke(a.actionScanWorkOrderToStation, { workOrderId: wo.id, workCenterCode: wo.workCenter! });
      for (const sc of await db.workOrderStepCompletion.findMany({ where: { workOrderId: wo.id }, include: { step: true }, orderBy: { step: { stepNumber: "asc" } } })) await invoke(a.actionSignOffStep, { workOrderId: wo.id, stepId: sc.stepId, result: "PASS", measuredValue: sc.step.measureUom ? "5" : "", measureUom: sc.step.measureUom || "", pinCode: pin });
      await invoke(a.actionSendWoToReceivingPutaway, { workOrderId: wo.id });
      assert.equal((await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status,"READY_FOR_PUTAWAY");
      const beforeRecovery = JSON.stringify({ totals: await totals(part.id), wo: await db.workOrder.findUnique({ where: { id: wo.id } }), mrb: await db.mrbCase.findUnique({ where: { id: mrb.id } }), events: await db.traceEvent.count() });
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_recovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType"='MRB_RECOVERY_COMPLETE' THEN RAISE EXCEPTION 'injected recovery failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_recovery BEFORE INSERT ON ${scope}."TraceEvent" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_recovery();`);
      try { await assert.rejects(run(() => f.completeWorkOrderToStock({ workOrderId: wo.id })), /injected recovery failure/); }
      finally { await pg.exec(`DROP TRIGGER qa_fail_recovery ON ${scope}."TraceEvent"; DROP FUNCTION ${scope}.qa_fail_recovery();`); }
      assert.equal(JSON.stringify({ totals: await totals(part.id), wo: await db.workOrder.findUnique({ where: { id: wo.id } }), mrb: await db.mrbCase.findUnique({ where: { id: mrb.id } }), events: await db.traceEvent.count() }),beforeRecovery);
      await invoke(a.actionCompleteWoToStock, { workOrderId: wo.id });
      assert.deepEqual(await totals(part.id),{ quantityOnHand: 5, quantityAvailable: 5, quantityQuarantine: 0 });
      assert.equal(await db.inventoryItem.count({ where: { mrbCaseId: mrb.id } }),0);
      assert.equal(await db.workInstructionSignOff.count({ where: { workOrderId: wo.id, pinVerified: true } }),3);
      console.log(`PASS MRB-005 ${scope} genuine released-WI/receipt/failed-QA/rework/three-signature/Receiving/putaway chain restores five original units, not ten; injected final trace failure rolls back everything`);
      // Explicit service-state fixtures cover partial and concurrent completion separately.
      for (const [quantity,serialized] of [[2,false],[5,false],[2,true]] as const) {
        const x = await fixture(serialized ? [1,1] : [5],serialized);
        const d = await decide(x.mrb.id,"REWORK",quantity);
        const id = d.reworkWorkOrderId!;
        await db.workOrder.update({ where: { id }, data: { status: "READY_FOR_PUTAWAY", workCenter: "RCV-01" } });
        const runs = await Promise.allSettled([0,1].map(() => run(() => f.completeWorkOrderToStock({ workOrderId: id }))));
        assert.equal(runs.filter(r => r.status === "fulfilled").length,1);
        const result = await totals(x.part.id); assert.equal(result.quantityOnHand,serialized ? 2 : 5); assert.equal(result.quantityAvailable,quantity); assert.equal(result.quantityQuarantine,(serialized ? 2 : 5)-quantity);
        const restored = await db.inventoryItem.findMany({ where: { partId: x.part.id, mrbCaseId: null, quantityOnHand: { gt: 0 } } });
        assert(restored.every(row => row.ownership === "GOVERNMENT" && row.unitCost === 43.25 && row.lotNumber === "ORIGINAL-LOT"));
        if (serialized) { assert.equal(await db.serialNumber.count({ where: { partId: x.part.id } }),2); assert.equal(await db.workOrderUnit.count({ where: { workOrderId: id, status: "COMPLETE", serialId: { not: null } } }),2); }
      }
      console.log(`PASS ${scope} MRB recovery service fixtures conserve partial/full/serialized original quantity, ownership/cost/lot/SNs and permit exactly one concurrent completion`);
    }
  } finally { await p.$disconnect(); await tenant.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
