import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/** Ordered PLM lifecycle phases (stage-gate style). */
export const PRODUCT_LIFECYCLE_PHASES = [
  "CONCEPT",
  "DESIGN",
  "DEVELOPMENT",
  "QUALIFICATION",
  "PRODUCTION",
  "SUSTAINMENT",
  "EOL",
  "OBSOLETE",
] as const;

export type ProductLifecyclePhase = (typeof PRODUCT_LIFECYCLE_PHASES)[number];

export const PRODUCT_STATUSES = [
  "ACTIVE",
  "ON_HOLD",
  "CANCELLED",
  "OBSOLETE",
] as const;

const PHASE_DATE_FIELD: Partial<Record<ProductLifecyclePhase, string>> = {
  CONCEPT: "conceptDate",
  DESIGN: "designStartDate",
  DEVELOPMENT: "developmentStartDate",
  QUALIFICATION: "qualificationStartDate",
  PRODUCTION: "productionReleaseDate",
  SUSTAINMENT: "sustainmentStartDate",
  EOL: "eolDate",
  OBSOLETE: "obsoleteDate",
};

function parseOptionalDate(v: string | null | undefined): Date | null {
  if (!v?.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseOptionalFloat(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

async function nextProductCode(): Promise<string> {
  const count = await prisma.product.count();
  for (let i = 0; i < 30; i++) {
    const code = `PRD-${String(count + 1 + i).padStart(4, "0")}`;
    const clash = await prisma.product.findUnique({ where: { code } });
    if (!clash) return code;
  }
  return `PRD-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Create a PLM product and optionally a matching CM library product folder.
 */
export async function createProduct(params: {
  code?: string | null;
  name: string;
  description?: string | null;
  overview?: string | null;
  productFamily?: string | null;
  productLine?: string | null;
  modelNumber?: string | null;
  revision?: string | null;
  lifecyclePhase?: string | null;
  status?: string | null;
  marketSegment?: string | null;
  customerName?: string | null;
  customerId?: string | null;
  productOwnerId?: string | null;
  engineeringLeadId?: string | null;
  cmOwnerId?: string | null;
  topLevelPartId?: string | null;
  targetCost?: number | null;
  standardCost?: number | null;
  estimatedWeight?: number | null;
  weightUom?: string | null;
  targetLeadDays?: number | null;
  itarControlled?: boolean;
  exportControl?: string | null;
  qualityStandard?: string | null;
  nsn?: string | null;
  cageCode?: string | null;
  regulatoryNotes?: string | null;
  notes?: string | null;
  createCmFolder?: boolean;
  userId?: string | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Product name is required");

  let code = params.code?.trim().toUpperCase() || "";
  if (!code) code = await nextProductCode();
  else {
    const clash = await prisma.product.findUnique({ where: { code } });
    if (clash) throw new Error(`Product code ${code} already exists`);
  }

  const phase = (
    params.lifecyclePhase || "CONCEPT"
  ).toUpperCase() as ProductLifecyclePhase;
  if (!PRODUCT_LIFECYCLE_PHASES.includes(phase)) {
    throw new Error(`Invalid lifecycle phase: ${phase}`);
  }

  const status = (params.status || "ACTIVE").toUpperCase();
  if (!PRODUCT_STATUSES.includes(status as (typeof PRODUCT_STATUSES)[number])) {
    throw new Error(`Invalid status: ${status}`);
  }

  let cmFolderId: string | null = null;
  if (params.createCmFolder !== false) {
    const { createCmFolder } = await import("@/lib/services/cm-library");
    const folder = await createCmFolder({
      name,
      kind: "PRODUCT",
      productTag: code,
      description: `CM library for product ${code} — ${name}`,
      userId: params.userId || undefined,
    });
    // Ensure productName on root
    await prisma.cmFolder.update({
      where: { id: folder.id },
      data: { productName: name, productTag: code },
    });
    cmFolderId = folder.id;
  }

  const now = new Date();
  const dateField = PHASE_DATE_FIELD[phase];
  const phaseDates: Record<string, Date> = { phaseEnteredAt: now };
  if (dateField) phaseDates[dateField] = now;
  if (phase === "CONCEPT") phaseDates.conceptDate = now;

  const product = await prisma.product.create({
    data: {
      code,
      name,
      description: params.description?.trim() || null,
      overview: params.overview?.trim() || null,
      productFamily: params.productFamily?.trim() || null,
      productLine: params.productLine?.trim() || null,
      modelNumber: params.modelNumber?.trim() || null,
      revision: (params.revision || "A").trim().toUpperCase() || "A",
      lifecyclePhase: phase,
      status,
      marketSegment: params.marketSegment?.trim() || null,
      customerName: params.customerName?.trim() || null,
      customerId: params.customerId || null,
      productOwnerId: params.productOwnerId || null,
      engineeringLeadId: params.engineeringLeadId || null,
      cmOwnerId: params.cmOwnerId || null,
      topLevelPartId: params.topLevelPartId || null,
      cmFolderId,
      targetCost: params.targetCost ?? null,
      standardCost: params.standardCost ?? null,
      estimatedWeight: params.estimatedWeight ?? null,
      weightUom: params.weightUom?.trim() || "LB",
      targetLeadDays: params.targetLeadDays ?? null,
      itarControlled: !!params.itarControlled,
      exportControl: params.exportControl?.trim() || "NONE",
      qualityStandard: params.qualityStandard?.trim() || null,
      nsn: params.nsn?.trim() || null,
      cageCode: params.cageCode?.trim() || null,
      regulatoryNotes: params.regulatoryNotes?.trim() || null,
      notes: params.notes?.trim() || null,
      createdById: params.userId || null,
      ...phaseDates,
      lifecycleEvents: {
        create: {
          fromPhase: null,
          toPhase: phase,
          notes: "Product created",
          userId: params.userId || null,
        },
      },
      ...(params.topLevelPartId
        ? {
            partLinks: {
              create: {
                partId: params.topLevelPartId,
                role: "TOP_LEVEL",
                sortOrder: 0,
              },
            },
          }
        : {}),
    },
  });

  await logAudit({
    entityType: "Product",
    entityId: product.id,
    action: "CREATE",
    userId: params.userId,
    metadata: { code: product.code, name: product.name, phase },
  });

  return product;
}

export async function updateProduct(params: {
  id: string;
  name?: string;
  description?: string | null;
  overview?: string | null;
  productFamily?: string | null;
  productLine?: string | null;
  modelNumber?: string | null;
  revision?: string | null;
  status?: string | null;
  marketSegment?: string | null;
  customerName?: string | null;
  customerId?: string | null;
  productOwnerId?: string | null;
  engineeringLeadId?: string | null;
  cmOwnerId?: string | null;
  topLevelPartId?: string | null;
  targetCost?: number | null;
  standardCost?: number | null;
  estimatedWeight?: number | null;
  weightUom?: string | null;
  targetLeadDays?: number | null;
  itarControlled?: boolean;
  exportControl?: string | null;
  qualityStandard?: string | null;
  nsn?: string | null;
  cageCode?: string | null;
  regulatoryNotes?: string | null;
  notes?: string | null;
  conceptDate?: Date | null;
  designStartDate?: Date | null;
  developmentStartDate?: Date | null;
  qualificationStartDate?: Date | null;
  firstArticleDate?: Date | null;
  productionReleaseDate?: Date | null;
  sustainmentStartDate?: Date | null;
  eolDate?: Date | null;
  obsoleteDate?: Date | null;
  userId?: string | null;
}) {
  const existing = await prisma.product.findUnique({ where: { id: params.id } });
  if (!existing) throw new Error("Product not found");

  const name = params.name !== undefined ? params.name.trim() : existing.name;
  if (!name) throw new Error("Product name is required");

  // Sync CM folder name/productName if present
  if (existing.cmFolderId && name !== existing.name) {
    await prisma.cmFolder.update({
      where: { id: existing.cmFolderId },
      data: { name, productName: name },
    });
  }

  const data: Record<string, unknown> = {
    name,
  };

  const strFields = [
    "description",
    "overview",
    "productFamily",
    "productLine",
    "modelNumber",
    "revision",
    "status",
    "marketSegment",
    "customerName",
    "exportControl",
    "qualityStandard",
    "nsn",
    "cageCode",
    "regulatoryNotes",
    "notes",
    "weightUom",
  ] as const;

  for (const f of strFields) {
    if (params[f] !== undefined) {
      const v = params[f];
      if (f === "revision" && typeof v === "string") {
        data[f] = v.trim().toUpperCase() || "A";
      } else if (typeof v === "string") {
        data[f] = v.trim() || null;
      } else {
        data[f] = v;
      }
    }
  }

  if (params.customerId !== undefined) data.customerId = params.customerId || null;
  if (params.productOwnerId !== undefined)
    data.productOwnerId = params.productOwnerId || null;
  if (params.engineeringLeadId !== undefined)
    data.engineeringLeadId = params.engineeringLeadId || null;
  if (params.cmOwnerId !== undefined) data.cmOwnerId = params.cmOwnerId || null;
  if (params.topLevelPartId !== undefined)
    data.topLevelPartId = params.topLevelPartId || null;
  if (params.targetCost !== undefined) data.targetCost = params.targetCost;
  if (params.standardCost !== undefined) data.standardCost = params.standardCost;
  if (params.estimatedWeight !== undefined)
    data.estimatedWeight = params.estimatedWeight;
  if (params.targetLeadDays !== undefined)
    data.targetLeadDays = params.targetLeadDays;
  if (params.itarControlled !== undefined)
    data.itarControlled = params.itarControlled;

  const dateFields = [
    "conceptDate",
    "designStartDate",
    "developmentStartDate",
    "qualificationStartDate",
    "firstArticleDate",
    "productionReleaseDate",
    "sustainmentStartDate",
    "eolDate",
    "obsoleteDate",
  ] as const;
  for (const f of dateFields) {
    if (params[f] !== undefined) data[f] = params[f];
  }

  if (params.status) {
    const st = params.status.toUpperCase();
    if (!PRODUCT_STATUSES.includes(st as (typeof PRODUCT_STATUSES)[number])) {
      throw new Error(`Invalid status: ${st}`);
    }
    data.status = st;
  }

  const product = await prisma.product.update({
    where: { id: params.id },
    data,
  });

  // Keep TOP_LEVEL part link in sync
  if (params.topLevelPartId !== undefined) {
    await prisma.productPart.deleteMany({
      where: { productId: params.id, role: "TOP_LEVEL" },
    });
    if (params.topLevelPartId) {
      await prisma.productPart.upsert({
        where: {
          productId_partId_role: {
            productId: params.id,
            partId: params.topLevelPartId,
            role: "TOP_LEVEL",
          },
        },
        create: {
          productId: params.id,
          partId: params.topLevelPartId,
          role: "TOP_LEVEL",
          sortOrder: 0,
        },
        update: {},
      });
    }
  }

  await logAudit({
    entityType: "Product",
    entityId: product.id,
    action: "UPDATE",
    userId: params.userId,
    metadata: { code: product.code },
  });

  return product;
}

export async function advanceProductLifecycle(params: {
  productId: string;
  toPhase: string;
  notes?: string | null;
  userId?: string | null;
}) {
  const product = await prisma.product.findUnique({
    where: { id: params.productId },
  });
  if (!product) throw new Error("Product not found");

  const toPhase = params.toPhase.toUpperCase() as ProductLifecyclePhase;
  if (!PRODUCT_LIFECYCLE_PHASES.includes(toPhase)) {
    throw new Error(`Invalid lifecycle phase: ${toPhase}`);
  }
  if (toPhase === product.lifecyclePhase) {
    throw new Error(`Product is already in ${toPhase}`);
  }

  const now = new Date();
  const data: {
    lifecyclePhase: string;
    phaseEnteredAt: Date;
    status?: string;
    conceptDate?: Date;
    designStartDate?: Date;
    developmentStartDate?: Date;
    qualificationStartDate?: Date;
    productionReleaseDate?: Date;
    sustainmentStartDate?: Date;
    eolDate?: Date;
    obsoleteDate?: Date;
  } = {
    lifecyclePhase: toPhase,
    phaseEnteredAt: now,
  };

  if (toPhase === "CONCEPT" && !product.conceptDate) data.conceptDate = now;
  if (toPhase === "DESIGN" && !product.designStartDate) data.designStartDate = now;
  if (toPhase === "DEVELOPMENT" && !product.developmentStartDate)
    data.developmentStartDate = now;
  if (toPhase === "QUALIFICATION" && !product.qualificationStartDate)
    data.qualificationStartDate = now;
  if (toPhase === "PRODUCTION" && !product.productionReleaseDate)
    data.productionReleaseDate = now;
  if (toPhase === "SUSTAINMENT" && !product.sustainmentStartDate)
    data.sustainmentStartDate = now;
  if (toPhase === "EOL") {
    if (!product.eolDate) data.eolDate = now;
  }
  if (toPhase === "OBSOLETE") {
    data.status = "OBSOLETE";
    if (!product.obsoleteDate) data.obsoleteDate = now;
  }

  const [updated] = await prisma.$transaction([
    prisma.product.update({
      where: { id: product.id },
      data,
    }),
    prisma.productLifecycleEvent.create({
      data: {
        productId: product.id,
        fromPhase: product.lifecyclePhase,
        toPhase,
        notes: params.notes?.trim() || null,
        userId: params.userId || null,
      },
    }),
  ]);

  await logAudit({
    entityType: "Product",
    entityId: product.id,
    action: "LIFECYCLE",
    userId: params.userId,
    metadata: {
      from: product.lifecyclePhase,
      to: toPhase,
      notes: params.notes,
    },
  });

  return updated;
}

export async function addProductPart(params: {
  productId: string;
  partId: string;
  role?: string;
  notes?: string | null;
  userId?: string | null;
}) {
  const role = (params.role || "RELATED").toUpperCase();
  const link = await prisma.productPart.create({
    data: {
      productId: params.productId,
      partId: params.partId,
      role,
      notes: params.notes?.trim() || null,
    },
  });
  if (role === "TOP_LEVEL") {
    await prisma.product.update({
      where: { id: params.productId },
      data: { topLevelPartId: params.partId },
    });
  }
  return link;
}

export async function removeProductPart(params: {
  id: string;
  userId?: string | null;
}) {
  const link = await prisma.productPart.findUnique({ where: { id: params.id } });
  if (!link) throw new Error("Product part link not found");
  await prisma.productPart.delete({ where: { id: params.id } });
  if (link.role === "TOP_LEVEL") {
    await prisma.product.update({
      where: { id: link.productId },
      data: { topLevelPartId: null },
    });
  }
  return link;
}

export async function addProductDocument(params: {
  productId: string;
  title: string;
  docType?: string;
  number?: string | null;
  revision?: string | null;
  status?: string | null;
  url?: string | null;
  notes?: string | null;
  cmDocumentId?: string | null;
  userId?: string | null;
}) {
  const title = params.title.trim();
  if (!title) throw new Error("Document title required");
  return prisma.productDocument.create({
    data: {
      productId: params.productId,
      title,
      docType: (params.docType || "OTHER").toUpperCase(),
      number: params.number?.trim().toUpperCase() || null,
      revision: params.revision?.trim().toUpperCase() || null,
      status: params.status?.trim().toUpperCase() || null,
      url: params.url?.trim() || null,
      notes: params.notes?.trim() || null,
      cmDocumentId: params.cmDocumentId || null,
    },
  });
}

export async function removeProductDocument(params: { id: string }) {
  return prisma.productDocument.delete({ where: { id: params.id } });
}

export async function addProductRequirement(params: {
  productId: string;
  number?: string | null;
  title: string;
  description?: string | null;
  category?: string;
  status?: string;
  priority?: string;
  source?: string | null;
  verificationMethod?: string | null;
}) {
  const title = params.title.trim();
  if (!title) throw new Error("Requirement title required");

  let number = params.number?.trim().toUpperCase() || "";
  if (!number) {
    const count = await prisma.productRequirement.count({
      where: { productId: params.productId },
    });
    number = `REQ-${String(count + 1).padStart(3, "0")}`;
  }

  return prisma.productRequirement.create({
    data: {
      productId: params.productId,
      number,
      title,
      description: params.description?.trim() || null,
      category: (params.category || "FUNCTIONAL").toUpperCase(),
      status: (params.status || "DRAFT").toUpperCase(),
      priority: (params.priority || "NORMAL").toUpperCase(),
      source: params.source?.trim() || null,
      verificationMethod: params.verificationMethod?.trim().toUpperCase() || null,
    },
  });
}

export async function updateProductRequirement(params: {
  id: string;
  title?: string;
  description?: string | null;
  category?: string;
  status?: string;
  priority?: string;
  source?: string | null;
  verificationMethod?: string | null;
}) {
  return prisma.productRequirement.update({
    where: { id: params.id },
    data: {
      ...(params.title !== undefined ? { title: params.title.trim() } : {}),
      ...(params.description !== undefined
        ? { description: params.description }
        : {}),
      ...(params.category
        ? { category: params.category.toUpperCase() }
        : {}),
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.priority ? { priority: params.priority.toUpperCase() } : {}),
      ...(params.source !== undefined ? { source: params.source } : {}),
      ...(params.verificationMethod !== undefined
        ? {
            verificationMethod: params.verificationMethod
              ? params.verificationMethod.toUpperCase()
              : null,
          }
        : {}),
    },
  });
}

export async function removeProductRequirement(params: { id: string }) {
  return prisma.productRequirement.delete({ where: { id: params.id } });
}

export async function addProductVariant(params: {
  productId: string;
  code: string;
  name: string;
  description?: string | null;
  isDefault?: boolean;
  topLevelPartId?: string | null;
}) {
  const code = params.code.trim().toUpperCase();
  const name = params.name.trim();
  if (!code || !name) throw new Error("Variant code and name required");

  if (params.isDefault) {
    await prisma.productVariant.updateMany({
      where: { productId: params.productId },
      data: { isDefault: false },
    });
  }

  return prisma.productVariant.create({
    data: {
      productId: params.productId,
      code,
      name,
      description: params.description?.trim() || null,
      isDefault: !!params.isDefault,
      topLevelPartId: params.topLevelPartId || null,
    },
  });
}

export async function removeProductVariant(params: { id: string }) {
  return prisma.productVariant.delete({ where: { id: params.id } });
}

export async function addProductMilestone(params: {
  productId: string;
  name: string;
  kind?: string;
  targetDate?: Date | null;
  status?: string;
  notes?: string | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Milestone name required");
  const count = await prisma.productMilestone.count({
    where: { productId: params.productId },
  });
  return prisma.productMilestone.create({
    data: {
      productId: params.productId,
      name,
      kind: (params.kind || "GATE").toUpperCase(),
      targetDate: params.targetDate || null,
      status: (params.status || "PLANNED").toUpperCase(),
      notes: params.notes?.trim() || null,
      sortOrder: count,
    },
  });
}

export async function updateProductMilestone(params: {
  id: string;
  name?: string;
  kind?: string;
  targetDate?: Date | null;
  actualDate?: Date | null;
  status?: string;
  notes?: string | null;
}) {
  return prisma.productMilestone.update({
    where: { id: params.id },
    data: {
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
      ...(params.kind ? { kind: params.kind.toUpperCase() } : {}),
      ...(params.targetDate !== undefined ? { targetDate: params.targetDate } : {}),
      ...(params.actualDate !== undefined ? { actualDate: params.actualDate } : {}),
      ...(params.status ? { status: params.status.toUpperCase() } : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
    },
  });
}

export async function removeProductMilestone(params: { id: string }) {
  return prisma.productMilestone.delete({ where: { id: params.id } });
}

export async function addProductMember(params: {
  productId: string;
  userId: string;
  role?: string;
  notes?: string | null;
}) {
  return prisma.productMember.create({
    data: {
      productId: params.productId,
      userId: params.userId,
      role: (params.role || "OTHER").toUpperCase(),
      notes: params.notes?.trim() || null,
    },
  });
}

export async function removeProductMember(params: { id: string }) {
  return prisma.productMember.delete({ where: { id: params.id } });
}

export async function listProducts(params?: {
  search?: string;
  phase?: string;
  status?: string;
  family?: string;
}) {
  const search = params?.search?.trim();
  return prisma.product.findMany({
    where: {
      ...(params?.phase ? { lifecyclePhase: params.phase } : {}),
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.family ? { productFamily: params.family } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search } },
              { name: { contains: search } },
              { modelNumber: { contains: search } },
              { productFamily: { contains: search } },
              { customerName: { contains: search } },
              { description: { contains: search } },
            ],
          }
        : {}),
    },
    include: {
      topLevelPart: {
        select: { id: true, partNumber: true, description: true, revision: true },
      },
      productOwner: { select: { id: true, name: true } },
      engineeringLead: { select: { id: true, name: true } },
      customer: { select: { id: true, code: true, name: true } },
      _count: {
        select: {
          partLinks: true,
          documentLinks: true,
          requirements: true,
          variants: true,
          milestones: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
}

export async function getProductDetail(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      topLevelPart: {
        include: {
          bomHeaders: {
            where: { status: { in: ["CERTIFIED", "PROTOTYPE", "IN_WORK"] } },
            orderBy: { revision: "desc" },
            take: 5,
          },
        },
      },
      productOwner: { select: { id: true, name: true, role: true } },
      engineeringLead: { select: { id: true, name: true, role: true } },
      cmOwner: { select: { id: true, name: true, role: true } },
      customer: { select: { id: true, code: true, name: true } },
      cmFolder: {
        select: {
          id: true,
          name: true,
          productName: true,
          _count: { select: { documents: true, children: true } },
        },
      },
      lifecycleEvents: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { user: { select: { id: true, name: true } } },
      },
      members: {
        include: { user: { select: { id: true, name: true, role: true } } },
        orderBy: { role: "asc" },
      },
      partLinks: {
        include: {
          part: {
            select: {
              id: true,
              partNumber: true,
              description: true,
              revision: true,
              partType: true,
              sourcingMethod: true,
              itemStructure: true,
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { role: "asc" }],
      },
      documentLinks: { orderBy: [{ sortOrder: "asc" }, { title: "asc" }] },
      variants: {
        include: {
          topLevelPart: {
            select: { id: true, partNumber: true, description: true },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      },
      requirements: {
        orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
      },
      milestones: {
        orderBy: [{ sortOrder: "asc" }, { targetDate: "asc" }],
      },
    },
  });
}

/** Helpers for form parsing */
export function productFieldsFromForm(formData: FormData) {
  return {
    code: ((formData.get("code") as string) || "").trim() || null,
    name: ((formData.get("name") as string) || "").trim(),
    description: ((formData.get("description") as string) || "").trim() || null,
    overview: ((formData.get("overview") as string) || "").trim() || null,
    productFamily:
      ((formData.get("productFamily") as string) || "").trim() || null,
    productLine: ((formData.get("productLine") as string) || "").trim() || null,
    modelNumber: ((formData.get("modelNumber") as string) || "").trim() || null,
    revision: ((formData.get("revision") as string) || "").trim() || null,
    lifecyclePhase:
      ((formData.get("lifecyclePhase") as string) || "").trim() || null,
    status: ((formData.get("status") as string) || "").trim() || null,
    marketSegment:
      ((formData.get("marketSegment") as string) || "").trim() || null,
    customerName:
      ((formData.get("customerName") as string) || "").trim() || null,
    customerId: ((formData.get("customerId") as string) || "").trim() || null,
    productOwnerId:
      ((formData.get("productOwnerId") as string) || "").trim() || null,
    engineeringLeadId:
      ((formData.get("engineeringLeadId") as string) || "").trim() || null,
    cmOwnerId: ((formData.get("cmOwnerId") as string) || "").trim() || null,
    topLevelPartId:
      ((formData.get("topLevelPartId") as string) || "").trim() || null,
    targetCost: parseOptionalFloat(formData.get("targetCost") as string),
    standardCost: parseOptionalFloat(formData.get("standardCost") as string),
    estimatedWeight: parseOptionalFloat(
      formData.get("estimatedWeight") as string
    ),
    weightUom: ((formData.get("weightUom") as string) || "").trim() || null,
    targetLeadDays: parseOptionalInt(formData.get("targetLeadDays") as string),
    itarControlled:
      formData.get("itarControlled") === "on" ||
      formData.get("itarControlled") === "true",
    exportControl:
      ((formData.get("exportControl") as string) || "").trim() || null,
    qualityStandard:
      ((formData.get("qualityStandard") as string) || "").trim() || null,
    nsn: ((formData.get("nsn") as string) || "").trim() || null,
    cageCode: ((formData.get("cageCode") as string) || "").trim() || null,
    regulatoryNotes:
      ((formData.get("regulatoryNotes") as string) || "").trim() || null,
    notes: ((formData.get("notes") as string) || "").trim() || null,
    createCmFolder:
      formData.get("createCmFolder") === "on" ||
      formData.get("createCmFolder") === "true" ||
      formData.get("createCmFolder") === null, // default on when not present for create
    conceptDate: parseOptionalDate(formData.get("conceptDate") as string),
    designStartDate: parseOptionalDate(
      formData.get("designStartDate") as string
    ),
    developmentStartDate: parseOptionalDate(
      formData.get("developmentStartDate") as string
    ),
    qualificationStartDate: parseOptionalDate(
      formData.get("qualificationStartDate") as string
    ),
    firstArticleDate: parseOptionalDate(
      formData.get("firstArticleDate") as string
    ),
    productionReleaseDate: parseOptionalDate(
      formData.get("productionReleaseDate") as string
    ),
    sustainmentStartDate: parseOptionalDate(
      formData.get("sustainmentStartDate") as string
    ),
    eolDate: parseOptionalDate(formData.get("eolDate") as string),
    obsoleteDate: parseOptionalDate(formData.get("obsoleteDate") as string),
  };
}
