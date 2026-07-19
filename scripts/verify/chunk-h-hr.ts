import { check, assert, prisma, summary, resetResults, userByRole } from "./lib";
import { userHasPermission } from "../../src/lib/auth";

export async function runChunkH() {
  resetResults();
  console.log("\n═══ Chunk H: HR & timesheets ═══");

  await check("H", "Timesheets queryable", async () => {
    await prisma.timesheet.findMany({ take: 10 });
  });

  await check("H", "HR role can admin or time decide", async () => {
    const hr = await userByRole("HR");
    const admin = await userHasPermission(hr.id, "hr.admin");
    const time = await userHasPermission(hr.id, "hr.time.decide");
    assert(admin || time, "HR lacks time/admin perms");
  });

  await check("H", "Everyone can request PTO", async () => {
    const op = await userByRole("OPERATOR");
    assert(await userHasPermission(op.id, "hr.pto.request"), "no pto.request");
  });

  await check("H", "Users have departments/titles populated for seed", async () => {
    const withDept = await prisma.user.count({
      where: { department: { not: null } },
    });
    assert(withDept > 0, "no departments on users");
  });

  return summary();
}

if (require.main === module) {
  runChunkH()
    .then((s) => process.exit(s.fail ? 1 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
