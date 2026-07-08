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
] as const;

export type Role = (typeof ROLES)[number];

export function canAccess(role: string, module: string): boolean {
  if (role === "ADMIN") return true;
  const matrix: Record<string, string[]> = {
    ENGINEERING: ["bom", "work-instructions", "cm", "engineering", "projects", "dashboard"],
    CM: ["bom", "work-instructions", "cm", "engineering", "dashboard"],
    QUALITY: ["quality", "mrb", "inventory", "suppliers", "dashboard", "work-orders"],
    PURCHASING: ["purchasing", "suppliers", "inventory", "value-stream", "dashboard"],
    PRODUCTION: ["work-orders", "work-instructions", "floor", "inventory", "dashboard", "shipping"],
    ACCOUNTING: ["accounting", "projects", "dashboard"],
    HR: ["hr", "dashboard"],
    OPERATOR: ["work-orders", "floor", "dashboard"],
    VIEWER: ["dashboard", "floor", "radiators", "value-stream"],
  };
  return matrix[role]?.includes(module) ?? false;
}
