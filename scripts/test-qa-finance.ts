/** Reconciled QA regressions. Owns an ephemeral loopback DB; no real tenant writes. */
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL, DOCS_HARDENING_SQL } from "../src/lib/tenant-template";

async function main() {
  const pg = await PGlite.create();
  await pg.exec(TENANT_TABLES_SQL + "\n" + TENANT_FKS_SQL + "\n" + DOCS_HARDENING_SQL);
  const socket = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0, maxConnections: 10 });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres@${socket.getServerConn()}/postgres`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.DATABASE_POOL_MAX = "1";
  process.env.DEMO_MODE = "1";
  process.env.DEMO_USER_ROLE = "ADMIN";
  process.env.DEMO_POOL_SIZE = "2";
  globalThis.fetch = async () => { throw new Error("External networking disabled in QA regressions"); };
  const { prisma: p } = await import("../src/lib/db");
  const bank = await import("../src/lib/services/banking");
  const hr = await import("../src/lib/services/hr");
  const supply = await import("../src/lib/services/supply-chain");
  try {
    const admin = await p.user.create({ data: { name: "QA Controller", email: "controller@example.invalid", role: "ADMIN" } });
    const employee = await p.user.create({ data: { name: "QA Employee", email: "employee@example.invalid", role: "OPERATOR" } });
    const manager = await p.user.create({ data: { name: "QA HR", email: "hr@example.invalid", role: "HR" } });
    const cash = await p.account.create({ data: { code: "1000", name: "Cash", type: "ASSET" } });
    const expense = await p.account.create({ data: { code: "6200", name: "Expense", type: "EXPENSE" } });
    await p.account.create({ data: { code: "2000", name: "AP", type: "LIABILITY" } });
    await p.accountingSettings.create({ data: { id: "default", requireJournalSoD: true } });
    const acct = await bank.connectBankAccount({ name: "Synthetic", glAccountId: cash.id, userId: admin.id });
    const imported = await bank.importBankTransactions({ bankAccountId: acct.id, text: "date,description,amount\n2026-01-01,Withdrawal,-25" });
    assert.equal(imported.imported, 1);
    const txn = await p.bankTransaction.findFirstOrThrow({ where: { bankAccountId: acct.id } });
    const categorize = () => bank.categorizeBankTransaction({ transactionId: txn.id, categoryAccountId: expense.id, userId: admin.id });
    const competing = await Promise.allSettled([categorize(), categorize(), categorize()]);
    assert.equal(competing.filter(x => x.status === "fulfilled").length, 1);
    await assert.rejects(categorize(), /already categorized/);
    assert.equal(await p.journalEntry.count({ where: { source: "BANK", sourceId: txn.id } }), 1);
    assert.equal((await p.account.findUniqueOrThrow({ where: { id: cash.id } })).balance, -25);
    await bank.reconcileBankTransaction(txn.id);
    await assert.rejects(categorize(), /already categorized/);
    const fail = await p.bankTransaction.create({ data: { bankAccountId: acct.id, description: "Failure", amount: -5, date: new Date() } });
    const retry = () => bank.categorizeBankTransaction({ transactionId: fail.id, categoryAccountId: expense.id, userId: admin.id });
    await pg.exec(`CREATE FUNCTION qa_fail_bank() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected bank failure'; END $$; CREATE TRIGGER qa_fail_bank BEFORE UPDATE ON "Account" FOR EACH ROW EXECUTE FUNCTION qa_fail_bank();`);
    await assert.rejects(retry(), /injected bank failure/);
    assert.equal((await p.bankTransaction.findUniqueOrThrow({ where: { id: fail.id } })).status, "UNMATCHED");
    assert.equal(await p.journalEntry.count({ where: { sourceId: fail.id } }), 0);
    assert.equal((await p.account.findUniqueOrThrow({ where: { id: cash.id } })).balance, -25);
    await pg.exec('DROP TRIGGER qa_fail_bank ON "Account"; DROP FUNCTION qa_fail_bank();');
    await retry();
    assert.equal((await p.account.findUniqueOrThrow({ where: { id: cash.id } })).balance, -30);
    console.log("PASS BANK-001 competing categorization posts once; retries reject; failed posting rolls back and can retry");
    const count = await p.bankTransaction.count();
    const balance = (await p.bankAccount.findUniqueOrThrow({ where: { id: acct.id } })).currentBalance;
    for (const amount of ["not-a-number", "NaN", "Infinity", "1e999", "", "12oops"]) {
      const result = await bank.importBankTransactions({ bankAccountId: acct.id, text: `date,description,amount\n2026-01-02,Malformed,${amount}` });
      assert.equal(result.imported, 0, amount);
      assert.equal(result.errors.length, 1, amount);
    }
    const malformedDebit = await bank.importBankTransactions({ bankAccountId: acct.id, text: "date,description,debit,credit\n2026-01-02,Bad debit,oops," });
    assert.equal(malformedDebit.errors.length, 1);
    assert.equal(await p.bankTransaction.count(), count);
    assert.equal((await p.bankAccount.findUniqueOrThrow({ where: { id: acct.id } })).currentBalance, balance);
    const valid = await bank.importBankTransactions({ bankAccountId: acct.id, text: "date,description,debit,credit\n2026-01-03,Good debit,10,\n2026-01-04,Good credit,,12.50" });
    assert.equal(valid.imported, 2); assert.equal(valid.errors.length, 0);
    console.log("PASS BANK-002 malformed/missing/nonfinite amounts reject without rows or balance changes; debit/credit blanks work");
    const report = await p.expenseReport.create({ data: { number: "EXP-QA", title: "QA report", userId: employee.id, status: "DRAFT", lines: { create: { description: "QA expense", amount: 20, category: "OTHER", date: new Date() } } } });
    await hr.advanceExpenseReport({ id: report.id, status: "SUBMITTED", userId: employee.id, approver: employee });
    await hr.advanceExpenseReport({ id: report.id, status: "APPROVED", userId: manager.id, approver: manager });
    await assert.rejects(hr.advanceExpenseReport({ id: report.id, status: "PAID", userId: manager.id, approver: manager }), /cannot go/);
    assert.equal((await p.expenseReport.findUniqueOrThrow({ where: { id: report.id } })).status, "APPROVED");
    assert.equal(await p.journalEntry.count({ where: { source: "EXPENSE" } }), 0);
    await hr.payExpenseReport({ id: report.id, processor: admin });
    assert.equal((await p.expenseReport.findUniqueOrThrow({ where: { id: report.id } })).status, "PAID");
    assert.equal(await p.journalEntry.count({ where: { source: "EXPENSE", sourceId: report.id } }), 1);
    console.log("PASS ACCT-010 HR generic transition cannot mark paid; independently approved controller reimbursement posts balanced journal");
    const supplier = await p.supplier.create({ data: { code: "FIN-QA", name: "QA supplier" } });
    const gaap = await import("../src/lib/services/gaap");
    const billing = await import("../src/lib/services/billing");
    const gl = await import("../src/lib/services/gl-posting");
    await gl.ensureAccountingDefaults();
    const job = await p.workOrder.create({ data: { number: "OSP-QA", type: "TASK_ONLY" } });
    await gl.prepareOutsideProcessingJournal({ sourceId: "qa-prepare", amount: 1, workOrderId: job.id });
    for (const workOrderId of [undefined, job.id]) {
      const bill = () => billing.createVendorApInvoice({ supplierId: supplier.id, amount: 10, tax: 2, workOrderId, userId: admin.id });
      const invoices = await p.apInvoice.count();
      const journals = await p.journalEntry.count();
      const balances = async () => (await p.account.findMany({ orderBy: { code: "asc" } })).map(x => x.balance);
      const before = await balances();
      await gaap.setAccountingCloseDate({ date: new Date("2099-12-31") });
      await assert.rejects(bill(), /closed/);
      assert.equal(await p.apInvoice.count(), invoices);
      assert.equal(await p.journalEntry.count(), journals);
      assert.deepEqual(await balances(), before);
      await gaap.setAccountingCloseDate({ date: null });
      await pg.exec(`CREATE FUNCTION qa_fail_ap() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected AP failure'; END $$; CREATE TRIGGER qa_fail_ap BEFORE UPDATE ON "Account" FOR EACH ROW EXECUTE FUNCTION qa_fail_ap();`);
      await assert.rejects(bill(), /injected AP failure/);
      assert.equal(await p.apInvoice.count(), invoices);
      assert.equal(await p.journalEntry.count(), journals);
      assert.deepEqual(await balances(), before);
      await pg.exec('DROP TRIGGER qa_fail_ap ON "Account"; DROP FUNCTION qa_fail_ap();');
      const voucher = await bill();
      assert.equal(voucher.total, 12);
      assert.equal(voucher.status, "OPEN");
      assert.equal(await p.journalEntry.count({ where: { source: "AP", sourceId: voucher.id } }), 1);
    }
    console.log("PASS ACCT-008 expense and outside-processing AP invoices/GL/balances roll back on period and injected posting failure; retry succeeds");
    const part = await p.part.create({ data: { partNumber: "FIN-QA", description: "QA material" } });
    const po = await p.purchaseOrder.create({ data: { number: "PO-FIN-QA", supplierId: supplier.id, status: "APPROVED", lines: { create: { partId: part.id, description: "QA", quantity: 2, unitCost: 10 } } }, include: { lines: true } });
    const receive = (lines = [{ poLineId: po.lines[0].id, quantityReceived: 2 }]) => supply.receivePurchaseOrder({ purchaseOrderId: po.id, receivedById: admin.id, lines });
    await assert.rejects(receive([{ poLineId: po.lines[0].id, quantityReceived: 2 }, { poLineId: po.lines[0].id, quantityReceived: 2 }]), /Duplicate PO line/);
    for (const status of ["CLOSED", "CANCELLED"]) {
      await p.purchaseOrder.update({ where: { id: po.id }, data: { status } });
      await assert.rejects(receive(), /receiving is blocked/);
    }
    assert.equal(await p.receipt.count(), 0);
    assert.equal(await p.inventoryItem.count(), 0);
    assert.equal((await p.purchaseOrderLine.findUniqueOrThrow({ where: { id: po.lines[0].id } })).quantityReceived, 0);
    console.log("PASS RCV-001/002 duplicate PO lines and terminal PO statuses reject before receipt/stock/AP writes");
  } finally {
    await p.$disconnect();
    await socket.stop();
    await pg.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
