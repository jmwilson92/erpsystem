import {
  check,
  assert,
  prisma,
  summary,
  adminUser,
  userByRole,
  resetResults,
} from "./lib";
import { userHasPermission } from "../../src/lib/auth";
import {
  demoModeEnabled,
  assertLoginNotRateLimited,
  recordLoginFailure,
  clearLoginFailures,
} from "../../src/lib/auth-core";
import {
  projectWbsChargeCode,
  chargeCodeFromBudgetName,
} from "../../src/lib/services/budgets";
import { isPathEnabled, moduleKeyForPath } from "../../src/lib/modules";

export async function runChunkB() {
  resetResults();
  console.log("\n═══ Chunk B: Auth & permissions ═══");

  await check("B", "demoModeEnabled is boolean", async () => {
    assert(typeof demoModeEnabled() === "boolean", "not boolean");
  });

  await check("B", "ADMIN has bom.certify", async () => {
    const admin = await adminUser();
    assert(await userHasPermission(admin.id, "bom.certify"), "denied");
  });

  await check("B", "OPERATOR denied bom.certify", async () => {
    const op = await userByRole("OPERATOR");
    assert(!(await userHasPermission(op.id, "bom.certify")), "operator can certify");
  });

  await check("B", "OPERATOR denied budgets.manage", async () => {
    const op = await userByRole("OPERATOR");
    assert(!(await userHasPermission(op.id, "budgets.manage")), "operator budgets");
  });

  await check("B", "PM has budgets.manage", async () => {
    const pm = await userByRole("PM");
    assert(await userHasPermission(pm.id, "budgets.manage"), "PM no budgets");
  });

  await check("B", "CM has cm.vote", async () => {
    const cm = await userByRole("CM");
    assert(await userHasPermission(cm.id, "cm.vote"), "CM no vote");
  });

  await check("B", "PRODUCTION has sales.order.ship", async () => {
    const p = await userByRole("PRODUCTION");
    assert(await userHasPermission(p.id, "sales.order.ship"), "no ship");
  });

  await check("B", "PURCHASING has purchasing.po.convert", async () => {
    const p = await userByRole("PURCHASING");
    assert(await userHasPermission(p.id, "purchasing.po.convert"), "no convert");
  });

  await check("B", "QUALITY has mrb.disposition", async () => {
    const q = await userByRole("QUALITY");
    assert(await userHasPermission(q.id, "mrb.disposition"), "no mrb");
  });

  await check("B", "Login rate limit trips after many failures", async () => {
    const email = "rate-limit-test@forge.erp";
    clearLoginFailures(email);
    for (let i = 0; i < 10; i++) recordLoginFailure(email);
    let threw = false;
    try {
      assertLoginNotRateLimited(email);
    } catch {
      threw = true;
    }
    clearLoginFailures(email);
    assert(threw, "rate limit did not trip");
  });

  await check("B", "Operators have PIN configured (seed)", async () => {
    const ops = await prisma.user.findMany({
      where: { role: "OPERATOR", isActive: true },
      select: { name: true, pinCode: true },
    });
    for (const o of ops) {
      assert(o.pinCode?.trim(), `${o.name} missing PIN`);
    }
  });

  await check("B", "Charge code scheme", async () => {
    assert(
      projectWbsChargeCode("Atlas Probe", ["1.0", "1.1"]) ===
        "Atlas-Probe-1.0-1.1",
      "wbs path wrong"
    );
    assert(
      chargeCodeFromBudgetName("Production LRIP") === "Production-LRIP",
      "name scheme wrong"
    );
  });

  await check("B", "Module packaging paths", async () => {
    assert(moduleKeyForPath("/work-orders/x") === "manufacturing");
    assert(moduleKeyForPath("/budgets") === "pmo");
    assert(moduleKeyForPath("/hr/timesheet") === null);
    assert(isPathEnabled("/sales", ["pmo"]) === true);
    assert(isPathEnabled("/pmo", ["pmo"]) === false);
  });

  return summary();
}

if (require.main === module) {
  runChunkB()
    .then((s) => process.exit(s.fail ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
