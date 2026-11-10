/** Offline regression tests for AUTH-002–004, ACCT-001–003 and GOVCON-001.
 * Each invocation owns an ephemeral loopback Postgres; never uses tenant data. */
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL, DOCS_HARDENING_SQL } from "../src/lib/tenant-template";

async function main() {
  const pg = await PGlite.create();
  await pg.exec(TENANT_TABLES_SQL + "\n" + TENANT_FKS_SQL + "\n" + DOCS_HARDENING_SQL);
  const socket = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0 });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres@${socket.getServerConn()}/postgres`;
  process.env.DATABASE_POOL_MAX = "1";
  process.env.DEMO_MODE = "1";
  process.env.DEMO_USER_ROLE = "ADMIN";
  const { prisma } = await import("../src/lib/db");
  const g = await import("../src/lib/services/gaap");
  const a = await import("../src/app/actions");
  const form = (data: Record<string, string>) => { const f = new FormData(); for (const [k,v] of Object.entries(data)) f.set(k,v); return f; };
  try {
    const admin = await prisma.user.create({ data: { name: "Integrity Admin", email: "admin@example.invalid", role: "ADMIN" } });
    const operator = await prisma.user.create({ data: { name: "Integrity Operator", email: "operator@example.invalid", role: "OPERATOR" } });
    const accountant = await prisma.user.create({ data: { name: "Integrity Accountant", email: "accountant@example.invalid", role: "ACCOUNTING" } });
    const customer = await prisma.customer.create({ data: { name: "Test customer", code: "TEST" } });
    const supplier = await prisma.supplier.create({ data: { name: "Test supplier", code: "TEST" } });
    const cash = await prisma.account.create({ data: { code: "1000", name: "Cash", type: "ASSET" } });
    const ar = await prisma.account.create({ data: { code: "1100", name: "AR", type: "ASSET" } });
    const ap = await prisma.account.create({ data: { code: "2000", name: "AP", type: "LIABILITY" } });
    await prisma.accountingSettings.create({ data: { id: "default", requireJournalSoD: true } });
    const { userHasPermission } = await import("../src/lib/auth");
    process.env.DEMO_USER_ROLE = "OPERATOR";
    for (const [fn, permission, count, data] of [
      [a.actionCreateCustomer, "customers.manage", () => prisma.customer.count(), { name: "Unauthorized" }],
      [a.actionUpdateCustomer, "customers.manage", () => prisma.customer.count(), { id: customer.id, name: "Unauthorized edit" }],
      [a.actionCreateItem, "items.manage", () => prisma.part.count(), { partNumber: "DENIED", description: "Denied" }],
      [a.actionUpdateItem, "items.manage", () => prisma.part.count(), { id: "missing", description: "Denied edit" }],
      [a.actionCreateForecast, "planning.forecast.create", () => prisma.forecast.count(), { name: "Denied forecast" }],
      [a.actionPostJournal, "accounting.journal.post", () => prisma.journalEntry.count(), { description: "Denied journal", debitAccountId: cash.id, creditAccountId: ar.id, amount: "10", postNow: "true" }],
    ] as const) {
      assert.equal(await userHasPermission(operator.id, permission), false);
      const before = await count();
      await assert.rejects(fn(form(data)), /NEXT_REDIRECT/);
      assert.equal(await count(), before);
      console.log("PASS denied", permission);
    }
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).name, "Test customer");
    process.env.DEMO_USER_ROLE = "ACCOUNTING";
    await assert.rejects(a.actionPostJournal(form({ description: "No bypass", debitAccountId: cash.id, creditAccountId: ar.id, amount: "10", postNow: "true" })), /approve/);
    for (const source of ["MANUAL", "AR_SETTLE", "EXPENSE"]) {
      await assert.rejects(g.postJournal({ description: "No bypass", source, status: "POSTED", createdById: accountant.id, lines: [{ accountId: cash.id, debit: 10 }, { accountId: ar.id, credit: 10 }] }), /approve/);
    }
    console.log("PASS immediate journal posting cannot bypass approval (manual, AR settlement, expense)");
    const pending = await g.postJournal({ description: "Pending", createdById: accountant.id, lines: [{ accountId: cash.id, debit: 2 }, { accountId: ar.id, credit: 2 }] });
    assert.equal(pending.status, "PENDING_APPROVAL");
    await assert.rejects(g.approveJournal({ id: pending.id, approvedById: accountant.id }), /approve/);
    process.env.DEMO_USER_ROLE = "ADMIN";
    for (const kind of ["ar", "ap"] as const) {
      const inv = kind === "ar" ? await prisma.arInvoice.create({ data: { number: "AR-TEST", customerId: customer.id, total: 100 } }) : await prisma.apInvoice.create({ data: { number: "AP-TEST", supplierId: supplier.id, total: 100 } });
      const record = kind === "ar" ? g.recordArPayment : g.recordApPayment;
      const read = () => kind === "ar" ? prisma.arInvoice.findUniqueOrThrow({ where: { id: inv.id } }) : prisma.apInvoice.findUniqueOrThrow({ where: { id: inv.id } });
      const count = () => kind === "ar" ? prisma.arPayment.count() : prisma.apPayment.count();
      await g.setAccountingCloseDate({ date: new Date("2020-12-31") });
      const balances = (await prisma.account.findMany({ orderBy: { code: "asc" } })).map(x => x.balance);
      const journals = await prisma.journalEntry.count();
      await assert.rejects(record({ invoiceId: inv.id, amount: 40, paymentDate: new Date("2020-06-01") }), /closed/);
      assert.equal(await count(), 0);
      assert.equal((await read()).amountPaid, 0);
      assert.equal((await read()).status, inv.status);
      assert.equal(await prisma.journalEntry.count(), journals);
      assert.deepEqual((await prisma.account.findMany({ orderBy: { code: "asc" } })).map(x => x.balance), balances);
      await g.setAccountingCloseDate({ date: null });
      // Fail after JE creation, while balances are being applied: all writes must roll back.
      await pg.exec(`CREATE FUNCTION integrity_fail_balance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'integrity injected ledger failure'; END $$; CREATE TRIGGER integrity_fail_balance BEFORE UPDATE ON "Account" FOR EACH ROW EXECUTE FUNCTION integrity_fail_balance();`);
      try {
        await assert.rejects(record({ invoiceId: inv.id, amount: 40 }), /integrity injected ledger failure/);
        assert.equal(await count(), 0);
        assert.equal((await read()).amountPaid, 0);
        assert.equal(await prisma.journalEntry.count(), journals);
      } finally { await pg.exec('DROP TRIGGER integrity_fail_balance ON "Account"; DROP FUNCTION integrity_fail_balance();'); }

      await record({ invoiceId: inv.id, amount: 40, paymentDate: new Date("2021-01-02") });
      assert.equal((await read()).amountPaid, 40);
      assert.equal((await read()).status, "PARTIAL");
      assert.equal(await count(), 1);
      assert.equal((await prisma.journalEntry.findFirstOrThrow({ where: { source: kind.toUpperCase() } })).date.toISOString().slice(0,10), "2021-01-02");
      await assert.rejects(record({ invoiceId: inv.id, amount: 61 }), /exceeds/);
      await assert.rejects(record({ invoiceId: inv.id, amount: Number.NaN }), /positive/);
      assert.equal(await count(), 1);
      console.log("PASS", kind, "atomic rollback, success, payment date, overpayment and NaN rejection");
    }
    const original = await g.postJournal({ description: "Classified", createdById: admin.id, status: "POSTED", lines: [{ accountId: cash.id, debit: 10, unallowable: true, farCitation: "FAR 31.205", costElement: "MATERIAL", chargeCode: "INDIRECT" }, { accountId: ap.id, credit: 10 }] });
    await prisma.account.update({ where: { id: ap.id }, data: { allowability: "UNALLOWABLE", farCitation: "NEW CLASSIFICATION" } });
    const reversal = await g.reverseJournalEntry({ id: original.id, userId: admin.id });
    for (const line of original.lines) {
      const reversed = reversal.lines.find(x => x.accountId === line.accountId)!;
      for (const field of ["unallowable", "farCitation", "costElement", "chargeCode", "projectId", "programId", "workOrderId", "clinId"] as const) assert.equal(reversed[field], line[field]);
      assert.equal(reversed.debit, line.credit); assert.equal(reversed.credit, line.debit);
    }
    console.log("PASS reversal preserves allowability, FAR and attribution");

    const f = await import("../src/lib/services/order-fulfillment");
    const bomSvc = await import("../src/lib/services/bom");
    const planning = await import("../src/lib/services/planning");
    const crm = await import("../src/lib/services/crm");
    const part = await prisma.part.create({ data: { partNumber: "ASSEMBLY", description: "Fixture" } });
    const component = await prisma.part.create({ data: { partNumber: "COMPONENT", description: "Fixture" } });
    const bom = await prisma.bomHeader.create({ data: { partId: part.id, revision: "A", lines: { create: { componentPartId: component.id, quantity: 1 } } }, include: { lines: true } });
    for (const quantity of [-1, 0, Infinity, Number.NaN]) {
      await assert.rejects(bomSvc.updateBomLine({ bomLineId: bom.lines[0].id, quantity }), /Quantity/);
      await assert.rejects(bomSvc.addBomLine({ bomHeaderId: bom.id, componentPartId: component.id, quantity }), /Quantity/);
      await assert.rejects(bomSvc.createBomRevision({ partId: part.id, revision: "BAD", lines: [{ componentPartId: component.id, quantity }] }), /Quantity/);
      await assert.rejects(planning.createForecast({ name: "Bad forecast", lines: [{ partId: part.id, quantity }] }), /quantity/);
    }
    assert.equal((await prisma.bomLine.findUniqueOrThrow({ where: { id: bom.lines[0].id } })).quantity, 1);
    assert.equal(await prisma.forecast.count(), 0);
    await bomSvc.updateBomLine({ bomLineId: bom.lines[0].id, quantity: 2 });
    await planning.createForecast({ name: "Valid", lines: [{ partId: part.id, quantity: 2 }] });
    console.log("PASS negative/zero/non-finite BOM and forecast quantities rejected without writes; positive accepted");

    const lead = await prisma.lead.create({ data: { company: "Conversion fixture" } });
    const firstDeal = await crm.convertLead({ leadId: lead.id, value: 10, userId: admin.id });
    const dealCount = await prisma.opportunity.count();
    const again = await crm.convertLead({ leadId: lead.id, value: 20, userId: admin.id });
    assert.equal(again.id, firstDeal.id); assert.equal(again.value, 10);
    assert.equal(await prisma.opportunity.count(), dealCount);
    const racingLead = await prisma.lead.create({ data: { company: "Concurrent conversion" } });
    const raced = await Promise.all([crm.convertLead({ leadId: racingLead.id }), crm.convertLead({ leadId: racingLead.id })]);
    assert.equal(raced[0].id, raced[1].id);
    console.log("PASS repeated/concurrent lead conversion returns one original deal");

    const quote = await prisma.quote.create({ data: { number: "Q-TEST", customerId: customer.id, lines: { create: { partId: part.id, description: "Fixture", quantity: 1, unitPrice: 10 } } } });
    // Request-scope redirect/cache side effects are expected outside Next; persisted business state is the assertion.
    const call = async (fn: (fd: FormData) => Promise<void>, data: Record<string,string>) => { try { await fn(form(data)); } catch (e) { if (!/NEXT_REDIRECT|outside.*request|incrementalCache|static generation store/i.test(String(e))) throw e; } };
    await call(a.actionRecordCustomerPo, { quoteId: quote.id, customerPo: "PO-ORIGINAL" });
    assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status, "CONVERTED");
    const soCount = await prisma.salesOrder.count();
    await call(a.actionRecordCustomerPo, { quoteId: quote.id, customerPo: "PO-RETRY" });
    const qAgain = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    assert.equal(qAgain.status, "CONVERTED"); assert.equal(qAgain.customerPo, "PO-ORIGINAL");
    assert.equal(await prisma.salesOrder.count(), soCount);
    console.log("PASS repeated customer PO action cannot regress quote or change PO");

    const buyer = await prisma.user.create({ data: { name: "Distinct buyer persona", email: "buyer@example.invalid", role: "PURCHASING" } });
    const pr = await prisma.purchaseRequest.create({ data: { number: "PR-TEST", status: "SUBMITTED", requestedById: operator.id, currentStepOrder: 1, buyerConfirmedPrices: true, buyerNotes: "Quote checked", quoteFileUrl: "data:text/plain,fixture" } });
    const demand = await prisma.approval.create({ data: { entityType: "PurchaseRequest", entityId: pr.id, stage: "Confirm demand", stepOrder: 1 } });
    const buyerStep = await prisma.approval.create({ data: { entityType: "PurchaseRequest", entityId: pr.id, stage: "Buyer package", stepOrder: 2 } });
    const final = await prisma.approval.create({ data: { entityType: "PurchaseRequest", entityId: pr.id, stage: "Purchase approval", stepOrder: 3 } });
    const prApproval = await import("../src/lib/services/pr-approval");
    const prBuyer = await import("../src/lib/services/pr-buyer");
    await prApproval.decidePrApproval({ purchaseRequestId: pr.id, userId: admin.id, userRole: "ADMIN", decision: "APPROVED" });
    assert.equal((await prisma.approval.findUniqueOrThrow({ where: { id: demand.id } })).status, "APPROVED");
    await assert.rejects(prBuyer.confirmBuyerPackageStep({ purchaseRequestId: pr.id, userId: admin.id, userRole: "ADMIN" }), /different person/);
    await assert.rejects(prApproval.decidePrApproval({ purchaseRequestId: pr.id, userId: admin.id, userRole: "ADMIN", decision: "APPROVED" }), /different person/);
    assert.equal((await prisma.approval.findUniqueOrThrow({ where: { id: buyerStep.id } })).status, "PENDING");
    await prBuyer.confirmBuyerPackageStep({ purchaseRequestId: pr.id, userId: buyer.id, userRole: "PURCHASING" });
    await assert.rejects(prApproval.decidePrApproval({ purchaseRequestId: pr.id, userId: buyer.id, userRole: "ADMIN", decision: "APPROVED" }), /different person/);
    await prApproval.decidePrApproval({ purchaseRequestId: pr.id, userId: admin.id, userRole: "ADMIN", decision: "APPROVED" });
    assert.equal((await prisma.approval.findUniqueOrThrow({ where: { id: final.id } })).approverId, admin.id);
    console.log("PASS admin cannot sign demand and buyer; distinct persona can; charge owner may return for final approval");

    const task = await prisma.workOrder.create({ data: { number: "TASK-TEST", type: "TASK_ONLY", status: "READY_FOR_PUTAWAY", workCenter: "RCV-01" } });
    const wi = await prisma.workInstruction.create({ data: { documentNumber: "WI-TEST", title: "Task", steps: { create: { stepNumber: 1, title: "Task", instructions: "Do task" } } }, include: { steps: true } });
    const completion = await prisma.workOrderStepCompletion.create({ data: { workOrderId: task.id, stepId: wi.steps[0].id } });
    const stockCount = await prisma.inventoryItem.count();
    await assert.rejects(f.completeWorkOrderToStock({ workOrderId: task.id }), /still open/);
    await prisma.workOrderStepCompletion.update({ where: { id: completion.id }, data: { status: "FAILED" } });
    await assert.rejects(f.completeWorkOrderToStock({ workOrderId: task.id }), /Failed/);
    await prisma.workOrderStepCompletion.update({ where: { id: completion.id }, data: { status: "SIGNED", signedById: admin.id, signedAt: new Date() } });
    const done = await f.completeWorkOrderToStock({ workOrderId: task.id, userId: admin.id });
    assert.equal(done.inventoryItemId, null);
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: task.id } })).status, "COMPLETED");
    assert.equal(await prisma.inventoryItem.count(), stockCount);
    await assert.rejects(f.completeWorkOrderToStock({ workOrderId: task.id }), /already COMPLETED/);
    console.log("PASS task-only completion retains signed-step gates and creates no inventory, even without storage");

    const warehouse = await prisma.warehouse.create({ data: { code: "TEST", name: "Fixture" } });
    const storage = await prisma.location.create({ data: { warehouseId: warehouse.id, code: "STOCK", type: "STORAGE" } });
    await prisma.location.create({ data: { warehouseId: warehouse.id, code: "STAGE", type: "STAGING" } });
    const wo = await prisma.workOrder.create({ data: { number: "KIT-WO", partId: part.id, status: "KITTING" } });
    const kit = await prisma.kitOrder.create({ data: { number: "KIT-TEST", workOrderId: wo.id, lines: { create: [{ partId: part.id, quantityRequired: 1 }, { partId: component.id, quantityRequired: 1 }] } } });
    await prisma.inventoryItem.create({ data: { partId: part.id, locationId: storage.id, quantityOnHand: 2, quantityAvailable: 2 } });
    await prisma.inventoryItem.create({ data: { partId: component.id, locationId: storage.id, quantityOnHand: 0.4, quantityAvailable: 0.4 } });
    const staged = async (id: string) => (await prisma.inventoryItem.aggregate({ where: { workOrderId: wo.id, partId: id }, _sum: { quantityOnHand: true } }))._sum.quantityOnHand;
    await assert.rejects(f.completeKitOrder({ kitOrderId: kit.id, userId: admin.id }), /short/i);
    assert.equal(await staged(part.id), 1); assert.equal(await staged(component.id), 0.4);
    await assert.rejects(f.completeKitOrder({ kitOrderId: kit.id, userId: admin.id }), /short/i);
    assert.equal(await staged(part.id), 1); assert.equal(await staged(component.id), 0.4);
    await prisma.inventoryItem.create({ data: { partId: component.id, locationId: storage.id, quantityOnHand: 0.6, quantityAvailable: 0.6 } });
    await f.completeKitOrder({ kitOrderId: kit.id, userId: admin.id });
    await f.completeKitOrder({ kitOrderId: kit.id, userId: admin.id });
    assert.equal(await staged(part.id), 1); assert.equal(await staged(component.id), 1);
    assert.equal((await prisma.kitOrder.findUniqueOrThrow({ where: { id: kit.id } })).status, "COMPLETE");
    assert.equal(await prisma.inventoryItem.count({ where: { quantityOnHand: { lt: 0 } } }), 0);
    console.log("PASS repeated short-kit retry stages exactly required quantities, including partial picks");
    const raceWo = await prisma.workOrder.create({ data: { number: "KIT-RACE-WO", partId: part.id, status: "KITTING" } });
    const raceKit = await prisma.kitOrder.create({ data: { number: "KIT-RACE", workOrderId: raceWo.id, lines: { create: { partId: part.id, quantityRequired: 1 } } } });
    await Promise.allSettled([f.completeKitOrder({ kitOrderId: raceKit.id }), f.completeKitOrder({ kitOrderId: raceKit.id })]);
    await f.completeKitOrder({ kitOrderId: raceKit.id });
    assert.equal((await prisma.inventoryItem.aggregate({ where: { workOrderId: raceWo.id }, _sum: { quantityOnHand: true } }))._sum.quantityOnHand, 1);
    assert.equal((await prisma.materialTransaction.aggregate({ where: { kitOrderId: raceKit.id }, _sum: { quantity: true } }))._sum.quantity, 1);
    console.log("PASS competing kit completion cannot duplicate inventory or material issues");

  } finally { await prisma.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
