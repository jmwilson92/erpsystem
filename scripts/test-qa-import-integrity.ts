/** Import numeric validation and org-chart cycle rejection, public + tenant. */
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
  const schema = "tenant_qaimport01";
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
  const importer = await import("../src/lib/services/data-import");
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
  const header = "partNumber,description,uom,standardCost,leadTimeDays,minStock,maxStock,partType,sourcingMethod";
  const partRow = (pn: string, cost = "12.50", min = "10", max = "50") =>
    `${pn},Steel mounting bracket,EA,${cost},14,${min},${max},BUY,PURCHASE`;
  try {
    await p.tenant.create({ data: { slug: "qa-import", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public", p], [schema, tenant]] as const) {
      const roles = ["ADMIN", "OPERATOR"];
      const pins = roles.map(() => String(randomInt(100000, 999999))); assert.equal(new Set(pins).size, roles.length);
      const users = await Promise.all(roles.map((role, i) => db.user.create({ data: { name: role, email: `${role}@example.invalid`, role, passwordHash: auth.hashPassword(password), pinCode: pins[i] } })));
      const sessions = await Promise.all(users.map((u) => request(() => scope === "public" ? auth.createSession(u.id) : auth.createTenantSession(u.id, scope))));
      const run = async <T>(fn: () => Promise<T>, role = "ADMIN") => (await request(fn, sessions[roles.indexOf(role)].cookies)).value;
      const importData = (params: Parameters<typeof importer.runImport>[0]) => run(() => importer.runImport(params));
      const snapshot = async () => JSON.stringify({
        parts: await db.part.findMany({ orderBy: { partNumber: "asc" } }),
        customers: await db.customer.findMany({ orderBy: { name: "asc" } }),
        people: await db.user.findMany({ orderBy: { email: "asc" }, select: { email: true, managerId: true, role: true, name: true } }),
      });

      const malformed = `${header}\n${partRow("QA-IMP-BAD", "not-a-number")}`;
      let before = await snapshot();
      const badCost = await importData({ entity: "parts", text: malformed });
      assert.equal(badCost.created, 0);
      assert.equal(badCost.updated, 0);
      assert.ok(badCost.errors.some((e) => /standardCost must be a number/i.test(e.message)));
      assert.equal(await db.part.count({ where: { partNumber: "QA-IMP-BAD" } }), 0);
      assert.equal(await snapshot(), before);

      const nativeBad = await run(() => a.actionImportData(null, form({ entity: "parts", text: malformed, mode: "skip" })));
      assert.equal(nativeBad.created, 0);
      assert.ok(nativeBad.errors.some((e) => /standardCost must be a number/i.test(e.message)));
      assert.equal(await snapshot(), before);
      console.log(`PASS IMPORT-001 ${scope} malformed part cost is reported as a validation error and creates no part, including the native import action`);

      const ranged = `${header}\n${partRow("QA-IMP-NEG", "-20", "50", "10")}`;
      before = await snapshot();
      const badRange = await importData({ entity: "parts", text: ranged });
      assert.equal(badRange.created, 0);
      assert.ok(badRange.errors.some((e) => /standardCost cannot be negative/i.test(e.message)));
      assert.equal(await db.part.count({ where: { partNumber: "QA-IMP-NEG" } }), 0);
      const onlyLimits = `${header}\n${partRow("QA-IMP-LIM", "12.50", "50", "10")}`;
      const badLimits = await importData({ entity: "parts", text: onlyLimits });
      assert.equal(badLimits.created, 0);
      assert.ok(badLimits.errors.some((e) => /minStock cannot be greater than maxStock/i.test(e.message)));
      assert.equal(await snapshot(), before);
      const valid = await importData({ entity: "parts", text: `${header}\n${partRow("QA-IMP-OK", "12.50", "10", "50")}` });
      assert.equal(valid.created, 1);
      assert.equal(valid.errors.length, 0);
      const created = await db.part.findUniqueOrThrow({ where: { partNumber: "QA-IMP-OK" } });
      assert.equal(created.standardCost, 12.5);
      assert.equal(created.minStock, 10);
      assert.equal(created.maxStock, 50);
      const currency = await importData({ entity: "parts", text: `${header}\n${partRow("QA-IMP-USD", "$8.00", "0", "5")}` });
      assert.equal(currency.created, 1);
      assert.equal((await db.part.findUniqueOrThrow({ where: { partNumber: "QA-IMP-USD" } })).standardCost, 8);
      const badCredit = await importData({
        entity: "customers",
        text: "name,code,contactEmail,paymentTerms,creditLimit\nAcme,ACME,po@acme.example,NET30,not-a-number",
      });
      assert.equal(badCredit.created, 0);
      assert.ok(badCredit.errors.some((e) => /creditLimit must be a number/i.test(e.message)));
      assert.equal(await db.customer.count({ where: { code: "ACME" } }), 0);
      console.log(`PASS IMPORT-002 ${scope} negative cost and reversed stock limits are rejected without writes; valid and currency-formatted costs import; malformed customer credit is also rejected`);

      const peopleHeader = "name,email,title,department,role,managerEmail";
      const seedPeople = await importData({
        entity: "people",
        text: `${peopleHeader}\nJordan Boss,boss@example.invalid,Lead,Production,PRODUCTION,\nAlex Worker,worker@example.invalid,Machinist,Production,OPERATOR,boss@example.invalid`,
      });
      assert.equal(seedPeople.created, 2, JSON.stringify(seedPeople));
      assert.equal(seedPeople.errors.length, 0);
      const boss = await db.user.findUniqueOrThrow({ where: { email: "boss@example.invalid" } });
      const worker = await db.user.findUniqueOrThrow({ where: { email: "worker@example.invalid" } });
      assert.equal(worker.managerId, boss.id);
      assert.equal(boss.managerId, null);
      before = await snapshot();
      const cycle = await importData({
        entity: "people",
        mode: "update",
        text: `${peopleHeader}\nJordan Boss,boss@example.invalid,Lead,Production,PRODUCTION,worker@example.invalid`,
      });
      assert.ok(cycle.errors.some((e) => /Reporting cycle rejected/i.test(e.message)));
      const afterBoss = await db.user.findUniqueOrThrow({ where: { email: "boss@example.invalid" } });
      const afterWorker = await db.user.findUniqueOrThrow({ where: { email: "worker@example.invalid" } });
      assert.equal(afterBoss.managerId, null);
      assert.equal(afterWorker.managerId, boss.id);
      const mutual = await importData({
        entity: "people",
        text: `${peopleHeader}\nPat One,one@example.invalid,A,Production,OPERATOR,two@example.invalid\nRiley Two,two@example.invalid,B,Production,OPERATOR,one@example.invalid`,
      });
      assert.equal(mutual.created, 2);
      assert.ok(mutual.errors.some((e) => /Reporting cycle rejected/i.test(e.message)));
      const one = await db.user.findUniqueOrThrow({ where: { email: "one@example.invalid" } });
      const two = await db.user.findUniqueOrThrow({ where: { email: "two@example.invalid" } });
      assert.equal(one.managerId, null);
      assert.equal(two.managerId, null);
      console.log(`PASS IMPORT-003 ${scope} existing manager links stay intact when an inverse report is rejected; same-file mutual reporting creates people but does not write a cycle`);
    }
  } finally {
    await socket.stop();
    await pg.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
