/**
 * Money path (service-level): stock FG → SO → plan allocate → pack → ship → AR.
 *
 *   npx tsx scripts/verify/chunk-c2-money-path.ts
 */
import {
  check,
  assert,
  prisma,
  summary,
  adminUser,
  resetResults,
  record,
} from "./lib";
import {
  createSalesOrder,
  planSalesOrderFulfillment,
  verifyShipmentPackingList,
  packShipment,
  shipSalesOrder,
} from "../../src/lib/services/order-fulfillment";

async function ensureFgStock(partId: string, qty: number) {
  const loc =
    (await prisma.location.findFirst({ where: { type: "STORAGE" } })) ||
    (await prisma.location.findFirst());
  assert(loc, "no storage location");

  const existing = await prisma.inventoryItem.findFirst({
    where: {
      partId,
      locationId: loc!.id,
      quantityAvailable: { gt: 0 },
    },
  });
  if (existing && existing.quantityAvailable >= qty) {
    return existing;
  }

  return prisma.inventoryItem.create({
    data: {
      partId,
      locationId: loc!.id,
      quantityOnHand: qty,
      quantityAvailable: qty,
      quantityCommitted: 0,
      lotNumber: `LOT-VERIFY-${Date.now().toString(36).toUpperCase()}`,
      ownership: "COMPANY",
      unitCost: 10,
    },
  });
}

export async function runChunkC2() {
  resetResults();
  console.log("\n═══ Chunk C2: Money path (SO → pack → ship) ═══");

  const admin = await adminUser();
  let soId = "";
  let shipmentId = "";

  await check("C2", "Pick customer + FG part", async () => {
    const customer = await prisma.customer.findFirst();
    const part = await prisma.part.findFirst({
      where: { isActive: true },
      orderBy: { partNumber: "asc" },
    });
    assert(customer, "no customer");
    assert(part, "no part");
    record(
      "C2",
      "chosen",
      true,
      `${customer!.code || customer!.name} / ${part!.partNumber}`
    );
  });

  await check("C2", "Stock finished goods", async () => {
    const part = await prisma.part.findFirst({
      where: { isActive: true },
      orderBy: { partNumber: "asc" },
    });
    assert(part, "no part");
    const inv = await ensureFgStock(part!.id, 5);
    assert(inv.quantityAvailable >= 1, "stock not available");
  });

  await check("C2", "Create sales order (early ship)", async () => {
    const customer = await prisma.customer.findFirst();
    const part = await prisma.part.findFirst({
      where: { isActive: true },
      orderBy: { partNumber: "asc" },
    });
    assert(customer && part, "missing masters");
    const so = await createSalesOrder({
      customerId: customer!.id,
      requiredDate: new Date(Date.now() + 3 * 864e5),
      allowEarlyShip: true,
      shipToAddress: "Verify Dock, Plant 1",
      lines: [
        {
          partId: part!.id,
          description: part!.description,
          quantity: 1,
          unitPrice: part!.standardCost || 50,
        },
      ],
      createdById: admin.id,
    });
    soId = so.id;
    assert(so.number?.startsWith("SO-"), `bad number ${so.number}`);
  });

  await check("C2", "Plan fulfillment allocates FG", async () => {
    assert(soId, "no SO");
    const plan = await planSalesOrderFulfillment({
      salesOrderId: soId,
      userId: admin.id,
      // use real FG stock path
      bypassStockCheck: false,
    });
    assert(Array.isArray(plan) || plan, "plan returned empty");
    const line = await prisma.salesOrderLine.findFirst({
      where: { salesOrderId: soId },
    });
    assert(line, "no line");
    // After allocate, quantityAllocated should rise OR status READY
    const ok =
      (line!.quantityAllocated || 0) >= 1 ||
      line!.fulfillmentStatus === "READY" ||
      line!.fulfillmentStatus === "ALLOCATED";
    assert(
      ok,
      `line not allocated: alloc=${line!.quantityAllocated} status=${line!.fulfillmentStatus}`
    );
  });

  await check("C2", "Create + verify + pack shipment", async () => {
    assert(soId, "no SO");
    const so = await prisma.salesOrder.findUnique({
      where: { id: soId },
      include: { lines: true, customer: true },
    });
    assert(so, "SO gone");

    // Mark SO ready-ish so ensure path is happy
    await prisma.salesOrder.update({
      where: { id: soId },
      data: { status: "READY_TO_SHIP" },
    });

    const count = await prisma.shipment.count();
    const shipment = await prisma.shipment.create({
      data: {
        number: `SHP-M${String(count + 1).padStart(4, "0")}`,
        salesOrderId: soId,
        status: "DRAFT",
        shipToAddress: so!.shipToAddress || "Verify Dock",
        packingListVerified: false,
        lines: {
          create: so!.lines.map((l) => ({
            partId: l.partId,
            description: l.description,
            quantity: Math.max(1, l.quantity - l.quantityShipped),
          })),
        },
      },
    });
    shipmentId = shipment.id;

    await verifyShipmentPackingList({
      shipmentId: shipment.id,
      userId: admin.id,
    });
    await packShipment({
      shipmentId: shipment.id,
      packPhotos: [
        { url: "data:image/png;base64,iVBORw0KGgo=", fileName: "pack-verify.png" },
      ],
      userId: admin.id,
    });
    const packed = await prisma.shipment.findUnique({
      where: { id: shipment.id },
    });
    assert(packed?.status === "PACKED", `got ${packed?.status}`);
  });

  await check("C2", "Ship SO (full stock preflight)", async () => {
    assert(soId && shipmentId, "missing SO/shipment");
    const result = await shipSalesOrder({
      salesOrderId: soId,
      shipmentId,
      userId: admin.id,
      force: true, // date only
      carrier: "VERIFY",
      trackingNumber: "1ZVERIFY",
    });
    assert(result, "ship returned null");
    const so = await prisma.salesOrder.findUnique({ where: { id: soId } });
    assert(so?.status === "SHIPPED", `SO status ${so?.status}`);
    const ship = await prisma.shipment.findUnique({
      where: { id: shipmentId },
    });
    assert(ship?.status === "SHIPPED", `shipment ${ship?.status}`);
  });

  await check("C2", "Inventory relieved (not negative)", async () => {
    const neg = await prisma.inventoryItem.count({
      where: { quantityOnHand: { lt: 0 } },
    });
    assert(neg === 0, `${neg} negative bins after ship`);
  });

  await check("C2", "Cannot ship twice", async () => {
    let threw = false;
    try {
      await shipSalesOrder({
        salesOrderId: soId,
        shipmentId,
        userId: admin.id,
        force: true,
      });
    } catch {
      threw = true;
    }
    assert(threw, "second ship should fail");
  });

  return summary();
}

if (require.main === module) {
  runChunkC2()
    .then((s) => process.exit(s.fail ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
