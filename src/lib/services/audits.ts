import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

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
  const hasNcr = params.results.some((r) => r.finding === "NCR");

  // Persist the run itself to inspection history (ok = finding OK).
  const inspection = await prisma.qualityInspection.create({
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
    await prisma.auditFinding.create({
      data: {
        inspectionId: inspection.id,
        programId: params.programId,
        itemId: params.itemId || null,
        type: r.finding,
        description: [r.label, r.note].filter(Boolean).join(" — "),
        correctiveAction: r.finding === "NCR" ? r.correctiveAction?.trim() || null : null,
        reinspectBy: r.finding === "NCR" && r.reinspectBy ? new Date(r.reinspectBy) : null,
        status: "OPEN",
        createdById: params.userId || null,
      },
    });
  }

  // Advance the audit area's due date when the audit is clean.
  if (params.itemId) {
    const item = await prisma.qualityItem.findUnique({ where: { id: params.itemId } });
    if (item) {
      const program = await prisma.qualityProgram.findUnique({ where: { id: item.programId } });
      const interval = item.intervalDays ?? program?.defaultIntervalDays ?? 0;
      const now = new Date();
      const nextDue = !hasNcr && interval > 0 ? new Date(now.getTime() + interval * 86_400_000) : item.nextDueAt;
      await prisma.qualityItem.update({
        where: { id: item.id },
        data: { lastActionAt: now, nextDueAt: nextDue, status: hasNcr ? "OUT_OF_SERVICE" : "ACTIVE" },
      });
    }
  }

  await logAudit({ entityType: "QualityInspection", entityId: inspection.id, action: "AUDIT_SAVED", userId: params.userId, metadata: { hasNcr } });
  return inspection;
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
  const finding = await prisma.auditFinding.findUnique({ where: { id: params.findingId } });
  if (!finding) throw new Error("Finding not found");
  const closed = params.status === "CLOSED";
  await prisma.auditFinding.update({
    where: { id: params.findingId },
    data: {
      status: params.status ?? finding.status,
      correctiveAction: params.correctiveAction !== undefined ? params.correctiveAction.trim() || null : finding.correctiveAction,
      reinspectBy: params.reinspectBy ? new Date(params.reinspectBy) : finding.reinspectBy,
      closedAt: closed ? new Date() : null,
    },
  });
  await logAudit({ entityType: "AuditFinding", entityId: params.findingId, action: "UPDATED", userId: params.userId, metadata: { status: params.status } });
}
