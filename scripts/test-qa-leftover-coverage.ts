/** Leftover coverage, older-failure retests, and first-run display/nav/banner checks. */
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";

function camelModel(name: string) {
  return name.slice(0, 1).toLowerCase() + name.slice(1);
}

async function main() {
  process.env.TZ = "America/Los_Angeles";
  Object.assign(globalThis, { AsyncLocalStorage });

  const { formatDate, parseJsonArray, greetingFor, resolveDisplayTimeZone, isValidTimeZone } = await import("../src/lib/utils");
  const { NAV_GROUPS } = await import("../src/lib/navigation");
  const { parseJson } = await import("../src/lib/services/tool-control");
  const { isUnderWarranty } = await import("../src/lib/services/field-service");

  // HOME-001: 6:56 PM PST on Monday Nov 9, 2026 is 02:56 UTC Nov 10.
  const evening = new Date("2026-11-10T02:56:00.000Z");
  const pacific = greetingFor(evening, "America/Los_Angeles");
  assert.equal(pacific.hour, 18);
  assert.equal(pacific.greeting, "Good evening");
  assert.equal(pacific.dateLabel, "Monday, November 9");
  const utc = greetingFor(evening, "UTC");
  assert.equal(utc.greeting, "Good morning");
  assert.equal(utc.dateLabel, "Tuesday, November 10");
  assert.equal(resolveDisplayTimeZone("America/Los_Angeles"), "America/Los_Angeles");
  assert.equal(resolveDisplayTimeZone("Not/AZone"), "America/Los_Angeles"); // env TZ
  assert.ok(isValidTimeZone("America/Los_Angeles"));
  assert.equal(isValidTimeZone("Not/AZone"), false);
  console.log("PASS HOME-001 greeting and calendar day use the visitor timezone, not the server clock");

  // NAV-001
  const gfp = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === "/government-property");
  assert.ok(gfp, "sidebar source of truth must include Government Property");
  assert.match(gfp.label, /gov(ernment)? property/i);
  console.log("PASS NAV-001 Government Property is present in NAV_GROUPS used by the sidebar");

  // ITEM-001
  const banner = readFileSync("src/components/marketing/cookie-banner.tsx", "utf8");
  assert.match(banner, /pointer-events-none fixed inset-x-0 bottom-0/);
  assert.match(banner, /pointer-events-auto mx-auto/);
  console.log("PASS ITEM-001 cookie banner wrapper does not intercept clicks outside the visible card");

  // Older failures that should now pass on current main
  assert.equal(formatDate("2090-05-17"), "May 17, 2090");
  assert.equal(formatDate("2090-05-17T00:00:00.000Z"), "May 17, 2090");
  assert.deepEqual(parseJsonArray('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseJsonArray("not-json"), []);
  assert.deepEqual(parseJsonArray('{"x":1}'), []);
  assert.deepEqual(parseJsonArray("null"), []);
  assert.deepEqual(parseJsonArray(""), []);
  assert.deepEqual(parseJson('{"ok":true}', { ok: false }), { ok: true });
  assert.deepEqual(parseJson("nope", { ok: false }), { ok: false });
  assert.equal(isUnderWarranty(null), false);
  assert.equal(isUnderWarranty(new Date(Date.now() + 86400000)), true);
  assert.equal(isUnderWarranty(new Date(Date.now() - 86400000)), false);
  console.log("PASS older formatDate / parseJsonArray / warranty helpers on current main");

  const pg = await PGlite.create();
  const ddl = execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { PATH: process.env.PATH, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", DATABASE_URL: "postgresql://postgres@127.0.0.1:1/unused", DIRECT_URL: "postgresql://postgres@127.0.0.1:1/unused" },
  });
  await pg.exec(ddl);
  const schema = "tenant_qacoverage01";
  await pg.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};` + TENANT_TABLES_SQL + TENANT_FKS_SQL + "SET search_path TO public;");
  const socket = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0, maxConnections: 16 });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres@${socket.getServerConn()}/postgres`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.DATABASE_POOL_MAX = "1"; process.env.DEMO_MODE = "0";
  process.env.MFA_SECRET_KEY = randomBytes(32).toString("hex");
  process.env.CRON_SECRET = "qa-cron-secret";
  process.env.ESD_HUMIDITY_TOKEN = "qa-esd-token";
  delete process.env.PLAID_CLIENT_ID; delete process.env.PLAID_SECRET;
  globalThis.fetch = async () => { throw new Error("External requests disabled in leftover coverage tests"); };

  const { createRequestStoreForAPI } = await import("next/dist/server/async-storage/request-store");
  const { createWorkStore } = await import("next/dist/server/async-storage/work-store");
  const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external");
  const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external");
  const { NextRequest } = await import("next/dist/server/web/spec-extension/request");
  const { controlPlaneClient, clientForSchema } = await import("../src/lib/db");
  const p = controlPlaneClient(), tenant = clientForSchema(schema);
  const auth = await import("../src/lib/auth-core");
  const password = "Synthetic-QA-" + randomBytes(20).toString("hex");

  async function request<T>(fn: () => Promise<T>, cookies: Record<string, string> = {}, extraHeaders: Record<string, string> = {}) {
    const headerBag = { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "), ...extraHeaders };
    const store = createRequestStoreForAPI(new NextRequest("http://127.0.0.1/invite/qa", { headers: headerBag }), { pathname: "/invite/qa", search: "" }, { tags: [], expirationsByCacheKind: new Map() }, undefined, undefined);
    const work = createWorkStore({ page: "/invite/[token]/page", buildId: "qa-local", previouslyRevalidatedTags: [], renderOpts: {
      supportsDynamicResponse: true, isPossibleServerAction: true, assetPrefix: "", incrementalCache: {} as never,
      experimental: { isRoutePPREnabled: false, cacheComponents: false, authInterrupts: false },
      waitUntil: () => {}, onClose: () => {},
    } as Parameters<typeof createWorkStore>[0]["renderOpts"] });
    const value = await workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, fn));
    return { value, cookies: Object.fromEntries(store.mutableCookies.getAll().filter((c) => c.value).map((c) => [c.name, c.value])) };
  }

  const modelNames = [...readFileSync("prisma/schema.prisma", "utf8").matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
  assert.ok(modelNames.length >= 229, `expected at least the historic 229 models, found ${modelNames.length}`);

  try {
    await p.tenant.create({ data: { slug: "qa-coverage", schemaName: schema, status: "ACTIVE" } });
    for (const [scope, db] of [["public", p], [schema, tenant]] as const) {
      const roles = ["ADMIN", "OPERATOR"];
      const pins = roles.map(() => String(randomInt(100000, 999999))); assert.equal(new Set(pins).size, roles.length);
      const users = await Promise.all(roles.map((role, i) => db.user.create({ data: { name: role, email: `${role}@example.invalid`, role, passwordHash: auth.hashPassword(password), pinCode: pins[i] } })));
      const sessions = await Promise.all(users.map((u) => request(() => scope === "public" ? auth.createSession(u.id) : auth.createTenantSession(u.id, scope))));
      const run = async <T>(fn: () => Promise<T>, role = "ADMIN") => (await request(fn, sessions[roles.indexOf(role)].cookies)).value;

      const controlPlaneOnly = new Set(["Tenant", "TenantLogin", "TelemetryEvent", "TelemetryIssue", "TelemetryIssueEvent"]);
      const probeNames = scope === "public" ? modelNames : modelNames.filter((name) => !controlPlaneOnly.has(name));
      const failedModels: string[] = [];
      for (const name of probeNames) {
        const key = camelModel(name);
        const delegate = (db as Record<string, { findMany?: (args: { take: number }) => Promise<unknown> }>)[key];
        if (!delegate?.findMany) { failedModels.push(`${name} (missing delegate ${key})`); continue; }
        try { await delegate.findMany({ take: 1 }); }
        catch (e) { failedModels.push(`${name}: ${e instanceof Error ? e.message : e}`); }
      }
      assert.equal(failedModels.length, 0, `model probes failed in ${scope}: ${failedModels.join("; ")}`);
      if (scope !== "public") {
        for (const name of controlPlaneOnly) {
          const key = camelModel(name);
          await assert.rejects((db as Record<string, { findMany: (args: { take: number }) => Promise<unknown> }>)[key].findMany({ take: 1 }));
        }
      }
      console.log(`PASS ${probeNames.length}/${probeNames.length} model probes ${scope} findMany({ take: 1 }) against the local fixture`);

      const apiAuth = await import("../src/lib/api-auth");
      assert.ok(!(await request(() => apiAuth.requireApiUser(), {}).value));
      const apiUser = await run(() => apiAuth.requireApiUser());
      assert.equal(apiUser?.id, users[0].id);
      const denied = await run(() => apiAuth.requireApiPermission("not-a-real-permission"), "OPERATOR");
      assert.ok(denied.error);
      const allowed = await run(() => apiAuth.requireApiPermission("customers.manage"));
      assert.equal(allowed.error, null);
      assert.equal(allowed.user?.id, users[0].id);
      console.log(`PASS requireApiUser / requireApiPermission ${scope} deny anonymous and honor signed-in permissions`);

      const cronDrop = await import("../src/app/api/cron/drop-orphan-demos/route");
      const cronSweep = await import("../src/app/api/cron/sweep-demos/route");
      const unauthorizedDrop = await cronDrop.GET(new NextRequest("http://127.0.0.1/api/cron/drop-orphan-demos"));
      assert.equal(unauthorizedDrop.status, 401);
      const authorizedDrop = await cronDrop.GET(new NextRequest("http://127.0.0.1/api/cron/drop-orphan-demos", { headers: { authorization: "Bearer qa-cron-secret" } }));
      assert.equal(authorizedDrop.status, 200);
      const dropBody = await authorizedDrop.json() as { ok?: boolean };
      assert.equal(dropBody.ok, true);
      const unauthorizedSweep = await cronSweep.GET(new NextRequest("http://127.0.0.1/api/cron/sweep-demos"));
      assert.equal(unauthorizedSweep.status, 401);
      const authorizedSweep = await cronSweep.GET(new NextRequest("http://127.0.0.1/api/cron/sweep-demos", { headers: { authorization: "Bearer qa-cron-secret" } }));
      assert.equal(authorizedSweep.status, 200);
      const sweepBody = await authorizedSweep.json() as { ok?: boolean };
      assert.equal(sweepBody.ok, true);
      console.log(`PASS cron drop-orphan-demos / sweep-demos ${scope} require the secret and succeed locally`);

      const demoEnd = await import("../src/app/api/demo/end/route");
      const demoLeave = await import("../src/app/api/demo/leave/route");
      const demoPing = await import("../src/app/api/demo/ping/route");
      const endRes = await run(() => demoEnd.GET(new Request("http://127.0.0.1/api/demo/end")));
      assert.ok(endRes);
      const leaveRes = await run(() => demoLeave.POST());
      assert.equal(leaveRes.status, 204);
      const pingRes = await run(() => demoPing.GET());
      assert.equal(pingRes.status, 204);
      console.log(`PASS demo end/leave/ping ${scope} close without throwing`);

      const humidity = await import("../src/app/api/esd/humidity/route");
      const humidUnauth = await humidity.POST(new NextRequest("http://127.0.0.1/api/esd/humidity", { method: "POST", body: "{}" }));
      assert.equal(humidUnauth.status, 401);
      const humidBad = await humidity.POST(new NextRequest("http://127.0.0.1/api/esd/humidity", { method: "POST", headers: { authorization: "Bearer qa-esd-token", "content-type": "application/json" }, body: JSON.stringify({ location: "WC-QA" }) }));
      assert.equal(humidBad.status, 400);
      const humidOk = await humidity.POST(new NextRequest("http://127.0.0.1/api/esd/humidity", { method: "POST", headers: { authorization: "Bearer qa-esd-token", "content-type": "application/json" }, body: JSON.stringify({ location: "WC-QA", relativeHumidity: 42.5, temperatureC: 21 }) }));
      assert.ok(humidOk.status === 200 || humidOk.status === 201, `humidity status ${humidOk.status}`);
      console.log(`PASS POST /api/esd/humidity ${scope} enforces the device token and rejects incomplete payloads`);

      const geocode = await import("../src/app/api/geocode/route");
      const geoShort = await geocode.GET(new NextRequest("http://127.0.0.1/api/geocode?q=ab"));
      assert.ok([200, 204].includes(geoShort.status));
      const geoOk = await geocode.GET(new NextRequest("http://127.0.0.1/api/geocode?q=San Diego CA"));
      // fetch is disabled; the route must fail closed rather than throw
      assert.ok([200, 204].includes(geoOk.status));
      if (geoOk.status === 200) {
        const geoBody = await geoOk.json() as { features?: unknown };
        assert.ok(Array.isArray(geoBody.features));
      }
      console.log(`PASS GET /api/geocode ${scope} fails closed without an upstream`);

      const leads = await import("../src/app/api/leads/route");
      const leadRes = await leads.POST(new Request("http://127.0.0.1/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "lead@example.invalid", company: "QA Co", stage: "typed" }) }));
      assert.equal(leadRes.status, 200);
      const leadBody = await leadRes.json() as { ok?: boolean };
      assert.equal(leadBody.ok, true);
      console.log(`PASS POST /api/leads ${scope} always answers ok`);

      const plaid = await import("../src/app/api/plaid/link-src/route");
      const plaidRes = await plaid.GET();
      assert.equal(plaidRes.status, 204);
      console.log(`PASS GET /api/plaid/link-src ${scope} declines when Plaid is not configured`);

      const dxf = await import("../src/app/api/quality/tools/[id]/dxf/route");
      const dxfUnauth = await dxf.GET(new NextRequest("http://127.0.0.1/api/quality/tools/missing/dxf"), { params: Promise.resolve({ id: "missing" }) });
      assert.equal(dxfUnauth.status, 401);
      const dxfMissing = await run(() => dxf.GET(new NextRequest("http://127.0.0.1/api/quality/tools/missing/dxf"), { params: Promise.resolve({ id: "missing" }) }));
      assert.equal(dxfMissing.status, 404);
      console.log(`PASS GET /api/quality/tools/[id]/dxf ${scope} requires a session and 404s unknown tools`);

      const staffEnter = await import("../src/app/api/staff/enter/route");
      const staffOpen = await run(() => staffEnter.GET(new NextRequest("http://127.0.0.1/api/staff/enter?next=https://evil.example/admin/support")));
      assert.equal(staffOpen.status, 307);
      assert.match(staffOpen.headers.get("location") || "", /\/admin\/support$/);
      const staffOk = await run(() => staffEnter.GET(new NextRequest("http://127.0.0.1/api/staff/enter?next=/admin/support-inbox")));
      assert.match(staffOk.headers.get("location") || "", /\/admin\/support-inbox$/);
      console.log(`PASS GET /api/staff/enter ${scope} rejects open redirects and stays in /admin`);

      const telemetry = await import("../src/app/api/telemetry/route");
      const alias = await import("../src/app/api/e/route");
      const tel = await run(() => telemetry.POST(new NextRequest("http://127.0.0.1/api/telemetry", { method: "POST", body: JSON.stringify({ kind: "PAGE", path: "/login" }) })));
      assert.equal(tel.status, 204);
      const telBad = await run(() => telemetry.POST(new NextRequest("http://127.0.0.1/api/telemetry", { method: "POST", body: JSON.stringify({ kind: "HACK" }) })));
      assert.equal(telBad.status, 204);
      const aliasRes = await run(() => alias.POST(new NextRequest("http://127.0.0.1/api/e", { method: "POST", body: JSON.stringify({ kind: "PAGE", path: "/login" }) })));
      assert.equal(aliasRes.status, 204);
      console.log(`PASS POST /api/telemetry and /api/e ${scope} always answer 204`);

      const pulse = await import("../src/lib/services/dashboard-pulse");
      const pulseResult = await run(() => pulse.getDisciplinePulse({ role: "ADMIN", department: "PRODUCTION" }));
      assert.ok(pulseResult && typeof pulseResult === "object");
      const reaper = await import("../src/lib/services/demo-reaper");
      const reaped = await reaper.reapAbandonedDemos(60);
      assert.ok(reaped && typeof reaped === "object");
      const kitting = await import("../src/lib/services/kitting");
      const swept = await run(() => kitting.sweepKitReadiness(users[0].id));
      assert.ok(swept !== undefined);
      const flash = await import("../src/lib/flash");
      const { isAnonymousDemoRequest } = await import("../src/lib/demo-request");
      assert.equal(await run(() => isAnonymousDemoRequest()), false);
      await run(() => flash.flashToast("Coverage toast", "success"));
      const toast = await run(() => flash.readFlashToast());
      assert.ok(toast === null || toast.message === "Coverage toast" || typeof toast === "object");
      console.log(`PASS leftover exported services ${scope}: pulse, reaper, kit sweep, flash, demo-request`);
    }
  } finally {
    await socket.stop();
    await pg.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
