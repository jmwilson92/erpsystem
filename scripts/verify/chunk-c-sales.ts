import { check, assert, prisma, summary, adminUser, resetResults } from "./lib";
import {
  createSalesOrder,
  planSalesOrderFulfillment,
  ensureShipmentForSalesOrder,
  verifyShipmentPackingList,
  packShipment,
  shipSalesOrder,
} from "../../src/lib/services/order-fulfillment";

export async function runChunkC() {
  resetResults();
  console.log("\n═══ Chunk C: Sales & fulfillment ═══");

  const admin = await adminUser();

  await check("C", "List open sales orders", async () => {
    const n = await prisma.salesOrder.count();
    assert(n > 0, "no sales orders in seed");
  });

  await check("C", "Create SO + plan fulfillment", async () => {
    const customer = await prisma.customer.findFirst();
    assert(customer, "no customer");
    const part = await prisma.part.findFirst({
      where: { isActive: true },
      orderBy: { partNumber: "asc" },
    });
    assert(part, "no part");

    const so = await createSalesOrder({
      customerId: customer.id,
      requiredDate: new Date(Date.now() + 14 * 864e5),
      lines: [
        {
          partId: part.id,
          description: part.description,
          quantity: 1,
          unitPrice: part.standardCost || 100,
        },
      ],
      userId: admin.id,
    });
    assert(so?.id, "SO not created");

    // Plan may create WO/PR depending on stock — must not throw
    await planSalesOrderFulfillment({
      salesOrderId: so.id,
      userId: admin.id,
      bypassStockCheck: true,
      bypassMaterialStockCheck: true,
    });

    const refreshed = await prisma.salesOrder.findUnique({
      where: { id: so.id },
    });
    assert(refreshed, "SO missing after plan");
  });

  await check("C", "Ship refuses without PACKED shipment", async () => {
    const so = await prisma.salesOrder.findFirst({
      where: { status: { notIn: ["SHIPPED", "CANCELLED", "CLOSED"] } },
      orderBy: { createdAt: "desc" },
    });
    assert(so, "no open SO");
    let threw = false;
    let msg = "";
    try {
      // force only bypasses date gate — pack still required
      await shipSalesOrder({
        salesOrderId: so.id,
        userId: admin.id,
        force: true,
      });
    } catch (e) {
      threw = true;
      msg = e instanceof Error ? e.message : "";
    }
    assert(threw, "ship allowed without pack");
    assert(
      /pack|shipment|inventory|insufficient/i.test(msg),
      `unexpected error: ${msg}`
    );
  });

  await check("C", "verify + pack shipment path", async () => {
    const customer = await prisma.customer.findFirst();
    const part = await prisma.part.findFirst({ where: { isActive: true } });
    assert(customer && part, "need customer+part");
    const so = await createSalesOrder({
      customerId: customer!.id,
      requiredDate: new Date(Date.now() + 7 * 864e5),
      allowEarlyShip: true,
      lines: [
        {
          partId: part!.id,
          description: "Verify pack path",
          quantity: 1,
          unitPrice: 10,
        },
      ],
      userId: admin.id,
    });
    // Direct shipment create so pack gate can be tested without FG readiness
    const count = await prisma.shipment.count();
    const shipment = await prisma.shipment.create({
      data: {
        number: `SHP-V${String(count + 1).padStart(4, "0")}`,
        salesOrderId: so.id,
        status: "DRAFT",
        shipToAddress: "Test Lab Dock",
        packingListVerified: false,
        lines: {
          create: [
            {
              partId: part!.id,
              description: "Verify pack path",
              quantity: 1,
            },
          ],
        },
      },
    });
    await verifyShipmentPackingList({
      shipmentId: shipment.id,
      userId: admin.id,
    });
    // Manual/ad-hoc stock issue only when no SO — SO-linked pack doesn't issue here
    // If pack throws insufficient stock on manual path, SO path should still pack
    await packShipment({
      shipmentId: shipment.id,
      packPhotos: [
        {
          url: "data:image/png;base64,iVBORw0KGgo=",
          fileName: "pack.png",
        },
      ],
      userId: admin.id,
    });
    const packed = await prisma.shipment.findUnique({
      where: { id: shipment.id },
    });
    assert(packed?.status === "PACKED", `status=${packed?.status}`);
  });

  return summary();
}

if (require.main === module) {
  runChunkC()
    .then((s) => process.exit(s.fail ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
