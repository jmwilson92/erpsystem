/** Manufacturing inventory accounting: receipt, pick, backflush, labor, partial output, scrap, close, ship. */
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";
import {
  closeVariancePlan,
  finishedGoodsOutputEntry,
  purchaseMatchEntry,
  reliefUnitCost,
  resolveConsumptionTiming,
  roundMoney,
} from "../src/lib/services/posting-rules";

function money(n: number) {
  return roundMoney(n);
}

async function main() {
  process.env.TZ = "America/Los_Angeles";
  Object.assign(globalThis, { AsyncLocalStorage });

  // Pure posting rules
  const match = purchaseMatchEntry({
    receiptValue: 100,
    invoiceValue: 110,
    grirAccountId: "grir",
    apAccountId: "ap",
    ppvAccountId: "ppv",
  });
  assert.ok(match);
  assert.equal(money(match.reduce((s, l) => s + l.debit - l.credit, 0)), 0);
  assert.ok(match.some((l) => l.accountId === "ppv" && l.debit === 10));

  const fg = finishedGoodsOutputEntry({ amount: 25.5, fgAccountId: "fg", wipAccountId: "wip" });
  assert.ok(fg);
  assert.equal(fg[0].debit, 25.5);
  assert.equal(fg[1].credit, 25.5);

  const residualOnly = closeVariancePlan({
    wipBalance: 12.34,
    materialIssued: 50,
    standardMaterial: 0,
    actualLabor: 20,
    clockedHours: 2,
    standardHours: 0,
    standardLaborRate: 10,
    absorbedOverhead: 8,
    standardOverhead: 0,
  });
  assert.equal(residualOnly.length, 1);
  assert.equal(residualOnly[0].key, "RESIDUAL");
  assert.equal(residualOnly[0].amount, 12.34);

  assert.equal(resolveConsumptionTiming("BACKFLUSH", "AT_PICK"), "BACKFLUSH");
  assert.equal(resolveConsumptionTiming(null, "AT_PICK"), "AT_PICK");
  assert.equal(reliefUnitCost({ costingMethod: "STANDARD", standardCost: 9, actualUnitCost: 11 }), 9);
  assert.equal(reliefUnitCost({ costingMethod: "AVERAGE", standardCost: 9, actualUnitCost: 11 }), 11);

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
  const schema = "tenant_qamfg01";
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
    throw new Error("External requests disabled in mfg-accounting tests");
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
      new NextRequest("http://127.0.0.1/mfg-acct-qa", {
        headers: {
          cookie: Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
        },
      }),
      { pathname: "/mfg-acct-qa", search: "" },
      { tags: [], expirationsByCacheKind: new Map() },
      undefined,
      undefined
    );
    const work = createWorkStore({
      page: "/mfg-acct-qa",
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
    data: { slug: "qa-mfg", schemaName: schema, status: "ACTIVE" },
  });

  async function assertBooksBalanced(db: typeof p, label: string) {
    const lines = await db.journalLine.findMany({
      where: { journalEntry: { status: "POSTED" } },
      select: { debit: true, credit: true, journalEntryId: true },
    });
    const byJe = new Map<string, { d: number; c: number }>();
    let d = 0;
    let c = 0;
    for (const l of lines) {
      d = money(d + (l.debit || 0));
      c = money(c + (l.credit || 0));
      const row = byJe.get(l.journalEntryId) || { d: 0, c: 0 };
      row.d = money(row.d + (l.debit || 0));
      row.c = money(row.c + (l.credit || 0));
      byJe.set(l.journalEntryId, row);
    }
    assert.equal(d, c, `${label}: books not balanced ${d} vs ${c}`);
    for (const [id, row] of byJe) {
      assert.equal(row.d, row.c, `${label}: journal ${id} ${row.d} vs ${row.c}`);
    }
  }

  for (const [scope, db] of [["public", p], [schema, tenant]] as const) {
    const admin = await db.user.create({
      data: {
        name: "Controller",
        email: `acct-${scope}@example.invalid`,
        role: "ADMIN",
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
      ["6230", "Material usage variance", "EXPENSE"],
      ["6240", "Labor rate variance", "EXPENSE"],
      ["6250", "Labor efficiency variance", "EXPENSE"],
      ["6260", "Overhead variance", "EXPENSE"],
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
      data: { code: "WH-1", name: "Main warehouse" },
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

    const supplier = await db.supplier.create({
      data: { name: "Fixture Metals", code: "FIX-MET" },
    });
    const customer = await db.customer.create({
      data: { name: "Fixture Customer", code: "FIX-CUS" },
    });

    const pickPart = await db.part.create({
      data: {
        partNumber: "RAW-PICK",
        description: "Issued at pick",
        sourcingMethod: "PURCHASE",
        itemStructure: "RAW_MATERIAL",
        standardCost: 10,
        consumptionTiming: "AT_PICK",
      },
    });
    const bfPart = await db.part.create({
      data: {
        partNumber: "RAW-BF",
        description: "Backflushed at output",
        sourcingMethod: "PURCHASE",
        itemStructure: "RAW_MATERIAL",
        standardCost: 15,
        consumptionTiming: "BACKFLUSH",
      },
    });
    const fgPart = await db.part.create({
      data: {
        partNumber: "FG-ASSY",
        description: "Finished assembly",
        sourcingMethod: "BUILD",
        itemStructure: "TOP_LEVEL_ASSEMBLY",
        standardCost: 100,
      },
    });
    const bom = await db.bomHeader.create({
      data: {
        partId: fgPart.id,
        revision: "A",
        status: "CERTIFIED",
        lines: {
          create: [
            { componentPartId: pickPart.id, quantity: 2 },
            { componentPartId: bfPart.id, quantity: 1 },
          ],
        },
      },
    });

    const po = await db.purchaseOrder.create({
      data: {
        number: `PO-MFG-${scope}`.slice(0, 24),
        supplierId: supplier.id,
        status: "ISSUED",
        lines: {
          create: [
            { partId: pickPart.id, description: "pick", quantity: 10, unitCost: 10 },
            { partId: bfPart.id, description: "bf", quantity: 5, unitCost: 15 },
          ],
        },
      },
    });
    const poLines = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    const receipt = await db.receipt.create({
      data: {
        number: `RCV-MFG-${scope}`.slice(0, 24),
        purchaseOrderId: po.id,
        status: "COMPLETE",
        lines: {
          create: poLines.map((l) => ({
            poLineId: l.id,
            partId: l.partId,
            description: l.description,
            quantityOrdered: l.quantity,
            quantityReceived: l.quantity,
            unitCost: l.unitCost,
          })),
        },
      },
    });
    for (const line of poLines) {
      await db.inventoryItem.create({
        data: {
          partId: line.partId!,
          locationId: storage.id,
          quantityOnHand: line.quantity,
          quantityAvailable: line.quantity,
          unitCost: line.unitCost,
          ownership: "COMPANY",
        },
      });
      await db.materialTransaction.create({
        data: {
          type: "RECEIPT",
          partId: line.partId!,
          purchaseOrderId: po.id,
          quantity: line.quantity,
          unitCost: line.unitCost,
          toLocation: "ST-01",
          reference: receipt.number,
        },
      });
    }

    await run(async () => {
      const { raiseApInvoiceForReceipt } = await import("../src/lib/services/billing");
      await raiseApInvoiceForReceipt({
        purchaseOrderId: po.id,
        receiptNumber: receipt.number,
        received: poLines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitCost: l.unitCost,
        })),
        userId: admin.id,
      });
    });
    await assertBooksBalanced(db, `${scope} after receipt`);
    const reconAfterReceipt = await run(async () => {
      const { getInventoryGlReconciliation } = await import(
        "../src/lib/services/inventory-accounting"
      );
      return getInventoryGlReconciliation();
    });
    assert.ok(reconAfterReceipt.inBalance, `${scope} receipt recon ${JSON.stringify(reconAfterReceipt.rows)}`);

    const wo = await db.workOrder.create({
      data: {
        number: `WO-MFG-${scope}`.slice(0, 24),
        type: "PRODUCTION",
        status: "IN_PROGRESS",
        partId: fgPart.id,
        bomHeaderId: bom.id,
        quantity: 2,
        quantityCompleted: 0,
        standardCost: 200,
        allocatedHours: 2,
        createdById: admin.id,
      },
    });
    const kit = await db.kitOrder.create({
      data: {
        number: `KIT-MFG-${scope}`.slice(0, 24),
        workOrderId: wo.id,
        status: "OPEN",
        lines: {
          create: [
            { partId: pickPart.id, quantityRequired: 4, quantityPicked: 0 },
            { partId: bfPart.id, quantityRequired: 2, quantityPicked: 0 },
          ],
        },
      },
    });

    await run(async () => {
      const { completeKitOrder } = await import("../src/lib/services/order-fulfillment");
      await completeKitOrder({ kitOrderId: kit.id, userId: admin.id });
    });

    const issueJournals = await db.journalEntry.findMany({
      where: { idempotencyKey: { startsWith: "material-issue:" } },
    });
    // Only the AT_PICK component should have posted (4 x $10 = 40), not the backflush part.
    const issueAmount = money(
      (await db.journalLine.findMany({
        where: { journalEntryId: { in: issueJournals.map((j) => j.id) }, debit: { gt: 0 } },
      })).reduce((s, l) => s + l.debit, 0)
    );
    assert.equal(issueAmount, 40, `${scope} pick should post only AT_PICK material`);
    await assertBooksBalanced(db, `${scope} after kit`);
    let recon = await run(async () => (await import("../src/lib/services/inventory-accounting")).getInventoryGlReconciliation());
    assert.ok(recon.inBalance, `${scope} after kit ${JSON.stringify(recon.rows)}`);

    const sheet = await db.timesheet.create({
      data: {
        userId: admin.id,
        periodStart: new Date("2026-11-01"),
        periodEnd: new Date("2026-11-07"),
        status: "APPROVED",
        entries: {
          create: [
            {
              userId: admin.id,
              workOrderId: wo.id,
              date: new Date("2026-11-02"),
              hours: 2,
              laborRate: 20,
              costAmount: 40,
              type: "REGULAR",
              status: "APPROVED",
            },
          ],
        },
      },
    });
    await run(async () => {
      const { absorbApprovedTimesheetLabor } = await import(
        "../src/lib/services/inventory-accounting"
      );
      await absorbApprovedTimesheetLabor({ timesheetId: sheet.id, userId: admin.id });
    });
    await assertBooksBalanced(db, `${scope} after labor`);
    recon = await run(async () => (await import("../src/lib/services/inventory-accounting")).getInventoryGlReconciliation());
    assert.ok(recon.inBalance, `${scope} after labor ${JSON.stringify(recon.rows)}`);

    await run(async () => {
      const { receiveWorkOrderOutput } = await import("../src/lib/services/inventory-accounting");
      await receiveWorkOrderOutput({ workOrderId: wo.id, quantity: 1, userId: admin.id });
    });
    const mid = await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    assert.equal(mid.quantityCompleted, 1);
    assert.equal(mid.status, "IN_PROGRESS");
    await assertBooksBalanced(db, `${scope} after first output`);
    recon = await run(async () => (await import("../src/lib/services/inventory-accounting")).getInventoryGlReconciliation());
    assert.ok(recon.inBalance, `${scope} after first output ${JSON.stringify(recon.rows)}`);

    const staged = await db.inventoryItem.findFirst({
      where: { workOrderId: wo.id, partId: pickPart.id, quantityOnHand: { gt: 0 } },
    });
    assert.ok(staged, "staged pick-part should remain after a partial output");
    const scrapQty = 1;
    const scrapTx = await db.materialTransaction.create({
      data: {
        type: "SCRAP",
        partId: pickPart.id,
        inventoryItemId: staged!.id,
        workOrderId: wo.id,
        quantity: scrapQty,
        unitCost: staged!.unitCost,
        reference: "SCRAP-FIXTURE",
        userId: admin.id,
      },
    });
    await db.inventoryItem.update({
      where: { id: staged!.id },
      data: { quantityOnHand: { decrement: scrapQty } },
    });
    await run(async () => {
      const { postScrap } = await import("../src/lib/services/gl-posting");
      await postScrap({
        materialTransactionId: scrapTx.id,
        amount: money(scrapQty * staged!.unitCost),
        workOrderId: wo.id,
        userId: admin.id,
        memo: "Fixture scrap",
      });
    });
    await assertBooksBalanced(db, `${scope} after scrap`);
    recon = await run(async () => (await import("../src/lib/services/inventory-accounting")).getInventoryGlReconciliation());
    assert.ok(recon.inBalance, `${scope} after scrap ${JSON.stringify(recon.rows)}`);

    await run(async () => {
      const { receiveWorkOrderOutput } = await import("../src/lib/services/inventory-accounting");
      await receiveWorkOrderOutput({ workOrderId: wo.id, quantity: 1, userId: admin.id });
    });
    const done = await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
    assert.equal(done.quantityCompleted, 2);
    assert.equal(done.status, "IN_PROGRESS");
    await assertBooksBalanced(db, `${scope} after second output`);
    recon = await run(async () => (await import("../src/lib/services/inventory-accounting")).getInventoryGlReconciliation());
    assert.ok(recon.inBalance, `${scope} after second output ${JSON.stringify(recon.rows)}`);

    await run(async () => {
      const { closeWorkOrderBooks } = await import("../src/lib/services/inventory-accounting");
      await closeWorkOrderBooks({ workOrderId: wo.id, userId: admin.id });
    });
    await db.workOrder.update({ where: { id: wo.id }, data: { status: "COMPLETED" } });
    await assertBooksBalanced(db, `${scope} after close`);
    recon = await run(async () => (await import("../src/lib/services/inventory-accounting")).getInventoryGlReconciliation());
    assert.ok(recon.inBalance, `${scope} after close ${JSON.stringify(recon.rows)}`);
    const wipAcct = await db.account.findUniqueOrThrow({ where: { code: "1210" } });
    const wipLines = await db.journalLine.findMany({
      where: { workOrderId: wo.id, accountId: wipAcct.id, journalEntry: { status: "POSTED" } },
    });
    const wipEnd = money(wipLines.reduce((s, l) => s + l.debit - l.credit, 0));
    assert.equal(wipEnd, 0, `${scope} WIP should be cleared at close, have ${wipEnd}`);

    const so = await db.salesOrder.create({
      data: {
        number: `SO-MFG-${scope}`.slice(0, 24),
        customerId: customer.id,
        status: "RELEASED",
        lines: {
          create: [{ partId: fgPart.id, description: "assembly", quantity: 1, unitPrice: 250 }],
        },
      },
    });
    const shipment = await db.shipment.create({
      data: {
        number: `SH-MFG-${scope}`.slice(0, 24),
        salesOrderId: so.id,
        status: "SHIPPED",
        lines: { create: [{ partId: fgPart.id, description: "assembly", quantity: 1 }] },
      },
    });
    const fgBin = await db.inventoryItem.findFirst({
      where: { partId: fgPart.id, quantityOnHand: { gt: 0 } },
    });
    assert.ok(fgBin);
    await db.inventoryItem.update({
      where: { id: fgBin!.id },
      data: {
        quantityOnHand: { decrement: 1 },
        quantityAvailable: fgBin!.quantityAvailable >= 1 ? { decrement: 1 } : undefined,
        quantityCommitted: fgBin!.quantityAvailable < 1 ? { decrement: 1 } : undefined,
      },
    });
    await run(async () => {
      const { raiseArInvoiceForShipment } = await import("../src/lib/services/billing");
      await raiseArInvoiceForShipment({
        salesOrderId: so.id,
        shipmentId: shipment.id,
        userId: admin.id,
      });
    });
    await assertBooksBalanced(db, `${scope} after ship`);
    recon = await run(async () => (await import("../src/lib/services/inventory-accounting")).getInventoryGlReconciliation());
    assert.ok(recon.inBalance, `${scope} after ship ${JSON.stringify(recon.rows)}`);

    const wipReport = await run(async () =>
      (await import("../src/lib/services/inventory-accounting")).getWipByWorkOrderReport({ includeClosed: true })
    );
    const woRow = wipReport.rows.find((r) => r.workOrderId === wo.id);
    assert.ok(woRow, "WIP report should include the job");
    assert.equal(money(woRow!.ending), 0);
    assert.ok(woRow!.materialIn > 0);
    assert.ok(woRow!.laborIn > 0);
    assert.ok(woRow!.relieved > 0);
  }

  console.log("PASS qa-mfg-accounting");
  await socket.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
