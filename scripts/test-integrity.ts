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
  } finally { await prisma.$disconnect(); await socket.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
