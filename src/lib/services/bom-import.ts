/**
 * File-sourced BOM import: store the upload, extract a reviewable draft,
 * and on approval create a DRAFT BomHeader (never certified here).
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { extractBomFromFile, extractTabularCompanion, suggestColumnMapping } from "@/lib/bom-import/extract";
import { applyColumnMapping, extractTabularBom } from "@/lib/bom-import/parse-tabular";
import {
  MAX_BOM_IMPORT_BYTES,
  type BomColumnMapping,
  type ExtractedBom,
  type ExtractedBomLine,
  type BomLineFlag,
} from "@/lib/bom-import/types";

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
  ".easm": "application/octet-stream",
  ".edrw": "application/octet-stream",
  ".eprt": "application/octet-stream",
  ".sldasm": "application/octet-stream",
  ".sldprt": "application/octet-stream",
  ".slddrw": "application/octet-stream",
};

export type ReviewLine = ExtractedBomLine & {
  flag: BomLineFlag;
  matchedPartId?: string;
  matchedDescription?: string;
  createNewItem: boolean;
};

type StoredGrid = { mapping: BomColumnMapping; headers: string[]; rows: string[][] };

export function fileToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function mimeForFile(fileName: string, fallback?: string | null): string {
  const ext = fileName.trim().toLowerCase().slice(fileName.lastIndexOf("."));
  return fallback || MIME_BY_EXT[ext] || "application/octet-stream";
}

export async function lookupPartsByNumbers(partNumbers: string[]) {
  const nums = [...new Set(partNumbers.map((p) => p.trim().toUpperCase()).filter(Boolean))];
  if (nums.length === 0) return new Map<string, { id: string; partNumber: string; description: string; uom: string }>();
  const rows = await prisma.part.findMany({
    where: { partNumber: { in: nums } },
    select: { id: true, partNumber: true, description: true, uom: true },
  });
  return new Map(rows.map((r) => [r.partNumber.toUpperCase(), r]));
}

export function flagExtractedLines(
  lines: ExtractedBomLine[],
  parts: Map<string, { id: string; partNumber: string; description: string; uom: string }>
): ReviewLine[] {
  return lines.map((line) => {
    const pn = line.partNumber?.trim().toUpperCase();
    const badQty = line.quantity == null || !(line.quantity > 0);
    if (!pn) {
      return { ...line, partNumber: pn, flag: "INVALID" as const, createNewItem: false, confidence: Math.min(line.confidence, 0.3) };
    }
    const hit = parts.get(pn);
    if (hit) {
      return {
        ...line,
        partNumber: pn,
        flag: badQty ? "NEEDS_REVIEW" : "MATCHED",
        matchedPartId: hit.id,
        matchedDescription: hit.description,
        uom: line.uom || hit.uom,
        createNewItem: false,
        confidence: badQty ? Math.min(line.confidence, 0.5) : Math.max(line.confidence, 0.9),
        notes: badQty ? "Matched the item card, but quantity must be greater than zero." : line.notes,
      };
    }
    return {
      ...line,
      partNumber: pn,
      flag: badQty ? "NEEDS_REVIEW" : "NEW_ITEM",
      createNewItem: true,
      confidence: badQty ? Math.min(line.confidence, 0.45) : Math.min(line.confidence, 0.7),
      notes: badQty
        ? "No matching item card, and quantity must be greater than zero."
        : line.notes || "No item card matches this part number. A new item can be created on approval.",
    };
  });
}

function packGrid(extracted: ExtractedBom): string {
  const grid: StoredGrid = { mapping: extracted.mapping, headers: extracted.headers, rows: extracted.rows };
  return JSON.stringify(grid);
}

function unpackGrid(raw: string | null | undefined): StoredGrid | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredGrid;
    if (!parsed || !Array.isArray(parsed.headers) || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function matchAssembly(partNumber?: string | null) {
  const pn = partNumber?.trim().toUpperCase();
  if (!pn) return { assemblyPartNumber: pn, assemblyPartId: undefined as string | undefined };
  const part = await prisma.part.findUnique({
    where: { partNumber: pn },
    select: { id: true, partNumber: true, description: true, revision: true },
  });
  return {
    assemblyPartNumber: pn,
    assemblyPartId: part?.id,
    assemblyDescription: part?.description,
    assemblyRevision: part?.revision,
  };
}

function previewForStore(extracted: ExtractedBom): string {
  return (extracted.previewText || "").slice(0, 20000);
}

export async function createBomImportFromFile(params: {
  fileName: string;
  bytes: Uint8Array;
  mime?: string | null;
  allowLlm?: boolean;
}) {
  const user = await requirePermission("bom.edit");
  const extracted = await extractBomFromFile({
    fileName: params.fileName,
    bytes: params.bytes,
    mime: params.mime || undefined,
    allowLlm: params.allowLlm,
  });
  const parts = await lookupPartsByNumbers([
    extracted.assemblyPartNumber || "",
    ...extracted.lines.map((l) => l.partNumber || ""),
  ]);
  const flagged = flagExtractedLines(extracted.lines, parts);
  const assembly = await matchAssembly(extracted.assemblyPartNumber);
  const mime = mimeForFile(params.fileName, params.mime);
  const rec = await prisma.bomImport.create({
    data: {
      status: "PENDING_REVIEW",
      sourceKind: extracted.sourceKind,
      parseStatus: extracted.parseStatus,
      fileName: params.fileName,
      fileMime: mime,
      fileUrl: fileToDataUrl(params.bytes, mime),
      fileSizeBytes: params.bytes.byteLength,
      previewText: previewForStore(extracted),
      previewKind: extracted.previewKind,
      columnMapping: packGrid(extracted),
      extractionNotes: extracted.extractionNotes,
      needsExport: extracted.needsExport,
      assemblyPartNumber: assembly.assemblyPartNumber || extracted.assemblyPartNumber || null,
      assemblyDescription: extracted.assemblyDescription || assembly.assemblyDescription || null,
      assemblyRevision: extracted.assemblyRevision || "A",
      assemblyPartId: assembly.assemblyPartId || null,
      createdById: user.id,
      lines: {
        create: flagged.map((l, i) => ({
          sortOrder: l.sortOrder || i + 1,
          level: l.level ?? null,
          findNumber: l.findNumber || null,
          partNumber: l.partNumber || null,
          description: l.description || null,
          revision: l.revision || null,
          quantity: l.quantity ?? null,
          uom: l.uom || null,
          rawText: l.rawText || null,
          confidence: l.confidence,
          flag: l.flag,
          matchedPartId: l.matchedPartId || null,
          createNewItem: l.createNewItem,
          notes: l.notes || null,
        })),
      },
    },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  await logAudit({
    entityType: "BomImport",
    entityId: rec.id,
    action: "CREATED",
    userId: user.id,
    metadata: {
      fileName: params.fileName,
      fileSizeBytes: params.bytes.byteLength,
      sourceKind: extracted.sourceKind,
      lineCount: flagged.length,
      needsExport: extracted.needsExport,
    },
  });
  return rec;
}

export async function attachCompanionFile(params: {
  importId: string;
  fileName: string;
  bytes: Uint8Array;
  mime?: string | null;
}) {
  const user = await requirePermission("bom.edit");
  const existing = await prisma.bomImport.findUnique({ where: { id: params.importId } });
  if (!existing) throw new Error("Import not found");
  if (existing.status !== "PENDING_REVIEW") throw new Error("Only a pending import can accept a companion file");
  if (params.bytes.byteLength > MAX_BOM_IMPORT_BYTES) {
    throw new Error(`Files must be ${Math.round(MAX_BOM_IMPORT_BYTES / (1024 * 1024))} MB or smaller`);
  }
  const extracted = extractTabularCompanion({
    fileName: params.fileName,
    bytes: params.bytes,
    mime: params.mime || undefined,
  } as { fileName: string; bytes: Uint8Array });
  const parts = await lookupPartsByNumbers([
    existing.assemblyPartNumber || extracted.assemblyPartNumber || "",
    ...extracted.lines.map((l) => l.partNumber || ""),
  ]);
  const flagged = flagExtractedLines(extracted.lines, parts);
  const assembly = await matchAssembly(existing.assemblyPartNumber || extracted.assemblyPartNumber);
  const mime = mimeForFile(params.fileName, params.mime);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.bomImportLine.deleteMany({ where: { importId: existing.id } });
    return tx.bomImport.update({
      where: { id: existing.id },
      data: {
        sourceKind: "COMPANION",
        parseStatus: extracted.parseStatus,
        needsExport: false,
        companionFileName: params.fileName,
        companionFileUrl: fileToDataUrl(params.bytes, mime),
        companionFileMime: mime,
        columnMapping: packGrid(extracted),
        previewText: previewForStore(extracted),
        previewKind: extracted.previewKind,
        extractionNotes: `Companion file ${params.fileName} was parsed as the BOM table. Original CAD/drawing file ${existing.fileName} is kept for history.`,
        assemblyPartNumber: assembly.assemblyPartNumber || extracted.assemblyPartNumber || existing.assemblyPartNumber,
        assemblyDescription: existing.assemblyDescription || extracted.assemblyDescription || assembly.assemblyDescription || null,
        assemblyRevision: existing.assemblyRevision || extracted.assemblyRevision || "A",
        assemblyPartId: assembly.assemblyPartId || existing.assemblyPartId,
        lines: {
          create: flagged.map((l, i) => ({
            sortOrder: l.sortOrder || i + 1,
            level: l.level ?? null,
            findNumber: l.findNumber || null,
            partNumber: l.partNumber || null,
            description: l.description || null,
            revision: l.revision || null,
            quantity: l.quantity ?? null,
            uom: l.uom || null,
            rawText: l.rawText || null,
            confidence: l.confidence,
            flag: l.flag,
            matchedPartId: l.matchedPartId || null,
            createNewItem: l.createNewItem,
            notes: l.notes || null,
          })),
        },
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
  });
  await logAudit({
    entityType: "BomImport",
    entityId: existing.id,
    action: "COMPANION_ATTACHED",
    userId: user.id,
    metadata: { fileName: params.fileName, lineCount: flagged.length },
  });
  return updated;
}

export async function remapBomImport(params: { importId: string; mapping: BomColumnMapping }) {
  const user = await requirePermission("bom.edit");
  const existing = await prisma.bomImport.findUnique({ where: { id: params.importId } });
  if (!existing) throw new Error("Import not found");
  if (existing.status !== "PENDING_REVIEW") throw new Error("Only a pending import can be remapped");
  const grid = unpackGrid(existing.columnMapping);
  if (!grid || grid.headers.length === 0) {
    throw new Error("This import has no stored table to remap. Attach an Excel or CSV companion file.");
  }
  const extracted = extractTabularBom({
    family: existing.sourceKind === "CSV" ? "CSV" : "EXCEL",
    headers: grid.headers,
    rows: grid.rows,
    mapping: params.mapping,
  });
  const parts = await lookupPartsByNumbers([
    existing.assemblyPartNumber || extracted.assemblyPartNumber || "",
    ...extracted.lines.map((l) => l.partNumber || ""),
  ]);
  const flagged = flagExtractedLines(extracted.lines, parts);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.bomImportLine.deleteMany({ where: { importId: existing.id } });
    return tx.bomImport.update({
      where: { id: existing.id },
      data: {
        parseStatus: extracted.parseStatus,
        needsExport: false,
        columnMapping: packGrid(extracted),
        extractionNotes: extracted.extractionNotes,
        assemblyPartNumber: existing.assemblyPartNumber || extracted.assemblyPartNumber || null,
        assemblyDescription: existing.assemblyDescription || extracted.assemblyDescription || null,
        lines: {
          create: flagged.map((l, i) => ({
            sortOrder: l.sortOrder || i + 1,
            level: l.level ?? null,
            findNumber: l.findNumber || null,
            partNumber: l.partNumber || null,
            description: l.description || null,
            revision: l.revision || null,
            quantity: l.quantity ?? null,
            uom: l.uom || null,
            rawText: l.rawText || null,
            confidence: l.confidence,
            flag: l.flag,
            matchedPartId: l.matchedPartId || null,
            createNewItem: l.createNewItem,
            notes: l.notes || null,
          })),
        },
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
  });
  await logAudit({
    entityType: "BomImport",
    entityId: existing.id,
    action: "MAPPING_UPDATED",
    userId: user.id,
    metadata: { mapping: params.mapping, lineCount: flagged.length },
  });
  return updated;
}

export type ReviewUpdateLine = {
  id?: string;
  sortOrder?: number;
  level?: number | null;
  findNumber?: string | null;
  partNumber?: string | null;
  description?: string | null;
  revision?: string | null;
  quantity?: number | null;
  uom?: string | null;
  createNewItem?: boolean;
  drop?: boolean;
};

export async function updateBomImportReview(params: {
  importId: string;
  assemblyPartNumber?: string;
  assemblyDescription?: string;
  assemblyRevision?: string;
  lines: ReviewUpdateLine[];
}) {
  const user = await requirePermission("bom.edit");
  const existing = await prisma.bomImport.findUnique({
    where: { id: params.importId },
    include: { lines: true },
  });
  if (!existing) throw new Error("Import not found");
  if (existing.status !== "PENDING_REVIEW") throw new Error("Only a pending import can be edited");

  const kept = params.lines.filter((l) => !l.drop);
  const parts = await lookupPartsByNumbers([
    params.assemblyPartNumber || existing.assemblyPartNumber || "",
    ...kept.map((l) => l.partNumber || ""),
  ]);
  const asExtracted: ExtractedBomLine[] = kept.map((l, i) => ({
    sortOrder: l.sortOrder || i + 1,
    level: l.level ?? undefined,
    findNumber: l.findNumber || undefined,
    partNumber: l.partNumber || undefined,
    description: l.description || undefined,
    revision: l.revision || undefined,
    quantity: l.quantity ?? undefined,
    uom: l.uom || undefined,
    confidence: 0.8,
  }));
  const flagged = flagExtractedLines(asExtracted, parts).map((line, i) => ({
    ...line,
    createNewItem: kept[i]?.createNewItem ?? line.createNewItem,
  }));
  const assemblyPn = (params.assemblyPartNumber || existing.assemblyPartNumber || "").trim().toUpperCase();
  const assemblyHit = assemblyPn ? parts.get(assemblyPn) : undefined;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.bomImportLine.deleteMany({ where: { importId: existing.id } });
    return tx.bomImport.update({
      where: { id: existing.id },
      data: {
        assemblyPartNumber: assemblyPn || null,
        assemblyDescription: params.assemblyDescription?.trim() || existing.assemblyDescription,
        assemblyRevision: (params.assemblyRevision || existing.assemblyRevision || "A").trim() || "A",
        assemblyPartId: assemblyHit?.id || null,
        lines: {
          create: flagged.map((l, i) => ({
            sortOrder: l.sortOrder || i + 1,
            level: l.level ?? null,
            findNumber: l.findNumber || null,
            partNumber: l.partNumber || null,
            description: l.description || null,
            revision: l.revision || null,
            quantity: l.quantity ?? null,
            uom: l.uom || null,
            rawText: l.rawText || null,
            confidence: l.confidence,
            flag: l.flag,
            matchedPartId: l.matchedPartId || null,
            createNewItem: l.createNewItem,
            notes: l.notes || null,
          })),
        },
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
  });
  await logAudit({
    entityType: "BomImport",
    entityId: existing.id,
    action: "REVIEW_UPDATED",
    userId: user.id,
    metadata: { lineCount: flagged.length, assemblyPartNumber: assemblyPn || null },
  });
  return updated;
}

export async function discardBomImport(importId: string) {
  const user = await requirePermission("bom.edit");
  const existing = await prisma.bomImport.findUnique({ where: { id: importId } });
  if (!existing) throw new Error("Import not found");
  if (existing.status === "APPROVED") throw new Error("An approved import cannot be discarded");
  const updated = await prisma.bomImport.update({
    where: { id: importId },
    data: { status: "DISCARDED", reviewedAt: new Date(), reviewedById: user.id },
  });
  await logAudit({ entityType: "BomImport", entityId: importId, action: "DISCARDED", userId: user.id });
  return updated;
}

export async function approveBomImport(importId: string) {
  const user = await requirePermission("bom.edit");
  const existing = await prisma.bomImport.findUnique({
    where: { id: importId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!existing) throw new Error("Import not found");
  if (existing.status !== "PENDING_REVIEW") throw new Error("Only a pending import can be approved");
  if (existing.needsExport && existing.lines.length === 0) {
    throw new Error("Export the BOM table to Excel or a text PDF and attach it before approving.");
  }
  const assemblyPn = (existing.assemblyPartNumber || "").trim().toUpperCase();
  const assemblyDesc = (existing.assemblyDescription || "").trim();
  const assemblyRev = (existing.assemblyRevision || "A").trim() || "A";
  if (!assemblyPn) throw new Error("Enter the assembly part number before approving");
  if (!assemblyDesc) throw new Error("Enter the assembly description before approving");

  const lines = existing.lines;
  if (lines.length === 0) throw new Error("Add at least one component line before approving");
  for (const line of lines) {
    const pn = (line.partNumber || "").trim();
    if (!pn) throw new Error("Every line needs a part number. Remove blank rows or fill them in.");
    if (line.quantity == null || !(line.quantity > 0)) {
      throw new Error(`Quantity must be greater than zero for ${pn}`);
    }
    if (pn === assemblyPn) throw new Error("The BOM cannot include the assembly as a component");
    if (line.flag === "NEW_ITEM" && !line.createNewItem) {
      throw new Error(`Check “create new item” for ${pn}, or remove that line`);
    }
    if (line.flag === "INVALID") throw new Error(`Fix or remove the invalid line (${pn || "missing part number"})`);
  }

  const company = await prisma.companySettings.findUnique({
    where: { id: "default" },
    select: { bomPrototypeRequired: true },
  });
  const prototypeRequired = company?.bomPrototypeRequired ?? true;

  const bom = await prisma.$transaction(async (tx) => {
    let assembly = await tx.part.findUnique({ where: { partNumber: assemblyPn } });
    if (!assembly) {
      assembly = await tx.part.create({
        data: {
          partNumber: assemblyPn,
          description: assemblyDesc,
          revision: assemblyRev,
          sourcingMethod: "BUILD",
          itemStructure: "TOP_LEVEL_ASSEMBLY",
          partType: "MAKE",
          uom: "EA",
        },
      });
    }
    const clash = await tx.bomHeader.findUnique({
      where: { partId_revision: { partId: assembly.id, revision: assemblyRev } },
    });
    if (clash) {
      throw new Error(`Revision ${assemblyRev} already exists for ${assemblyPn}. Choose a new revision before approving.`);
    }

    const createdLines: { componentPartId: string; quantity: number; uom: string; findNumber?: string; notes?: string }[] = [];
    for (const line of lines) {
      const pn = (line.partNumber || "").trim().toUpperCase();
      let part = await tx.part.findUnique({ where: { partNumber: pn } });
      if (!part) {
        part = await tx.part.create({
          data: {
            partNumber: pn,
            description: (line.description || pn).trim(),
            revision: (line.revision || "A").trim() || "A",
            sourcingMethod: "PURCHASE",
            itemStructure: "N_A",
            partType: "BUY",
            uom: (line.uom || "EA").trim().toUpperCase() || "EA",
          },
        });
      }
      createdLines.push({
        componentPartId: part.id,
        quantity: line.quantity as number,
        uom: (line.uom || part.uom || "EA").trim().toUpperCase() || "EA",
        findNumber: line.findNumber || undefined,
        notes: [line.notes, line.revision ? `Rev ${line.revision}` : "", line.level != null ? `Level ${line.level}` : ""]
          .filter(Boolean)
          .join(" · ") || undefined,
      });
    }

    const header = await tx.bomHeader.create({
      data: {
        partId: assembly.id,
        revision: assemblyRev,
        status: "DRAFT",
        prototypeRequired,
        isPrototype: false,
        description: `Imported from ${existing.companionFileName || existing.fileName}`,
        sourceFileName: existing.companionFileName || existing.fileName,
        sourceFileUrl: existing.companionFileUrl || existing.fileUrl,
        sourceKind: existing.sourceKind,
        importedAt: new Date(),
        importedById: user.id,
        lines: {
          create: createdLines.map((l, i) => ({
            componentPartId: l.componentPartId,
            quantity: l.quantity,
            uom: l.uom,
            findNumber: l.findNumber,
            notes: l.notes,
            sortOrder: i + 1,
          })),
        },
      },
      include: { part: true, lines: { include: { componentPart: true }, orderBy: { sortOrder: "asc" } } },
    });

    await tx.bomImport.update({
      where: { id: existing.id },
      data: {
        status: "APPROVED",
        bomHeaderId: header.id,
        assemblyPartId: assembly.id,
        reviewedAt: new Date(),
        reviewedById: user.id,
        needsExport: false,
        parseStatus: "PARSED",
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "BomHeader",
        entityId: header.id,
        action: "IMPORTED",
        userId: user.id,
        changes: JSON.stringify({
          importId: existing.id,
          fileName: existing.companionFileName || existing.fileName,
          sourceKind: existing.sourceKind,
          revision: assemblyRev,
          certificationPath: prototypeRequired ? "PROTOTYPE" : "DIRECT",
          status: "DRAFT",
          lineCount: createdLines.length,
        }),
      },
    });
    return header;
  });

  return bom;
}

export async function getBomImport(id: string) {
  return prisma.bomImport.findUnique({
    where: { id },
    include: { lines: { orderBy: { sortOrder: "asc" } }, bomHeader: { include: { part: true } } },
  });
}

export { suggestColumnMapping };
