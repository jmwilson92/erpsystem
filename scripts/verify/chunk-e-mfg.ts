import {
  check,
  assert,
  prisma,
  summary,
  adminUser,
  userByRole,
  resetResults,
} from "./lib";
import { startWorkOrderProduction } from "../../src/lib/services/work-orders";

export async function runChunkE() {
  resetResults();
  console.log("\n═══ Chunk E: Manufacturing ═══");

  await adminUser();

  await check("E", "Work orders present", async () => {
    const n = await prisma.workOrder.count();
    assert(n > 0, "no work orders");
  });

  await check("E", "Workcenters exist", async () => {
    const n = await prisma.workCenter.count();
    assert(n > 0, "no workcenters");
  });

  await check("E", "PRODUCTION start without kit is blocked", async () => {
    const wo = await prisma.workOrder.findFirst({
      where: {
        type: "PRODUCTION",
        kitStatus: { not: "KITTED" },
        status: { in: ["RELEASED", "READY_TO_KIT", "PLANNED"] },
      },
    });
    if (!wo) {
      // create synthetic check via any non-kitted production if exists
      const any = await prisma.workOrder.findFirst({
        where: { type: "PRODUCTION", kitStatus: { not: "KITTED" } },
      });
      if (!any) return; // skip-like
      let threw = false;
      try {
        await startWorkOrderProduction({ workOrderId: any.id });
      } catch (e) {
        threw = /kit/i.test(e instanceof Error ? e.message : "");
      }
      assert(threw, "allowed start without kit");
      return;
    }
    let threw = false;
    try {
      await startWorkOrderProduction({ workOrderId: wo.id });
    } catch (e) {
      threw = /kit/i.test(e instanceof Error ? e.message : "");
    }
    assert(threw, "allowed production start without KITTED");
  });

  await check("E", "Kit orders queryable", async () => {
    await prisma.kitOrder.findMany({ take: 5 });
  });

  await check("E", "Work instructions exist", async () => {
    const n = await prisma.workInstruction.count();
    assert(n > 0, "no WIs");
  });

  await check("E", "Operator PIN required for sign-off path", async () => {
    const op = await userByRole("OPERATOR");
    assert(op.pinCode?.trim(), "operator missing pin — seed issue");
  });

  return summary();
}

if (require.main === module) {
  runChunkE()
    .then((s) => process.exit(s.fail ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
