/** Workflow consistency regressions in a disposable loopback fixture. */
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";

async function main() {
  const pg = await PGlite.create();
  await pg.exec(TENANT_TABLES_SQL + "\n" + TENANT_FKS_SQL);
  const server = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0 });
  await server.start();
  process.env.DATABASE_URL = `postgresql://postgres@${server.getServerConn()}/postgres`;
  process.env.DATABASE_POOL_MAX = "1";
  process.env.DEMO_MODE = "1";
  process.env.DEMO_USER_ROLE = "ADMIN";
  globalThis.fetch = async () => { throw new Error("External networking disabled"); };
  const { prisma: p } = await import("../src/lib/db");
  const c = await import("../src/lib/services/crm");
  const svc = await import("../src/lib/services/field-service");
  const ca = await import("../src/app/crm/actions");
  const sa = await import("../src/app/service/actions");
  const form = (data: Record<string,string>) => { const f = new FormData(); for (const [k,v] of Object.entries(data)) f.set(k,v); return f; };
  const action = async (fn: (fd: FormData) => Promise<void>, data: Record<string,string>) => { try { await fn(form(data)); } catch(e) { if (!/outside.*request|incrementalCache|static generation store|NEXT_REDIRECT/i.test(String(e))) throw e; } };
  try {
    const admin = await p.user.create({ data: { email: "qa@example.invalid", name: "QA", role: "ADMIN" } });
    const lead = await c.createLead({ company: "Lead" });
    const n = await p.auditLog.count();
    await assert.rejects(ca.actionUpdateLeadStatus(form({ id: lead.id, status: "QA_UNKNOWN_STATE" })), /Unknown lead/);
    assert.equal((await p.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, "NEW");
    assert.equal(await p.auditLog.count(), n);
    for (const status of c.LEAD_STATUSES) await c.updateLeadStatus(lead.id, status, admin.id);
    console.log("PASS CRM-002 unknown lead states rejected at action boundary without mutation; known states persist");
    const opp = await c.createOpportunity({ name: "Opportunity" });
    for (const probability of [-1, 250, Infinity, NaN, "50"]) {
      await assert.rejects(c.updateOpportunity(opp.id, { probability }), /Probability/);
      if (typeof probability === "number") {
        await assert.rejects(c.createOpportunity({ name: "Invalid", probability }), /Probability/);
        await assert.rejects(c.setStage({ id: opp.id, stage: "QUALIFY", probability }), /Probability/);
      }
    }
    await assert.rejects(ca.actionUpdateOpportunity(form({ id: opp.id, name: opp.name, probability: "250" })), /Probability/);
    assert.equal((await p.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).probability, 10);
    for (const probability of [0, 50, 100]) assert.equal((await c.updateOpportunity(opp.id, { probability })).probability, probability);
    console.log("PASS CRM-003 percentage validation covers create/update/stage and rejects out-of-range/non-finite inputs");
    const customer = await p.customer.create({ data: { code: "QA", name: "QA customer" } });
    const ticket = await svc.createTicket({ title: "Service fixture", customerId: customer.id });
    await assert.rejects(sa.actionUpdateTicketStatus(form({ id: ticket.id, status: "QA_UNKNOWN_STATE" })), /Unknown service/);
    assert.equal((await p.serviceTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status, "REQUEST");
    await action(sa.actionUpdateTicketStatus, { id: ticket.id, status: "COMPLETED" });
    assert((await p.serviceTicket.findUniqueOrThrow({ where: { id: ticket.id } })).closedAt);
    await action(sa.actionUpdateTicketStatus, { id: ticket.id, status: "IN_PROGRESS" });
    assert.equal((await p.serviceTicket.findUniqueOrThrow({ where: { id: ticket.id } })).closedAt, null);
    for (const status of svc.TICKET_STATUSES) await svc.updateTicketStatus({ id: ticket.id, status });
    console.log("PASS SVC-001/002 unknown states rejected; closing timestamps set and reopening clears them");
    const supplier = await p.supplier.create({ data: { code: "QA", name: "Supplier", isApprovedVendor: true } });
    const part = await p.part.create({ data: { partNumber: "QA", description: "QA", requiresGdtInspection: true } });
    const warehouse = await p.warehouse.create({ data: { code: "QA", name: "QA" } });
    const loc = await p.location.create({ data: { warehouseId: warehouse.id, code: "RCV-01", type: "RECEIVING" } });
    const po = await p.purchaseOrder.create({ data: { number: "PO-QA", supplierId: supplier.id, status: "APPROVED", lines: { create: { partId: part.id, description: "QA", quantity: 1, unitCost: 10 } } }, include: { lines: true } });
    const rv = await import("../src/lib/services/receiving");
    const s = await import("../src/lib/services/supply-chain");
    const ri = await import("../src/lib/services/receiving-inspection");
    const tr = await rv.createReceivingTravelerForPo({ purchaseOrderId: po.id });
    await s.receivePurchaseOrder({ purchaseOrderId: po.id, travelerId: tr.id, putawayLocationCode: loc.code, receivedById: admin.id, receivingAck: true, packingListDocs: [{ url: "/qa/packing.pdf" }], cocDocs: [{ url: "/qa/coc.pdf" }], lines: [{ poLineId: po.lines[0].id, quantityReceived: 1 }] });
    const ins = await p.inspection.findFirstOrThrow({ where: { purchaseOrderId: po.id } });
    await ri.completeReceivingInspection({ inspectionId: ins.id, result: "FAIL", documents: [{ url: "/qa/failure.pdf" }], userId: admin.id });
    assert.equal((await p.nonConformance.findFirstOrThrow({ where: { inspectionId: ins.id } })).supplierId, supplier.id);
    console.log("PASS QA-002 failed receiving NCR retains source PO supplier");
    const dueDate = new Date("2027-05-10T12:00:00Z"), plannedEnd = new Date("2027-06-20T12:00:00Z");
    await p.workOrder.create({ data: { number: "WO-DATE-REGRESSION", type: "TASK_ONLY", dueDate, plannedEnd } });
    const page = (await import("../src/app/work-orders/page")).default;
    const { formatDate } = await import("../src/lib/utils");
    function text(node: unknown): string {
      if (typeof node === "string" || typeof node === "number") return String(node);
      if (Array.isArray(node)) return node.map(text).join(" ");
      if (node && typeof node === "object" && "props" in node) return text((node as { props: { children?: unknown } }).props.children);
      return "";
    }
    const tree = text(await page({ searchParams: Promise.resolve({}) }));
    assert(tree.includes(formatDate(dueDate)), "WO list must show the promised due date");
    assert(!tree.includes(formatDate(plannedEnd)), "Scheduled end must not be relabeled Due");
    console.log("PASS WORK-001 actual WO list renders promised dueDate, not differing plannedEnd");
  } finally { await p.$disconnect(); await server.stop(); await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
