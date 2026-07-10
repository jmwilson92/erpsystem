import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function listBusinessPriorities(params?: {
  publishedOnly?: boolean;
}) {
  return prisma.businessPriority.findMany({
    where: params?.publishedOnly
      ? { status: "PUBLISHED" }
      : undefined,
    orderBy: [{ status: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
  });
}

export async function upsertBusinessPriority(params: {
  id?: string;
  title: string;
  description?: string | null;
  category?: string;
  priority?: number;
  ownerRole?: string | null;
  status?: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  userId?: string | null;
}) {
  const title = params.title.trim();
  if (!title) throw new Error("Title required");
  const status = (params.status || "DRAFT").toUpperCase();

  if (params.id) {
    return prisma.businessPriority.update({
      where: { id: params.id },
      data: {
        title,
        description: params.description?.trim() || null,
        category: (params.category || "STRATEGIC").toUpperCase(),
        priority: params.priority ?? 1,
        ownerRole: params.ownerRole?.trim() || null,
        status,
        effectiveFrom: params.effectiveFrom || null,
        effectiveTo: params.effectiveTo || null,
        updatedById: params.userId || null,
        publishedAt:
          status === "PUBLISHED" ? new Date() : undefined,
      },
    });
  }

  const count = await prisma.businessPriority.count();
  const number = `BP-${String(count + 1).padStart(3, "0")}`;
  const created = await prisma.businessPriority.create({
    data: {
      number,
      title,
      description: params.description?.trim() || null,
      category: (params.category || "STRATEGIC").toUpperCase(),
      priority: params.priority ?? 1,
      ownerRole: params.ownerRole?.trim() || null,
      status,
      effectiveFrom: params.effectiveFrom || null,
      effectiveTo: params.effectiveTo || null,
      createdById: params.userId || null,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
    },
  });
  await logAudit({
    entityType: "BusinessPriority",
    entityId: created.id,
    action: "CREATE",
    userId: params.userId,
    metadata: { number, title, status },
  });
  return created;
}

export async function setPriorityStatus(params: {
  id: string;
  status: string;
  userId?: string | null;
}) {
  const status = params.status.toUpperCase();
  return prisma.businessPriority.update({
    where: { id: params.id },
    data: {
      status,
      publishedAt: status === "PUBLISHED" ? new Date() : undefined,
      updatedById: params.userId || null,
    },
  });
}
