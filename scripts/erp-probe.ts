import { prisma } from "../src/lib/db";
import { userHasPermission } from "../src/lib/auth";

async function main() {
  const users = await prisma.user.count();
  const sos = await prisma.salesOrder.count();
  const wos = await prisma.workOrder.count();
  const budgets = await prisma.budget.count();
  const enactedNoCode = await prisma.budget.count({
    where: { status: "ENACTED", OR: [{ chargeCode: null }, { chargeCode: "" }] },
  });
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  const op = await prisma.user.findFirst({
    where: { role: "OPERATOR", isActive: true },
    select: { id: true },
  });
  console.log({ users, sos, wos, budgets, enactedNoCode });
  if (admin) {
    console.log("admin bom.certify", await userHasPermission(admin.id, "bom.certify"));
  }
  if (op) {
    console.log("op bom.certify", await userHasPermission(op.id, "bom.certify"));
    console.log("op budgets.manage", await userHasPermission(op.id, "budgets.manage"));
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
