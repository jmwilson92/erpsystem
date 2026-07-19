import { check, assert, prisma, summary, adminUser, resetResults } from "./lib";
import {
  ensureProjectWbsChargeCodes,
  projectWbsChargeCode,
  wbsCodePathFromLeaf,
} from "../../src/lib/services/budgets";

export async function runChunkG() {
  resetResults();
  console.log("\n═══ Chunk G: PMO & budgets ═══");

  const admin = await adminUser();

  await check("G", "Projects exist", async () => {
    const n = await prisma.project.count();
    assert(n > 0, "no projects");
  });

  await check("G", "WBS elements exist", async () => {
    const n = await prisma.wbsElement.count();
    assert(n > 0, "no WBS");
  });

  await check("G", "wbsCodePathFromLeaf root→leaf", async () => {
    const child = await prisma.wbsElement.findFirst({
      where: { parentId: { not: null } },
    });
    if (!child) {
      const root = await prisma.wbsElement.findFirst();
      assert(root, "no wbs");
      const path = await wbsCodePathFromLeaf(root!.id);
      assert(path.length >= 1, "empty path");
      return;
    }
    const path = await wbsCodePathFromLeaf(child.id);
    assert(path.length >= 2, `expected parent+child path, got ${path.join("-")}`);
  });

  await check("G", "ensureProjectWbsChargeCodes is idempotent", async () => {
    const project = await prisma.project.findFirst({
      include: { _count: { select: { wbsElements: true } } },
    });
    assert(project && project._count.wbsElements > 0, "no project with WBS");
    const r1 = await ensureProjectWbsChargeCodes({
      projectId: project!.id,
      userId: admin.id,
      ownerId: admin.id,
    });
    const r2 = await ensureProjectWbsChargeCodes({
      projectId: project!.id,
      userId: admin.id,
      ownerId: admin.id,
    });
    assert(r2.created === 0, `second run created ${r2.created}`);
    assert(r1.created + r1.skipped >= project!._count.wbsElements);
  });

  await check("G", "WBS budgets use hierarchical charge codes", async () => {
    const b = await prisma.budget.findFirst({
      where: {
        wbsElementId: { not: null },
        chargeCode: { not: null },
        status: { not: "CANCELLED" },
      },
      include: { project: true, wbsElement: true },
    });
    assert(b?.chargeCode, "no WBS budget with code");
    if (b?.wbsElementId && b.project) {
      const path = await wbsCodePathFromLeaf(b.wbsElementId);
      const expected = projectWbsChargeCode(
        b.project.name || b.project.number,
        path
      );
      // may have -1 uniqueness suffix
      assert(
        b.chargeCode === expected ||
          b.chargeCode!.startsWith(expected + "-"),
        `code ${b.chargeCode} vs expected ${expected}`
      );
    }
  });

  await check("G", "Programs listable", async () => {
    await prisma.program.findMany({ take: 5 });
  });

  return summary();
}

if (require.main === module) {
  runChunkG()
    .then((s) => process.exit(s.fail ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
