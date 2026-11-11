/** Quantity-weighted repair pricing and terminal-safe quote identity, public + tenant. */
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
  const schema = "tenant_qarmaintegrity01";
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
  const repair = await import("../src/lib/services/rma");
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
    await p.tenant.create({ data: { slug: "qa-rma", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public",p],[schema,tenant]] as const) {
      const roles=["ADMIN","OPERATOR","HR","ACCOUNTING"];
      const pins=roles.map(() => String(randomInt(100000,999999))); assert.equal(new Set(pins).size,roles.length);
      const users=await Promise.all(roles.map((role,i)=>db.user.create({data:{name:role,email:`${role}@example.invalid`,role,passwordHash:auth.hashPassword(password),pinCode:pins[i]}})));
      const sessions=await Promise.all(users.map(u=>request(()=>scope==="public"?auth.createSession(u.id):auth.createTenantSession(u.id,scope))));
      const run=async<T>(fn:()=>Promise<T>,role="ADMIN")=>(await request(fn,sessions[roles.indexOf(role)].cookies)).value;

      const invoke = async (fn: (fd: FormData) => Promise<unknown>, data: Record<string, string>, role = "OPERATOR") => {
        try { return await run(() => fn(form(data)), role); } catch (e) { if (!/NEXT_REDIRECT/.test(String(e)) || String((e as { digest?: string }).digest).includes("/no-access")) throw e; }
      };
      const part = await db.part.create({ data: { partNumber: "QA-RMA-PART", description: "Synthetic returned unit" } }), customer = await db.customer.create({ data: { code: "QA-RMA-CUSTOMER", name: "Synthetic customer" } });
      let seq = 0;
      const rma = (status = "EVALUATING") => db.rma.create({ data: { number: `QA-RMA-${++seq}`, topPartId: part.id, customerId: customer.id, customerSn: `QA-SN-${seq}`, status, coverage: "CHARGEABLE" } });
      const snapshot = async () => JSON.stringify({ rmas: await db.rma.findMany({ orderBy: { id: "asc" } }), quotes: await db.quote.findMany({ orderBy: { id: "asc" }, include: { lines: { orderBy: { id: "asc" } } } }), wo: await db.workOrder.findMany({ orderBy: { id: "asc" } }), units: await db.workOrderUnit.findMany({ orderBy: { id: "asc" } }), audits: await db.auditLog.findMany({ orderBy: { id: "asc" } }) });
      const create = (rmaId: string) => invoke(a.actionCreateRepairQuoteForRma, { rmaId }, "ADMIN");
      const update = (rmaId: string, lines: { quantity: number; unitPrice: number }[]) => invoke(a.actionUpdateRepairQuote, { rmaId, lineCount: String(lines.length), ...Object.fromEntries(lines.flatMap((l,i) => [[`desc_${i}`, `Synthetic charge ${i}`], [`qty_${i}`, String(l.quantity)], [`price_${i}`, String(l.unitPrice)]])) }, "ADMIN");
      const adjust = (rmaId: string, total: number | string, reason = "Authorized synthetic adjustment") => invoke(a.actionAdjustRmaQuotePrice, { rmaId, newTotal: String(total), reason }, "ADMIN");
      const loaded = (id: string) => db.rma.findUniqueOrThrow({ where: { id }, include: { quote: { include: { lines: true } }, workOrders: true } });
      const reconciles = async (id: string, total: number) => { const row = await loaded(id); assert.equal(row.quote!.totalAmount, total); assert.equal(row.quotedPrice, total); assert.equal(row.finalPrice, total); assert.ok(Math.abs(row.quote!.lines.reduce((sum,l) => sum + l.quantity * l.unitPrice, 0) - total) < .000001); return row; };
      const m = await rma(); await create(m.id); await update(m.id, [{ quantity: 2, unitPrice: 100 }]); await adjust(m.id, 150); let current = await reconciles(m.id, 150); assert.equal(current.quote!.lines[0].quantity, 2); assert.equal(current.quote!.lines[0].unitPrice, 75);
      await update(m.id, [{ quantity: 2, unitPrice: 20 }, { quantity: 3, unitPrice: 100 }]); await adjust(m.id, 100); current = await reconciles(m.id, 100); assert.equal(current.quote!.lines.find(l => l.lineNumber === 2)!.quantity, 3); assert.equal(current.quote!.lines.find(l => l.lineNumber === 2)!.unitPrice, 20);
      await update(m.id, [{ quantity: 2.5, unitPrice: 100 }]); await adjust(m.id, 150); await reconciles(m.id, 150); await adjust(m.id, 0); await reconciles(m.id, 0);
      for (const total of [-1, NaN, Infinity, "malformed"]) { const before = await snapshot(); await adjust(m.id, total); assert.equal(await snapshot(), before); }
      let before = await snapshot(); await adjust(m.id, 10, ""); assert.equal(await snapshot(), before);
      for (const line of [{ quantity: 0, unitPrice: 1 }, { quantity: NaN, unitPrice: 1 }, { quantity: 1, unitPrice: Infinity }, { quantity: 1, unitPrice: -1 }]) { before = await snapshot(); await update(m.id, [line]); assert.equal(await snapshot(), before); }
      before = await snapshot(); await assert.rejects(run(() => repair.updateRepairQuote({ rmaId: m.id, lines: [{ description: "Invalid foreign key", quantity: 1, unitPrice: 2, partId: "missing-part" }] })), /Foreign key|constraint/i); assert.equal(await snapshot(), before);
      const empty = await rma(); await create(empty.id); const emptyQuote = (await loaded(empty.id)).quoteId!; await db.quoteLine.deleteMany({ where: { quoteId: emptyQuote } }); await adjust(empty.id, 33); assert.equal((await reconciles(empty.id, 33)).quote!.lines[0].quantity, 1);
      for (const [table, event, condition] of [["Quote", "UPDATE", "TRUE"], ["Rma", "UPDATE", "TRUE"], ["AuditLog", "INSERT", `NEW."action"='PRICE_ADJUST'`]] as const) {
        before = await snapshot(); await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_price() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'injected price failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_price BEFORE ${event} ON ${scope}."${table}" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_price();`);
        try { await adjust(m.id, 55); } finally { await pg.exec(`DROP TRIGGER qa_fail_price ON ${scope}."${table}"; DROP FUNCTION ${scope}.qa_fail_price();`); } assert.equal(await snapshot(), before); await adjust(m.id, 55); await reconciles(m.id, 55);
      }
      console.log(`PASS RMA-001 ${scope} quantity2 at100 adjusted to150 becomes2 at75; multi-line and fractional quantities reconcile with header/RMA totals; invalid totals/lines/reasons reject, empty legacy quotes gain a valid line, and line/header/RMA/audit failures roll back`);
      const concurrent = await rma(); await Promise.all([create(concurrent.id), create(concurrent.id)]); const canonical = await loaded(concurrent.id); assert.equal(await db.quote.count({ where: { rma: { id: concurrent.id } } }), 1); before = await snapshot(); await create(concurrent.id); assert.equal(await snapshot(), before);
      const another = await rma(), third = await rma(); await Promise.all([create(another.id), create(third.id)]); assert.notEqual((await loaded(another.id)).quote!.number, (await loaded(third.id)).quote!.number);
      await update(concurrent.id, [{ quantity: 2, unitPrice: 100 }]); const accept = (quoteId: string) => invoke(a.actionAcceptRepairQuote, { quoteId }, "ADMIN"); await accept(canonical.quoteId!); const accepted = await loaded(concurrent.id); assert.equal(accepted.quote!.status, "ACCEPTED"); assert.equal(accepted.status, "IN_WORK"); assert.equal(accepted.workOrders.length, 1); const acceptedId = accepted.quoteId;
      before = await snapshot(); await accept(acceptedId!); await create(concurrent.id); assert.equal(await snapshot(), before); assert.equal((await loaded(concurrent.id)).quoteId, acceptedId);
      for (const state of ["CANCELLED", "COMPLETE", "COMPLETED", "CLOSED", "SHIPPED"]) {
        await db.rma.update({ where: { id: concurrent.id }, data: { status: state } }); before = await snapshot(); await create(concurrent.id); await update(concurrent.id, [{ quantity: 1, unitPrice: 1 }]); await adjust(concurrent.id, 1); await accept(acceptedId!); assert.equal(await snapshot(), before); await assert.rejects(run(() => repair.createRepairQuoteForRma({ rmaId: concurrent.id })), /Cannot change repair quote/);
        const terminalNoQuote = await rma(state); before = await snapshot(); await create(terminalNoQuote.id); assert.equal(await snapshot(), before);
      }
      const corrupt = await rma(); await create(corrupt.id); await update(corrupt.id, [{ quantity: 2, unitPrice: 100 }]); const corruptId = (await loaded(corrupt.id)).quoteId!; await db.quote.update({ where: { id: corruptId }, data: { totalAmount: 150 } }); before = await snapshot(); await accept(corruptId); assert.equal(await snapshot(), before); await adjust(corrupt.id, 150); await accept(corruptId); assert.equal((await loaded(corrupt.id)).status, "IN_WORK");
      const failCreate = await rma(); before = await snapshot(); await pg.exec(`CREATE FUNCTION ${scope}.qa_fail_quote_create() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action"='REPAIR_QUOTE_CREATED' THEN RAISE EXCEPTION 'injected quote audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_quote_create BEFORE INSERT ON ${scope}."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${scope}.qa_fail_quote_create();`);
      try { await create(failCreate.id); } finally { await pg.exec(`DROP TRIGGER qa_fail_quote_create ON ${scope}."AuditLog"; DROP FUNCTION ${scope}.qa_fail_quote_create();`); } assert.equal(await snapshot(), before); await create(failCreate.id);
      console.log(`PASS RMA-002 ${scope} concurrent/repeated quote creation preserves one canonical quote; genuine accept creates one repair WO, repeated acceptance preserves active status and identity; terminal aliases reject all quote mutations/acceptance, legacy inconsistent totals fail closed and create-audit failure rolls back`);
    }
  } finally { await p.$disconnect(); await tenant.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
