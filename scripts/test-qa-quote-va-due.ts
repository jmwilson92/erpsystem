/** Quote terminal send guard, virtual-asset seats/consumed state, and Pacific due-date display. */
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
  const schema = "tenant_qaquoteva01";
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
  const fulfillment = await import("../src/lib/services/order-fulfillment");
  const va = await import("../src/lib/services/virtual-assets");
  const { formatDate } = await import("../src/lib/utils");
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
    await p.tenant.create({ data: { slug: "qa-quote-va", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public", p], [schema, tenant]] as const) {
      const roles = ["ADMIN", "OPERATOR"];
      const pins = roles.map(() => String(randomInt(100000, 999999))); assert.equal(new Set(pins).size, roles.length);
      const users = await Promise.all(roles.map((role, i) => db.user.create({ data: { name: role, email: `${role}@example.invalid`, role, passwordHash: auth.hashPassword(password), pinCode: pins[i] } })));
      const sessions = await Promise.all(users.map((u) => request(() => scope === "public" ? auth.createSession(u.id) : auth.createTenantSession(u.id, scope))));
      const run = async <T>(fn: () => Promise<T>, role = "ADMIN") => (await request(fn, sessions[roles.indexOf(role)].cookies)).value;
      const invoke = async (fn: (fd: FormData) => Promise<unknown>, data: Record<string, string>, role = "ADMIN") => {
        try { return await run(() => fn(form(data)), role); } catch (e) { if (!/NEXT_REDIRECT/.test(String(e)) || String((e as { digest?: string }).digest).includes("/no-access")) throw e; }
      };

      const part = await db.part.create({ data: { partNumber: "QA-QVA-PART", description: "Synthetic part", standardCost: 10, sourcingMethod: "PURCHASE" } });
      const customer = await db.customer.create({ data: { name: "QA Quote Customer", code: "QAQVA" } });
      const quote = await db.quote.create({
        data: {
          number: "QT-QA-004",
          customerId: customer.id,
          status: "DRAFT",
          lines: { create: { partId: part.id, description: part.description, quantity: 2, unitPrice: 15 } },
        },
      });
      const so = await run(() => fulfillment.convertQuoteToSalesOrder({ quoteId: quote.id, userId: users[0].id }));
      const converted = await db.quote.findUniqueOrThrow({ where: { id: quote.id } });
      assert.equal(converted.status, "CONVERTED");
      assert.ok(so.number);
      const beforeSend = JSON.stringify({ quote: await db.quote.findUnique({ where: { id: quote.id } }), so: await db.salesOrder.findMany({ orderBy: { id: "asc" } }) });
      await invoke(a.actionSendQuote, { quoteId: quote.id });
      assert.equal((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status, "CONVERTED");
      assert.equal(JSON.stringify({ quote: await db.quote.findUnique({ where: { id: quote.id } }), so: await db.salesOrder.findMany({ orderBy: { id: "asc" } }) }), beforeSend);
      const rejected = await db.quote.create({ data: { number: "QT-QA-REJ", customerId: customer.id, status: "REJECTED" } });
      await invoke(a.actionSendQuote, { quoteId: rejected.id });
      assert.equal((await db.quote.findUniqueOrThrow({ where: { id: rejected.id } })).status, "REJECTED");
      const draft = await db.quote.create({ data: { number: "QT-QA-DRAFT", customerId: customer.id, status: "DRAFT" } });
      await invoke(a.actionSendQuote, { quoteId: draft.id });
      assert.equal((await db.quote.findUniqueOrThrow({ where: { id: draft.id } })).status, "SENT");
      console.log(`PASS SALES-004 ${scope} sending a converted or rejected quote leaves status unchanged; a genuine draft can still be sent`);

      const license = await run(() => va.createVirtualAsset({ name: "QA License", seats: 2, userId: users[0].id }));
      await invoke(a.actionAssignVirtualAsset, { assetId: license.id, userId: users[1].id });
      await invoke(a.actionAssignVirtualAsset, { assetId: license.id, userId: users[1].id });
      let held = await db.virtualAsset.findUniqueOrThrow({ where: { id: license.id } });
      assert.equal(held.seatsUsed, 1);
      assert.equal(held.assignedToId, users[1].id);
      await invoke(a.actionUnassignVirtualAsset, { assetId: license.id });
      held = await db.virtualAsset.findUniqueOrThrow({ where: { id: license.id } });
      assert.equal(held.seatsUsed, 0);
      assert.equal(held.assignedToId, null);
      console.log(`PASS VA-001 ${scope} assigning the same user twice is idempotent; one unassign returns seatsUsed to 0`);

      const tool = await run(() => va.createVirtualAsset({ name: "QA Consumable", seats: 1, userId: users[0].id }));
      const wo = await db.workOrder.create({ data: { number: "WO-QA-VA", type: "TASK_ONLY", status: "RELEASED" } });
      await invoke(a.actionConsumeVirtualAsset, { assetId: tool.id, workOrderId: wo.id, notes: "into unit" });
      const consumed = await db.virtualAsset.findUniqueOrThrow({ where: { id: tool.id } });
      assert.equal(consumed.status, "CONSUMED");
      const consumedSnap = JSON.stringify(consumed);
      await assert.rejects(run(() => va.returnVirtualAsset({ assetId: tool.id, actorId: users[0].id })), /consumed/i);
      await assert.rejects(run(() => va.checkoutVirtualAsset({ assetId: tool.id, userId: users[1].id })), /consumed/i);
      await assert.rejects(run(() => va.assignVirtualAsset({ assetId: tool.id, userId: users[1].id, actorId: users[0].id })), /consumed/i);
      const still = await db.virtualAsset.findUniqueOrThrow({ where: { id: tool.id } });
      assert.equal(still.status, "CONSUMED");
      assert.equal(JSON.stringify(still), consumedSnap);
      console.log(`PASS VA-002 ${scope} ordinary return, checkout and assign cannot resurrect a consumed asset`);

      assert.equal(formatDate("2090-05-17"), "May 17, 2090");
      assert.equal(formatDate("2090-05-17T00:00:00.000Z"), "May 17, 2090");
      assert.equal(formatDate(new Date(Date.UTC(2090, 4, 17))), "May 17, 2090");
      const dueWo = await db.workOrder.create({ data: { number: "WO-QA-DUE", type: "TASK_ONLY" } });
      await invoke(a.actionSetWorkOrderDueDate, { workOrderId: dueWo.id, dueDate: "2090-05-17" });
      const saved = await db.workOrder.findUniqueOrThrow({ where: { id: dueWo.id } });
      assert.ok(saved.dueDate);
      assert.equal(formatDate(saved.dueDate), "May 17, 2090");
      console.log(`PASS WORK-009 ${scope} date-only promised day 2090-05-17 displays May 17, 2090 in Pacific time after persist and formatDate`);
    }
  } finally {
    await socket.stop();
    await pg.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
