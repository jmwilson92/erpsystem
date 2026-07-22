import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { ensureAdminFolder } from "@/lib/services/cm-library";

/**
 * Quality-program policies live in Config Management as controlled documents
 * (docType POLICY) so they revise through the same CM process as work
 * instructions and test procedures. Each program links to its policy doc so it
 * stays clickable from the module.
 */

async function ensureQualityPoliciesFolder(userId?: string) {
  const admin = await ensureAdminFolder(userId);
  const existing = await prisma.cmFolder.findFirst({
    where: { parentId: admin.id, name: "Quality Program Policies" },
  });
  if (existing) return existing;
  return prisma.cmFolder.create({
    data: {
      name: "Quality Program Policies",
      parentId: admin.id,
      kind: "ADMIN",
      isSystem: true,
      description: "QMS program policies (CM controlled)",
      sortOrder: 6,
      createdById: userId || null,
    },
  });
}

/**
 * Create (or update) a program's policy document in CM and link it to the
 * program. New policies enter CM as IN_WORK; revisions are then managed through
 * the CM library like any other controlled document.
 */
export async function saveProgramPolicy(params: {
  programId: string;
  fileUrl: string;
  fileName: string;
  userId?: string;
}) {
  const program = await prisma.qualityProgram.findUnique({ where: { id: params.programId } });
  if (!program) throw new Error("Program not found");
  if (!params.fileUrl) throw new Error("Attach the policy document");

  const number = program.policyNumber || `QP-${program.key.toUpperCase()}-001`;
  const title = `${program.name} — Program Policy`;

  let doc;
  if (program.policyCmDocId) {
    doc = await prisma.cmDocument.update({
      where: { id: program.policyCmDocId },
      data: { fileUrl: params.fileUrl, fileName: params.fileName, status: "IN_WORK" },
    });
  } else {
    const folder = await ensureQualityPoliciesFolder(params.userId);
    doc = await prisma.cmDocument.create({
      data: {
        folderId: folder.id,
        docType: "POLICY",
        number,
        title,
        revision: "A",
        status: "IN_WORK",
        description: `${program.name} program policy (QMS controlled).`,
        fileUrl: params.fileUrl,
        fileName: params.fileName,
        createdById: params.userId || null,
      },
    });
  }

  await prisma.qualityProgram.update({
    where: { id: program.id },
    data: { policyCmDocId: doc.id, policyNumber: doc.number },
  });
  await logAudit({ entityType: "CmDocument", entityId: doc.id, action: "PROGRAM_POLICY_SET", userId: params.userId, metadata: { program: program.key, number: doc.number } });
  return doc;
}

/** The linked policy document for a program (for the module's clickable link). */
export async function getProgramPolicy(programId: string) {
  const program = await prisma.qualityProgram.findUnique({ where: { id: programId } });
  if (!program?.policyCmDocId) return null;
  return prisma.cmDocument.findUnique({
    where: { id: program.policyCmDocId },
    select: { id: true, number: true, title: true, revision: true, status: true, fileUrl: true, fileName: true },
  });
}
