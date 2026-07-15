import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { randomUUID } from "crypto";

const ADMIN_FOLDER_NAME = "Admin";

export type EcrAttachment = {
  id: string;
  url: string;
  fileName: string;
  caption?: string | null;
  uploadedAt: string;
  uploadedById?: string | null;
  /** When true, this file is the primary drawing released to the library */
  isPrimary?: boolean;
};

export function parseEcrAttachments(raw: string | null | undefined): EcrAttachment[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (a): a is EcrAttachment =>
          !!a &&
          typeof a === "object" &&
          typeof (a as EcrAttachment).url === "string" &&
          typeof (a as EcrAttachment).fileName === "string"
      )
      .map((a) => ({
        id: a.id || randomUUID(),
        url: a.url,
        fileName: a.fileName,
        caption: a.caption ?? null,
        uploadedAt: a.uploadedAt || new Date().toISOString(),
        uploadedById: a.uploadedById ?? null,
        isPrimary: !!a.isPrimary,
      }));
  } catch {
    return [];
  }
}

function serializeEcrAttachments(list: EcrAttachment[]): string {
  return JSON.stringify(list);
}

/** Primary file for library release — explicit primary, else first attachment, else legacy fields. */
export function resolvePrimaryDrawing(cr: {
  documentFileUrl?: string | null;
  documentFileName?: string | null;
  documentAttachments?: string | null;
}): { url: string | null; fileName: string | null } {
  const atts = parseEcrAttachments(cr.documentAttachments);
  const primary = atts.find((a) => a.isPrimary) || atts[0];
  if (primary) {
    return { url: primary.url, fileName: primary.fileName };
  }
  return {
    url: cr.documentFileUrl || null,
    fileName: cr.documentFileName || null,
  };
}

/** Ensure company Admin root exists for internal policies / QMS docs. */
export async function ensureAdminFolder(userId?: string) {
  const existing = await prisma.cmFolder.findFirst({
    where: {
      kind: "ADMIN",
      parentId: null,
      isSystem: true,
    },
  });
  if (existing) return existing;

  // Also match by name if created earlier without flags
  const byName = await prisma.cmFolder.findFirst({
    where: { parentId: null, name: ADMIN_FOLDER_NAME },
  });
  if (byName) {
    return prisma.cmFolder.update({
      where: { id: byName.id },
      data: {
        kind: "ADMIN",
        isSystem: true,
        productName: null,
        description:
          byName.description ||
          "Company internal documents, policies, and QMS records",
        sortOrder: -1,
      },
    });
  }

  return prisma.cmFolder.create({
    data: {
      name: ADMIN_FOLDER_NAME,
      kind: "ADMIN",
      isSystem: true,
      parentId: null,
      productName: null,
      description: "Company internal documents, policies, and QMS records",
      sortOrder: -1,
      createdById: userId || null,
    },
  });
}

/** Ensure the system "Work Instructions" folder (under Admin) for released WI masters. */
export async function ensureWorkInstructionsFolder(userId?: string) {
  const admin = await ensureAdminFolder(userId);
  const existing = await prisma.cmFolder.findFirst({
    where: { parentId: admin.id, name: "Work Instructions" },
  });
  if (existing) return existing;
  return prisma.cmFolder.create({
    data: {
      name: "Work Instructions",
      parentId: admin.id,
      kind: "ADMIN",
      isSystem: true,
      productName: null,
      description: "Released work instruction master copies (CM controlled)",
      sortOrder: 5,
      createdById: userId || null,
    },
  });
}

/**
 * Retain a released work instruction as a CM-controlled master document.
 * Creates (or refreshes) a RELEASED CmDocument of docType WI linked to the WI,
 * and archives the master copies of any prior revisions of the same document
 * number. Called when CM releases a WI so the shop always has one controlled
 * master with a proper revision history.
 */
export async function retainWorkInstructionMaster(params: {
  workInstructionId: string;
  userId?: string;
}) {
  const wi = await prisma.workInstruction.findUnique({
    where: { id: params.workInstructionId },
    include: { part: { select: { partNumber: true } }, _count: { select: { steps: true } } },
  });
  if (!wi) throw new Error("Work instruction not found");

  // Prior masters for this document number (other revisions) still live
  const priors = await prisma.cmDocument.findMany({
    where: {
      docType: "WI",
      number: wi.documentNumber,
      isArchived: false,
      NOT: { workInstructionId: wi.id },
    },
  });

  // Home folder: reuse a prior master's folder, else the Work Instructions folder
  let folderId: string | null =
    priors.find((p) => p.folderId)?.folderId || null;
  if (!folderId) {
    folderId = (await ensureWorkInstructionsFolder(params.userId)).id;
  }

  // Lock + archive prior-revision masters
  if (priors.length > 0) {
    const archive = await ensureArchiveFolder(folderId, params.userId);
    for (const p of priors) {
      await prisma.cmDocument.update({
        where: { id: p.id },
        data: {
          isLocked: true,
          isArchived: true,
          status: "ARCHIVED",
          lockedAt: new Date(),
          folderId: archive.id,
        },
      });
    }
  }

  const data = {
    folderId,
    docType: "WI",
    number: wi.documentNumber,
    title: wi.title,
    revision: wi.revision,
    status: "RELEASED",
    description: `Work instruction master — ${wi._count.steps} step${
      wi._count.steps === 1 ? "" : "s"
    }${wi.part ? ` · part ${wi.part.partNumber}` : ""}. Controlled copy; edit via new revision only.`,
    // CM-style read-only view of the WI
    fileUrl: `/work-instructions/${wi.id}?cm=1`,
    fileName: `${wi.documentNumber} Rev ${wi.revision}`,
    productTag: wi.part?.partNumber || null,
    partId: wi.partId || null,
    bomHeaderId: wi.bomHeaderId || null,
    workInstructionId: wi.id,
    supersedesId: priors[0]?.id || null,
    isLocked: false,
    isArchived: false,
    createdById: params.userId || null,
  };

  const mine = await prisma.cmDocument.findFirst({
    where: { docType: "WI", workInstructionId: wi.id },
  });
  const doc = mine
    ? await prisma.cmDocument.update({ where: { id: mine.id }, data })
    : await prisma.cmDocument.create({ data });

  await logAudit({
    entityType: "CmDocument",
    entityId: doc.id,
    action: "WI_MASTER_RETAINED",
    userId: params.userId,
    metadata: {
      workInstructionId: wi.id,
      number: wi.documentNumber,
      revision: wi.revision,
      archivedPriors: priors.length,
    },
  });

  return doc;
}

/**
 * Create a product root folder, Admin subfolder, or a subfolder under a product.
 * Root-level creates are product folders (not projects).
 */
export async function createCmFolder(params: {
  name: string;
  parentId?: string | null;
  /** PRODUCT (default) | ADMIN — only used at root */
  kind?: "PRODUCT" | "ADMIN";
  productTag?: string | null;
  description?: string | null;
  userId?: string;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Folder name required");

  let parent: {
    id: string;
    kind: string;
    productName: string | null;
    isSystem: boolean;
  } | null = null;

  if (params.parentId) {
    parent = await prisma.cmFolder.findUnique({
      where: { id: params.parentId },
      select: {
        id: true,
        kind: true,
        productName: true,
        isSystem: true,
      },
    });
    if (!parent) throw new Error("Parent folder not found");
  }

  const siblings = await prisma.cmFolder.count({
    where: { parentId: params.parentId || null },
  });

  // Root folder = product (or explicit ADMIN)
  const isRoot = !params.parentId;
  const kind = isRoot
    ? params.kind === "ADMIN"
      ? "ADMIN"
      : "PRODUCT"
    : parent?.kind === "ADMIN"
      ? "ADMIN"
      : "PRODUCT";

  const productName = isRoot
    ? kind === "PRODUCT"
      ? name
      : null
    : parent?.productName || null;

  const folder = await prisma.cmFolder.create({
    data: {
      name,
      parentId: params.parentId || null,
      kind,
      productName,
      productTag:
        params.productTag?.trim() ||
        (isRoot && kind === "PRODUCT" ? name : null),
      description: params.description?.trim() || null,
      isSystem: kind === "ADMIN" && isRoot,
      sortOrder: kind === "ADMIN" && isRoot ? -1 : siblings,
      createdById: params.userId || null,
      projectId: null,
    },
  });

  await logAudit({
    entityType: "CmFolder",
    entityId: folder.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { name, kind, productName },
  });
  return folder;
}

export async function updateCmFolder(params: {
  id: string;
  name?: string;
  projectId?: string | null;
  productTag?: string | null;
  description?: string | null;
  parentId?: string | null;
  userId?: string;
}) {
  const folder = await prisma.cmFolder.update({
    where: { id: params.id },
    data: {
      ...(params.name !== undefined ? { name: params.name.trim() } : {}),
      ...(params.projectId !== undefined
        ? { projectId: params.projectId || null }
        : {}),
      ...(params.productTag !== undefined
        ? { productTag: params.productTag?.trim() || null }
        : {}),
      ...(params.description !== undefined
        ? { description: params.description?.trim() || null }
        : {}),
      ...(params.parentId !== undefined
        ? { parentId: params.parentId || null }
        : {}),
    },
  });
  await logAudit({
    entityType: "CmFolder",
    entityId: folder.id,
    action: "UPDATED",
    userId: params.userId,
  });
  return folder;
}

export async function deleteCmFolder(params: {
  id: string;
  userId?: string;
}) {
  const folder = await prisma.cmFolder.findUnique({ where: { id: params.id } });
  if (!folder) throw new Error("Folder not found");
  if (folder.isSystem || (folder.kind === "ADMIN" && !folder.parentId)) {
    throw new Error("Cannot delete the company Admin folder");
  }

  // Move docs to parent (or root)
  await prisma.cmDocument.updateMany({
    where: { folderId: params.id },
    data: { folderId: folder.parentId },
  });
  // Re-parent children to parent of deleted folder
  await prisma.cmFolder.updateMany({
    where: { parentId: params.id },
    data: { parentId: folder.parentId },
  });
  await prisma.cmFolder.delete({ where: { id: params.id } });
  await logAudit({
    entityType: "CmFolder",
    entityId: params.id,
    action: "DELETED",
    userId: params.userId,
  });
}

/**
 * Library documents (drawings, company policies, procedures) are created only by
 * releaseDocumentEcr after an approved document ECR on CM submissions.
 * Manual create into product/Admin folders is intentionally not supported.
 */

export async function moveCmDocument(params: {
  id: string;
  folderId: string | null;
  userId?: string;
}) {
  const doc = await prisma.cmDocument.update({
    where: { id: params.id },
    data: { folderId: params.folderId },
  });
  await logAudit({
    entityType: "CmDocument",
    entityId: doc.id,
    action: "MOVED",
    userId: params.userId,
    metadata: { folderId: params.folderId },
  });
  return doc;
}

export async function updateCmDocument(params: {
  id: string;
  title?: string;
  revision?: string;
  status?: string;
  description?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  productTag?: string | null;
  userId?: string;
}) {
  const doc = await prisma.cmDocument.update({
    where: { id: params.id },
    data: {
      ...(params.title !== undefined ? { title: params.title.trim() } : {}),
      ...(params.revision !== undefined
        ? { revision: params.revision.trim().toUpperCase() }
        : {}),
      ...(params.status !== undefined
        ? { status: params.status.toUpperCase() }
        : {}),
      ...(params.description !== undefined
        ? { description: params.description }
        : {}),
      ...(params.fileUrl !== undefined ? { fileUrl: params.fileUrl } : {}),
      ...(params.fileName !== undefined ? { fileName: params.fileName } : {}),
      ...(params.productTag !== undefined
        ? { productTag: params.productTag }
        : {}),
    },
  });
  await logAudit({
    entityType: "CmDocument",
    entityId: doc.id,
    action: "UPDATED",
    userId: params.userId,
  });
  return doc;
}

export async function deleteCmDocument(params: {
  id: string;
  userId?: string;
}) {
  await prisma.cmDocument.delete({ where: { id: params.id } });
  await logAudit({
    entityType: "CmDocument",
    entityId: params.id,
    action: "DELETED",
    userId: params.userId,
  });
}

/** Map change-request / WI / BOM statuses onto board columns */
export type CmBoardColumn =
  | "IN_WORK"
  | "SUBMITTED"
  | "IN_REVIEW"
  | "APPROVED"
  | "RELEASED";

export function mapCrToColumn(status: string): CmBoardColumn {
  const s = status.toUpperCase();
  if (s === "DRAFT" || s === "ENGINEERING_REVIEW") return "IN_WORK";
  if (s === "SUBMITTED") return "SUBMITTED";
  if (
    s === "IMPACT_ANALYSIS" ||
    s === "REVIEW_BOARD" ||
    s === "CM_REVIEW" ||
    s === "IN_REVIEW"
  )
    return "IN_REVIEW";
  if (s === "APPROVED") return "APPROVED";
  if (s === "IMPLEMENTED" || s === "CLOSED" || s === "RELEASED")
    return "RELEASED";
  if (s === "REJECTED") return "IN_REVIEW";
  return "IN_WORK";
}

/**
 * Document ECRs enter the board at SUBMITTED (not In work).
 * Map legacy DRAFT document ECRs to the Submitted column.
 */
export function mapDocumentEcrToColumn(status: string): CmBoardColumn {
  const s = status.toUpperCase();
  if (s === "DRAFT" || s === "ENGINEERING_REVIEW") return "SUBMITTED";
  return mapCrToColumn(s);
}

export function mapWiToColumn(status: string): CmBoardColumn {
  const s = status.toUpperCase();
  if (s === "DRAFT" || s === "ENGINEERING_REVIEW") return "IN_WORK";
  if (s === "CM_REVIEW") return "IN_REVIEW";
  if (s === "RELEASED") return "RELEASED";
  if (s === "OBSOLETE") return "RELEASED";
  return "IN_WORK";
}

export function mapBomToColumn(status: string): CmBoardColumn {
  const s = status.toUpperCase();
  if (s === "DRAFT" || s === "PROTOTYPE") return "IN_WORK";
  if (s === "IN_REVIEW") return "IN_REVIEW";
  if (s === "CERTIFIED") return "RELEASED";
  if (s === "OBSOLETE") return "RELEASED";
  return "IN_WORK";
}

export async function moveChangeRequestColumn(params: {
  changeRequestId: string;
  column: CmBoardColumn;
  userId?: string;
}) {
  const statusMap: Record<CmBoardColumn, string> = {
    IN_WORK: "DRAFT",
    SUBMITTED: "SUBMITTED",
    IN_REVIEW: "REVIEW_BOARD",
    APPROVED: "APPROVED",
    RELEASED: "IMPLEMENTED",
  };
  const status = statusMap[params.column];
  const cr = await prisma.changeRequest.update({
    where: { id: params.changeRequestId },
    data: {
      status,
      ...(params.column === "APPROVED" || params.column === "RELEASED"
        ? { decidedAt: new Date() }
        : {}),
    },
  });
  await logAudit({
    entityType: "ChangeRequest",
    entityId: cr.id,
    action: "BOARD_MOVED",
    userId: params.userId,
    metadata: { column: params.column, status },
  });
  return cr;
}

/** Ensure Archive subfolder under a product root or Admin. */
export async function ensureArchiveFolder(
  parentFolderId: string,
  userId?: string
) {
  const parent = await prisma.cmFolder.findUnique({
    where: { id: parentFolderId },
  });
  if (!parent) throw new Error("Parent folder not found");

  // Archive sits under product root (or Admin root)
  let rootId = parent.id;
  if (parent.parentId) {
    // Walk up to root
    let cur = parent;
    while (cur.parentId) {
      const p = await prisma.cmFolder.findUnique({
        where: { id: cur.parentId },
      });
      if (!p) break;
      cur = p;
      rootId = p.id;
    }
  }

  const existing = await prisma.cmFolder.findFirst({
    where: {
      parentId: rootId,
      OR: [{ kind: "ARCHIVE" }, { name: "Archive", isSystem: true }],
    },
  });
  if (existing) {
    if (existing.kind !== "ARCHIVE") {
      return prisma.cmFolder.update({
        where: { id: existing.id },
        data: { kind: "ARCHIVE", isSystem: true },
      });
    }
    return existing;
  }

  return prisma.cmFolder.create({
    data: {
      name: "Archive",
      parentId: rootId,
      kind: "ARCHIVE",
      isSystem: true,
      productName: parent.productName,
      description: "Locked previous document revisions",
      sortOrder: 999,
      createdById: userId || null,
    },
  });
}

/** Search released (current) CM documents by number for update ECR. */
export async function searchCmDocumentsByNumber(query: string, limit = 15) {
  const q = query.trim();
  if (q.length < 1) return [];
  return prisma.cmDocument.findMany({
    where: {
      isArchived: false,
      status: { in: ["RELEASED", "IN_WORK"] },
      number: { contains: q.toUpperCase() },
    },
    orderBy: [{ number: "asc" }, { revision: "desc" }],
    take: limit,
    include: {
      folder: { select: { id: true, name: true, productName: true, kind: true } },
    },
  });
}

/**
 * Create document ECR — creator must name product (or mark company internal).
 * If sourceDocumentId set, copies current CM version as working baseline.
 */
export async function createDocumentEcr(params: {
  title?: string;
  description?: string;
  productFolderId?: string | null;
  productName?: string | null;
  projectId?: string | null;
  isCompanyInternal?: boolean;
  sourceDocumentId?: string | null;
  documentNumber?: string | null;
  documentTitle?: string | null;
  documentRevision?: string | null;
  documentDocType?: string | null;
  documentFileUrl?: string | null;
  documentFileName?: string | null;
  documentDescription?: string | null;
  /** Initial file attachments (drawing PDF, supporting docs) */
  attachments?: {
    url: string;
    fileName: string;
    caption?: string | null;
    isPrimary?: boolean;
  }[];
  /** Drawing defines a BOM — auto-create an in-work BOM for bomPartId and
   *  block release until it is certified */
  includesBom?: boolean;
  bomPartId?: string | null;
  priority?: string;
  userId?: string;
}) {
  await ensureAdminFolder(params.userId);

  let source: Awaited<ReturnType<typeof prisma.cmDocument.findUnique>> = null;
  if (params.sourceDocumentId) {
    source = await prisma.cmDocument.findUnique({
      where: { id: params.sourceDocumentId },
    });
    if (!source) throw new Error("Source document not found");
  }

  let productFolderId = params.productFolderId || null;
  let productName = params.productName?.trim() || null;
  let isCompanyInternal = !!params.isCompanyInternal;

  if (source?.folderId && !productFolderId && !isCompanyInternal) {
    // Inherit product from source folder root
    let folder = await prisma.cmFolder.findUnique({
      where: { id: source.folderId },
    });
    while (folder?.parentId) {
      folder = await prisma.cmFolder.findUnique({
        where: { id: folder.parentId },
      });
    }
    if (folder) {
      if (folder.kind === "ADMIN") {
        isCompanyInternal = true;
        productFolderId = folder.id;
        productName = "Admin / company internal";
      } else {
        productFolderId = folder.id;
        productName = folder.productName || folder.name;
      }
    }
  }

  if (isCompanyInternal) {
    const admin = await ensureAdminFolder(params.userId);
    productFolderId = admin.id;
    productName = productName || "Admin / company internal";
  }

  if (!productName && !productFolderId) {
    throw new Error(
      "Select a product (or mark as company internal / Admin policy)"
    );
  }

  if (productFolderId && !productName) {
    const f = await prisma.cmFolder.findUnique({
      where: { id: productFolderId },
    });
    productName = f?.productName || f?.name || productName;
    if (f?.kind === "ADMIN") isCompanyInternal = true;
  }

  // Next revision if updating
  let documentRevision = params.documentRevision?.trim().toUpperCase() || "A";
  let isDocumentUpdate = false;
  let documentNumber =
    params.documentNumber?.trim().toUpperCase() ||
    source?.number ||
    null;
  const documentTitle =
    params.documentTitle?.trim() || source?.title || params.title?.trim() || "";
  const documentDocType =
    params.documentDocType?.trim().toUpperCase() ||
    source?.docType ||
    "DRAWING";
  let documentFileUrl =
    params.documentFileUrl || source?.fileUrl || null;
  let documentFileName =
    params.documentFileName || source?.fileName || null;
  const documentDescription =
    params.documentDescription || source?.description || null;

  if (source) {
    isDocumentUpdate = true;
    documentNumber = source.number;
    // Suggest next rev letter
    if (/^[A-Z]$/i.test(source.revision)) {
      documentRevision = String.fromCharCode(
        source.revision.toUpperCase().charCodeAt(0) + 1
      );
    } else {
      documentRevision = `${source.revision}.1`;
    }
    if (params.documentRevision?.trim()) {
      documentRevision = params.documentRevision.trim().toUpperCase();
    }
  }

  // Build attachment list (new uploads + carry primary from source if no upload)
  const attachments: EcrAttachment[] = (params.attachments || [])
    .filter((a) => a.url?.trim() && a.fileName?.trim())
    .map((a, i) => ({
      id: randomUUID(),
      url: a.url,
      fileName: a.fileName.trim(),
      caption: a.caption?.trim() || null,
      uploadedAt: new Date().toISOString(),
      uploadedById: params.userId || null,
      isPrimary: a.isPrimary ?? i === 0,
    }));

  if (attachments.length === 0 && documentFileUrl) {
    attachments.push({
      id: randomUUID(),
      url: documentFileUrl,
      fileName: documentFileName || "drawing",
      caption: null,
      uploadedAt: new Date().toISOString(),
      uploadedById: params.userId || null,
      isPrimary: true,
    });
  } else if (
    attachments.length === 0 &&
    source?.fileUrl
  ) {
    attachments.push({
      id: randomUUID(),
      url: source.fileUrl,
      fileName: source.fileName || source.number,
      caption: "Carried from prior release",
      uploadedAt: new Date().toISOString(),
      uploadedById: params.userId || null,
      isPrimary: true,
    });
  }

  // Ensure one primary; sync legacy primary fields for release
  if (attachments.length > 0) {
    const hasPrimary = attachments.some((a) => a.isPrimary);
    if (!hasPrimary) attachments[0].isPrimary = true;
    const primary = attachments.find((a) => a.isPrimary) || attachments[0];
    documentFileUrl = primary.url;
    documentFileName = primary.fileName;
  }

  if (!documentNumber) throw new Error("Document number required");
  if (!documentTitle) throw new Error("Document title required");

  // New document numbers should already be on the master CM list (from a
  // number request). Updates of existing library docs may reuse the number.
  // Legacy free-text still allowed if not on the list (soft guidance).
  if (!isDocumentUpdate) {
    const { markRegistryInUse } = await import("@/lib/services/cm-numbers");
    try {
      await markRegistryInUse({
        number: documentNumber,
        userId: params.userId,
      });
    } catch (e) {
      // Obsolete numbers are hard-blocked; missing entries are allowed (soft)
      if (e instanceof Error && e.message.includes("OBSOLETE")) throw e;
    }
  }

  // ── Drawing includes a BOM: ensure an in-work BOM exists for the part ──
  const includesBom = !!params.includesBom;
  let bomPartId: string | null = null;
  let bomHeaderId: string | null = null;
  let bomAutoCreated = false;
  if (includesBom) {
    if (!params.bomPartId) {
      throw new Error(
        "Select the item this drawing's BOM builds (includes-BOM drawings need a part)"
      );
    }
    const bomPart = await prisma.part.findUnique({
      where: { id: params.bomPartId },
      select: { id: true, partNumber: true },
    });
    if (!bomPart) throw new Error("BOM part not found");
    bomPartId = bomPart.id;

    // Reuse an existing in-work BOM; otherwise auto-create a prototype rev
    const inWork = await prisma.bomHeader.findFirst({
      where: {
        partId: bomPart.id,
        status: { in: ["DRAFT", "PROTOTYPE", "IN_REVIEW"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (inWork) {
      bomHeaderId = inWork.id;
    } else {
      const existingRevs = await prisma.bomHeader.findMany({
        where: { partId: bomPart.id },
        select: { revision: true },
      });
      let nextRev = "A";
      if (existingRevs.length > 0) {
        const letters = existingRevs
          .map((r) => r.revision)
          .filter((r) => /^[A-Z]$/.test(r))
          .sort();
        const last = letters[letters.length - 1];
        nextRev = last
          ? String.fromCharCode(last.charCodeAt(0) + 1)
          : `R${existingRevs.length + 1}`;
      }
      const { createBomRevision } = await import("@/lib/services/bom");
      const created = await createBomRevision({
        partId: bomPart.id,
        revision: nextRev,
        asPrototype: true,
        description: `In-work BOM from drawing ECR — ${
          params.documentNumber || documentNumber || "drawing"
        }`,
        userId: params.userId,
      });
      bomHeaderId = created.id;
      bomAutoCreated = true;
    }
  }

  const count = await prisma.changeRequest.count();
  const number = `ECR-${String(count + 1).padStart(5, "0")}`;

  const title =
    params.title?.trim() ||
    (isDocumentUpdate
      ? `Update ${documentNumber} to Rev ${documentRevision}`
      : `Release ${documentNumber} Rev ${documentRevision}`);

  const description =
    params.description?.trim() ||
    (isDocumentUpdate
      ? `Revise document ${documentNumber} from Rev ${source?.revision} to ${documentRevision}. Product: ${productName}.`
      : `New document ${documentNumber} Rev ${documentRevision}. Product: ${productName}.`);

  // Always land on the Submitted board column (never In work / DRAFT)
  const cr = await prisma.changeRequest.create({
    data: {
      number,
      title,
      description,
      type: documentDocType === "PROCEDURE" ? "PROCESS" : "DRAWING",
      status: "SUBMITTED",
      priority: params.priority || "NORMAL",
      requestedById: params.userId || null,
      productFolderId,
      productName,
      projectId: params.projectId || null,
      isCompanyInternal,
      isDocumentUpdate,
      sourceDocumentId: source?.id || null,
      documentNumber,
      documentTitle,
      documentRevision,
      documentDocType,
      documentFileUrl,
      documentFileName,
      documentDescription,
      documentAttachments:
        attachments.length > 0 ? serializeEcrAttachments(attachments) : null,
      includesBom,
      bomPartId,
      bomHeaderId,
    },
  });

  // Hard guarantee — schema default is DRAFT; never leave a new doc ECR there
  if (cr.status !== "SUBMITTED") {
    await prisma.changeRequest.update({
      where: { id: cr.id },
      data: { status: "SUBMITTED" },
    });
    cr.status = "SUBMITTED";
  }

  await logAudit({
    entityType: "ChangeRequest",
    entityId: cr.id,
    action: "DOCUMENT_ECR_CREATED",
    userId: params.userId,
    metadata: {
      number,
      documentNumber,
      productName,
      isDocumentUpdate,
      status: "SUBMITTED",
      includesBom,
      bomHeaderId,
      bomAutoCreated,
    },
  });

  return cr;
}

/** CM manager assigns exactly two approvers when ECR enters review. */
export async function assignEcrApprovers(params: {
  changeRequestId: string;
  approverUserId1: string;
  approverUserId2: string;
  userId?: string;
}) {
  if (params.approverUserId1 === params.approverUserId2) {
    throw new Error("Assign two different approvers");
  }
  const cr = await prisma.changeRequest.findUnique({
    where: { id: params.changeRequestId },
    include: { boardMembers: true },
  });
  if (!cr) throw new Error("ECR not found");

  // Clear previous approver seats (keep CHAIR if any)
  await prisma.cmBoardMember.deleteMany({
    where: {
      changeRequestId: cr.id,
      role: { in: ["APPROVER", "ENGINEERING", "QUALITY"] },
    },
  });

  await prisma.cmBoardMember.createMany({
    data: [
      {
        changeRequestId: cr.id,
        userId: params.approverUserId1,
        role: "APPROVER",
      },
      {
        changeRequestId: cr.id,
        userId: params.approverUserId2,
        role: "APPROVER",
      },
    ],
  });

  const updated = await prisma.changeRequest.update({
    where: { id: cr.id },
    data: {
      status: "REVIEW_BOARD",
      approversAssignedAt: new Date(),
      boardDate: new Date(),
    },
  });

  await logAudit({
    entityType: "ChangeRequest",
    entityId: cr.id,
    action: "APPROVERS_ASSIGNED",
    userId: params.userId,
    metadata: {
      approvers: [params.approverUserId1, params.approverUserId2],
    },
  });

  return updated;
}

/**
 * CM manager releases approved document ECR into a product (or Admin) folder.
 * - Creates new released CmDocument in target folder
 * - Locks previous revision and moves it to Archive
 * - ECR → IMPLEMENTED (Released column); doc leaves submissions for library
 */
export async function releaseDocumentEcr(params: {
  changeRequestId: string;
  releaseFolderId: string;
  userId?: string;
}) {
  const cr = await prisma.changeRequest.findUnique({
    where: { id: params.changeRequestId },
    include: {
      boardMembers: true,
      sourceDocument: true,
    },
  });
  if (!cr) throw new Error("ECR not found");
  if (cr.status !== "APPROVED" && cr.status !== "REVIEW_BOARD") {
    // Allow release from APPROVED primarily
    if (cr.status !== "APPROVED") {
      throw new Error("ECR must be approved before release");
    }
  }
  if (cr.status === "REVIEW_BOARD") {
    const approvers = cr.boardMembers.filter((m) =>
      ["APPROVER", "ENGINEERING", "QUALITY"].includes(m.role)
    );
    if (approvers.length < 2) {
      throw new Error("Assign two approvers and complete votes first");
    }
    const allOk = approvers.every((m) => m.vote === "APPROVE");
    if (!allOk) throw new Error("Both approvers must approve before release");
  }

  if (!cr.documentNumber || !cr.documentTitle || !cr.documentRevision) {
    throw new Error("ECR missing document number / title / revision");
  }

  // ── Includes-BOM gate: drawing cannot release until its BOM is certified ──
  if (cr.includesBom) {
    const gateBom = cr.bomHeaderId
      ? await prisma.bomHeader.findUnique({
          where: { id: cr.bomHeaderId },
          include: { part: { select: { partNumber: true } } },
        })
      : null;
    if (!gateBom) {
      throw new Error(
        "This drawing includes a BOM but no BOM is linked — link or create the BOM before release"
      );
    }
    if (gateBom.status !== "CERTIFIED") {
      throw new Error(
        `Release blocked — this drawing includes a BOM. BOM ${gateBom.part.partNumber} Rev ${gateBom.revision} is ${gateBom.status}; certify it first.`
      );
    }
  }

  const releaseFolder = await prisma.cmFolder.findUnique({
    where: { id: params.releaseFolderId },
  });
  if (!releaseFolder) throw new Error("Release folder not found");

  // Find current live document with same number (any non-archived released)
  const previous = await prisma.cmDocument.findFirst({
    where: {
      number: cr.documentNumber,
      isArchived: false,
      status: { in: ["RELEASED", "IN_WORK"] },
      ...(cr.sourceDocumentId ? { id: cr.sourceDocumentId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  // Archive previous
  if (previous) {
    // Determine product root for archive
    let rootId = releaseFolder.id;
    if (releaseFolder.parentId) {
      let cur = releaseFolder;
      while (cur.parentId) {
        const p = await prisma.cmFolder.findUnique({
          where: { id: cur.parentId },
        });
        if (!p) break;
        cur = p;
        rootId = p.id;
      }
    }
    const archive = await ensureArchiveFolder(rootId, params.userId);
    await prisma.cmDocument.update({
      where: { id: previous.id },
      data: {
        isLocked: true,
        isArchived: true,
        status: "ARCHIVED",
        lockedAt: new Date(),
        folderId: archive.id,
      },
    });
  }

  const primaryFile = resolvePrimaryDrawing(cr);

  const newDoc = await prisma.cmDocument.create({
    data: {
      folderId: releaseFolder.id,
      docType: cr.documentDocType || "DRAWING",
      number: cr.documentNumber,
      title: cr.documentTitle,
      revision: cr.documentRevision,
      status: "RELEASED",
      description: cr.documentDescription,
      fileUrl: primaryFile.url,
      fileName: primaryFile.fileName,
      productTag:
        releaseFolder.productName ||
        cr.productName ||
        releaseFolder.productTag,
      isLocked: false,
      isArchived: false,
      supersedesId: previous?.id || null,
      createdById: params.userId || null,
      partId: cr.bomPartId || null,
      bomHeaderId: cr.includesBom ? cr.bomHeaderId : null,
    },
  });

  if (previous) {
    await prisma.cmDocument.update({
      where: { id: previous.id },
      data: {
        // supersededBy relation is reverse of supersedesId on newDoc
      },
    });
  }

  const updated = await prisma.changeRequest.update({
    where: { id: cr.id },
    data: {
      status: "IMPLEMENTED",
      releaseFolderId: releaseFolder.id,
      releasedDocumentId: newDoc.id,
      releasedAt: new Date(),
      releasedById: params.userId || null,
      decidedAt: cr.decidedAt || new Date(),
      decisionNotes: [
        cr.decisionNotes,
        `Released to folder "${releaseFolder.name}" as ${newDoc.number} Rev ${newDoc.revision}`,
        previous
          ? `Previous Rev ${previous.revision} locked and archived`
          : null,
      ]
        .filter(Boolean)
        .join(". "),
    },
  });

  await logAudit({
    entityType: "ChangeRequest",
    entityId: cr.id,
    action: "DOCUMENT_RELEASED",
    userId: params.userId,
    metadata: {
      documentId: newDoc.id,
      folderId: releaseFolder.id,
      archivedId: previous?.id,
    },
  });

  // Master number list: mark RELEASED and link to library document
  try {
    const { linkRegistryToReleasedDocument } = await import(
      "@/lib/services/cm-numbers"
    );
    await linkRegistryToReleasedDocument({
      number: newDoc.number,
      cmDocumentId: newDoc.id,
      userId: params.userId,
    });
  } catch {
    /* registry entry may not exist for legacy numbers */
  }

  return { changeRequest: updated, document: newDoc };
}

/** Append files to an open ECR (drawing / supporting docs) while it flows through review. */
export async function addEcrAttachments(params: {
  changeRequestId: string;
  files: { url: string; fileName: string; caption?: string | null }[];
  /** Mark first new file as the primary drawing for release */
  setAsPrimary?: boolean;
  userId?: string;
}) {
  const cr = await prisma.changeRequest.findUnique({
    where: { id: params.changeRequestId },
  });
  if (!cr) throw new Error("ECR not found");
  if (cr.status === "IMPLEMENTED" || cr.status === "CLOSED") {
    throw new Error("Cannot attach files to a released/closed ECR");
  }
  if (!params.files.length) throw new Error("No files provided");

  const existing = parseEcrAttachments(cr.documentAttachments);
  // Seed from legacy primary if empty
  if (
    existing.length === 0 &&
    cr.documentFileUrl &&
    cr.documentFileName
  ) {
    existing.push({
      id: randomUUID(),
      url: cr.documentFileUrl,
      fileName: cr.documentFileName,
      caption: null,
      uploadedAt: cr.createdAt.toISOString(),
      uploadedById: cr.requestedById,
      isPrimary: true,
    });
  }

  if (params.setAsPrimary) {
    for (const a of existing) a.isPrimary = false;
  }

  const added: EcrAttachment[] = params.files
    .filter((f) => f.url?.trim() && f.fileName?.trim())
    .map((f, i) => ({
      id: randomUUID(),
      url: f.url,
      fileName: f.fileName.trim(),
      caption: f.caption?.trim() || null,
      uploadedAt: new Date().toISOString(),
      uploadedById: params.userId || null,
      isPrimary: !!params.setAsPrimary && i === 0,
    }));

  if (!added.length) throw new Error("No valid files");

  const merged = [...existing, ...added];
  if (!merged.some((a) => a.isPrimary)) merged[0].isPrimary = true;

  const primary = merged.find((a) => a.isPrimary) || merged[0];

  const updated = await prisma.changeRequest.update({
    where: { id: cr.id },
    data: {
      documentAttachments: serializeEcrAttachments(merged),
      documentFileUrl: primary.url,
      documentFileName: primary.fileName,
    },
  });

  await logAudit({
    entityType: "ChangeRequest",
    entityId: cr.id,
    action: "ECR_ATTACHMENTS_ADDED",
    userId: params.userId,
    metadata: {
      count: added.length,
      names: added.map((a) => a.fileName),
      setAsPrimary: !!params.setAsPrimary,
    },
  });

  return updated;
}

export async function setEcrPrimaryAttachment(params: {
  changeRequestId: string;
  attachmentId: string;
  userId?: string;
}) {
  const cr = await prisma.changeRequest.findUnique({
    where: { id: params.changeRequestId },
  });
  if (!cr) throw new Error("ECR not found");
  if (cr.status === "IMPLEMENTED" || cr.status === "CLOSED") {
    throw new Error("Cannot change primary file on a released/closed ECR");
  }

  const list = parseEcrAttachments(cr.documentAttachments);
  const hit = list.find((a) => a.id === params.attachmentId);
  if (!hit) throw new Error("Attachment not found");

  for (const a of list) a.isPrimary = a.id === params.attachmentId;

  const updated = await prisma.changeRequest.update({
    where: { id: cr.id },
    data: {
      documentAttachments: serializeEcrAttachments(list),
      documentFileUrl: hit.url,
      documentFileName: hit.fileName,
    },
  });

  await logAudit({
    entityType: "ChangeRequest",
    entityId: cr.id,
    action: "ECR_PRIMARY_ATTACHMENT",
    userId: params.userId,
    metadata: { attachmentId: hit.id, fileName: hit.fileName },
  });

  return updated;
}

/** Discussion note on an ECR (visible to everyone on the board). */
export async function addChangeRequestComment(params: {
  changeRequestId: string;
  body: string;
  userId?: string;
  authorName?: string | null;
}) {
  const body = params.body.trim();
  if (!body) throw new Error("Comment cannot be empty");

  const cr = await prisma.changeRequest.findUnique({
    where: { id: params.changeRequestId },
  });
  if (!cr) throw new Error("ECR not found");

  let authorName = params.authorName?.trim() || null;
  if (!authorName && params.userId) {
    const u = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { name: true },
    });
    authorName = u?.name || null;
  }

  const comment = await prisma.changeRequestComment.create({
    data: {
      changeRequestId: cr.id,
      userId: params.userId || null,
      authorName,
      body,
    },
  });

  await logAudit({
    entityType: "ChangeRequest",
    entityId: cr.id,
    action: "ECR_COMMENT",
    userId: params.userId,
    metadata: { commentId: comment.id },
  });

  return comment;
}
