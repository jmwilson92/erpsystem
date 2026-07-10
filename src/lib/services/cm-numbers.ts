import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/** Built-in scheme codes — customers rename/prefix freely but codes stay stable. */
export const CM_NUMBER_CATEGORIES = [
  { code: "PART", name: "Part number", appliesTo: "PART", defaultPrefix: "PN" },
  {
    code: "DRAWING",
    name: "Drawing",
    appliesTo: "DOCUMENT",
    defaultPrefix: "DWG",
  },
  {
    code: "POLICY",
    name: "Company policy",
    appliesTo: "DOCUMENT",
    defaultPrefix: "POL",
  },
  { code: "FORM", name: "Form", appliesTo: "DOCUMENT", defaultPrefix: "FORM" },
  {
    code: "TEST",
    name: "Test / ATP / FAT",
    appliesTo: "DOCUMENT",
    defaultPrefix: "TP",
  },
  { code: "SPEC", name: "Specification", appliesTo: "DOCUMENT", defaultPrefix: "SPEC" },
  {
    code: "PROCEDURE",
    name: "Procedure",
    appliesTo: "DOCUMENT",
    defaultPrefix: "PROC",
  },
  {
    code: "WI",
    name: "Work instruction",
    appliesTo: "DOCUMENT",
    defaultPrefix: "WI",
  },
  {
    code: "OTHER",
    name: "Other document",
    appliesTo: "DOCUMENT",
    defaultPrefix: "DOC",
  },
] as const;

export type CmNumberCategory = (typeof CM_NUMBER_CATEGORIES)[number]["code"];

export function formatNumberFromScheme(params: {
  prefix: string;
  separator: string;
  padLength: number;
  sequence: number;
  suffix?: string | null;
}): string {
  const seq = String(params.sequence).padStart(
    Math.max(1, params.padLength),
    "0"
  );
  const base = `${params.prefix.trim()}${params.separator}${seq}`;
  const suffix = params.suffix?.trim();
  return (suffix ? `${base}${params.separator}${suffix}` : base).toUpperCase();
}

export function schemeExample(scheme: {
  prefix: string;
  separator: string;
  padLength: number;
  nextSequence: number;
  suffix?: string | null;
}): string {
  return formatNumberFromScheme({
    prefix: scheme.prefix,
    separator: scheme.separator,
    padLength: scheme.padLength,
    sequence: scheme.nextSequence,
    suffix: scheme.suffix,
  });
}

/** Ensure default schemes exist (idempotent). Safe to call from pages/actions. */
export async function ensureDefaultNumberSchemes() {
  const existing = await prisma.cmNumberScheme.findMany({
    select: { code: true },
  });
  const have = new Set(existing.map((s) => s.code));
  let sort = 0;
  for (const cat of CM_NUMBER_CATEGORIES) {
    if (have.has(cat.code)) continue;
    const example = formatNumberFromScheme({
      prefix: cat.defaultPrefix,
      separator: "-",
      padLength: cat.code === "PART" ? 5 : 4,
      sequence: 1,
    });
    await prisma.cmNumberScheme.create({
      data: {
        code: cat.code,
        name: cat.name,
        appliesTo: cat.appliesTo,
        prefix: cat.defaultPrefix,
        separator: "-",
        padLength: cat.code === "PART" ? 5 : 4,
        nextSequence: 1,
        example,
        sortOrder: sort++,
        description: `Default ${cat.name.toLowerCase()} numbering scheme — customize prefix/padding for your company.`,
      },
    });
  }
}

export async function listNumberSchemes(activeOnly = false) {
  await ensureDefaultNumberSchemes();
  return prisma.cmNumberScheme.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function updateNumberScheme(params: {
  id: string;
  name?: string;
  description?: string | null;
  prefix?: string;
  separator?: string;
  padLength?: number;
  suffix?: string | null;
  nextSequence?: number;
  isActive?: boolean;
  sortOrder?: number;
  userId?: string;
}) {
  const current = await prisma.cmNumberScheme.findUnique({
    where: { id: params.id },
  });
  if (!current) throw new Error("Number scheme not found");

  const prefix = (params.prefix ?? current.prefix).trim().toUpperCase();
  if (!prefix) throw new Error("Prefix is required");
  const separator =
    params.separator !== undefined ? params.separator : current.separator;
  const padLength =
    params.padLength !== undefined
      ? Math.min(10, Math.max(1, params.padLength))
      : current.padLength;
  const suffix =
    params.suffix !== undefined
      ? params.suffix?.trim().toUpperCase() || null
      : current.suffix;
  const nextSequence =
    params.nextSequence !== undefined
      ? Math.max(1, Math.floor(params.nextSequence))
      : current.nextSequence;

  const example = formatNumberFromScheme({
    prefix,
    separator,
    padLength,
    sequence: nextSequence,
    suffix,
  });

  const updated = await prisma.cmNumberScheme.update({
    where: { id: params.id },
    data: {
      name: params.name?.trim() || current.name,
      description:
        params.description !== undefined
          ? params.description
          : current.description,
      prefix,
      separator,
      padLength,
      suffix,
      nextSequence,
      example,
      isActive:
        params.isActive !== undefined ? params.isActive : current.isActive,
      sortOrder:
        params.sortOrder !== undefined ? params.sortOrder : current.sortOrder,
    },
  });

  await logAudit({
    entityType: "CmNumberScheme",
    entityId: updated.id,
    action: "UPDATE",
    userId: params.userId,
    metadata: {
      summary: `Scheme ${updated.code}: ${updated.prefix}${updated.separator}… next=${updated.nextSequence}`,
    },
  });

  return updated;
}

async function nextRequestNumber(): Promise<string> {
  const count = await prisma.cmNumberRequest.count();
  // Uniqueness under concurrent creates: retry with offset if needed
  for (let i = 0; i < 20; i++) {
    const n = `NREQ-${String(count + 1 + i).padStart(5, "0")}`;
    const clash = await prisma.cmNumberRequest.findUnique({
      where: { requestNumber: n },
    });
    if (!clash) return n;
  }
  return `NREQ-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * User submits a request for a part number or document number.
 * CM manager later assigns the controlled number.
 */
export async function createNumberRequest(params: {
  category: string;
  title: string;
  description?: string | null;
  justification?: string | null;
  preferredNumber?: string | null;
  productName?: string | null;
  productFolderId?: string | null;
  schemeId?: string | null;
  requestedById?: string | null;
  requestedByName?: string | null;
}) {
  await ensureDefaultNumberSchemes();

  const category = params.category.trim().toUpperCase();
  const title = params.title.trim();
  if (!title) throw new Error("Title / description of the item is required");
  if (!category) throw new Error("Category is required");

  let schemeId = params.schemeId || null;
  if (!schemeId) {
    const scheme = await prisma.cmNumberScheme.findFirst({
      where: { code: category, isActive: true },
    });
    schemeId = scheme?.id || null;
  } else {
    const scheme = await prisma.cmNumberScheme.findUnique({
      where: { id: schemeId },
    });
    if (!scheme) throw new Error("Number scheme not found");
    if (!scheme.isActive) throw new Error("Number scheme is inactive");
  }

  const preferred = params.preferredNumber?.trim().toUpperCase() || null;
  if (preferred) {
    const taken = await prisma.cmNumberRegistry.findUnique({
      where: { number: preferred },
    });
    if (taken) {
      throw new Error(
        `${preferred} is already on the master list (${taken.status})`
      );
    }
  }

  const requestNumber = await nextRequestNumber();

  const req = await prisma.cmNumberRequest.create({
    data: {
      requestNumber,
      status: "PENDING",
      category,
      schemeId,
      title,
      description: params.description?.trim() || null,
      justification: params.justification?.trim() || null,
      preferredNumber: preferred,
      productName: params.productName?.trim() || null,
      productFolderId: params.productFolderId || null,
      requestedById: params.requestedById || null,
      requestedByName: params.requestedByName || null,
    },
  });

  await logAudit({
    entityType: "CmNumberRequest",
    entityId: req.id,
    action: "CREATE",
    userId: params.requestedById || undefined,
    metadata: {
      summary: `${req.requestNumber}: request ${category} number for "${title}"`,
    },
  });

  return req;
}

/**
 * CM manager assigns a number to a pending request.
 * Writes the number to the master registry (RESERVED).
 * Auto-issues next sequence from the scheme unless overrideNumber is provided.
 */
export async function assignNumberToRequest(params: {
  requestId: string;
  /** Manual override; if omitted, next number from scheme */
  overrideNumber?: string | null;
  cmNotes?: string | null;
  assignedById?: string | null;
}) {
  const req = await prisma.cmNumberRequest.findUnique({
    where: { id: params.requestId },
    include: { scheme: true },
  });
  if (!req) throw new Error("Number request not found");
  if (req.status !== "PENDING") {
    throw new Error(`Request is ${req.status} — only PENDING can be assigned`);
  }

  let scheme = req.scheme;
  if (!scheme) {
    scheme = await prisma.cmNumberScheme.findFirst({
      where: { code: req.category, isActive: true },
    });
  }
  if (!scheme && !params.overrideNumber?.trim()) {
    throw new Error(
      "No active number scheme for this category — configure schemes or enter a number manually"
    );
  }

  let assignedNumber = params.overrideNumber?.trim().toUpperCase() || null;
  let sequenceValue: number | null = null;

  if (!assignedNumber) {
    // Issue next sequence (retry on rare unique collisions)
    for (let attempt = 0; attempt < 10; attempt++) {
      const fresh = await prisma.cmNumberScheme.findUnique({
        where: { id: scheme!.id },
      });
      if (!fresh) throw new Error("Scheme disappeared");
      const candidate = formatNumberFromScheme({
        prefix: fresh.prefix,
        separator: fresh.separator,
        padLength: fresh.padLength,
        sequence: fresh.nextSequence,
        suffix: fresh.suffix,
      });
      const clash = await prisma.cmNumberRegistry.findUnique({
        where: { number: candidate },
      });
      if (!clash) {
        assignedNumber = candidate;
        sequenceValue = fresh.nextSequence;
        await prisma.cmNumberScheme.update({
          where: { id: fresh.id },
          data: {
            nextSequence: fresh.nextSequence + 1,
            example: formatNumberFromScheme({
              prefix: fresh.prefix,
              separator: fresh.separator,
              padLength: fresh.padLength,
              sequence: fresh.nextSequence + 1,
              suffix: fresh.suffix,
            }),
          },
        });
        break;
      }
      // Sequence already used (manual entry) — bump and retry
      await prisma.cmNumberScheme.update({
        where: { id: fresh.id },
        data: { nextSequence: fresh.nextSequence + 1 },
      });
    }
    if (!assignedNumber) {
      throw new Error("Could not generate a unique number — try a manual override");
    }
  } else {
    const clash = await prisma.cmNumberRegistry.findUnique({
      where: { number: assignedNumber },
    });
    if (clash) {
      throw new Error(
        `${assignedNumber} is already on the master list (${clash.status})`
      );
    }
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const registry = await tx.cmNumberRegistry.create({
      data: {
        number: assignedNumber!,
        category: req.category,
        schemeId: scheme?.id || null,
        title: req.title,
        description: req.description,
        status: "RESERVED",
        productName: req.productName,
        sequenceValue,
        requestId: req.id,
        requestedById: req.requestedById,
        assignedById: params.assignedById || null,
        assignedAt: now,
        notes: params.cmNotes?.trim() || null,
      },
    });

    const updated = await tx.cmNumberRequest.update({
      where: { id: req.id },
      data: {
        status: "ASSIGNED",
        assignedNumber: assignedNumber!,
        assignedAt: now,
        assignedById: params.assignedById || null,
        cmNotes: params.cmNotes?.trim() || null,
        schemeId: scheme?.id || req.schemeId,
      },
    });

    return { request: updated, registry };
  });

  await logAudit({
    entityType: "CmNumberRequest",
    entityId: req.id,
    action: "ASSIGN",
    userId: params.assignedById || undefined,
    metadata: {
      summary: `${req.requestNumber} → ${assignedNumber} (${req.category})`,
    },
  });

  return result;
}

export async function rejectNumberRequest(params: {
  requestId: string;
  reason: string;
  assignedById?: string | null;
}) {
  const req = await prisma.cmNumberRequest.findUnique({
    where: { id: params.requestId },
  });
  if (!req) throw new Error("Number request not found");
  if (req.status !== "PENDING") {
    throw new Error(`Request is ${req.status} — only PENDING can be rejected`);
  }
  const reason = params.reason.trim();
  if (!reason) throw new Error("Rejection reason is required");

  const updated = await prisma.cmNumberRequest.update({
    where: { id: req.id },
    data: {
      status: "REJECTED",
      rejectedReason: reason,
      assignedById: params.assignedById || null,
      assignedAt: new Date(),
    },
  });

  await logAudit({
    entityType: "CmNumberRequest",
    entityId: req.id,
    action: "REJECT",
    userId: params.assignedById || undefined,
    metadata: {
      summary: `${req.requestNumber} rejected: ${reason}`,
    },
  });

  return updated;
}

export async function cancelNumberRequest(params: {
  requestId: string;
  userId?: string | null;
}) {
  const req = await prisma.cmNumberRequest.findUnique({
    where: { id: params.requestId },
  });
  if (!req) throw new Error("Number request not found");
  if (req.status !== "PENDING") {
    throw new Error("Only pending requests can be cancelled");
  }

  return prisma.cmNumberRequest.update({
    where: { id: req.id },
    data: { status: "CANCELLED" },
  });
}

/**
 * CM can manually register a number (migration / bootstrap) without a request.
 */
export async function registerNumberManually(params: {
  number: string;
  category: string;
  title: string;
  description?: string | null;
  productName?: string | null;
  notes?: string | null;
  status?: string;
  assignedById?: string | null;
  schemeId?: string | null;
}) {
  await ensureDefaultNumberSchemes();
  const number = params.number.trim().toUpperCase();
  if (!number) throw new Error("Number is required");
  const category = params.category.trim().toUpperCase();
  const title = params.title.trim();
  if (!title) throw new Error("Title is required");

  const clash = await prisma.cmNumberRegistry.findUnique({ where: { number } });
  if (clash) throw new Error(`${number} is already on the master list`);

  let schemeId = params.schemeId || null;
  if (!schemeId) {
    const s = await prisma.cmNumberScheme.findFirst({
      where: { code: category },
    });
    schemeId = s?.id || null;
  }

  const entry = await prisma.cmNumberRegistry.create({
    data: {
      number,
      category,
      schemeId,
      title,
      description: params.description?.trim() || null,
      status: (params.status || "ACTIVE").toUpperCase(),
      productName: params.productName?.trim() || null,
      notes: params.notes?.trim() || null,
      assignedById: params.assignedById || null,
      assignedAt: new Date(),
    },
  });

  await logAudit({
    entityType: "CmNumberRegistry",
    entityId: entry.id,
    action: "CREATE",
    userId: params.assignedById || undefined,
    metadata: {
      summary: `Manual register ${number} (${category}): ${title}`,
    },
  });

  return entry;
}

export async function updateRegistryStatus(params: {
  id: string;
  status: string;
  notes?: string | null;
  userId?: string;
}) {
  const status = params.status.trim().toUpperCase();
  const allowed = ["RESERVED", "ACTIVE", "RELEASED", "OBSOLETE"];
  if (!allowed.includes(status)) {
    throw new Error(`Status must be one of: ${allowed.join(", ")}`);
  }
  const entry = await prisma.cmNumberRegistry.update({
    where: { id: params.id },
    data: {
      status,
      notes:
        params.notes !== undefined
          ? params.notes
          : undefined,
    },
  });
  await logAudit({
    entityType: "CmNumberRegistry",
    entityId: entry.id,
    action: "UPDATE",
    userId: params.userId,
    metadata: { summary: `${entry.number} → ${status}` },
  });
  return entry;
}

/**
 * When a document ECR is filed with a controlled number, mark registry ACTIVE.
 * Call from createDocumentEcr (best-effort).
 */
export async function markRegistryInUse(params: {
  number: string;
  userId?: string;
}) {
  const number = params.number.trim().toUpperCase();
  if (!number) return null;
  const entry = await prisma.cmNumberRegistry.findUnique({ where: { number } });
  if (!entry) return null;
  if (entry.status === "OBSOLETE") {
    throw new Error(
      `${number} is OBSOLETE on the master list and cannot be used on a new ECR`
    );
  }
  if (entry.status === "RESERVED" || entry.status === "ACTIVE") {
    return prisma.cmNumberRegistry.update({
      where: { id: entry.id },
      data: { status: "ACTIVE" },
    });
  }
  return entry;
}

/**
 * When a document is released into the library, link registry + set RELEASED.
 */
export async function linkRegistryToReleasedDocument(params: {
  number: string;
  cmDocumentId: string;
  userId?: string;
}) {
  const number = params.number.trim().toUpperCase();
  const entry = await prisma.cmNumberRegistry.findUnique({ where: { number } });
  if (!entry) return null;
  return prisma.cmNumberRegistry.update({
    where: { id: entry.id },
    data: {
      status: "RELEASED",
      cmDocumentId: params.cmDocumentId,
    },
  });
}

export async function listNumberRequests(params?: {
  status?: string;
  limit?: number;
}) {
  return prisma.cmNumberRequest.findMany({
    where: params?.status ? { status: params.status } : undefined,
    include: {
      scheme: true,
      registryEntry: true,
    },
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 200,
  });
}

export async function listNumberRegistry(params?: {
  category?: string;
  status?: string;
  search?: string;
  limit?: number;
}) {
  const search = params?.search?.trim();
  return prisma.cmNumberRegistry.findMany({
    where: {
      ...(params?.category ? { category: params.category } : {}),
      ...(params?.status ? { status: params.status } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search } },
              { title: { contains: search } },
              { productName: { contains: search } },
            ],
          }
        : {}),
    },
    include: {
      scheme: { select: { id: true, code: true, name: true, prefix: true } },
      request: {
        select: {
          id: true,
          requestNumber: true,
          requestedByName: true,
          status: true,
        },
      },
    },
    orderBy: [{ number: "asc" }],
    take: params?.limit ?? 500,
  });
}

/** Numbers the requester can use on a new ECR (RESERVED or ACTIVE, not obsolete). */
export async function listAvailableNumbersForEcr(params?: {
  category?: string;
  search?: string;
}) {
  const search = params?.search?.trim().toUpperCase();
  return prisma.cmNumberRegistry.findMany({
    where: {
      status: { in: ["RESERVED", "ACTIVE"] },
      ...(params?.category ? { category: params.category } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search } },
              { title: { contains: search } },
            ],
          }
        : {}),
    },
    orderBy: { number: "asc" },
    take: 100,
  });
}

export async function previewNextNumber(schemeId: string): Promise<string | null> {
  const scheme = await prisma.cmNumberScheme.findUnique({
    where: { id: schemeId },
  });
  if (!scheme) return null;
  return schemeExample(scheme);
}
