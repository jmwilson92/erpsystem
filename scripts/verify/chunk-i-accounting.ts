import { check, assert, prisma, summary, resetResults } from "./lib";

export async function runChunkI() {
  resetResults();
  console.log("\n═══ Chunk I: Accounting ═══");

  await check("I", "GL accounts exist", async () => {
    const n = await prisma.account.count();
    assert(n > 0, "no GL accounts — seed incomplete");
  });

  await check("I", "Journal entries queryable", async () => {
    await prisma.journalEntry.findMany({ take: 10 });
  });

  await check("I", "Journal lines balance check (sample)", async () => {
    const entries = await prisma.journalEntry.findMany({
      take: 20,
      include: { lines: true },
    });
    for (const e of entries) {
      if (!e.lines.length) continue;
      const debits = e.lines.reduce((s, l) => s + (l.debit || 0), 0);
      const credits = e.lines.reduce((s, l) => s + (l.credit || 0), 0);
      const diff = Math.abs(debits - credits);
      assert(diff < 0.02, `JE ${e.number || e.id} unbalanced ${debits} vs ${credits}`);
    }
  });

  return summary();
}

if (require.main === module) {
  runChunkI()
    .then((s) => process.exit(s.fail ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
