import { prisma } from "./db";

/** Demo auth — returns a default user by role. Replace with real auth in production. */
export async function getCurrentUser(roleHint?: string) {
  const role = roleHint || process.env.DEMO_USER_ROLE || "ADMIN";
  const user = await prisma.user.findFirst({
    where: { role, isActive: true },
  });
  if (user) return user;
  return prisma.user.findFirst({ where: { isActive: true } });
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function listUsers() {
  return prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
}

export const ROLES = [
  "ADMIN",
  "ENGINEERING",
  "CM",
  "QUALITY",
  "PURCHASING",
  "PRODUCTION",
  "ACCOUNTING",
  "HR",
  "OPERATOR",
  "VIEWER",
  "PM",
  "EXECUTIVE", // CEO / CFO / COO / VP
] as const;

export type Role = (typeof ROLES)[number];

/** Catalog of permission codes used across modules. */
export const PERMISSIONS = [
  { code: "engineering.lane.manage", name: "Manage swim lanes", module: "engineering" },
  { code: "engineering.task.create", name: "Create eng tasks", module: "engineering" },
  { code: "engineering.task.scan", name: "Scan into tasks", module: "engineering" },
  { code: "pmo.quarter.manage", name: "Manage PI quarters/sprints", module: "pmo" },
  { code: "pmo.project.manage", name: "Manage projects", module: "pmo" },
  { code: "pmo.alerts.read", name: "Read PM dependency alerts", module: "pmo" },
  { code: "leadership.priority.manage", name: "Publish business priorities", module: "leadership" },
  { code: "leadership.priority.read", name: "Read business priorities", module: "leadership" },
  { code: "accounting.journal.post", name: "Post journal entries", module: "accounting" },
  { code: "accounting.reports.read", name: "View GAAP reports", module: "accounting" },
  { code: "cm.ecr.manage", name: "Manage ECRs", module: "cm" },
  { code: "admin.permissions", name: "Assign permissions", module: "admin" },
] as const;

export function canAccess(role: string, module: string): boolean {
  if (role === "ADMIN") return true;
  const matrix: Record<string, string[]> = {
    ENGINEERING: [
      "bom",
      "work-instructions",
      "cm",
      "products",
      "engineering",
      "projects",
      "pmo",
      "dashboard",
      "sales",
      "leadership",
    ],
    CM: [
      "bom",
      "work-instructions",
      "cm",
      "products",
      "quality",
      "engineering",
      "dashboard",
      "leadership",
    ],
    QUALITY: [
      "quality",
      "mrb",
      "cm",
      "inventory",
      "suppliers",
      "dashboard",
      "work-orders",
      "test-center",
      "receiving",
      "leadership",
    ],
    PURCHASING: [
      "purchasing",
      "suppliers",
      "inventory",
      "value-stream",
      "dashboard",
      "sales",
      "customers",
      "leadership",
    ],
    PRODUCTION: [
      "work-orders",
      "work-instructions",
      "floor",
      "inventory",
      "dashboard",
      "shipping",
      "kitting",
      "sales",
      "customers",
      "test-center",
      "workcenters",
      "leadership",
    ],
    ACCOUNTING: [
      "accounting",
      "projects",
      "pmo",
      "dashboard",
      "leadership",
    ],
    HR: ["hr", "dashboard", "leadership"],
    OPERATOR: [
      "work-orders",
      "floor",
      "dashboard",
      "kitting",
      "test-center",
      "leadership",
    ],
    VIEWER: [
      "dashboard",
      "floor",
      "radiators",
      "value-stream",
      "sales",
      "test-center",
      "leadership",
    ],
    PM: ["pmo", "projects", "engineering", "products", "dashboard", "leadership", "cm"],
    EXECUTIVE: [
      "leadership",
      "dashboard",
      "pmo",
      "accounting",
      "products",
      "engineering",
      "sales",
      "projects",
    ],
  };
  return matrix[role]?.includes(module) ?? false;
}

/** Check fine-grained permission (group + direct grants). ADMIN always true. */
export async function userHasPermission(
  userId: string | undefined | null,
  permissionCode: string
): Promise<boolean> {
  if (!userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user) return false;
  if (user.role === "ADMIN") return true;

  // Explicit deny
  const direct = await prisma.userPermission.findFirst({
    where: {
      userId,
      permission: { code: permissionCode },
    },
    include: { permission: true },
  });
  if (direct && !direct.allowed) return false;
  if (direct?.allowed) return true;

  const viaGroup = await prisma.userPermissionGroup.findFirst({
    where: {
      userId,
      group: {
        permissions: { some: { permission: { code: permissionCode } } },
      },
    },
  });
  if (viaGroup) return true;

  // Role defaults for key permissions
  const roleDefaults: Record<string, string[]> = {
    PM: ["pmo.alerts.read", "pmo.project.manage", "leadership.priority.read"],
    EXECUTIVE: [
      "leadership.priority.manage",
      "leadership.priority.read",
      "accounting.reports.read",
      "pmo.alerts.read",
    ],
    ACCOUNTING: ["accounting.journal.post", "accounting.reports.read"],
    ENGINEERING: [
      "engineering.task.create",
      "engineering.task.scan",
      "leadership.priority.read",
    ],
    ADMIN: PERMISSIONS.map((p) => p.code),
  };
  return roleDefaults[user.role]?.includes(permissionCode) ?? false;
}

export async function requirePermission(
  permissionCode: string,
  roleHint?: string
) {
  const user = await getCurrentUser(roleHint);
  const ok = await userHasPermission(user?.id, permissionCode);
  if (!ok && user?.role !== "ADMIN") {
    // Soft gate in demo: allow ADMIN via role; others need grant
    if (user?.role === "ADMIN") return user;
    throw new Error(`Permission denied: ${permissionCode}`);
  }
  return user;
}
