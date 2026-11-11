import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { qualityEvidenceContext, validateQualityEvidence, auditReinspectionDate } from "./quality-evidence";

/**
 * Internal audit runs. An audit walks the program template; each step is an
 * OK / NCR / OFI finding. NCRs become tracked corrective actions with a
 * reinspect-by date; OFIs are logged for reference. The full run is saved to
 * inspection history.
 */

export type AuditStepResult = {
  label: string;
  finding: "OK" | "NCR" | "OFI";
  note?: string;
  photoUrl?: string;
  photoName?: string;
  correctiveAction?: string;
  reinspectBy?: string; // yyyy-mm-dd
};

export async function saveAudit(params: {
  programId: string;
  itemId?: string;
  results: AuditStepResult[];
  notes?: string;
  userId?: string;
}) {
  return prisma.$transaction(async db => {
  const { program, item } = await qualityEvidenceContext(db, params.programId, params.itemId);
  validateQualityEvidence(program.inspectionTemplate, params.results);
  for (const result of params.results) {
    if (!["OK", "NCR", "OFI"].includes(result.finding)) throw new Error("Invalid audit finding type");
    if (result.reinspectBy) auditReinspectionDate(result.reinspectBy);
  }
  const hasNcr = params.results.some((r) => r.finding === "NCR");

  // Persist the run itself to inspection history (ok = finding OK).
  const inspection = await db.qualityInspection.create({
    data: {
      programId: params.programId,
      itemId: params.itemId || null,
      results: JSON.stringify(
        params.results.map((r) => ({
          label: r.label,
          ok: r.finding === "OK",
          finding: r.finding,
          note: r.note,
          photoUrl: r.photoUrl,
          photoName: r.photoName,
        }))
      ),
      passed: !hasNcr,
      notes: params.notes?.trim() || null,
      performedById: params.userId || null,
    },
  });

  // Each NCR / OFI becomes a tracked finding.
  for (const r of params.results) {
    if (r.finding === "OK") continue;
    await db.auditFinding.create({
      data: {
        inspectionId: inspection.id,
        programId: params.programId,
        itemId: params.itemId || null,
        type: r.finding,
        description: [r.label, r.note].filter(Boolean).join(" — "),
        correctiveAction: r.finding === "NCR" ? r.correctiveAction?.trim() || null : null,
        reinspectBy: r.finding === "NCR" && r.reinspectBy ? auditReinspectionDate(r.reinspectBy) : null,
        status: "OPEN",
        createdById: params.userId || null,
      },
    });
  }

  // Advance the audit area's due date when the audit is clean.
  if (item) {
    const interval = item.intervalDays ?? program.defaultIntervalDays;
    const now = new Date();
    await db.qualityItem.update({ where: { id: item.id }, data: { lastActionAt: now,
      nextDueAt: !hasNcr && interval > 0 ? new Date(now.getTime() + interval * 86400000) : item.nextDueAt,
      status: hasNcr ? "OUT_OF_SERVICE" : "ACTIVE" } });
  }

  await logAudit({ entityType: "QualityInspection", entityId: inspection.id, action: "AUDIT_SAVED", userId: params.userId, metadata: { hasNcr } }, db);
  return inspection;
  });
}

export async function listAuditFindings(programId: string) {
  return prisma.auditFinding.findMany({
    where: { programId },
    orderBy: [{ status: "asc" }, { reinspectBy: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
}

export async function updateAuditFinding(params: {
  findingId: string;
  status?: string;
  correctiveAction?: string;
  reinspectBy?: string;
  userId?: string;
}) {
  if (params.status !== undefined && !["OPEN", "IN_PROGRESS", "REINSPECT", "CLOSED"].includes(params.status)) throw new Error("Invalid audit finding status");
  const reinspectBy = params.reinspectBy ? auditReinspectionDate(params.reinspectBy) : undefined;
  return prisma.$transaction(async db => {
    const finding = await db.auditFinding.findUniqueOrThrow({ where: { id: params.findingId } });
    const status = params.status ?? finding.status;
    const updated = await db.auditFinding.update({ where: { id: finding.id }, data: {
      status, correctiveAction: params.correctiveAction !== undefined ? params.correctiveAction.trim() || null : finding.correctiveAction,
      reinspectBy: reinspectBy ?? finding.reinspectBy, closedAt: status === "CLOSED" ? finding.closedAt || new Date() : null,
    } });
    await logAudit({ entityType: "AuditFinding", entityId: finding.id, action: "UPDATED", userId: params.userId, metadata: { status } }, db);
    return updated;
  });
}
