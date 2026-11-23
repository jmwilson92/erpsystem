/** RMA restock, credit memo, and scrap: inventory and the books stay in step. */
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";
import { roundMoney } from "../src/lib/services/posting-rules";
import { openReceivable } from "../src/lib/services/ar-balance";

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
  const schema = "tenant_qarma01";
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
    throw new Error("External requests disabled in rma-accounting tests");
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
      new NextRequest("http://127.0.0.1/rma-acct-qa", {
        headers: {
          cookie: Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
        },
      }),
      { pathname: "/rma-acct-qa", search: "" },
      { tags: [], expirationsByCacheKind: new Map() },
      undefined,
      undefined
    );
    const work = createWorkStore({
      page: "/rma-acct-qa",
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
    data: { slug: "qa-rma", schemaName: schema, status: "ACTIVE" },
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

  async function accountBalance(db: typeof p, code: string) {
    const acct = await db.account.findUniqueOrThrow({ where: { code } });
    const lines = await db.journalLine.findMany({
      where: { accountId: acct.id, journalEntry: { status: "POSTED" } },
    });
    return money(lines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0));
  }

  for (const [scope, db] of [["public", p], [schema, tenant]] as const) {
    const admin = await db.user.create({
      data: {
        name: "Controller",
        email: `rma-${scope}@example.invalid`,
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
      ["1230", "Returns inspection", "ASSET"],
      ["2000", "Accounts payable", "LIABILITY"],
      ["3000", "Opening equity", "EQUITY"],
      ["4000", "Sales revenue", "REVENUE"],
      ["4100", "Sales returns", "REVENUE"],
      ["5000", "Cost of goods sold", "COGS"],
      ["6210", "Scrap", "EXPENSE"],
    ] as const;
    for (const [code, name, type] of chart) {
      await db.account.create({ data: { code, name, type } });
    }

    await run(async () => {
      const { ensureRmaAccountingDefaults } = await import("../src/lib/services/rma-accounting");
      await ensureRmaAccountingDefaults();
    });

    const warehouse = await db.warehouse.create({
      data: { code: "WH-1", name: "Main warehouse" },
    });
    const storage = await db.location.create({
      data: { warehouseId: warehouse.id, code: "ST-01", name: "Stores", type: "STORAGE" },
    });
    await db.location.create({
      data: { warehouseId: warehouse.id, code: "QA-01", name: "Quarantine", type: "QUARANTINE" },
    });

    const customer = await db.customer.create({
      data: { name: "Return Customer", code: "RET-CUS" },
    });
    const fgPart = await db.part.create({
      data: {
        partNumber: "FG-RET",
        description: "Returned assembly",
        sourcingMethod: "BUILD",
        itemStructure: "TOP_LEVEL_ASSEMBLY",
        standardCost: 80,
      },
    });
    const bin = await db.inventoryItem.create({
      data: {
        partId: fgPart.id,
        locationId: storage.id,
        quantityOnHand: 2,
        quantityAvailable: 2,
        unitCost: 80,
        lotNumber: "LOT-RET",
      },
    });
    const [fgAcct, equity] = await Promise.all([
      db.account.findUniqueOrThrow({ where: { code: "1220" } }),
      db.account.findUniqueOrThrow({ where: { code: "3000" } }),
    ]);
    await run(async () => {
      const { postJournal } = await import("../src/lib/services/gaap");
      await postJournal({
        description: "Opening finished goods",
        source: "INVENTORY",
        sourceId: bin.id,
        idempotencyKey: `open-fg:${bin.id}`,
        status: "POSTED",
        lines: [
          { accountId: fgAcct.id, debit: 160, memo: "Opening FG" },
          { accountId: equity.id, credit: 160, memo: "Opening FG" },
        ],
      });
    });

    const so = await db.salesOrder.create({
      data: {
        number: `SO-RMA-${scope}`.slice(0, 24),
        customerId: customer.id,
        status: "RELEASED",
        lines: { create: [{ partId: fgPart.id, description: "assembly", quantity: 2, unitPrice: 250 }] },
      },
    });
    const shipment = await db.shipment.create({
      data: {
        number: `SH-RMA-${scope}`.slice(0, 24),
        salesOrderId: so.id,
        status: "SHIPPED",
        lines: { create: [{ partId: fgPart.id, description: "assembly", quantity: 2 }] },
      },
    });
    await db.inventoryItem.update({
      where: { id: bin.id },
      data: { quantityOnHand: 0, quantityAvailable: 0 },
    });
    await db.materialTransaction.create({
      data: {
        type: "SHIP",
        partId: fgPart.id,
        inventoryItemId: bin.id,
        salesOrderId: so.id,
        quantity: 2,
        unitCost: 80,
        fromLocation: "ST-01",
        reference: shipment.id,
        lotNumber: "LOT-RET",
      },
    });
    const invoice = await run(async () => {
      const { raiseArInvoiceForShipment } = await import("../src/lib/services/billing");
      return raiseArInvoiceForShipment({ salesOrderId: so.id, shipmentId: shipment.id, userId: admin.id });
    });
    assert.ok(invoice);
    await assertBooksBalanced(db, `${scope} after ship`);
    const cogsAfterShip = await accountBalance(db, "5000");
    const arAfterShip = await accountBalance(db, "1100");
    const fgAfterShip = await accountBalance(db, "1220");
    assert.equal(cogsAfterShip, 160, `${scope} COGS should be 2 × 80`);
    assert.equal(arAfterShip, 500, `${scope} AR should be 2 × 250`);
    assert.equal(fgAfterShip, 0, `${scope} FG should be cleared after shipping both units`);

    const rma = await run(async () => {
      const { createRmaRequest } = await import("../src/lib/services/rma");
      const created = await createRmaRequest({
        customerId: customer.id,
        serial: "SN-RET-1",
        partId: fgPart.id,
        userId: admin.id,
      });
      return created.rma;
    });

    const first = await run(async () => {
      const { receiveRmaReturn } = await import("../src/lib/services/rma-accounting");
      return receiveRmaReturn({
        rmaId: rma.id,
        quantity: 1,
        destination: "INSPECTION",
        partId: fgPart.id,
        serialNumber: "SN-RET-1",
        salesOrderId: so.id,
        shipmentId: shipment.id,
        userId: admin.id,
      });
    });
    assert.equal(first.unitCost, 80, `${scope} inspection return uses original COGS unit cost`);
    await assertBooksBalanced(db, `${scope} after inspection receive`);
    let recon = await run(async () =>
      (await import("../src/lib/services/inventory-accounting")).getInventoryGlReconciliation()
    );
    assert.ok(recon.inBalance, `${scope} after inspection receive ${JSON.stringify(recon.rows)}`);
    assert.equal(await accountBalance(db, "5000"), 80, `${scope} COGS reduced by 80`);
    assert.equal(await accountBalance(db, "1230"), 80, `${scope} returns inspection 80`);

    const again = await run(async () => {
      const { receiveRmaReturn } = await import("../src/lib/services/rma-accounting");
      return receiveRmaReturn({
        rmaId: rma.id,
        quantity: 1,
        destination: "INSPECTION",
        partId: fgPart.id,
        serialNumber: "SN-RET-1",
        salesOrderId: so.id,
        shipmentId: shipment.id,
        userId: admin.id,
      });
    });
    assert.equal(again.receiptId, first.receiptId);
    assert.equal(await db.journalEntry.count({ where: { idempotencyKey: `rma-return:${first.receiptId}` } }), 1);

    const second = await run(async () => {
      const { receiveRmaReturn } = await import("../src/lib/services/rma-accounting");
      return receiveRmaReturn({
        rmaId: rma.id,
        quantity: 1,
        destination: "INSPECTION",
        partId: fgPart.id,
        serialNumber: "SN-RET-2",
        salesOrderId: so.id,
        shipmentId: shipment.id,
        userId: admin.id,
      });
    });
    await assertBooksBalanced(db, `${scope} after second receive`);
    recon = await run(async () =>
      (await import("../src/lib/services/inventory-accounting")).getInventoryGlReconciliation()
    );
    assert.ok(recon.inBalance, `${scope} after second receive ${JSON.stringify(recon.rows)}`);
    assert.equal(await accountBalance(db, "5000"), 0);
    assert.equal(await accountBalance(db, "1230"), 160);

    const credit = await run(async () => {
      const { issueRmaCreditMemo } = await import("../src/lib/services/rma-accounting");
      return issueRmaCreditMemo({ rmaId: rma.id, userId: admin.id });
    });
    assert.equal(credit.total, 500);
    await assertBooksBalanced(db, `${scope} after credit memo`);
    assert.equal(await accountBalance(db, "1100"), 0, `${scope} AR cleared by credit`);
    assert.equal(await accountBalance(db, "4100"), 500, `${scope} sales returns 500`);
    const inv = await db.arInvoice.findUniqueOrThrow({ where: { id: invoice!.id } });
    assert.equal(openReceivable(inv), 0);
    const creditAgain = await run(async () => {
      const { issueRmaCreditMemo } = await import("../src/lib/services/rma-accounting");
      return issueRmaCreditMemo({ rmaId: rma.id, receiptId: first.receiptId, userId: admin.id });
    });
    assert.equal(creditAgain.id, credit.id);
    assert.equal(await db.arCreditMemo.count(), 1);

    await run(async () => {
      const { dispositionRmaReceipt } = await import("../src/lib/services/rma-accounting");
      await dispositionRmaReceipt({ receiptId: first.receiptId, disposition: "RESTOCK", userId: admin.id });
    });
    await assertBooksBalanced(db, `${scope} after restock`);
    recon = await run(async () =>
      (await import("../src/lib/services/inventory-accounting")).getInventoryGlReconciliation()
    );
    assert.ok(recon.inBalance, `${scope} after restock ${JSON.stringify(recon.rows)}`);
    assert.equal(await accountBalance(db, "1230"), 80);
    assert.equal(await accountBalance(db, "1220"), 80, `${scope} FG should hold the restocked unit`);
    const sellable = await db.inventoryItem.findFirst({
      where: { id: first.inventoryItemId!, quantityAvailable: { gt: 0 }, quantityQuarantine: 0 },
    });
    assert.ok(sellable, "restocked unit should be sellable");

    await run(async () => {
      const { dispositionRmaReceipt } = await import("../src/lib/services/rma-accounting");
      await dispositionRmaReceipt({ receiptId: second.receiptId, disposition: "SCRAP", userId: admin.id });
    });
    await assertBooksBalanced(db, `${scope} after scrap`);
    recon = await run(async () =>
      (await import("../src/lib/services/inventory-accounting")).getInventoryGlReconciliation()
    );
    assert.ok(recon.inBalance, `${scope} after scrap ${JSON.stringify(recon.rows)}`);
    assert.equal(await accountBalance(db, "1230"), 0);
    assert.equal(await accountBalance(db, "6210"), 80);
    const leftover = await db.inventoryItem.findUnique({ where: { id: second.inventoryItemId! } });
    assert.equal(leftover?.quantityOnHand, 0);

    const register = await run(async () =>
      (await import("../src/lib/services/inventory-accounting")).getInventoryTransactionRegister({
        rmaId: rma.id,
        take: 50,
      })
    );
    const types = register.map((r) => r.type).sort();
    assert.ok(types.includes("RMA_RECEIPT"));
    assert.ok(types.includes("RMA_RESTOCK"));
    assert.ok(types.includes("SCRAP"));
    assert.ok(register.every((r) => r.rmaNumber === rma.number));
    assert.ok(register.some((r) => r.journalNumber));
  }

  console.log("PASS qa-rma-accounting");
  await socket.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
