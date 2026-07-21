import { prisma } from "@/lib/db";

/**
 * Clock a person out of every kind of live "on the clock" work in one shot.
 * Used when someone starts a break/lunch — they should not stay clocked in on
 * a traveler, engineering task, or buyer package while away.
 *
 * Each subsystem tracks its own active session:
 *  - Receiving/QA/Test travelers: activeScanUserId/activeScanAt on the traveler
 *  - Engineering tasks: WorkTimeScan rows with status OPEN
 *  - Buyer packages: buyerWorkStartedById/At on the purchase request
 */
export async function clockOutAllActiveWork(params: {
  userId: string;
  reason?: string;
}): Promise<{ closed: number; details: string[] }> {
  const details: string[] = [];
  let closed = 0;

  // 1) Receiving / QA / Test traveler scans
  const travelers = await prisma.receivingTraveler.findMany({
    where: { activeScanUserId: params.userId },
    select: { id: true, number: true },
  });
  if (travelers.length) {
    const { scanOutOfReceivingTraveler } = await import(
      "@/lib/services/receiving-time"
    );
    for (const t of travelers) {
      try {
        await scanOutOfReceivingTraveler({
          travelerId: t.id,
          userId: params.userId,
          reason: "FORCE",
        });
        closed++;
        details.push(t.number);
      } catch {
        /* best effort */
      }
    }
  }

  // 2) Engineering task scans
  const scans = await prisma.workTimeScan.findMany({
    where: { userId: params.userId, status: "OPEN" },
    select: { id: true },
  });
  if (scans.length) {
    const { scanOutOfTask } = await import("@/lib/services/engineering-work");
    for (const s of scans) {
      try {
        await scanOutOfTask({
          scanId: s.id,
          userId: params.userId,
          notes: params.reason || "On break",
        });
        closed++;
        details.push("eng task");
      } catch {
        /* best effort */
      }
    }
  }

  // 3) Buyer package work
  const prs = await prisma.purchaseRequest.findMany({
    where: { buyerWorkStartedById: params.userId },
    select: { id: true, number: true },
  });
  if (prs.length) {
    const { clockOutBuyerWork } = await import("@/lib/services/pr-buyer");
    for (const pr of prs) {
      try {
        await clockOutBuyerWork({
          purchaseRequestId: pr.id,
          userId: params.userId,
          reason: params.reason || "BREAK",
        });
        closed++;
        details.push(pr.number);
      } catch {
        /* best effort */
      }
    }
  }

  return { closed, details };
}
