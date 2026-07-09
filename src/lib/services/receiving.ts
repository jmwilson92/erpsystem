"use server";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/** Create a receiving traveler when a PO is issued (one open traveler per PO). */
export async function createReceivingTravelerForPo(params: {
  purchaseOrderId: string;
  userId?: string;
  notes?: string;
}) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.purchaseOrderId },
    include: { receivingTravelers: true, lines: true },
  });
  if (!po) throw new Error("Purchase order not found");

  const open = po.receivingTravelers.find((t) =>
    ["WAITING", "PARTIAL"].includes(t.status)
  );
  if (open) return open;

  const count = await prisma.receivingTraveler.count();
  const number = `RCV-T-${String(count + 1).padStart(5, "0")}`;

  const traveler = await prisma.receivingTraveler.create({
    data: {
      number,
      purchaseOrderId: po.id,
      status: "WAITING",
      expectedDate: po.promisedDate,
      notes:
        params.notes ||
        `Receiving traveler for ${po.number} — dock hold until material arrives`,
    },
  });

  await logAudit({
    entityType: "ReceivingTraveler",
    entityId: traveler.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number, poNumber: po.number },
  });

  return traveler;
}

export async function syncReceivingTravelerStatus(purchaseOrderId: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: true, receivingTravelers: true },
  });
  if (!po) return;

  const allReceived = po.lines.every((l) => l.quantityReceived >= l.quantity);
  const anyReceived = po.lines.some((l) => l.quantityReceived > 0);
  const status = allReceived ? "COMPLETE" : anyReceived ? "PARTIAL" : "WAITING";

  for (const t of po.receivingTravelers) {
    if (["CLOSED"].includes(t.status)) continue;
    if (t.status !== status) {
      await prisma.receivingTraveler.update({
        where: { id: t.id },
        data: { status },
      });
    }
  }
}
