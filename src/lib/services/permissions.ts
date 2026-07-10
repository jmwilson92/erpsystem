import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/auth";

export async function ensurePermissionCatalog() {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        name: p.name,
        module: p.module,
      },
      update: { name: p.name, module: p.module },
    });
  }
}

export async function ensureDefaultPermissionGroups() {
  await ensurePermissionCatalog();
  const defaults: {
    code: string;
    name: string;
    baseRole: string;
    perms: string[];
  }[] = [
    {
      code: "GRP_PM",
      name: "Project Managers",
      baseRole: "PM",
      perms: [
        "pmo.alerts.read",
        "pmo.project.manage",
        "pmo.quarter.manage",
        "leadership.priority.read",
        "engineering.task.create",
      ],
    },
    {
      code: "GRP_EXEC",
      name: "Senior Leadership",
      baseRole: "EXECUTIVE",
      perms: [
        "leadership.priority.manage",
        "leadership.priority.read",
        "accounting.reports.read",
        "pmo.alerts.read",
      ],
    },
    {
      code: "GRP_ACCT",
      name: "Accounting",
      baseRole: "ACCOUNTING",
      perms: ["accounting.journal.post", "accounting.reports.read"],
    },
    {
      code: "GRP_ENG",
      name: "Engineering",
      baseRole: "ENGINEERING",
      perms: [
        "engineering.task.create",
        "engineering.task.scan",
        "leadership.priority.read",
      ],
    },
  ];

  for (const g of defaults) {
    const group = await prisma.permissionGroup.upsert({
      where: { code: g.code },
      create: {
        code: g.code,
        name: g.name,
        baseRole: g.baseRole,
        description: `Default group for ${g.baseRole}`,
      },
      update: { name: g.name },
    });
    for (const code of g.perms) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      if (!perm) continue;
      await prisma.permissionGroupMember.upsert({
        where: {
          groupId_permissionId: {
            groupId: group.id,
            permissionId: perm.id,
          },
        },
        create: { groupId: group.id, permissionId: perm.id },
        update: {},
      });
    }
  }
}

export async function listPermissionGroups() {
  await ensureDefaultPermissionGroups();
  return prisma.permissionGroup.findMany({
    include: {
      permissions: { include: { permission: true } },
      users: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
    orderBy: { name: "asc" },
  });
}

export async function assignUserToGroup(params: {
  userId: string;
  groupId: string;
}) {
  return prisma.userPermissionGroup.upsert({
    where: {
      userId_groupId: {
        userId: params.userId,
        groupId: params.groupId,
      },
    },
    create: { userId: params.userId, groupId: params.groupId },
    update: {},
  });
}

export async function removeUserFromGroup(params: {
  userId: string;
  groupId: string;
}) {
  return prisma.userPermissionGroup.delete({
    where: {
      userId_groupId: {
        userId: params.userId,
        groupId: params.groupId,
      },
    },
  });
}

export async function grantUserPermission(params: {
  userId: string;
  permissionCode: string;
  allowed?: boolean;
}) {
  await ensurePermissionCatalog();
  const perm = await prisma.permission.findUnique({
    where: { code: params.permissionCode },
  });
  if (!perm) throw new Error("Unknown permission");
  return prisma.userPermission.upsert({
    where: {
      userId_permissionId: {
        userId: params.userId,
        permissionId: perm.id,
      },
    },
    create: {
      userId: params.userId,
      permissionId: perm.id,
      allowed: params.allowed !== false,
    },
    update: { allowed: params.allowed !== false },
  });
}
