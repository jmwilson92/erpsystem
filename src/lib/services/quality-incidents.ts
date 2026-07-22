import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getProgramByKey } from "@/lib/services/quality-programs";

/**
 * Links between MRB and the quality programs:
 *  - tag an MRB case to a calibration tool and disposition whether to pull it
 *    for recalibration;
 *  - an ESD- or FOD-caused nonconformance auto-opens an incident in that
 *    program that runs a user-defined disposition process.
 */

/** Default disposition process for an auto-triggered program incident. */
export function defaultIncidentSteps(programKey: string): { step: string; done: boolean }[] {
  if (programKey === "esd") {
    return [
      { step: "Contain affected product and quarantine", done: false },
      { step: "Verify the ESD-protected area / wrist strap / mat at fault", done: false },
      { step: "Retest the workstation and log the reading", done: false },
      { step: "Retrain the operator if procedure lapse", done: false },
      { step: "Assess other product built at this station", done: false },
      { step: "Close incident once corrective action verified", done: false },
    ];
  }
  if (programKey === "fod") {
    return [
      { step: "Contain the area and account for all foreign objects", done: false },
      { step: "Identify FOD source and entry path", done: false },
      { step: "Inspect affected product for entrapment", done: false },
      { step: "Corrective action (tool control, housekeeping, shields)", done: false },
      { step: "Re-walk the zone and verify clean", done: false },
      { step: "Close incident once corrective action verified", done: false },
    ];
  }
  if (programKey === "counterfeit") {
    return [
      { step: "Quarantine the suspect part / lot immediately", done: false },
      { step: "Impound and preserve evidence (packaging, markings, C of C)", done: false },
      { step: "Verify authenticity (supplier, test, GIDEP/manufacturer)", done: false },
      { step: "Report to GIDEP / customer / authorities if confirmed", done: false },
      { step: "Disposition (return, scrap-witness, retain as evidence)", done: false },
      { step: "Supplier corrective action & ASL review", done: false },
      { step: "Close incident once dispositioned", done: false },
    ];
  }
  return [
    { step: "Contain and quarantine affected product/lot", done: false },
    { step: "Investigate root cause", done: false },
    { step: "Corrective action", done: false },
    { step: "Verify and close", done: false },
  ];
}

/** Link (or clear) a calibration tool on an MRB case. */
export async function linkCalToolToMrb(params: {
  mrbCaseId: string;
  toolId: string | null;
  userId?: string;
}) {
  let identifier: string | null = null;
  if (params.toolId) {
    const tool = await prisma.qualityItem.findUnique({ where: { id: params.toolId } });
    if (!tool) throw new Error("Tool not found");
    identifier = tool.identifier;
  }
  await prisma.mrbCase.update({
    where: { id: params.mrbCaseId },
    data: {
      calToolId: params.toolId,
      calToolIdentifier: identifier,
      calToolDisposition: params.toolId ? "PENDING" : null,
    },
  });
  await logAudit({ entityType: "MrbCase", entityId: params.mrbCaseId, action: "CAL_TOOL_LINKED", userId: params.userId, metadata: { toolId: params.toolId } });
}

/** Disposition the linked tool: pull it for recalibration, or no action. */
export async function setCalToolDisposition(params: {
  mrbCaseId: string;
  disposition: "PULL_FOR_RECAL" | "NO_ACTION";
  userId?: string;
}) {
  const mrb = await prisma.mrbCase.findUnique({ where: { id: params.mrbCaseId } });
  if (!mrb) throw new Error("MRB case not found");
  await prisma.mrbCase.update({
    where: { id: params.mrbCaseId },
    data: { calToolDisposition: params.disposition },
  });
  // Pulling for recal takes the tool out of service and flags it overdue-ish.
  if (params.disposition === "PULL_FOR_RECAL" && mrb.calToolId) {
    await prisma.qualityItem.update({
      where: { id: mrb.calToolId },
      data: { status: "OUT_OF_SERVICE", nextDueAt: new Date() },
    });
  }
  await logAudit({ entityType: "MrbCase", entityId: params.mrbCaseId, action: "CAL_TOOL_DISPOSITION", userId: params.userId, metadata: { disposition: params.disposition } });
}

/**
 * Auto-trigger an ESD, FOD, or counterfeit incident from an MRB case. Creates
 * an OPEN incident event in that program pre-loaded with the disposition
 * process, and links it back on the case. Idempotent per program.
 */
export async function triggerIncidentFromMrb(params: {
  mrbCaseId: string;
  programKey: "esd" | "fod" | "counterfeit";
  userId?: string;
}) {
  const mrb = await prisma.mrbCase.findUnique({
    where: { id: params.mrbCaseId },
    include: { ncr: { select: { number: true, title: true, description: true } } },
  });
  if (!mrb) throw new Error("MRB case not found");
  const existing =
    params.programKey === "esd" ? mrb.esdEventId : params.programKey === "fod" ? mrb.fodEventId : mrb.counterfeitEventId;
  if (existing) return existing;

  const program = await getProgramByKey(params.programKey);
  if (!program) throw new Error(`${params.programKey.toUpperCase()} program not found`);

  const event = await prisma.qualityEvent.create({
    data: {
      programId: program.id,
      type: "INCIDENT",
      result: "OPEN",
      notes: `From MRB ${mrb.number} (NCR ${mrb.ncr.number}): ${mrb.ncr.title}`,
      steps: JSON.stringify(defaultIncidentSteps(params.programKey)),
      sourceMrbId: mrb.id,
      performedById: params.userId || null,
    },
  });
  const linkData =
    params.programKey === "esd"
      ? { esdEventId: event.id }
      : params.programKey === "fod"
        ? { fodEventId: event.id }
        : { counterfeitEventId: event.id, suspectCounterfeit: true };
  await prisma.mrbCase.update({ where: { id: mrb.id }, data: linkData });
  await logAudit({ entityType: "QualityEvent", entityId: event.id, action: "INCIDENT_FROM_MRB", userId: params.userId, metadata: { programKey: params.programKey, mrb: mrb.number } });
  return event.id;
}

/**
 * Log a standalone counterfeit / suspect-part incident (customizable, with an
 * attached photo/file), optionally initiating an MRB case from it.
 */
export async function logCounterfeitIncident(params: {
  description: string;
  documentUrl?: string;
  documentName?: string;
  sendToMrb?: boolean;
  userId?: string;
}) {
  const program = await getProgramByKey("counterfeit");
  if (!program) throw new Error("Counterfeit program not found");
  const description = params.description?.trim();
  if (!description) throw new Error("Describe the suspect part / counterfeit concern");

  const event = await prisma.qualityEvent.create({
    data: {
      programId: program.id,
      type: "INCIDENT",
      result: "OPEN",
      notes: description,
      steps: JSON.stringify(defaultIncidentSteps("counterfeit")),
      documentUrl: params.documentUrl?.trim() || null,
      documentName: params.documentName?.trim() || null,
      performedById: params.userId || null,
    },
  });

  let mrbNumber: string | null = null;
  if (params.sendToMrb) {
    const mrb = await sendCounterfeitToMrb({ eventId: event.id, userId: params.userId });
    mrbNumber = mrb.number;
  }
  await logAudit({ entityType: "QualityEvent", entityId: event.id, action: "COUNTERFEIT_LOGGED", userId: params.userId, metadata: { sentToMrb: !!params.sendToMrb } });
  return { eventId: event.id, mrbNumber };
}

/** Initiate an MRB case (with NCR) from a counterfeit incident. */
export async function sendCounterfeitToMrb(params: { eventId: string; userId?: string }) {
  const event = await prisma.qualityEvent.findUnique({ where: { id: params.eventId } });
  if (!event) throw new Error("Incident not found");
  if (event.sourceMrbId) {
    const existing = await prisma.mrbCase.findUnique({ where: { id: event.sourceMrbId } });
    if (existing) return existing;
  }

  const ncrCount = await prisma.nonConformance.count();
  const ncr = await prisma.nonConformance.create({
    data: {
      number: `NCR-${String(ncrCount + 1).padStart(5, "0")}`,
      title: "Suspect counterfeit part",
      description: event.notes || "Suspect counterfeit / unapproved part flagged from the Counterfeit program.",
      status: "MRB",
      severity: "MAJOR",
      source: "SUPPLIER",
      quantity: 1,
      createdById: params.userId || null,
    },
  });
  const mrbCount = await prisma.mrbCase.count();
  const mrb = await prisma.mrbCase.create({
    data: {
      number: `MRB-${String(mrbCount + 1).padStart(5, "0")}`,
      ncrId: ncr.id,
      status: "OPEN",
      chairId: params.userId || null,
      notes: "Suspect counterfeit — quarantine, verify authenticity, and disposition.",
      suspectCounterfeit: true,
      counterfeitEventId: event.id,
    },
  });
  await prisma.qualityEvent.update({ where: { id: event.id }, data: { sourceMrbId: mrb.id } });
  await logAudit({ entityType: "MrbCase", entityId: mrb.id, action: "MRB_FROM_COUNTERFEIT", userId: params.userId, metadata: { number: mrb.number } });
  return mrb;
}

export async function updateIncidentSteps(params: { eventId: string; steps: { step: string; done: boolean }[]; userId?: string }) {
  await prisma.qualityEvent.update({ where: { id: params.eventId }, data: { steps: JSON.stringify(params.steps) } });
}

export async function setIncidentResult(params: { eventId: string; result: string; userId?: string }) {
  await prisma.qualityEvent.update({ where: { id: params.eventId }, data: { result: params.result } });
  await logAudit({ entityType: "QualityEvent", entityId: params.eventId, action: "INCIDENT_RESULT", userId: params.userId, metadata: { result: params.result } });
}

/** MRB cases that reference a set of tools, keyed by toolId (for the calibration view). */
export async function mrbCasesForTools(toolIds: string[]) {
  if (toolIds.length === 0) return {} as Record<string, { id: string; number: string; title: string; disposition: string | null; status: string }[]>;
  const cases = await prisma.mrbCase.findMany({
    where: { calToolId: { in: toolIds } },
    include: { ncr: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
  });
  const byTool: Record<string, { id: string; number: string; title: string; disposition: string | null; status: string }[]> = {};
  for (const c of cases) {
    if (!c.calToolId) continue;
    (byTool[c.calToolId] ||= []).push({
      id: c.id,
      number: c.number,
      title: c.ncr.title,
      disposition: c.calToolDisposition,
      status: c.status,
    });
  }
  return byTool;
}
