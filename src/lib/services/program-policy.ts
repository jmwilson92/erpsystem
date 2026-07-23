import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createDocumentEcr } from "@/lib/services/cm-library";

/**
 * Quality-program policies are controlled documents. Creating one doesn't drop
 * it straight into the released library — it enters the CM change process as a
 * submitted ECR (the same path work instructions and test procedures take) and
 * only becomes a released document when CM releases the ECR. A program can also
 * link an existing CM document as its policy.
 */

/**
 * Submit a program policy into the CM change process. Creates a SUBMITTED
 * document ECR (company-internal) carrying the policy file, and tracks the ECR
 * on the program until it's released.
 */
export async function submitProgramPolicyToCm(params: {
  programId: string;
  fileUrl: string;
  fileName: string;
  userId?: string;
}) {
  const program = await prisma.qualityProgram.findUnique({ where: { id: params.programId } });
  if (!program) throw new Error("Program not found");
  if (!params.fileUrl) throw new Error("Attach the policy document");

  const number = program.policyNumber || `QP-${program.key.toUpperCase()}-001`;
  const cr = await createDocumentEcr({
    isCompanyInternal: true,
    documentNumber: number,
    documentTitle: `${program.name} — Program Policy`,
    documentRevision: "A",
    documentDocType: "PROCEDURE",
    documentDescription: `${program.name} program policy (QMS controlled).`,
    documentFileUrl: params.fileUrl,
    documentFileName: params.fileName,
    attachments: [{ url: params.fileUrl, fileName: params.fileName, isPrimary: true }],
    userId: params.userId,
  });

  await prisma.qualityProgram.update({
    where: { id: program.id },
    data: { policyEcrId: cr.id, policyEcrNumber: cr.number, policyNumber: number },
  });
  await logAudit({ entityType: "ChangeRequest", entityId: cr.id, action: "PROGRAM_POLICY_SUBMITTED", userId: params.userId, metadata: { program: program.key, number } });
  return cr;
}

/** Link an already-existing CM document as this program's policy. */
export async function linkExistingPolicy(params: { programId: string; cmDocId: string; userId?: string }) {
  const doc = await prisma.cmDocument.findUnique({ where: { id: params.cmDocId } });
  if (!doc) throw new Error("Document not found");
  await prisma.qualityProgram.update({
    where: { id: params.programId },
    data: { policyCmDocId: doc.id, policyNumber: doc.number, policyEcrId: null, policyEcrNumber: null },
  });
  await logAudit({ entityType: "CmDocument", entityId: doc.id, action: "PROGRAM_POLICY_LINKED", userId: params.userId, metadata: { programId: params.programId, number: doc.number } });
  return doc;
}

export type ProgramPolicy =
  | { kind: "doc"; id: string; number: string; title: string; revision: string; status: string; fileUrl: string | null; fileName: string | null }
  | { kind: "ecr"; ecrId: string; number: string; status: string }
  | null;

/** The program's policy — a released CM document, or the in-process ECR. */
export async function getProgramPolicy(programId: string): Promise<ProgramPolicy> {
  const program = await prisma.qualityProgram.findUnique({ where: { id: programId } });
  if (!program) return null;

  if (program.policyCmDocId) {
    const doc = await prisma.cmDocument.findUnique({
      where: { id: program.policyCmDocId },
      select: { id: true, number: true, title: true, revision: true, status: true, fileUrl: true, fileName: true },
    });
    if (doc) return { kind: "doc", ...doc };
  }

  if (program.policyEcrId) {
    const cr = await prisma.changeRequest.findUnique({
      where: { id: program.policyEcrId },
      select: { id: true, number: true, status: true, releasedDocumentId: true },
    });
    if (cr) {
      // If CM released the ECR into a document, adopt it as the linked policy.
      if (cr.releasedDocumentId) {
        await prisma.qualityProgram.update({
          where: { id: program.id },
          data: { policyCmDocId: cr.releasedDocumentId, policyEcrId: null, policyEcrNumber: null },
        });
        const doc = await prisma.cmDocument.findUnique({
          where: { id: cr.releasedDocumentId },
          select: { id: true, number: true, title: true, revision: true, status: true, fileUrl: true, fileName: true },
        });
        if (doc) return { kind: "doc", ...doc };
      }
      return { kind: "ecr", ecrId: cr.id, number: cr.number, status: cr.status };
    }
  }

  return null;
}

/** Candidate CM documents a program could link as its policy. */
export async function listPolicyCandidates() {
  return prisma.cmDocument.findMany({
    where: { isArchived: false, docType: { in: ["POLICY", "PROCEDURE"] }, status: { in: ["RELEASED", "IN_WORK"] } },
    orderBy: [{ number: "asc" }, { revision: "desc" }],
    select: { id: true, number: true, title: true, revision: true, status: true },
    take: 100,
  });
}
