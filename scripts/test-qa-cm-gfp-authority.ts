/** CM/GFP/station privilege regressions with real authenticated Next request stores. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
async function main() {
  // Services accept internal actor IDs; only guarded app actions may be RPCs.
  // All callers of these modules are server actions, server-rendered pages or
  // other services. A directive here silently registers spoofable endpoints.
  for (const file of readdirSync("src/lib/services").filter(f => f.endsWith(".ts"))) {
    assert(!/^\s*["']use server["']/m.test(readFileSync(`src/lib/services/${file}`, "utf8")), `${file}: internal services must not become actor-id RPCs`);
  }
  Object.assign(globalThis, { AsyncLocalStorage });
  const pg = await PGlite.create();
  const ddl = execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { PATH: process.env.PATH, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", DATABASE_URL: "postgresql://postgres@127.0.0.1:1/unused", DIRECT_URL: "postgresql://postgres@127.0.0.1:1/unused" },
  });
  await pg.exec(ddl);
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
  const { controlPlaneClient } = await import("../src/lib/db");
  const p = controlPlaneClient();
  const auth = await import("../src/lib/auth-core"), access = await import("../src/lib/auth"), a = await import("../src/app/actions");
  const cm = await import("../src/lib/services/cm-library"), numbers = await import("../src/lib/services/cm-numbers"), gfp = await import("../src/lib/services/gfp");
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
  const form = (data: Record<string,string>) => { const f = new FormData(); for (const [k,v] of Object.entries(data)) f.set(k,v); return f; };
  const pin = randomBytes(8).toString("hex");
  try {
    const users = await Promise.all(["ADMIN", "OPERATOR", "CM"].map(role => p.user.create({ data: { name: role, email: `${role}@example.invalid`, role, passwordHash: auth.hashPassword(password), pinCode: pin } })));
    const [admin, operator, manager] = users;
    const sessions = await Promise.all(users.map(u => request(() => auth.createSession(u.id))));
    const [adminCookies, operatorCookies, managerCookies] = sessions.map(s => s.cookies);
    const invoke = async (fn: (f: FormData) => Promise<unknown>, data: Record<string,string>, cookies = adminCookies) => {
      try { return (await request(() => fn(form(data)), cookies)).value; }
      catch (e) { if (!/NEXT_REDIRECT/.test(String(e))) throw e; }
    };
    const snapshot = async () => JSON.stringify({ requests: await p.cmNumberRequest.findMany(), numbers: await p.cmNumberRegistry.findMany(), schemes: await p.cmNumberScheme.findMany(), changes: await p.changeRequest.findMany(), docs: await p.cmDocument.findMany(), property: await p.governmentProperty.findMany(), custody: await p.gfpCheckout.findMany(), consumption: await p.gfpConsumption.findMany(), stock: await p.inventoryItem.findMany(), stations: await p.workCenter.findMany(), audits: await p.auditLog.count() });
    await (await import("../src/lib/services/permissions")).ensurePermissionCatalog();
    for (const permission of ["gfp.manage", "cm.ecr.manage", "workcenters.manage"]) assert(!(await access.userHasPermission(operator.id, permission)));
    const property = await p.governmentProperty.create({ data: { assetTag: "AUTH-GFP", description: "Synthetic property", propertyType: "GFP" } });
    const consumption = await p.gfpConsumption.create({ data: { propertyId: property.id, requestedById: operator.id } });
    const req = await numbers.createNumberRequest({ category: "DRAWING", title: "QA drawing", requestedById: admin.id });
    const own = await numbers.createNumberRequest({ category: "DRAWING", title: "Operator request", requestedById: operator.id });
    const scheme = await p.cmNumberScheme.findFirstOrThrow();
    const cr = await p.changeRequest.create({ data: { number: "AUTH-ECR", title: "QA", description: "Synthetic drawing", type: "DRAWING", status: "SUBMITTED", documentNumber: "QA-DWG", documentTitle: "QA drawing", documentRevision: "A", documentFileUrl: "data:application/pdf;base64,UUE=" } });
    const cases: [(f: FormData) => Promise<unknown>, Record<string,string>][] = [
      [a.actionCheckinGfp, { propertyId: property.id, disposition: "TRANSFER_COMPANY" }],
      [a.actionCheckinGfp, { propertyId: property.id, disposition: "RETURN_TO_GOV" }],
      [a.actionDecideGfpConsumption, { consumptionId: consumption.id, approve: "true", pinCode: pin }],
      [a.actionDecideGfpConsumption, { consumptionId: consumption.id, approve: "false", approvalNotes: "Denied", pinCode: pin }],
      [a.actionAssignCmNumber, { requestId: req.id, overrideNumber: "UNAUTHORIZED" }],
      [a.actionRejectCmNumberRequest, { requestId: req.id, reason: "Unauthorized" }],
      [a.actionRegisterCmNumber, { number: "UNAUTHORIZED", category: "DRAWING", title: "Bad" }],
      [a.actionUpdateCmNumberScheme, { id: scheme.id, prefix: "BAD" }],
      [a.actionCancelCmNumberRequest, { requestId: req.id }],
      [a.actionSaveWorkCenter, { code: "BAD", name: "Unauthorized", area: "MANUFACTURING" }],
    ];
    for (const [fn, data] of cases) {
      const before = await snapshot(); await assert.rejects(request(() => fn(form(data)), operatorCookies)); assert.equal(await snapshot(), before);
    }
    for (const column of ["APPROVED", "RELEASED", "IN_REVIEW"]) {
      const before = await snapshot(); const result = (await request(() => a.actionMoveCmBoardCard({ changeRequestId: cr.id, column, isDocumentEcr: false }), operatorCookies)).value;
      assert(!result.ok); assert.equal(await snapshot(), before);
    }
    console.log("PASS AUTH-015/016/017/018 and CM-001: genuine OPERATOR session denied before any management/foreign-request mutation");
    await invoke(a.actionCancelCmNumberRequest, { requestId: own.id }, operatorCookies);
    assert.equal((await p.cmNumberRequest.findUniqueOrThrow({ where: { id: own.id } })).status, "CANCELLED");
    const other = await numbers.createNumberRequest({ category: "DRAWING", title: "Manager cancel", requestedById: operator.id });
    await invoke(a.actionCancelCmNumberRequest, { requestId: other.id }, managerCookies);
    await invoke(a.actionAssignCmNumber, { requestId: req.id, overrideNumber: "QA-DWG" }, managerCookies);
    assert.equal((await p.cmNumberRequest.findUniqueOrThrow({ where: { id: req.id } })).status, "ASSIGNED");
    await invoke(a.actionRegisterCmNumber, { number: "QA-LEGACY", category: "DRAWING", title: "Legacy" }, managerCookies);
    await invoke(a.actionUpdateCmNumberScheme, { id: scheme.id, prefix: "QA", isActiveOn: "true" }, managerCookies);
    await invoke(a.actionSaveWorkCenter, { code: "QA-STATION", name: "Authorized", area: "MANUFACTURING" });
    assert(await p.workCenter.findUnique({ where: { code: "QA-STATION" } }));
    await invoke(a.actionCheckinGfp, { propertyId: property.id, disposition: "TRANSFER_COMPANY" });
    assert.equal((await p.governmentProperty.findUniqueOrThrow({ where: { id: property.id } })).status, "DISPOSED");
    await invoke(a.actionDecideGfpConsumption, { consumptionId: consumption.id, approve: "false", approvalNotes: "Authorized denial", pinCode: pin });
    assert.equal((await p.gfpConsumption.findUniqueOrThrow({ where: { id: consumption.id } })).status, "REJECTED");
    const rejected = await numbers.createNumberRequest({ category: "DRAWING", title: "Manager reject", requestedById: operator.id });
    await invoke(a.actionRejectCmNumberRequest, { requestId: rejected.id, reason: "Valid controlled-number rejection" }, managerCookies);
    assert.equal((await p.cmNumberRequest.findUniqueOrThrow({ where: { id: rejected.id } })).status, "REJECTED");
    const held = await p.governmentProperty.create({ data: { assetTag: "QA-CUSTODY", description: "Checkout control", propertyType: "GFP" } });
    await gfp.checkoutGfp({ propertyId: held.id, checkedOutById: operator.id });
    await invoke(a.actionCheckinGfp, { propertyId: held.id, disposition: "CHECKIN" }, operatorCookies);
    assert.equal((await p.governmentProperty.findUniqueOrThrow({ where: { id: held.id } })).checkedOutToId, null);
    const asset = await p.governmentProperty.create({ data: { assetTag: "QA-CONSUME", description: "Single asset consumption", propertyType: "GFP" } });
    const consume = await p.gfpConsumption.create({ data: { propertyId: asset.id, requestedById: operator.id } });
    await invoke(a.actionDecideGfpConsumption, { consumptionId: consume.id, approve: "true", pinCode: pin });
    assert.equal((await p.gfpConsumption.findUniqueOrThrow({ where: { id: consume.id } })).status, "CONSUMED");
    console.log("PASS authorized CM numbering/cancellation, admin station/ownership/consumption decisions; requester may cancel own request");
    for (const column of ["APPROVED", "RELEASED", "IN_WORK"]) {
      const before = await snapshot(); const result = (await request(() => a.actionMoveCmBoardCard({ changeRequestId: cr.id, column, isDocumentEcr: false }), managerCookies)).value;
      assert(!result.ok); assert.equal(await snapshot(), before);
    }
    await assert.rejects(cm.moveChangeRequestColumn({ changeRequestId: cr.id, column: "APPROVED", userId: operator.id }), /permission/);
    const folder = await p.cmFolder.create({ data: { name: "QA library" } });
    await p.changeRequest.update({ where: { id: cr.id }, data: { status: "APPROVED" } });
    await assert.rejects(cm.releaseDocumentEcr({ changeRequestId: cr.id, releaseFolderId: folder.id, userId: manager.id }), /board votes/);
    await p.changeRequest.update({ where: { id: cr.id }, data: { status: "REVIEW_BOARD" } });
    const seats = await Promise.all([admin, manager].map(u => p.cmBoardMember.create({ data: { changeRequestId: cr.id, userId: u.id, role: "APPROVER" } })));
    await invoke(a.actionVoteCm, { memberId: seats[0].id, vote: "APPROVE" });
    await assert.rejects(cm.moveChangeRequestColumn({ changeRequestId: cr.id, column: "APPROVED", userId: manager.id }), /board votes/);
    await invoke(a.actionVoteCm, { memberId: seats[1].id, vote: "APPROVE" }, managerCookies);
    assert.equal((await p.changeRequest.findUniqueOrThrow({ where: { id: cr.id } })).status, "APPROVED");
    assert((await request(() => a.actionMoveCmBoardCard({ changeRequestId: cr.id, column: "APPROVED" }), managerCookies)).value.ok);
    await invoke(a.actionReleaseDocumentEcr, { changeRequestId: cr.id, releaseFolderId: folder.id }, managerCookies);
    const released = await p.changeRequest.findUniqueOrThrow({ where: { id: cr.id } });
    assert.equal(released.status, "IMPLEMENTED"); assert(released.releasedDocumentId);
    assert.equal((await p.cmDocument.findUniqueOrThrow({ where: { id: released.releasedDocumentId } })).status, "RELEASED");
    console.log("PASS AUTH-017 actual document type and votes enforced even for manager and legacy APPROVED; two real own-seat votes plus formal folder release succeed");
    // Preserve #143 includes-BOM certification gate with valid approval evidence.
    const bom = await p.changeRequest.create({ data: { number: "QA-BOM-GATE", title: "BOM gate", description: "No BOM linked", type: "DRAWING", status: "APPROVED", documentNumber: "QA-BOM-DWG", documentTitle: "BOM drawing", documentRevision: "A", includesBom: true, boardMembers: { create: users.filter(u => u.role !== "OPERATOR").map(u => ({ userId: u.id, role: "APPROVER", vote: "APPROVE" })) } } });
    await assert.rejects(cm.releaseDocumentEcr({ changeRequestId: bom.id, releaseFolderId: folder.id, userId: manager.id }), /no BOM is linked/);
    console.log("PASS #143 mandatory BOM link/certification gate preserved after completed board approval");
  } finally { await p.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
