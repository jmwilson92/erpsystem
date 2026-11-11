/** Atomic packing/idempotency/aggregate-stock regressions in public and tenant schemas. */
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
  const schema = "tenant_qaship01";
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
    await p.tenant.create({ data: { slug: "qa-shipment-stock", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public", p], [schema, tenant]] as const) {
      const admin = await db.user.create({ data: { name: "QA Admin", email: "admin@example.invalid", role: "ADMIN", passwordHash: auth.hashPassword(password) } });
      const cookies = (await request(() => scope === "public" ? auth.createSession(admin.id) : auth.createTenantSession(admin.id, scope))).cookies;
      const run = async <T>(fn: () => Promise<T>) => (await request(fn, cookies)).value;
      const invoke = async (fn: (fd: FormData) => Promise<unknown>, data: Record<string,string>) => run(() => fn(form(data)));
      const photos = [{ url: "data:image/png;base64,UUE=" }];
      const wh = await db.warehouse.create({ data: { code: "QA", name: "Synthetic warehouse" } });
      const loc = await db.location.create({ data: { warehouseId: wh.id, code: "STOCK", name: "Stock", type: "STORAGE" } });
      const quarantine = await db.location.create({ data: { warehouseId: wh.id, code: "HOLD", name: "Quarantine", type: "QUARANTINE" } });
      let seq = 0;
      async function part(quantity: number, second = 0) {
        const item = await db.part.create({ data: { partNumber: `SHIP-PART-${++seq}`, description: "Synthetic stock" } });
        const bin = await db.inventoryItem.create({ data: { partId: item.id, locationId: loc.id, quantityOnHand: quantity, quantityAvailable: quantity } });
        if (second) await db.inventoryItem.create({ data: { partId: item.id, locationId: loc.id, quantityOnHand: second, quantityAvailable: second } });
        return { item, bin };
      }
      async function shipment(partId: string, quantities: number[]) {
        return db.shipment.create({ data: { number: `SHIP-${++seq}`, status: "PICKING", packingListVerified: true,
          lines: { create: quantities.map(quantity => ({ partId, quantity, description: "Synthetic shipment" })) } } });
      }
      const stock = await part(10), manual = await shipment(stock.item.id, [2]);
      await invoke(a.actionPackShipment, { shipmentId: manual.id, pack_photo_0: photos[0].url });
      const packed = await db.shipment.findUniqueOrThrow({ where: { id: manual.id } });
      assert.equal(packed.status, "PACKED");
      for (let retry = 0; retry < 2; retry++) await invoke(a.actionPackShipment, { shipmentId: manual.id, pack_photo_0: photos[0].url, notes: "Do not overwrite original packing evidence" });
      assert.deepEqual(await db.shipment.findUniqueOrThrow({ where: { id: manual.id } }), packed);
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: stock.bin.id } })).quantityOnHand, 8);
      assert.equal(await db.materialTransaction.count({ where: { reference: manual.number, type: "SHIP" } }), 1);
      const concurrent = await shipment(stock.item.id, [2]);
      const attempts = await Promise.all([0,1].map(() => run(() => f.packShipment({ shipmentId: concurrent.id, packPhotos: photos }))));
      assert(attempts.every(s => s.status === "PACKED"));
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: stock.bin.id } })).quantityOnHand, 6);
      assert.equal(await db.materialTransaction.count({ where: { reference: concurrent.number, type: "SHIP" } }), 1);
      console.log(`PASS SHIP-002 ${scope} repeated and concurrent manual packing issues stock once and preserves packing evidence`);
      const duplicate = await part(5), short = await shipment(duplicate.item.id, [4,4]);
      const unchanged = async () => JSON.stringify({ stock: await db.inventoryItem.findMany(), shipment: await db.shipment.findUnique({ where: { id: short.id } }), transactions: await db.materialTransaction.findMany() });
      const before = await unchanged(); await assert.rejects(run(() => f.packShipment({ shipmentId: short.id, packPhotos: photos })), /insufficient stock/); assert.equal(await unchanged(), before);
      const enough = await part(3,5), split = await shipment(enough.item.id, [4,4]);
      await run(() => f.packShipment({ shipmentId: split.id, packPhotos: photos }));
      assert.equal((await db.inventoryItem.aggregate({ where: { partId: enough.item.id }, _sum: { quantityOnHand: true } }))._sum.quantityOnHand, 0);
      assert.equal((await db.materialTransaction.aggregate({ where: { reference: split.number, type: "SHIP" }, _sum: { quantity: true } }))._sum.quantity, 8);
      const held = await part(0); await db.inventoryItem.create({ data: { partId: held.item.id, locationId: quarantine.id, quantityOnHand: 5, quantityAvailable: 5 } });
      const heldShipment = await shipment(held.item.id, [1]); await assert.rejects(run(() => f.packShipment({ shipmentId: heldShipment.id, packPhotos: photos })), /insufficient stock/);
      console.log(`PASS SHIP-003 ${scope} duplicate-part demand aggregates across bins, rejects eight-from-five atomically, and ignores quarantine stock`);
      const racing = await part(5), first = await shipment(racing.item.id, [4]), second = await shipment(racing.item.id, [4]);
      const race = await Promise.allSettled([first, second].map(s => run(() => f.packShipment({ shipmentId: s.id, packPhotos: photos }))));
      assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: racing.bin.id } })).quantityOnHand, 1);
      const rollback = await part(5), reject = await shipment(rollback.item.id, [2]);
      const beforeFailure = JSON.stringify({ bin: await db.inventoryItem.findUnique({ where: { id: rollback.bin.id } }), shipment: await db.shipment.findUnique({ where: { id: reject.id } }), count: await db.materialTransaction.count() });
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_ship() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='SHIP' THEN RAISE EXCEPTION 'injected shipment trace failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_ship BEFORE INSERT ON ${scope}."MaterialTransaction" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_ship();`);
      try { await assert.rejects(run(() => f.packShipment({ shipmentId: reject.id, packPhotos: photos })), /injected shipment trace failure/); }
      finally { await pg.exec(`DROP TRIGGER qa_fail_ship ON ${scope}."MaterialTransaction"; DROP FUNCTION ${scope}.qa_fail_ship();`); }
      assert.equal(JSON.stringify({ bin: await db.inventoryItem.findUnique({ where: { id: rollback.bin.id } }), shipment: await db.shipment.findUnique({ where: { id: reject.id } }), count: await db.materialTransaction.count() }), beforeFailure);
      await run(() => f.packShipment({ shipmentId: reject.id, packPhotos: photos }));
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: rollback.bin.id } })).quantityOnHand, 3);
      console.log(`PASS ${scope} competing shipments cannot overdraw shared stock; trace failure rolls back packed state and deductions and retry succeeds`);
      const customer = await db.customer.create({ data: { code: "QA-CUSTOMER", name: "Synthetic customer" } });
      const salesStock = await part(10);
      const so = await run(() => f.createSalesOrder({ customerId: customer.id, requiredDate: new Date("2026-01-01"), allowEarlyShip: true, lines: [{ partId: salesStock.item.id, quantity: 2, unitPrice: 10 }], createdById: admin.id }));
      await run(() => f.planSalesOrderFulfillment({ salesOrderId: so.id, userId: admin.id }));
      const queued = await run(() => f.ensureShipmentForSalesOrder({ salesOrderId: so.id, userId: admin.id }));
      const salesShipment = queued.shipment; assert(salesShipment);
      await invoke(a.actionVerifyPackingList, { shipmentId: salesShipment.id });
      await invoke(a.actionPackShipment, { shipmentId: salesShipment.id, pack_photo_0: photos[0].url });
      // SO stock is issued at ship, not at pack.
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: salesStock.bin.id } })).quantityOnHand, 10);
      await run(() => f.shipSalesOrder({ salesOrderId: so.id, shipmentId: salesShipment.id, userId: admin.id }));
      const shipped = await db.shipment.findUniqueOrThrow({ where: { id: salesShipment.id } }); assert.equal(shipped.status, "SHIPPED");
      await assert.rejects(invoke(a.actionPackShipment, { shipmentId: shipped.id, pack_photo_0: photos[0].url }), /Cannot pack/);
      assert.deepEqual(await db.shipment.findUniqueOrThrow({ where: { id: shipped.id } }), shipped);
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: salesStock.bin.id } })).quantityOnHand, 8);
      console.log(`PASS SHIP-002 ${scope} real SO plan/verify/pack/ship stays terminal and packing does not double-deduct SO stock`);
    }
  } finally { await p.$disconnect(); await tenant.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
