/** Expired physical stock holds and collision-safe lot identity, public + tenant. */
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
  const schema = "tenant_qashelfintegrity01";
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
  const shelf = await import("../src/lib/services/shelf-life");
  const expiring = await import("../src/app/inventory/expiring/actions");
  const fulfillment = await import("../src/lib/services/order-fulfillment");
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
  try {
    await p.tenant.create({ data: { slug: "qa-shelf-integrity", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public",p],[schema,tenant]] as const) {
      const roles=["ADMIN","OPERATOR","ACCOUNTING","CM"];
      const pins=roles.map(() => String(randomInt(100000,999999))); assert.equal(new Set(pins).size,roles.length);
      const users=await Promise.all(roles.map((role,i)=>db.user.create({data:{name:role,email:`${role}@example.invalid`,role,passwordHash:auth.hashPassword(password),pinCode:pins[i]}})));
      const sessions=await Promise.all(users.map(u=>request(()=>scope==="public"?auth.createSession(u.id):auth.createTenantSession(u.id,scope))));
      const run=async<T>(fn:()=>Promise<T>,role="ADMIN")=>(await request(fn,sessions[roles.indexOf(role)].cookies)).value;

      const warehouse = await db.warehouse.create({ data: { code: "SHELF", name: "Synthetic shelf stock" } });
      const location = await db.location.create({ data: { code: "SHELF-STORAGE", name: "Shelf storage", type: "STORAGE", warehouseId: warehouse.id } });
      const part = await db.part.create({ data: { partNumber: "SHELF-A", description: "Adhesive A", shelfLifeDays: 10 } });
      const otherPart = await db.part.create({ data: { partNumber: "SHELF-B", description: "Adhesive B", shelfLifeDays: 20 } });
      const past = new Date(Date.now() - 86_400_000), future = new Date(Date.now() + 30 * 86_400_000);
      const snapshot = async () => JSON.stringify({ lots: await db.lot.findMany({ orderBy: { id: "asc" } }), stock: await db.inventoryItem.findMany({ orderBy: { id: "asc" } }), trace: await db.traceEvent.findMany({ orderBy: { id: "asc" } }), log: await db.auditLog.findMany({ orderBy: { id: "asc" } }) });
      const makeLot = (lotNumber: string, status = "AVAILABLE", quantity = 3) => db.lot.create({ data: { lotNumber, partId: part.id, quantity, expiresAt: past, status } });
      const stock = (lotNumber: string, quantity = 3) => db.inventoryItem.create({ data: { partId: part.id, locationId: location.id, lotNumber, quantityOnHand: quantity, quantityAvailable: quantity, unitCost: 17 } });
      const expired = await makeLot("EXPIRED", "AVAILABLE", 8);
      const ordinary = await stock(expired.lotNumber);
      const held = await stock(expired.lotNumber, 4);
      const ncr = await db.nonConformance.create({ data: { number: "SHELF-NCR", title: "Existing hold", description: "Synthetic prior partial hold", source: "RECEIVING", partId: part.id, quantity: 2 } });
      const mrb = await db.mrbCase.create({ data: { number: "SHELF-MRB", ncrId: ncr.id } });
      await db.inventoryItem.update({ where: { id: held.id }, data: { quantityAvailable: 2, quantityQuarantine: 2, ownership: "GOVERNMENT", mrbCaseId: mrb.id } });
      const serial = await stock(expired.lotNumber, 1);
      await db.inventoryItem.update({ where: { id: serial.id }, data: { serialNumber: "SHELF-SERIAL", quantityAvailable: 0, quantityCommitted: 1, ownership: "CUSTOMER" } });
      const foreignStock = await db.inventoryItem.create({ data: { partId: otherPart.id, locationId: location.id, lotNumber: expired.lotNumber, quantityOnHand: 2, quantityAvailable: 2 } });
      const healthy = await db.lot.create({ data: { lotNumber: "FUTURE", partId: part.id, quantity: 3, expiresAt: future } });
      const healthyStock = await stock(healthy.lotNumber);
      await db.lot.createMany({ data: Array.from({ length: 501 }, (_, i) => ({ id: `aa-healthy-${i}`, lotNumber: `OLD-HOLD-${i}`, partId: part.id, quantity: 0, expiresAt: past, status: "QUARANTINE" })) });
      const legacy = await makeLot("LEGACY-HOLD", "QUARANTINE"), legacyStock = await stock(legacy.lotNumber);
      const zero = await makeLot("ZERO-REGISTER", "AVAILABLE", 0), zeroStock = await stock(zero.lotNumber, 2);
      const beforeDenied = await snapshot();
      await assert.rejects(run(() => expiring.actionQuarantineExpired(), "ACCOUNTING"), /NEXT_REDIRECT/);
      await assert.rejects(request(() => expiring.actionQuarantineExpired()), /Sign in required|NEXT_REDIRECT/);
      assert.equal(await snapshot(), beforeDenied);
      const identity = (item: typeof ordinary) => { const { quantityAvailable, quantityQuarantine, updatedAt, ...rest } = item; void quantityAvailable; void quantityQuarantine; void updatedAt; return rest; };
      const originals = await db.inventoryItem.findMany({ where: { id: { in: [ordinary.id, held.id, serial.id, legacyStock.id, zeroStock.id] } } });
      await run(() => expiring.actionQuarantineExpired());
      for (const original of originals) {
        const current = await db.inventoryItem.findUniqueOrThrow({ where: { id: original.id } });
        assert.equal(current.quantityAvailable, 0); assert.equal(current.quantityQuarantine, current.quantityOnHand);
        assert.deepEqual(identity(current), identity(original));
      }
      assert.deepEqual(await db.inventoryItem.findUniqueOrThrow({ where: { id: foreignStock.id } }), foreignStock);
      assert.deepEqual(await db.inventoryItem.findUniqueOrThrow({ where: { id: healthyStock.id } }), healthyStock);
      for (const lot of [expired, legacy, zero]) assert.equal((await db.lot.findUniqueOrThrow({ where: { id: lot.id } })).status, "QUARANTINE");
      assert.equal(await db.traceEvent.count({ where: { eventType: "QUARANTINED_EXPIRED" } }), 3);
      await assert.rejects(run(() => fulfillment.putAwayInventory({ inventoryItemId: ordinary.id, capturePhotos: false })), /quarantined/);
      const after = await snapshot(); assert.equal(await run(() => shelf.quarantineExpiredLots(users[0].id)), 0); assert.equal(await snapshot(), after);
      console.log(`PASS SHELF-001 ${scope} native sweep holds exact part/lot stock including legacy labels and zero registry quantity, preserves physical/serial/ownership/cost/reservation/MRB identity, blocks putaway; healthy/foreign stock unchanged and retry has no writes`);
      for (const [table, condition] of [["TraceEvent", `NEW."eventType"='QUARANTINED_EXPIRED'`], ["AuditLog", `NEW."entityType"='Lot'`]] as const) {
        const lot = await makeLot(`FAIL-${table}`); await stock(lot.lotNumber); const before = await snapshot();
        await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_shelf() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'injected shelf evidence failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_shelf BEFORE INSERT ON ${scope}."${table}" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_shelf();`);
        try { await assert.rejects(run(() => expiring.actionQuarantineExpired()), /injected shelf evidence failure/); } finally { await pg.exec(`DROP TRIGGER qa_fail_shelf ON ${scope}."${table}"; DROP FUNCTION ${scope}.qa_fail_shelf();`); }
        assert.equal(await snapshot(), before);
        await Promise.all([1, 2].map(() => run(() => expiring.actionQuarantineExpired())));
        assert.equal(await db.traceEvent.count({ where: { eventType: "QUARANTINED_EXPIRED", lotNumber: lot.lotNumber } }), 1);
        assert.equal(await db.auditLog.count({ where: { entityType: "Lot", entityId: lot.id, action: "QUARANTINED_EXPIRED" } }), 1);
      }
      console.log(`PASS SHELF-001 ${scope} trace/audit fault rolls back lot+physical stock+evidence; simultaneous sweeps quarantine each lot exactly once`);
      const collision = await run(() => shelf.recordLot({ lotNumber: "IDENTITY", partId: part.id, quantity: 10, expiresAt: past, userId: users[0].id }));
      const beforeCollision = await snapshot();
      await assert.rejects(run(() => shelf.recordLot({ lotNumber: collision.lotNumber, partId: otherPart.id, quantity: 999, expiresAt: future })), /another part|unique/i);
      assert.equal(await snapshot(), beforeCollision);
      const updated = await run(() => shelf.recordLot({ lotNumber: collision.lotNumber, partId: part.id, quantity: 11, expiresAt: past, userId: users[0].id }));
      assert.equal(updated.id, collision.id); assert.equal(updated.partId, part.id); assert.equal(updated.quantity, 11);
      const competitors = await Promise.allSettled([part, otherPart].map((item, index) => run(() => shelf.recordLot({ lotNumber: "FIRST-RACE", partId: item.id, quantity: index + 1 }))));
      assert.equal(competitors.filter(result => result.status === "fulfilled").length, 1);
      const winner = await db.lot.findUniqueOrThrow({ where: { lotNumber: "FIRST-RACE" } });
      assert.equal(winner.quantity, winner.partId === part.id ? 1 : 2);
      const beforeRecordFailure = await snapshot();
      await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_lot_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType"='Lot' THEN RAISE EXCEPTION 'injected lot audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_lot_audit BEFORE INSERT ON ${scope}."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_lot_audit();`);
      try { await assert.rejects(run(() => shelf.recordLot({ lotNumber: "FAIL-RECORD", partId: part.id, quantity: 1 })), /injected lot audit failure/); } finally { await pg.exec(`DROP TRIGGER qa_fail_lot_audit ON ${scope}."AuditLog"; DROP FUNCTION ${scope}.qa_fail_lot_audit();`); }
      assert.equal(await snapshot(), beforeRecordFailure);
      console.log(`PASS SHELF-002 ${scope} cross-part collision cannot rewrite lot, same-part update preserved, competing first registration has one winner, audit failure rolls back registration`);
    }
  } finally { await p.$disconnect(); await tenant.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
