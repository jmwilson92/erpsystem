import { check, assert, prisma, summary, record, resetResults } from "./lib";

export async function runChunkA() {
  resetResults();
  console.log("\n═══ Chunk A: Database integrity ═══");

  await check("A", "DB SELECT 1", async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  await check("A", "CompanySettings exists", async () => {
    const c = await prisma.companySettings.findUnique({ where: { id: "default" } });
    assert(c, "missing CompanySettings default");
  });

  await check("A", "Users present", async () => {
    const n = await prisma.user.count({ where: { isActive: true } });
    assert(n >= 1, `only ${n} active users`);
  });

  await check("A", "Core masters non-empty (parts/customers/suppliers)", async () => {
    const [parts, customers, suppliers] = await Promise.all([
      prisma.part.count(),
      prisma.customer.count(),
      prisma.supplier.count(),
    ]);
    assert(parts > 0, "no parts");
    assert(customers > 0, "no customers");
    assert(suppliers > 0, "no suppliers");
    record("A", "counts", true, `parts=${parts} customers=${customers} suppliers=${suppliers}`);
  });

  await check("A", "WBS parent pointers valid", async () => {
    const all = await prisma.wbsElement.findMany({
      select: { id: true, parentId: true, code: true },
    });
    const ids = new Set(all.map((w) => w.id));
    const broken = all.filter((w) => w.parentId && !ids.has(w.parentId));
    assert(broken.length === 0, `broken parents: ${broken.map((b) => b.code).join(",")}`);
  });

  await check("A", "Enacted budgets have charge codes", async () => {
    const bad = await prisma.budget.count({
      where: {
        status: "ENACTED",
        OR: [{ chargeCode: null }, { chargeCode: "" }],
      },
    });
    assert(bad === 0, `${bad} enacted without chargeCode`);
  });

  await check("A", "No negative inventory on-hand", async () => {
    const neg = await prisma.inventoryItem.count({
      where: { quantityOnHand: { lt: 0 } },
    });
    assert(neg === 0, `${neg} negative bins`);
  });

  await check("A", "SO lines reference valid parts or null", async () => {
    const lines = await prisma.salesOrderLine.findMany({
      where: { partId: { not: null } },
      select: { partId: true },
      take: 500,
    });
    for (const l of lines) {
      const p = await prisma.part.findUnique({ where: { id: l.partId! } });
      assert(p, `orphan partId ${l.partId}`);
    }
  });

  return summary();
}

if (require.main === module) {
  runChunkA()
    .then((s) => process.exit(s.fail ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
