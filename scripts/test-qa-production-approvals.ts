/** Production journal approvals: kit / consume / output stay unposted until approved. */
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";
import { roundMoney } from "../src/lib/services/posting-rules";

function money(n: number) {
  return roundMoney(n);
}

async function main() {
  process.env.TZ = "America/Los_Angeles";
  Object.assign(globalThis, { AsyncLocalStorage });

  const pg = await PGlite.create();
  const ddl = execFileSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema",
      "prisma/schema.prisma",
      "--script",
    ],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        CHECKPOINT_DISABLE: "1",
        PRISMA_HIDE_UPDATE_MESSAGE: "1",
        DATABASE_URL: "postgresql://postgres@127.0.0.1:1/unused",
        DIRECT_URL: "postgresql://postgres@127.0.0.1:1/unused",
      },
    }
  );
  await pg.exec(ddl);
  const schema = "tenant_qapj01";
  await pg.exec(
    `CREATE SCHEMA ${schema}; SET search_path TO ${schema};` +
      TENANT_TABLES_SQL +
      TENANT_FKS_SQL +
      "SET search_path TO public;"
  );
  const socket = new PGLiteSocketServer({
    db: pg,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 16,
  });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres@${socket.getServerConn()}/postgres`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.DATABASE_POOL_MAX = "1";
  process.env.DEMO_MODE = "0";
  process.env.MFA_SECRET_KEY = randomBytes(32).toString("hex");
  delete process.env.RESEND_API_KEY;
  globalThis.fetch = async () => {
    throw new Error("External requests disabled in production-approvals tests");
  };

  const { createRequestStoreForAPI } = await import(
    "next/dist/server/async-storage/request-store"
  );
  const { createWorkStore } = await import(
    "next/dist/server/async-storage/work-store"
  );
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external"
  );
  const { workUnitAsyncStorage } = await import(
    "next/dist/server/app-render/work-unit-async-storage.external"
  );
  const { NextRequest } = await import(
    "next/dist/server/web/spec-extension/request"
  );
  const { controlPlaneClient, clientForSchema } = await import("../src/lib/db");
  const auth = await import("../src/lib/auth-core");
  const p = controlPlaneClient();
  const tenant = clientForSchema(schema);
  const password = "Synthetic-QA-" + randomBytes(20).toString("hex");

  async function request<T>(fn: () => Promise<T>, cookies: Record<string, string> = {}) {
    const store = createRequestStoreForAPI(
      new NextRequest("http://127.0.0.1/pj-qa", {
        headers: {
          cookie: Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
        },
      }),
      { pathname: "/pj-qa", search: "" },
      { tags: [], expirationsByCacheKind: new Map() },
      undefined,
      undefined
    );
    const work = createWorkStore({
      page: "/pj-qa",
      buildId: "qa-local",
      previouslyRevalidatedTags: [],
      renderOpts: {
        supportsDynamicResponse: true,
        isPossibleServerAction: true,
        assetPrefix: "",
        incrementalCache: {} as never,
        experimental: {
          isRoutePPREnabled: false,
          cacheComponents: false,
          authInterrupts: false,
        },
        waitUntil: () => {},
        onClose: () => {},
      } as Parameters<typeof createWorkStore>[0]["renderOpts"],
    });
    const value = await workAsyncStorage.run(work, () =>
      workUnitAsyncStorage.run(store, fn)
    );
    return {
      value,
      cookies: Object.fromEntries(
        store.mutableCookies
          .getAll()
          .filter((c) => c.value)
          .map((c) => [c.name, c.value])
      ),
    };
  }

  await p.tenant.create({
    data: { slug: "qa-pj", schemaName: schema, status: "ACTIVE" },
  });

  async function onHand(db: typeof p, partId: string) {
    const rows = await db.inventoryItem.findMany({
      where: { partId, workOrderId: null, location: { type: "STORAGE" } },
    });
    return money(rows.reduce((s, r) => s + (r.quantityOnHand || 0), 0));
  }

  async function postedDebits(db: typeof p) {
    const lines = await db.journalLine.findMany({
      where: { journalEntry: { status: "POSTED" }, debit: { gt: 0 } },
    });
    return money(lines.reduce((s, l) => s + l.debit, 0));
  }

  for (const [scope, db] of [["public", p], [schema, tenant]] as const) {
    const admin = await db.user.create({
      data: {
        name: "Controller",
        email: `pj-admin-${scope}@example.invalid`,
        role: "ADMIN",
        passwordHash: auth.hashPassword(password),
        pinCode: String(randomInt(100000, 999999)),
        isActive: true,
      },
    });
    const operator = await db.user.create({
      data: {
        name: "Floor operator",
        email: `pj-op-${scope}@example.invalid`,
        role: "OPERATOR",
        passwordHash: auth.hashPassword(password),
        pinCode: String(randomInt(100000, 999999)),
        isActive: true,
      },
    });
    const session = await request(() =>
      scope === "public" ? auth.createSession(admin.id) : auth.createTenantSession(admin.id, scope)
    );
    const run = async <T>(fn: () => Promise<T>) => (await request(fn, session.cookies)).value;

    const chart = [
      ["1000", "Cash", "ASSET"],
      ["1100", "Accounts receivable", "ASSET"],
      ["1200", "Raw materials", "ASSET"],
      ["1210", "Work in process", "ASSET"],
      ["1220", "Finished goods", "ASSET"],
      ["2000", "Accounts payable", "LIABILITY"],
      ["2010", "Goods received / invoices received", "LIABILITY"],
      ["4000", "Sales revenue", "REVENUE"],
      ["5000", "Cost of goods sold", "COGS"],
      ["6000", "Wages", "EXPENSE"],
      ["6050", "Applied direct labor", "EXPENSE"],
      ["6060", "Applied shop overhead", "EXPENSE"],
      ["6070", "Applied fringe", "EXPENSE"],
      ["6200", "Production variance", "EXPENSE"],
      ["6210", "Scrap", "EXPENSE"],
      ["6220", "Inventory adjustment", "EXPENSE"],
      ["6221", "Purchase price variance", "EXPENSE"],
    ] as const;
    for (const [code, name, type] of chart) {
      await db.account.create({ data: { code, name, type } });
    }

    await run(async () => {
      const { ensureManufacturingAccountingDefaults } = await import(
        "../src/lib/services/inventory-accounting"
      );
      await ensureManufacturingAccountingDefaults();
    });

    const warehouse = await db.warehouse.create({
      data: { code: "WH-PJ", name: "Main warehouse" },
    });
    const storage = await db.location.create({
      data: { warehouseId: warehouse.id, code: "ST-01", name: "Stores", type: "STORAGE" },
    });
    await db.location.create({
      data: { warehouseId: warehouse.id, code: "STAGE-01", name: "Kit staging", type: "STAGING" },
    });
    await db.companySettings.upsert({
      where: { id: "default" },
      create: { id: "default", kittingLocation: "STAGE-01" },
      update: { kittingLocation: "STAGE-01" },
    });
    const station = await db.workCenter.create({
      data: { code: "ASM-PJ", name: "Assembly", area: "MANUFACTURING", isActive: true },
    });

    const pickPart = await db.part.create({
      data: {
        partNumber: `RAW-PICK-${scope}`,
        description: "Issued at pick",
        sourcingMethod: "PURCHASE",
        itemStructure: "RAW_MATERIAL",
        standardCost: 10,
        consumptionTiming: "AT_PICK",
      },
    });
    const fgPart = await db.part.create({
      data: {
        partNumber: `FG-ASSY-${scope}`,
        description: "Finished assembly",
        sourcingMethod: "BUILD",
        itemStructure: "TOP_LEVEL_ASSEMBLY",
        standardCost: 40,
      },
    });
    const bom = await db.bomHeader.create({
      data: {
        partId: fgPart.id,
        revision: "A",
        status: "CERTIFIED",
        lines: { create: [{ componentPartId: pickPart.id, quantity: 2 }] },
      },
    });

    async function stock(qty: number, unitCost = 10) {
      await db.inventoryItem.create({
        data: {
          partId: pickPart.id,
          locationId: storage.id,
          quantityOnHand: qty,
          quantityAvailable: qty,
          unitCost,
          ownership: "COMPANY",
        },
      });
    }

    async function makeJob(label: string, qty = 2) {
      const wo = await db.workOrder.create({
        data: {
          number: `WO-PJ-${label}-${scope}`.slice(0, 30),
          type: "PRODUCTION",
          status: "IN_PROGRESS",
          partId: fgPart.id,
          bomHeaderId: bom.id,
          quantity: qty,
          quantityCompleted: 0,
          standardCost: 40 * qty,
          workCenter: station.code,
          createdById: admin.id,
        },
      });
      const kit = await db.kitOrder.create({
        data: {
          number: `KIT-PJ-${label}-${scope}`.slice(0, 30),
          workOrderId: wo.id,
          status: "OPEN",
          lines: { create: [{ partId: pickPart.id, quantityRequired: 2 * qty, quantityPicked: 0 }] },
        },
      });
      return { wo, kit };
    }

    // 1. Feature is off by default: kit posts immediately, no pending journal.
    await stock(20);
    const off = await makeJob("OFF");
    const beforeOff = await onHand(db, pickPart.id);
    const defaultSettings = await run(async () => {
      const { getProductionApprovalSettings } = await import(
        "../src/lib/services/production-journals"
      );
      return getProductionApprovalSettings();
    });
    assert.equal(defaultSettings.required, false, `${scope} approvals default off`);
    await run(async () => {
      const { completeKitOrder } = await import("../src/lib/services/order-fulfillment");
      const result = await completeKitOrder({ kitOrderId: off.kit.id, userId: admin.id });
      assert.ok(!("pendingApproval" in (result as object) && (result as { pendingApproval?: boolean }).pendingApproval));
    });
    const offKit = await db.kitOrder.findUniqueOrThrow({ where: { id: off.kit.id } });
    assert.equal(offKit.status, "COMPLETE");
    assert.equal(await onHand(db, pickPart.id), money(beforeOff - 4));
    assert.equal(await db.productionJournal.count({ where: { workOrderId: off.wo.id, status: "PENDING" } }), 0);

    // Turn the feature on for the rest of the cases.
    await db.accountingSettings.update({
      where: { id: "default" },
      data: {
        productionApprovalRequired: true,
        productionApproverUserIds: JSON.stringify([admin.id]),
        productionApproverRoles: JSON.stringify(["ADMIN"]),
        productionApprovalThreshold: null,
      },
    });

    // 2. Kit is held: no stock or GL movement, journal is PENDING.
    const held = await makeJob("HOLD");
    const stockBeforeHold = await onHand(db, pickPart.id);
    const debitBeforeHold = await postedDebits(db);
    const kitResult = await run(async () => {
      const { completeKitOrder } = await import("../src/lib/services/order-fulfillment");
      return completeKitOrder({ kitOrderId: held.kit.id, userId: operator.id });
    });
    assert.equal((kitResult as { pendingApproval?: boolean }).pendingApproval, true);
    const heldKit = await db.kitOrder.findUniqueOrThrow({ where: { id: held.kit.id } });
    assert.equal(heldKit.status, "OPEN", `${scope} kit must stay open until approved`);
    assert.equal(await onHand(db, pickPart.id), stockBeforeHold, `${scope} kit hold must not move stock`);
    assert.equal(await postedDebits(db), debitBeforeHold, `${scope} kit hold must not post GL`);
    const pendingKit = await db.productionJournal.findFirstOrThrow({
      where: { kitOrderId: held.kit.id, type: "KIT" },
    });
    assert.equal(pendingKit.status, "PENDING");
    assert.ok(pendingKit.number.startsWith("PJ-"));

    // Inbox / to-do visibility
    const inbox = await run(async () => {
      const { listPendingProductionJournalsForUser, productionJournalAsCarinaTask } = await import(
        "../src/lib/services/production-journals"
      );
      const rows = await listPendingProductionJournalsForUser({ userId: admin.id, userRole: "ADMIN" });
      assert.ok(rows.some((r) => r.id === pendingKit.id), `${scope} journal must appear in approver inbox`);
      const todo = productionJournalAsCarinaTask({ journal: rows.find((r) => r.id === pendingKit.id)!, userId: admin.id });
      assert.equal(todo.status, "needs-approval");
      assert.ok(todo.id.startsWith("pj:"));
      const hidden = await listPendingProductionJournalsForUser({ userId: operator.id, userRole: "OPERATOR" });
      assert.ok(!hidden.some((r) => r.id === pendingKit.id), `${scope} operator must not see the journal`);
      return rows;
    });
    assert.ok(inbox.length >= 1);
    void inbox;

    // Operator cannot approve
    await run(async () => {
      const { approveProductionJournal } = await import("../src/lib/services/production-journals");
      await assert.rejects(
        () => approveProductionJournal({ id: pendingKit.id, userId: operator.id, userRole: "OPERATOR" }),
        /not assigned/i
      );
    });
    assert.equal((await db.productionJournal.findUniqueOrThrow({ where: { id: pendingKit.id } })).status, "PENDING");
    assert.equal(await onHand(db, pickPart.id), stockBeforeHold);

    // Close is blocked while pending
    await run(async () => {
      const { closeWorkOrderBooks } = await import("../src/lib/services/inventory-accounting");
      await assert.rejects(
        () => closeWorkOrderBooks({ workOrderId: held.wo.id, userId: admin.id }),
        /waiting for approval/i
      );
    });

    // Period lock blocks approve, journal stays pending, no movement
    const closeDate = new Date();
    closeDate.setDate(closeDate.getDate() + 1);
    await db.accountingSettings.update({
      where: { id: "default" },
      data: { closedThroughDate: closeDate },
    });
    await run(async () => {
      const { approveProductionJournal } = await import("../src/lib/services/production-journals");
      await assert.rejects(
        () => approveProductionJournal({ id: pendingKit.id, userId: admin.id, userRole: "ADMIN" }),
        /period is closed/i
      );
    });
    assert.equal((await db.productionJournal.findUniqueOrThrow({ where: { id: pendingKit.id } })).status, "PENDING");
    assert.equal(await onHand(db, pickPart.id), stockBeforeHold);
    await db.accountingSettings.update({
      where: { id: "default" },
      data: { closedThroughDate: null },
    });

    // Approver can edit quantity (audit trail) then approve; stock and GL post
    await run(async () => {
      const { editProductionJournalQuantity, approveProductionJournal } = await import(
        "../src/lib/services/production-journals"
      );
      const edited = await editProductionJournalQuantity({
        id: pendingKit.id,
        quantity: 4,
        userId: admin.id,
        userRole: "ADMIN",
        note: "Confirmed full kit quantity",
      });
      assert.equal(edited.quantityApproved, 4);
      assert.equal(edited.quantityEditNote, "Confirmed full kit quantity");
      assert.ok(edited.quantityEditedAt);
      const posted = await approveProductionJournal({
        id: pendingKit.id,
        userId: admin.id,
        userRole: "ADMIN",
      });
      assert.equal(posted.status, "APPROVED");
    });
    const afterApprove = await db.kitOrder.findUniqueOrThrow({ where: { id: held.kit.id } });
    assert.equal(afterApprove.status, "COMPLETE");
    assert.equal(await onHand(db, pickPart.id), money(stockBeforeHold - 4));
    assert.ok((await postedDebits(db)) > debitBeforeHold, `${scope} approve must post GL`);
    const approvedRow = await db.productionJournal.findUniqueOrThrow({ where: { id: pendingKit.id } });
    assert.equal(approvedRow.status, "APPROVED");
    assert.equal(approvedRow.decidedById, admin.id);
    // Journals are never deleted
    assert.ok(await db.productionJournal.findUnique({ where: { id: pendingKit.id } }));

    // Re-approve is idempotent
    const again = await run(async () => {
      const { approveProductionJournal } = await import("../src/lib/services/production-journals");
      return approveProductionJournal({ id: pendingKit.id, userId: admin.id, userRole: "ADMIN" });
    });
    assert.equal(again.status, "APPROVED");

    // 3. Reject leaves a reason, does not post, and does not delete
    const rejectJob = await makeJob("REJ");
    const stockBeforeReject = await onHand(db, pickPart.id);
    await run(async () => {
      const { completeKitOrder } = await import("../src/lib/services/order-fulfillment");
      await completeKitOrder({ kitOrderId: rejectJob.kit.id, userId: operator.id });
    });
    const rejectJournal = await db.productionJournal.findFirstOrThrow({
      where: { kitOrderId: rejectJob.kit.id, status: "PENDING" },
    });
    await run(async () => {
      const { rejectProductionJournal } = await import("../src/lib/services/production-journals");
      await assert.rejects(
        () => rejectProductionJournal({ id: rejectJournal.id, reason: "   ", userId: admin.id, userRole: "ADMIN" }),
        /reason is required/i
      );
      const rejected = await rejectProductionJournal({
        id: rejectJournal.id,
        reason: "Wrong lot staged",
        userId: admin.id,
        userRole: "ADMIN",
      });
      assert.equal(rejected.status, "REJECTED");
      assert.equal(rejected.rejectReason, "Wrong lot staged");
    });
    assert.equal((await db.kitOrder.findUniqueOrThrow({ where: { id: rejectJob.kit.id } })).status, "OPEN");
    assert.equal(await onHand(db, pickPart.id), stockBeforeReject);
    assert.ok(await db.productionJournal.findUnique({ where: { id: rejectJournal.id } }));

    // 4. Auto-approve under threshold posts immediately and records an APPROVED journal
    await db.accountingSettings.update({
      where: { id: "default" },
      data: { productionApprovalThreshold: 1000 },
    });
    const autoJob = await makeJob("AUTO");
    const stockBeforeAuto = await onHand(db, pickPart.id);
    await run(async () => {
      const { completeKitOrder } = await import("../src/lib/services/order-fulfillment");
      const result = await completeKitOrder({ kitOrderId: autoJob.kit.id, userId: operator.id });
      assert.ok(!("pendingApproval" in (result as object) && (result as { pendingApproval?: boolean }).pendingApproval));
    });
    assert.equal((await db.kitOrder.findUniqueOrThrow({ where: { id: autoJob.kit.id } })).status, "COMPLETE");
    assert.equal(await onHand(db, pickPart.id), money(stockBeforeAuto - 4));
    const autoRow = await db.productionJournal.findFirstOrThrow({
      where: { kitOrderId: autoJob.kit.id, type: "KIT" },
    });
    assert.equal(autoRow.status, "APPROVED");
    assert.ok(autoRow.notes?.toLowerCase().includes("auto-approved"));
    await db.accountingSettings.update({
      where: { id: "default" },
      data: { productionApprovalThreshold: null },
    });

    // 5. Output is held, then posts inventory on approve. Close blocked until then.
    const outJob = await makeJob("OUT");
    await run(async () => {
      const { completeKitOrder } = await import("../src/lib/services/order-fulfillment");
      const queued = await completeKitOrder({ kitOrderId: outJob.kit.id, userId: operator.id });
      assert.equal((queued as { pendingApproval?: boolean }).pendingApproval, true);
      const { approveProductionJournal } = await import("../src/lib/services/production-journals");
      const kitJ = await (await import("../src/lib/db")).prisma.productionJournal.findFirstOrThrow({
        where: { kitOrderId: outJob.kit.id, status: "PENDING" },
      });
      await approveProductionJournal({ id: kitJ.id, userId: admin.id, userRole: "ADMIN" });
    });
    const fgBefore = await db.inventoryItem.aggregate({
      where: { partId: fgPart.id },
      _sum: { quantityOnHand: true },
    });
    const outputResult = await run(async () => {
      const { receiveWorkOrderOutput } = await import("../src/lib/services/inventory-accounting");
      return receiveWorkOrderOutput({ workOrderId: outJob.wo.id, quantity: 1, userId: operator.id });
    });
    assert.equal((outputResult as { pendingApproval?: boolean }).pendingApproval, true);
    const midWo = await db.workOrder.findUniqueOrThrow({ where: { id: outJob.wo.id } });
    assert.equal(midWo.quantityCompleted, 0, `${scope} held output must not increase completed qty`);
    const fgHeld = await db.inventoryItem.aggregate({
      where: { partId: fgPart.id },
      _sum: { quantityOnHand: true },
    });
    assert.equal(fgHeld._sum.quantityOnHand || 0, fgBefore._sum.quantityOnHand || 0);
    const outJournal = await db.productionJournal.findFirstOrThrow({
      where: { workOrderId: outJob.wo.id, type: "OUTPUT", status: "PENDING" },
    });
    await run(async () => {
      const { closeWorkOrderBooks } = await import("../src/lib/services/inventory-accounting");
      await assert.rejects(
        () => closeWorkOrderBooks({ workOrderId: outJob.wo.id, userId: admin.id }),
        /waiting for approval/i
      );
      const { approveProductionJournal } = await import("../src/lib/services/production-journals");
      const posted = await approveProductionJournal({
        id: outJournal.id,
        userId: admin.id,
        userRole: "ADMIN",
      });
      assert.equal(posted.status, "APPROVED");
    });
    const afterOut = await db.workOrder.findUniqueOrThrow({ where: { id: outJob.wo.id } });
    assert.equal(afterOut.quantityCompleted, 1);
    const fgAfter = await db.inventoryItem.aggregate({
      where: { partId: fgPart.id },
      _sum: { quantityOnHand: true },
    });
    assert.equal(fgAfter._sum.quantityOnHand || 0, (fgBefore._sum.quantityOnHand || 0) + 1);

    // 6. Work-center approver can approve. Standalone CONSUME journal posts via backflush helper path.
    const wcApprover = await db.user.create({
      data: {
        name: "Station lead",
        email: `pj-lead-${scope}@example.invalid`,
        role: "PRODUCTION",
        passwordHash: auth.hashPassword(password),
        pinCode: String(randomInt(100000, 999999)),
        isActive: true,
      },
    });
    await db.workCenter.update({
      where: { id: station.id },
      data: { productionApproverUserId: wcApprover.id },
    });
    const consumeJob = await makeJob("CNS", 1);
    // Seed a BACKFLUSH part on this job's BOM-equivalent by queuing a CONSUME journal and approving it.
    const consumeQueued = await run(async () => {
      const { queueProductionJournal } = await import("../src/lib/services/production-journals");
      return queueProductionJournal({
        type: "CONSUME",
        workOrderId: consumeJob.wo.id,
        workCenterCode: station.code,
        partId: pickPart.id,
        quantity: 1,
        amount: 10,
        unitCost: 10,
        payload: { workOrderId: consumeJob.wo.id, quantity: 1, partId: pickPart.id, consumeSource: "BACKFLUSH" },
        requestedById: operator.id,
      });
    });
    const wcInbox = await run(async () => {
      const { listPendingProductionJournalsForUser, userCanDecideProductionJournal, approveProductionJournal } =
        await import("../src/lib/services/production-journals");
      const rows = await listPendingProductionJournalsForUser({
        userId: wcApprover.id,
        userRole: "PRODUCTION",
      });
      assert.ok(rows.some((r) => r.id === consumeQueued.id), `${scope} station approver must see the journal`);
      const row = await (await import("../src/lib/db")).prisma.productionJournal.findUniqueOrThrow({
        where: { id: consumeQueued.id },
      });
      assert.equal(
        await userCanDecideProductionJournal({ userId: wcApprover.id, userRole: "PRODUCTION", journal: row }),
        true
      );
      const posted = await approveProductionJournal({
        id: consumeQueued.id,
        userId: wcApprover.id,
        userRole: "PRODUCTION",
      });
      assert.equal(posted.status, "APPROVED");
      return rows;
    });
    assert.ok(wcInbox.length >= 1);
    void wcInbox;

    // FIFO: approving a kit uses the company's costing method (layers consumed FIFO).
    await db.accountingSettings.update({
      where: { id: "default" },
      data: { costingMethod: "FIFO", productionApprovalThreshold: null },
    });
    const fifoPartStock = await db.inventoryItem.create({
      data: {
        partId: pickPart.id,
        locationId: storage.id,
        quantityOnHand: 6,
        quantityAvailable: 6,
        unitCost: 12,
        ownership: "COMPANY",
      },
    });
    void fifoPartStock;
    const fifoJob = await makeJob("FIFO", 1);
    await run(async () => {
      const { completeKitOrder } = await import("../src/lib/services/order-fulfillment");
      const queued = await completeKitOrder({ kitOrderId: fifoJob.kit.id, userId: operator.id });
      assert.equal((queued as { pendingApproval?: boolean }).pendingApproval, true);
      const { approveProductionJournal } = await import("../src/lib/services/production-journals");
      const journal = await (await import("../src/lib/db")).prisma.productionJournal.findFirstOrThrow({
        where: { kitOrderId: fifoJob.kit.id, status: "PENDING" },
      });
      const posted = await approveProductionJournal({
        id: journal.id,
        userId: admin.id,
        userRole: "ADMIN",
      });
      assert.equal(posted.status, "APPROVED");
    });
    assert.equal((await db.kitOrder.findUniqueOrThrow({ where: { id: fifoJob.kit.id } })).status, "COMPLETE");
    await db.accountingSettings.update({
      where: { id: "default" },
      data: { costingMethod: "STANDARD" },
    });

    console.log(`  ${scope}: production journal approvals ok`);
  }

  await socket.stop();
  await pg.close();
  console.log("production-approvals qa: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
