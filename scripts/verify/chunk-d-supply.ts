import { check, assert, prisma, summary, adminUser, resetResults } from "./lib";

export async function runChunkD() {
  resetResults();
  console.log("\n═══ Chunk D: Supply chain ═══");

  await adminUser();

  await check("D", "PRs exist or can be listed", async () => {
    const n = await prisma.purchaseRequest.count();
    assert(n >= 0, "PR count failed");
  });

  await check("D", "POs have suppliers", async () => {
    const pos = await prisma.purchaseOrder.findMany({
      take: 20,
      include: { supplier: true },
    });
    for (const po of pos) {
      assert(po.supplierId, `${po.number} missing supplierId`);
      if (po.supplierId) {
        assert(po.supplier, `${po.number} orphan supplier`);
      }
    }
  });

  await check("D", "ASL suppliers can be found", async () => {
    const asl = await prisma.supplier.count({
      where: {
        isApprovedVendor: true,
        status: { in: ["APPROVED", "CONDITIONAL"] },
      },
    });
    assert(asl > 0, "no ASL suppliers");
  });

  await check("D", "Inventory locations exist", async () => {
    const locs = await prisma.location.count();
    assert(locs > 0, "no locations");
  });

  await check("D", "Receiving travelers queryable", async () => {
    await prisma.receivingTraveler.findMany({ take: 5 });
  });

  await check("D", "Open PRs only use valid statuses", async () => {
    const ok = new Set([
      "DRAFT",
      "SUBMITTED",
      "APPROVED",
      "REJECTED",
      "CONVERTED",
      "CANCELLED",
    ]);
    const prs = await prisma.purchaseRequest.findMany({
      select: { number: true, status: true },
      take: 100,
    });
    for (const p of prs) {
      assert(ok.has(p.status), `PR ${p.number} bad status ${p.status}`);
    }
  });

  return summary();
}

if (require.main === module) {
  runChunkD()
    .then((s) => process.exit(s.fail ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
