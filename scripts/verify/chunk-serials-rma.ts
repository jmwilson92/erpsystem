/**
 * Serial tree + RMA smoke (service layer).
 */
import {
  check,
  assert,
  prisma,
  summary,
  adminUser,
  resetResults,
} from "./lib";
import {
  mintSerial,
  installSerial,
  getSerialTree,
  ensureWorkOrderUnits,
  assignKitSerialToUnit,
  listKitSerialPlan,
  startWarranty,
  evaluateWarranty,
  removeSerialInstall,
} from "../../src/lib/services/serials";
import {
  createRmaRequest,
  issueRma,
  acceptRepairQuote,
  createRepairQuoteForRma,
  adjustRmaQuotePrice,
} from "../../src/lib/services/rma";
import { dispositionMrb } from "../../src/lib/services/supply-chain";

export async function runChunkSerialsRma() {
  resetResults();
  console.log("\n═══ Chunk S: Serials + RMA ═══");

  const admin = await adminUser();
  let parentId = "";
  let childId = "";
  let rmaId = "";

  await check("S", "Mint parent + child serials", async () => {
    const part = await prisma.part.findFirst({
      where: { isActive: true },
      orderBy: { partNumber: "asc" },
    });
    const childPart =
      (await prisma.part.findFirst({
        where: { isActive: true, id: { not: part!.id } },
      })) || part;
    assert(part && childPart, "need parts");
    const ts = Date.now().toString(36).toUpperCase();
    const parent = await mintSerial({
      serial: `TOP-${ts}`,
      partId: part!.id,
      userId: admin.id,
    });
    const child = await mintSerial({
      serial: `CHD-${ts}`,
      partId: childPart!.id,
      userId: admin.id,
    });
    parentId = parent.id;
    childId = child.id;
  });

  await check("S", "Install child under parent → tree depth", async () => {
    const child = await prisma.serialNumber.findUnique({
      where: { id: childId },
    });
    await installSerial({
      parentSerialId: parentId,
      childSerialId: childId,
      childPartId: child!.partId,
      userId: admin.id,
    });
    const tree = await getSerialTree(parentId);
    assert(tree && tree.children.length >= 1, "tree empty");
    assert(
      tree!.children.some((c) => c.serialId === childId),
      "child missing from tree"
    );
  });

  await check("S", "Kit serial plan maps SN → unit", async () => {
    const wo = await prisma.workOrder.findFirst({
      where: { status: { notIn: ["CANCELLED"] } },
      orderBy: { createdAt: "desc" },
    });
    assert(wo, "no WO");
    await ensureWorkOrderUnits({ workOrderId: wo!.id });
    const child = await prisma.serialNumber.findUnique({
      where: { id: childId },
    });
    // re-issue child for kit assign
    await prisma.serialNumber.update({
      where: { id: childId },
      data: { status: "IN_STOCK", parentSerialId: null },
    });
    await assignKitSerialToUnit({
      workOrderId: wo!.id,
      unitIndex: 1,
      serial: child!.serial,
      userId: admin.id,
    });
    const plan = await listKitSerialPlan(wo!.id);
    assert(
      plan.some((p) => p.serialId === childId && p.unitIndex === 1),
      "kit plan missing assignment"
    );
  });

  await check("S", "Warranty window", async () => {
    await startWarranty({ serialId: parentId });
    const sn = await prisma.serialNumber.findUnique({
      where: { id: parentId },
      include: { part: true },
    });
    const w = evaluateWarranty(sn!, sn!.part);
    assert(w.eligible, w.reason);
  });

  await check("S", "RMA request + warranty issue → repair WO", async () => {
    const customer = await prisma.customer.findFirst();
    const sn = await prisma.serialNumber.findUnique({
      where: { id: parentId },
      include: { part: true },
    });
    assert(customer && sn, "need customer+sn");
    const { rma } = await createRmaRequest({
      customerId: customer!.id,
      serial: sn!.serial,
      partNumber: sn!.part.partNumber,
      symptom: "Verify RMA path",
      userId: admin.id,
    });
    rmaId = rma.id;
    const issued = await issueRma({
      rmaId: rma.id,
      coverage: "WARRANTY",
      userId: admin.id,
    });
    assert(issued.workOrder, "warranty should create WO immediately");
    assert(!issued.quote, "warranty should not require quote");
    const wo = await prisma.workOrder.findUnique({
      where: { id: issued.workOrder!.id },
    });
    assert(wo?.rmaId === rma.id, "WO not linked to RMA");
    assert(!wo?.salesOrderId, "repair WO must not have sales order");
  });

  await check("S", "Chargeable RMA → quote → accept → WO", async () => {
    const customer = await prisma.customer.findFirst();
    const part = await prisma.part.findFirst({ where: { isActive: true } });
    assert(customer && part, "need masters");
    const ts = Date.now().toString(36).toUpperCase();
    const sn = await mintSerial({
      serial: `RMA-CHG-${ts}`,
      partId: part!.id,
      userId: admin.id,
    });
    await startWarranty({
      serialId: sn.id,
      asOf: new Date("2020-01-01"),
      customerId: customer!.id,
    });
    // force expired warranty by setting end in past
    await prisma.serialNumber.update({
      where: { id: sn.id },
      data: {
        warrantyStart: new Date("2020-01-01"),
        warrantyEnd: new Date("2021-01-01"),
      },
    });
    const { rma } = await createRmaRequest({
      customerId: customer!.id,
      serial: sn.serial,
      partNumber: part!.partNumber,
      userId: admin.id,
    });
    const issued = await issueRma({
      rmaId: rma.id,
      coverage: "CHARGEABLE",
      userId: admin.id,
    });
    assert(issued.quote, "chargeable needs quote");
    // set a price on quote
    await prisma.quoteLine.updateMany({
      where: { quoteId: issued.quote!.id },
      data: { unitPrice: 500 },
    });
    await prisma.quote.update({
      where: { id: issued.quote!.id },
      data: { totalAmount: 500 },
    });
    const accepted = await acceptRepairQuote({
      quoteId: issued.quote!.id,
      userId: admin.id,
    });
    assert(accepted.workOrder.rmaId === rma.id);
    assert(!accepted.workOrder.salesOrderId);

    await adjustRmaQuotePrice({
      rmaId: rma.id,
      newTotal: 450,
      reason: "Lower labor than estimated",
      userId: admin.id,
    });
    const updated = await prisma.rma.findUnique({ where: { id: rma.id } });
    assert(updated?.finalPrice === 450, `price ${updated?.finalPrice}`);
  });

  await check("S", "Tear-down → MRB disposition (scrap)", async () => {
    const part = await prisma.part.findFirst({ where: { isActive: true } });
    const childPart =
      (await prisma.part.findFirst({
        where: { isActive: true, id: { not: part!.id } },
      })) || part;
    const customer = await prisma.customer.findFirst();
    assert(part && childPart && customer, "need masters");
    const ts = Date.now().toString(36).toUpperCase();
    const top = await mintSerial({
      serial: `TOP-MRB-${ts}`,
      partId: part!.id,
      userId: admin.id,
    });
    const child = await mintSerial({
      serial: `CHD-MRB-${ts}`,
      partId: childPart!.id,
      userId: admin.id,
    });
    const install = await installSerial({
      parentSerialId: top.id,
      childSerialId: child.id,
      childPartId: childPart!.id,
      userId: admin.id,
    });
    const { rma } = await createRmaRequest({
      customerId: customer!.id,
      serial: top.serial,
      partNumber: part!.partNumber,
      userId: admin.id,
    });
    await issueRma({
      rmaId: rma.id,
      coverage: "WARRANTY",
      userId: admin.id,
    });
    const result = await removeSerialInstall({
      installId: install.id,
      rmaId: rma.id,
      quarantine: true,
      notes: "Failed board — send to MRB",
      userId: admin.id,
    });
    assert(result.mrbCase, "expected MRB from quarantine tear-down");
    const mrb = await prisma.mrbCase.findUnique({
      where: { id: result.mrbCase!.id },
    });
    assert(mrb?.rmaId === rma.id, "MRB not linked to RMA");
    assert(mrb?.serialId === child.id, "MRB not linked to child SN");
    const rmaHold = await prisma.rma.findUnique({ where: { id: rma.id } });
    assert(rmaHold?.status === "MRB_HOLD", `status ${rmaHold?.status}`);

    await dispositionMrb({
      mrbCaseId: mrb!.id,
      disposition: "SCRAP",
      quantity: 1,
      justification: "Beyond economic repair",
      decidedById: admin.id,
      createReplacementPr: true,
    });
    const sn = await prisma.serialNumber.findUnique({ where: { id: child.id } });
    assert(sn?.status === "SCRAPPED", `serial status ${sn?.status}`);
    const rmaAfter = await prisma.rma.findUnique({ where: { id: rma.id } });
    assert(rmaAfter?.status === "IN_WORK", `RMA after scrap ${rmaAfter?.status}`);
    const pr = await prisma.purchaseRequest.findFirst({
      where: { mrbCaseId: mrb!.id },
    });
    assert(pr, "scrap should raise replacement PR");
  });

  return summary();
}

if (require.main === module) {
  runChunkSerialsRma()
    .then((s) => process.exit(s.fail ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
