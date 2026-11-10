/** Offline PostgreSQL service integration: no project credentials or live writes. */
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";

async function main() {
  const db = await PGlite.create();
  await db.exec(TENANT_TABLES_SQL + "\n" + TENANT_FKS_SQL);
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 8 });
  await server.start();
  process.env.DATABASE_URL = `postgresql://postgres@${server.getServerConn()}/postgres`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.DATABASE_POOL_MAX = "1";
  process.env.DEMO_MODE = "1";
  process.env.DEMO_USER_ROLE = "ADMIN";
  const { prisma, clientForSchema } = await import("../src/lib/db");
  const boms = await import("../src/lib/services/bom");
  const orders = await import("../src/lib/services/work-orders");
  const { planSalesOrderFulfillment } = await import("../src/lib/services/order-fulfillment");
  const pin = String(randomInt(100000, 999999));
  try {
    const admin = await prisma.user.create({ data: { name: "BOM Test Admin", email: "bom-admin@example.invalid", role: "ADMIN", pinCode: pin } });
    const operator = await prisma.user.create({ data: { name: "BOM Test Operator", email: "bom-operator@example.invalid", role: "OPERATOR", pinCode: String(Number(pin) + 1) } });
    await prisma.companySettings.create({ data: { id: "default", name: "BOM Fixture" } });
    const part = await prisma.part.create({ data: { partNumber: "BOM-LOCAL", description: "Assembly", partType: "MAKE" } });
    const a = await boms.createBomRevision({ partId: part.id, revision: "A", userId: admin.id });
    assert.equal(a.prototypeRequired, true);
    await assert.rejects(boms.certifyBom({ bomHeaderId: a.id, pinCode: pin }), /prototype work order/);
    await assert.rejects(boms.certifyBom({ bomHeaderId: a.id }), /PIN/);
    await assert.rejects(boms.certifyBomForPrototype({ bomHeaderId: a.id, pinCode: "incorrect" }), /PIN/);
    await boms.setBomPrototypeRequirement(a.id, false);
    await assert.rejects(boms.certifyBom({ bomHeaderId: a.id, userId: operator.id, pinCode: String(Number(pin) + 1) }), /PIN/);
    const certifiedA = await boms.certifyBom({ bomHeaderId: a.id, userId: operator.id, pinCode: pin });
    assert.equal(certifiedA.status, "CERTIFIED");
    assert.equal(certifiedA.certifiedById, admin.id, "Caller cannot substitute the signer identity");
    assert.equal(await prisma.workOrder.count(), 0, "Direct certification does not need a prototype WO or WI");
    await assert.rejects(boms.setBomPrototypeRequirement(a.id, true), /new revision/);
    console.log("✓ Direct DRAFT → CERTIFIED, own PIN, forged signer rejection, path locking");

    const production = await orders.createWorkOrder({ bomHeaderId: a.id, type: "PRODUCTION", createdById: admin.id, scheduleMode: "MANUAL", plannedStart: new Date(), plannedEnd: new Date() });
    await orders.updateWorkOrderStatus({ workOrderId: production.id, toStatus: "RELEASED", userId: admin.id });
    await boms.setBomPrototypeDefault(false);
    const b = await boms.createBomRevision({ partId: part.id, revision: "B", asPrototype: true });
    assert.equal(b.prototypeRequired, true);
    assert.equal(b.status, "DRAFT", "Prototype choice does not bypass PIN certification");
    await boms.certifyBomForPrototype({ bomHeaderId: b.id, pinCode: pin });
    const proto = await orders.createWorkOrder({ bomHeaderId: b.id, type: "PROTOTYPE", scheduleMode: "MANUAL", plannedStart: new Date(), plannedEnd: new Date() });
    await assert.rejects(boms.certifyBom({ bomHeaderId: b.id, pinCode: pin }), /prototype work order/);
    await orders.updateWorkOrderStatus({ workOrderId: proto.id, toStatus: "COMPLETED" });
    await assert.rejects(boms.certifyBom({ bomHeaderId: b.id, pinCode: pin }), /RELEASED work instruction/);
    await prisma.workInstruction.create({ data: { documentNumber: "WI-BOM-LOCAL", title: "Build assembly", status: "RELEASED", partId: part.id, bomHeaderId: b.id } });
    await boms.certifyBom({ bomHeaderId: b.id, pinCode: pin });
    assert.equal((await prisma.bomHeader.findUniqueOrThrow({ where: { id: a.id } })).status, "OBSOLETE");
    await assert.rejects(orders.updateWorkOrderStatus({ workOrderId: production.id, toStatus: "RELEASED" }), /CERTIFIED BOM/);
    await assert.rejects(orders.startWorkOrderProduction({ workOrderId: production.id, allowWithoutKit: true }), /CERTIFIED BOM/);
    await assert.rejects(orders.createWorkOrder({ bomHeaderId: a.id, type: "PRODUCTION" }), /CERTIFIED BOM/);
    console.log("✓ Prototype path retains completed-build + released-WI gates; superseded revision blocked at release/start");

    const c = await boms.createBomRevision({ partId: part.id, revision: "C" });
    assert.equal(c.prototypeRequired, false, "New revisions inherit tenant default");
    assert.equal((await prisma.bomHeader.findUniqueOrThrow({ where: { id: b.id } })).prototypeRequired, true, "Default does not rewrite existing revisions");
    for (const status of ["DRAFT", "IN_REVIEW", "PROTOTYPE", "OBSOLETE"]) {
      await prisma.bomHeader.update({ where: { id: c.id }, data: { status } });
      await assert.rejects(orders.createWorkOrder({ bomHeaderId: c.id, type: "PRODUCTION" }), /CERTIFIED BOM/);
      const legacy = await prisma.workOrder.create({ data: { number: `LEGACY-${status}`, type: "PRODUCTION", bomHeaderId: c.id, partId: part.id } });
      await assert.rejects(orders.updateWorkOrderStatus({ workOrderId: legacy.id, toStatus: "RELEASED" }), /CERTIFIED BOM/);
    }
    await assert.rejects(orders.createWorkOrder({ partId: part.id, type: "PRODUCTION" }), /CERTIFIED BOM/);
    await assert.rejects(orders.createWorkOrder({ type: "PRODUCTION" }), /CERTIFIED BOM/);
    await assert.rejects(orders.createWorkOrder({ bomHeaderId: c.id, type: "typo" }), /Invalid work order type/);
    const task = await orders.createWorkOrder({ type: "TASK_ONLY", scheduleMode: "MANUAL", plannedStart: new Date(), plannedEnd: new Date() });
    await orders.updateWorkOrderStatus({ workOrderId: task.id, toStatus: "RELEASED" });
    const legacyMissing = await prisma.workOrder.create({ data: { number: "LEGACY-NO-BOM", type: "PRODUCTION", partId: part.id } });
    await assert.rejects(orders.updateWorkOrderStatus({ workOrderId: legacyMissing.id, toStatus: "RELEASED" }), /CERTIFIED BOM/);
    console.log("✓ Missing/non-certified BOMs blocked on creation/release, invalid WO types rejected, task-only unchanged");

    const customer = await prisma.customer.create({ data: { code: "LOCAL", name: "Fixture Customer" } });
    const so = await prisma.salesOrder.create({ data: { number: "SO-LOCAL", customerId: customer.id, lines: { create: { partId: part.id, description: "Assembly", quantity: 2 } } } });
    const planned = await planSalesOrderFulfillment({ salesOrderId: so.id, userId: admin.id });
    assert.ok(planned.results[0].workOrderId);
    const salesWo = await prisma.workOrder.findUniqueOrThrow({ where: { id: planned.results[0].workOrderId } });
    assert.equal(salesWo.bomHeaderId, b.id);
    assert.equal(salesWo.type, "PRODUCTION");
    assert.equal(salesWo.sourceType, "SALES_ORDER");
    await prisma.bomHeader.update({ where: { id: b.id }, data: { status: "OBSOLETE" } });
    const soBlocked = await prisma.salesOrder.create({ data: { number: "SO-NO-BOM", customerId: customer.id, lines: { create: { partId: part.id, description: "Assembly", quantity: 1 } } } });
    const blockedPlan = await planSalesOrderFulfillment({ salesOrderId: soBlocked.id, userId: admin.id });
    assert.equal(blockedPlan.results[0].action, "NO_BOM");
    assert.match(blockedPlan.results[0].message || "", /CERTIFIED BOM/);
    assert.equal(await prisma.workOrder.count({ where: { salesOrderId: soBlocked.id } }), 0);
    console.log("✓ Sales-order fulfillment selects certified revision only, otherwise reports NO_BOM and creates no WO");

    await prisma.bomHeader.update({ where: { id: c.id }, data: { status: "IN_REVIEW" } });
    process.env.DEMO_USER_ROLE = "OPERATOR";
    await assert.rejects(boms.certifyBom({ bomHeaderId: c.id, pinCode: pin }));
    await assert.rejects(boms.setBomPrototypeRequirement(c.id, true));
    await assert.rejects(boms.setBomPrototypeDefault(true));
    process.env.DEMO_USER_ROLE = "ADMIN";
    await boms.certifyBom({ bomHeaderId: c.id, pinCode: pin });
    const audits = await prisma.auditLog.findMany();
    const certs = audits.filter(x => x.action === "CERTIFIED");
    assert.ok(certs.some(x => JSON.parse(x.changes || "{}").certificationPath === "DIRECT"));
    assert.ok(certs.some(x => JSON.parse(x.changes || "{}").certificationPath === "PROTOTYPE"));
    assert.ok(certs.every(x => JSON.parse(x.changes || "{}").pinVerified === true && x.userId === admin.id));
    assert.ok(!JSON.stringify(audits).includes(pin), "PIN must never be audited");
    console.log("✓ IN_REVIEW direct path, permission gates, path + verified signer audit, no secret in audit");

    await db.exec('CREATE SCHEMA tenant_bom_fixture; SET search_path TO tenant_bom_fixture;');
    await db.exec(TENANT_TABLES_SQL + "\n" + TENANT_FKS_SQL);
    const tenant = clientForSchema("tenant_bom_fixture");
    await tenant.companySettings.create({ data: { id: "default", name: "Other tenant" } });
    assert.equal((await tenant.companySettings.findUniqueOrThrow({ where: { id: "default" } })).bomPrototypeRequired, true);
    assert.equal(await tenant.bomHeader.count(), 0);
    const tenantPart = await tenant.part.create({ data: { partNumber: "TENANT-BOM", description: "Tenant part" } });
    const tenantBom = await tenant.bomHeader.create({ data: { partId: tenantPart.id, revision: "A" } });
    assert.equal(tenantBom.prototypeRequired, true);
    // Simulate a pre-rollout schema and apply the exact additive DDL twice.
    await db.exec('ALTER TABLE "BomHeader" DROP COLUMN "prototypeRequired"; ALTER TABLE "CompanySettings" DROP COLUMN "bomPrototypeRequired";');
    const backfill = (apply: boolean) => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/backfill-tenant-schemas.ts", "--bom-only", "--include-public", "--include-demos", ...(apply ? ["--apply"] : [])], {
        env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", d => output += d); child.stderr.on("data", d => output += d);
      child.on("error", reject); child.on("exit", code => code === 0 ? resolve(output) : reject(new Error(output)));
    });
    assert.match(await backfill(false), /2 column\(s\).*BomHeader.prototypeRequired, CompanySettings.bomPrototypeRequired/);
    assert.match(await backfill(true), /2 column\(s\) added/);
    assert.match(await backfill(true), /0 column\(s\) added/);
    assert.equal((await tenant.bomHeader.findUniqueOrThrow({ where: { id: tenantBom.id } })).prototypeRequired, true);
    assert.equal((await tenant.companySettings.findUniqueOrThrow({ where: { id: "default" } })).bomPrototypeRequired, true);
    await tenant.$disconnect();
    console.log("✓ Fresh tenant defaults, schema isolation, additive backfill over existing rows + idempotence");
    console.log("BOM lifecycle integration tests passed.");
  } finally {
    await prisma.$disconnect(); await server.stop(); await db.close();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
