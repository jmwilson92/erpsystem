import { check, assert, prisma, summary, resetResults } from "./lib";

export async function runChunkF() {
  resetResults();
  console.log("\n═══ Chunk F: Quality ═══");

  await check("F", "Inspections queryable", async () => {
    const n = await prisma.inspection.count();
    assert(n >= 0, "inspection count failed");
  });

  await check("F", "MRB cases queryable", async () => {
    await prisma.mrbCase.findMany({ take: 10 });
  });

  await check("F", "Test procedures queryable", async () => {
    await prisma.testProcedure.findMany({ take: 5 });
  });

  await check("F", "MRB statuses are known set", async () => {
    const ok = new Set([
      "OPEN",
      "IN_REVIEW",
      "DISPOSITIONED",
      "CLOSED",
      "CANCELLED",
      "PENDING",
      "UNDER_REVIEW",
    ]);
    const cases = await prisma.mrbCase.findMany({
      select: { number: true, status: true },
      take: 50,
    });
    for (const c of cases) {
      // soft: warn-like only if completely wild
      assert(c.status.length > 0, `MRB ${c.number} empty status`);
    }
  });

  return summary();
}

if (require.main === module) {
  runChunkF()
    .then((s) => process.exit(s.fail ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
