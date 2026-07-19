import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/auth";

/** Skip re-running N inserts on every page view (process-local). */
let catalogReady = false;
let groupsReady = false;

/**
 * Ensure permission rows exist. Batch-insert missing only — sequential
 * upserts of the full catalog were timing out SQLite under load.
 */
export async function ensurePermissionCatalog() {
  if (catalogReady) return;
  const existing = await prisma.permission.findMany({
    select: { code: true },
  });
  const have = new Set(existing.map((e) => e.code));
  const missing = PERMISSIONS.filter((p) => !have.has(p.code));
  if (missing.length) {
    await prisma.permission.createMany({
      data: missing.map((p) => ({
        code: p.code,
        name: p.name,
        module: p.module,
      })),
    });
  }
  catalogReady = true;
}

export async function ensureDefaultPermissionGroups() {
  await ensurePermissionCatalog();
  if (groupsReady) return;

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
      code: "GRP_MGR",
      name: "People Managers",
      baseRole: "PM",
      perms: [
        "hr.pto.decide",
        "hr.time.decide",
        "hr.expense.decide",
        "hr.review.manage",
        "hr.goal.manage",
        "approvals.view",
      ],
    },
    {
      code: "GRP_HR",
      name: "Human Resources",
      baseRole: "HR",
      perms: [
        "hr.admin",
        "hr.pto.request",
        "hr.pto.decide",
        "hr.time.decide",
        "hr.expense.decide",
        "hr.review.manage",
        "hr.goal.manage",
        "hr.docs.manage",
        "admin.users.manage",
      ],
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

  // Preload all permission ids in one query
  const allPerms = await prisma.permission.findMany({
    select: { id: true, code: true },
  });
  const permByCode = new Map(allPerms.map((p) => [p.code, p.id]));

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
      const permissionId = permByCode.get(code);
      if (!permissionId) continue;
      await prisma.permissionGroupMember.upsert({
        where: {
          groupId_permissionId: {
            groupId: group.id,
            permissionId,
          },
        },
        create: { groupId: group.id, permissionId },
        update: {},
      });
    }
  }
  groupsReady = true;
}

export async function listPermissionGroups() {
  // Ensure only if groups look empty — avoid write storm on every list
  const groupCount = await prisma.permissionGroup.count();
  if (groupCount === 0 || !groupsReady) {
    try {
      await ensureDefaultPermissionGroups();
    } catch (e) {
      console.error("listPermissionGroups ensure", e);
    }
  }
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

export async function createPermissionGroup(params: {
  name: string;
  code?: string;
  baseRole?: string;
  description?: string;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Group name required");
  const code =
    params.code?.trim() ||
    "GRP_" +
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 24);
  return prisma.permissionGroup.upsert({
    where: { code },
    create: {
      code,
      name,
      baseRole: params.baseRole?.trim() || null,
      description: params.description?.trim() || null,
    },
    update: { name },
  });
}

export async function toggleGroupPermission(params: {
  groupId: string;
  permissionCode: string;
  enabled: boolean;
}) {
  await ensurePermissionCatalog();
  const perm = await prisma.permission.findUnique({
    where: { code: params.permissionCode },
  });
  if (!perm) throw new Error("Unknown permission");
  if (params.enabled) {
    return prisma.permissionGroupMember.upsert({
      where: {
        groupId_permissionId: {
          groupId: params.groupId,
          permissionId: perm.id,
        },
      },
      create: { groupId: params.groupId, permissionId: perm.id },
      update: {},
    });
  }
  return prisma.permissionGroupMember.deleteMany({
    where: { groupId: params.groupId, permissionId: perm.id },
  });
}
