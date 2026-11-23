/** Costing methods: STANDARD, moving weighted AVERAGE, FIFO, and LIFO — subledger equals GL. */
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";
import { reliefUnitCost, roundMoney } from "../src/lib/services/posting-rules";

function money(n: number) {
  return roundMoney(n);
}

async function main() {
  process.env.TZ = "America/Los_Angeles";
  Object.assign(globalThis, { AsyncLocalStorage });

  assert.equal(reliefUnitCost({ costingMethod: "STANDARD", standardCost: 9, actualUnitCost: 11 }), 9);
  assert.equal(reliefUnitCost({ costingMethod: "AVERAGE", standardCost: 9, actualUnitCost: 11 }), 11);
  assert.equal(reliefUnitCost({ costingMethod: "FIFO", standardCost: 9, actualUnitCost: 11 }), 11);
  assert.equal(reliefUnitCost({ costingMethod: "LIFO", standardCost: 9, actualUnitCost: 11 }), 11);

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
  const schema = "tenant_qacost01";
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
    throw new Error("External requests disabled in costing-methods tests");
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
  const { normalizeCostingMethod, usesCostLayers } = await import("../src/lib/services/cost-layers");
  assert.equal(normalizeCostingMethod("fifo"), "FIFO");
  assert.equal(normalizeCostingMethod("lifo"), "LIFO");
  assert.equal(normalizeCostingMethod("actual"), "AVERAGE");
  assert.equal(usesCostLayers("FIFO"), true);
  assert.equal(usesCostLayers("STANDARD"), false);
  const auth = await import("../src/lib/auth-core");
  const p = controlPlaneClient();
  const tenant = clientForSchema(schema);
  const password = "Synthetic-QA-" + randomBytes(20).toString("hex");

  async function request<T>(fn: () => Promise<T>, cookies: Record<string, string> = {}) {
    const store = createRequestStoreForAPI(
      new NextRequest("http://127.0.0.1/costing-qa", {
        headers: {
          cookie: Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
        },
      }),
      { pathname: "/costing-qa", search: "" },
      { tags: [], expirationsByCacheKind: new Map() },
      undefined,
      undefined
    );
    const work = createWorkStore({
      page: "/costing-qa",
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
    data: { slug: "qa-costing", schemaName: schema, status: "ACTIVE" },
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

  let periodSeq = 0;

  for (const [scope, db] of [["public", p], [schema, tenant]] as const) {
    const admin = await db.user.create({
      data: {
        name: "Controller",
        email: `cost-${scope}@example.invalid`,
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
      ["2010", "Goods received / invoices received", "LIABILITY"],
      ["3000", "Opening equity", "EQUITY"],
      ["4000", "Sales revenue", "REVENUE"],
      ["4100", "Sales returns", "REVENUE"],
      ["5000", "Cost of goods sold", "COGS"],
      ["6200", "Production variance", "EXPENSE"],
      ["6210", "Scrap", "EXPENSE"],
      ["6220", "Inventory adjustment", "EXPENSE"],
      ["6221", "Purchase price variance", "EXPENSE"],
      ["6222", "Inventory revaluation", "EXPENSE"],
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
      data: { code: "WH-C", name: "Costing warehouse" },
    });
    const storage = await db.location.create({
      data: { warehouseId: warehouse.id, code: "ST-C", name: "Stores", type: "STORAGE" },
    });
    const customer = await db.customer.create({
      data: { name: "Costing Customer", code: `CUS-C-${scope}`.slice(0, 16) },
    });

    const fgAcct = await db.account.findUniqueOrThrow({ where: { code: "1220" } });
    const grir = await db.account.findUniqueOrThrow({ where: { code: "2010" } });
    const cogsAcct = await db.account.findUniqueOrThrow({ where: { code: "5000" } });

    async function openQuietPeriod() {
      // Close the slice of time that already has activity by ending it just
      // before now, then open a fresh period that starts now. Closing the
      // calendar month itself would period-lock today's journals.
      const now = new Date();
      const justBefore = new Date(now.getTime() - 1000);
      const current = await db.accountingPeriod.findMany({
        where: { status: "OPEN", startDate: { lte: now }, endDate: { gte: now } },
      });
      for (const row of current) {
        await db.accountingPeriod.update({
          where: { id: row.id },
          data: { status: "CLOSED", closedAt: now, endDate: justBefore },
        });
      }
      periodSeq += 1;
      await db.accountingPeriod.create({
        data: {
          name: `QC${periodSeq}-${Date.now().toString(36)}`.slice(0, 20),
          startDate: now,
          endDate: new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000),
          status: "OPEN",
        },
      });
    }

    async function setMethod(method: string) {
      await run(async () => {
        const { changeCostingMethod } = await import("../src/lib/services/cost-layers");
        await changeCostingMethod({ nextMethod: method, userId: admin.id });
      });
    }

    async function assertRecon(label: string) {
      const recon = await run(async () => {
        const { getInventoryGlReconciliation } = await import(
          "../src/lib/services/inventory-accounting"
        );
        return getInventoryGlReconciliation();
      });
      assert.ok(
        recon.inBalance,
        `${label}: subledger != GL ${JSON.stringify(recon.rows)}`
      );
    }

    async function accountActivity(code: string) {
      const acct = await db.account.findUniqueOrThrow({ where: { code } });
      const lines = await db.journalLine.aggregate({
        where: { accountId: acct.id, journalEntry: { status: "POSTED" } },
        _sum: { debit: true, credit: true },
      });
      return money((lines._sum.debit || 0) - (lines._sum.credit || 0));
    }

    let recvSeq = 0;
    async function receiveStock(partId: string, quantity: number, unitCost: number) {
      const existing = await db.inventoryItem.findFirst({
        where: { partId, locationId: storage.id, ownership: "COMPANY", workOrderId: null },
      });
      const item = existing
        ? await db.inventoryItem.update({
            where: { id: existing.id },
            data: {
              quantityOnHand: { increment: quantity },
              quantityAvailable: { increment: quantity },
              unitCost,
            },
          })
        : await db.inventoryItem.create({
            data: {
              partId,
              locationId: storage.id,
              quantityOnHand: quantity,
              quantityAvailable: quantity,
              unitCost,
              ownership: "COMPANY",
            },
          });
      recvSeq += 1;
      const tx = await db.materialTransaction.create({
        data: {
          type: "RECEIPT",
          partId,
          inventoryItemId: item.id,
          quantity,
          unitCost,
          toLocation: storage.code,
          reference: `RCV-C-${scope}-${recvSeq}`,
        },
      });
      await run(async () => {
        const { recordInboundCost } = await import("../src/lib/services/cost-layers");
        const { postJournal } = await import("../src/lib/services/gaap");
        await recordInboundCost({
          partId,
          locationId: storage.id,
          inventoryItemId: item.id,
          quantity,
          unitCost,
          sourceType: "RECEIPT",
          sourceId: tx.id,
          materialTransactionId: tx.id,
          ownership: "COMPANY",
        });
        await postJournal({
          description: `QA receipt ${tx.reference}`,
          source: "INVENTORY",
          sourceId: tx.id,
          idempotencyKey: `qa-cost-rcv:${tx.id}`,
          status: "POSTED",
          createdById: admin.id,
          lines: [
            { accountId: fgAcct.id, debit: money(quantity * unitCost) },
            { accountId: grir.id, credit: money(quantity * unitCost) },
          ],
        });
      });
      return item;
    }

    let shipSeq = 0;
    async function shipQty(partId: string, quantity: number, unitPrice: number) {
      shipSeq += 1;
      const so = await db.salesOrder.create({
        data: {
          number: `SO-C-${scope}-${shipSeq}`.slice(0, 24),
          customerId: customer.id,
          status: "READY_TO_SHIP",
          lines: {
            create: {
              partId,
              description: "Costing ship line",
              quantity,
              unitPrice,
            },
          },
        },
      });
      const shipment = await db.shipment.create({
        data: {
          number: `SH-C-${scope}-${shipSeq}`.slice(0, 24),
          salesOrderId: so.id,
          status: "SHIPPED",
          lines: {
            create: { partId, description: "Costing ship line", quantity },
          },
        },
      });
      let remaining = quantity;
      const bins = await db.inventoryItem.findMany({
        where: {
          partId,
          locationId: storage.id,
          quantityOnHand: { gt: 0 },
          workOrderId: null,
        },
        orderBy: { id: "asc" },
      });
      for (const bin of bins) {
        if (remaining <= 0) break;
        const take = Math.min(bin.quantityOnHand, remaining);
        await db.inventoryItem.update({
          where: { id: bin.id },
          data: {
            quantityOnHand: { decrement: take },
            quantityAvailable: { decrement: Math.min(take, bin.quantityAvailable) },
          },
        });
        const tx = await db.materialTransaction.create({
          data: {
            type: "SHIP",
            partId,
            inventoryItemId: bin.id,
            salesOrderId: so.id,
            quantity: take,
            unitCost: bin.unitCost,
            fromLocation: storage.code,
            reference: shipment.number,
            notes: `Shipped on ${so.number}`,
            userId: admin.id,
          },
        });
        await run(async () => {
          const { consumeOutboundCost } = await import("../src/lib/services/cost-layers");
          const relief = await consumeOutboundCost({
            partId,
            locationId: storage.id,
            inventoryItemId: bin.id,
            quantity: take,
            fallbackUnitCost: bin.unitCost,
            materialTransactionId: tx.id,
            ownership: bin.ownership,
          });
          await db.materialTransaction.update({
            where: { id: tx.id },
            data: { unitCost: relief.unitCost },
          });
        });
        remaining -= take;
      }
      assert.equal(remaining, 0, `${scope} insufficient stock to ship ${partId}`);
      await run(async () => {
        const { raiseArInvoiceForShipment } = await import("../src/lib/services/billing");
        await raiseArInvoiceForShipment({
          salesOrderId: so.id,
          shipmentId: shipment.id,
          userId: admin.id,
        });
      });
      return so;
    }

    async function makePart(suffix: string, standardCost: number) {
      return db.part.create({
        data: {
          partNumber: `FG-C-${suffix}-${scope}`.slice(0, 32),
          description: `Costing ${suffix}`,
          sourcingMethod: "PURCHASE",
          itemStructure: "TOP_LEVEL_ASSEMBLY",
          standardCost,
          averageCost: 0,
        },
      });
    }

    // --- STANDARD: receive at standard, ship at standard, recon ties ---
    await openQuietPeriod();
    await setMethod("STANDARD");
    const stdPart = await makePart("STD", 10);
    await receiveStock(stdPart.id, 4, 10);
    await shipQty(stdPart.id, 1, 25);
    const stdCogs = await accountActivity("5000");
    const stdFg = await accountActivity("1220");
    assert.equal(stdCogs, 10, `${scope} STANDARD COGS`);
    assert.equal(stdFg, 30, `${scope} STANDARD remaining FG`);
    await assertBooksBalanced(db, `${scope} STANDARD books`);
    await assertRecon(`${scope} STANDARD`);

    let midPeriodBlocked = false;
    try {
      await setMethod("FIFO");
    } catch (err) {
      midPeriodBlocked = String(err).includes("period");
    }
    assert.ok(midPeriodBlocked, `${scope}: mid-period method change must be blocked`);

    // --- AVERAGE: (2@10 + 2@20) => 15; ship 1 at 15; remaining 45 ---
    await openQuietPeriod();
    await setMethod("AVERAGE");
    const avgPart = await makePart("AVG", 99);
    await receiveStock(avgPart.id, 2, 10);
    await receiveStock(avgPart.id, 2, 20);
    const avgRow = await db.part.findUniqueOrThrow({ where: { id: avgPart.id } });
    assert.equal(avgRow.averageCost, 15, `${scope} moving average after receipts`);
    const cogsBeforeAvg = await accountActivity("5000");
    const fgBeforeAvg = await accountActivity("1220");
    await shipQty(avgPart.id, 1, 30);
    assert.equal(money((await accountActivity("5000")) - cogsBeforeAvg), 15, `${scope} AVERAGE COGS`);
    assert.equal(money((await accountActivity("1220")) - fgBeforeAvg), -15, `${scope} AVERAGE FG relieved`);
    await assertBooksBalanced(db, `${scope} AVERAGE books`);
    await assertRecon(`${scope} AVERAGE`);

    // --- FIFO: ship 3 of (2@10 + 2@20) => COGS 40, remaining 20 ---
    await openQuietPeriod();
    await setMethod("FIFO");
    const fifoPart = await makePart("FIFO", 99);
    await receiveStock(fifoPart.id, 2, 10);
    await receiveStock(fifoPart.id, 2, 20);
    const fifoLayersIn = await db.inventoryCostLayer.findMany({
      where: { partId: fifoPart.id, quantityRemaining: { gt: 0 } },
      orderBy: { receivedAt: "asc" },
    });
    assert.equal(fifoLayersIn.length, 2, `${scope} FIFO opening layers`);
    const cogsBeforeFifo = await accountActivity("5000");
    const fgBeforeFifo = await accountActivity("1220");
    await shipQty(fifoPart.id, 3, 40);
    assert.equal(money((await accountActivity("5000")) - cogsBeforeFifo), 40, `${scope} FIFO COGS 10+10+20`);
    assert.equal(money((await accountActivity("1220")) - fgBeforeFifo), -40, `${scope} FIFO FG relieved`);
    const fifoLeft = await db.inventoryCostLayer.findMany({
      where: { partId: fifoPart.id, quantityRemaining: { gt: 0 } },
    });
    assert.equal(fifoLeft.length, 1, `${scope} FIFO one layer remains`);
    assert.equal(fifoLeft[0].unitCost, 20);
    assert.equal(fifoLeft[0].quantityRemaining, 1);
    const fifoConsumed = await db.inventoryLayerConsumption.aggregate({
      where: { layer: { partId: fifoPart.id } },
      _sum: { amount: true, quantity: true },
    });
    assert.equal(money(fifoConsumed._sum.amount || 0), 40);
    assert.equal(fifoConsumed._sum.quantity, 3);
    await assertBooksBalanced(db, `${scope} FIFO books`);
    await assertRecon(`${scope} FIFO`);

    // --- LIFO: ship 3 of (2@10 + 2@20) => COGS 50, remaining 10 ---
    await openQuietPeriod();
    await setMethod("LIFO");
    const lifoPart = await makePart("LIFO", 99);
    await receiveStock(lifoPart.id, 2, 10);
    await receiveStock(lifoPart.id, 2, 20);
    const cogsBeforeLifo = await accountActivity("5000");
    const fgBeforeLifo = await accountActivity("1220");
    await shipQty(lifoPart.id, 3, 40);
    assert.equal(money((await accountActivity("5000")) - cogsBeforeLifo), 50, `${scope} LIFO COGS 20+20+10`);
    assert.equal(money((await accountActivity("1220")) - fgBeforeLifo), -50, `${scope} LIFO FG relieved`);
    const lifoLeft = await db.inventoryCostLayer.findMany({
      where: { partId: lifoPart.id, quantityRemaining: { gt: 0 } },
    });
    assert.equal(lifoLeft.length, 1, `${scope} LIFO one layer remains`);
    assert.equal(lifoLeft[0].unitCost, 10);
    assert.equal(lifoLeft[0].quantityRemaining, 1);
    await assertBooksBalanced(db, `${scope} LIFO books`);
    await assertRecon(`${scope} LIFO`);

    // Switch to STANDARD when book (10) != standard (15): revaluation journal, then recon ties.
    // Other leftover stock is restated to its book standard first so only this part revalues.
    const leftoverBins = await db.inventoryItem.findMany({
      where: { quantityOnHand: { gt: 0 }, ownership: "COMPANY" },
    });
    for (const bin of leftoverBins) {
      if (bin.partId === lifoPart.id) continue;
      await db.part.update({
        where: { id: bin.partId },
        data: { standardCost: bin.unitCost },
      });
    }
    await db.part.update({ where: { id: lifoPart.id }, data: { standardCost: 15 } });
    await openQuietPeriod();
    const fgBeforeReval = await accountActivity("1220");
    const revalBefore = await accountActivity("6222");
    await setMethod("STANDARD");
    assert.equal(money((await accountActivity("1220")) - fgBeforeReval), 5, `${scope} reval increases FG`);
    assert.equal(money((await accountActivity("6222")) - revalBefore), -5, `${scope} reval credits 6222`);
    const restated = await db.inventoryItem.findFirstOrThrow({
      where: { partId: lifoPart.id, quantityOnHand: { gt: 0 } },
    });
    assert.equal(restated.unitCost, 15);
    await assertBooksBalanced(db, `${scope} reval books`);
    await assertRecon(`${scope} after reval to STANDARD`);
  }

  await socket.stop();
  await pg.close();
  console.log("qa-costing-methods: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
