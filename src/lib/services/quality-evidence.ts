import type { Prisma } from "@prisma/client";

/** Lock template then item in a consistent order; evidence cannot cross programs. */
export async function qualityEvidenceContext(db: Prisma.TransactionClient, programId: string, itemId?: string) {
  const program = await db.qualityProgram.findUniqueOrThrow({ where: { id: programId } });
  const claim = await db.qualityProgram.updateMany({ where: { id: programId, inspectionTemplate: program.inspectionTemplate }, data: { inspectionTemplate: program.inspectionTemplate } });
  if (!claim.count) throw new Error("Inspection template changed; refresh and retry");
  let item = itemId ? await db.qualityItem.findUniqueOrThrow({ where: { id: itemId } }) : null;
  if (item) {
    if (item.programId !== program.id) throw new Error("Quality item does not belong to this program");
    const locked = await db.qualityItem.updateMany({ where: { id: item.id, programId, updatedAt: item.updatedAt }, data: { updatedAt: item.updatedAt } });
    if (!locked.count) throw new Error("Quality item changed; refresh and retry");
    item = await db.qualityItem.findUniqueOrThrow({ where: { id: item.id } });
    if (item.status === "RETIRED") throw new Error("Retired quality items cannot be reactivated by inspection");
  }
  return { program, item };
}

export function validateQualityEvidence(template: string | null, results: { label: string }[]) {
  if (!Array.isArray(results) || !results.length) throw new Error("Complete inspection evidence is required");
  const labels = results.map(r => typeof r?.label === "string" ? r.label.trim() : "");
  if (labels.some(x => !x) || new Set(labels).size !== labels.length) throw new Error("Inspection checks must have unique nonempty labels");
  if (!template) return;
  let steps: { label: string }[];
  try { steps = JSON.parse(template); } catch { throw new Error("Inspection template is invalid; repair it before recording evidence"); }
  if (!Array.isArray(steps)) throw new Error("Inspection template is invalid");
  const required = steps.map(s => typeof s?.label === "string" ? s.label.trim() : "");
  if (required.some(x => !x) || new Set(required).size !== required.length) throw new Error("Inspection template contains ambiguous checks");
  if (required.length && (required.length !== labels.length || required.some(label => !labels.includes(label)))) throw new Error("Complete every configured inspection check exactly once");
}

export function auditReinspectionDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid reinspection date");
  return date;
}
