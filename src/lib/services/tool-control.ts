import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getProgramByKey } from "@/lib/services/quality-programs";

/**
 * Tool Control: toolboxes hold controlled tools; tools can be inventoried
 * (saved inspection reports), and reported missing / broken / worn. A broken
 * tool gathers its pieces and raises a replacement PR; a missing tool (or an
 * unrecoverable broken piece) opens a FOD incident and a user-driven process.
 */

async function nextToolReportNumber(): Promise<string> {
  const n = await prisma.toolReport.count();
  return `TR-${String(n + 1).padStart(5, "0")}`;
}

export async function createToolbox(params: {
  identifier: string;
  name: string;
  location?: string;
  ownerId?: string;
  notes?: string;
  userId?: string;
}) {
  const identifier = params.identifier?.trim();
  if (!identifier) throw new Error("A toolbox ID is required");
  const box = await prisma.toolbox.create({
    data: {
      identifier,
      name: params.name?.trim() || identifier,
      location: params.location?.trim() || null,
      ownerId: params.ownerId || null,
      notes: params.notes?.trim() || null,
      createdById: params.userId || null,
    },
  });
  await logAudit({ entityType: "Toolbox", entityId: box.id, action: "CREATED", userId: params.userId, metadata: { name: box.name } });
  return box;
}

/** Move a tool into a toolbox (or set it loose when toolboxId is null). */
export async function assignToolToToolbox(params: { toolId: string; toolboxId: string | null; userId?: string }) {
  const tool = await prisma.qualityItem.findUnique({ where: { id: params.toolId } });
  if (!tool) throw new Error("Tool not found");
  if (params.toolboxId) {
    const box = await prisma.toolbox.findUnique({ where: { id: params.toolboxId } });
    if (!box) throw new Error("Toolbox not found");
  }
  await prisma.qualityItem.update({ where: { id: params.toolId }, data: { toolboxId: params.toolboxId } });
  await logAudit({ entityType: "QualityItem", entityId: params.toolId, action: "TOOLBOX_ASSIGNED", userId: params.userId, metadata: { toolboxId: params.toolboxId } });
}

/** All toolboxes with their tools + latest inspection, for the Tool Control page. */
export async function listToolboxes() {
  const boxes = await prisma.toolbox.findMany({
    orderBy: { identifier: "asc" },
    include: {
      tools: {
        include: { toolReports: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true, kind: true, number: true } } },
        orderBy: { identifier: "asc" },
      },
      inspections: { orderBy: { performedAt: "desc" }, take: 10 },
    },
  });
  return boxes;
}

/** Save a completed toolbox inspection to history. */
export async function saveToolboxInspection(params: {
  toolboxId: string;
  results: { toolId: string; identifier: string; name: string; present: boolean; ok: boolean; note?: string }[];
  notes?: string;
  userId?: string;
}) {
  const okCount = params.results.filter((r) => r.present && r.ok).length;
  const insp = await prisma.toolboxInspection.create({
    data: {
      toolboxId: params.toolboxId,
      performedById: params.userId || null,
      results: JSON.stringify(params.results),
      toolCount: params.results.length,
      okCount,
      notes: params.notes?.trim() || null,
    },
  });
  await logAudit({ entityType: "ToolboxInspection", entityId: insp.id, action: "RECORDED", userId: params.userId, metadata: { okCount, toolCount: params.results.length } });
  return insp;
}

export async function createToolReport(params: {
  itemId: string;
  kind: "MISSING" | "BROKEN" | "WORN";
  description?: string;
  userId?: string;
}) {
  const tool = await prisma.qualityItem.findUnique({ where: { id: params.itemId } });
  if (!tool) throw new Error("Tool not found");

  const number = await nextToolReportNumber();
  // A broken tool starts with a single piece-recovery line for the whole tool;
  // the user adds specific broken pieces as they gather them.
  const pieces =
    params.kind === "BROKEN"
      ? JSON.stringify([{ piece: `${tool.identifier} — main body`, gathered: false }])
      : null;

  const report = await prisma.toolReport.create({
    data: {
      number,
      itemId: tool.id,
      toolboxId: tool.toolboxId,
      kind: params.kind,
      status: "OPEN",
      description: params.description?.trim() || null,
      pieces,
      steps: JSON.stringify(defaultSteps(params.kind)),
    },
  });

  // Take the tool out of service while the report is open.
  await prisma.qualityItem.update({ where: { id: tool.id }, data: { status: "OUT_OF_SERVICE" } });

  // A missing tool is a foreign-object risk — open a FOD incident immediately.
  if (params.kind === "MISSING") {
    const fodEventId = await raiseFodIncident({
      title: `Missing tool ${tool.identifier} — ${tool.name}`,
      detail: params.description,
      userId: params.userId,
    });
    if (fodEventId) {
      await prisma.toolReport.update({ where: { id: report.id }, data: { fodEventId } });
    }
  }

  await logAudit({ entityType: "ToolReport", entityId: report.id, action: "CREATED", userId: params.userId, metadata: { kind: params.kind, tool: tool.identifier } });
  return report;
}

function defaultSteps(kind: string): { step: string; done: boolean }[] {
  if (kind === "MISSING") {
    return [
      { step: "Search last known work area and adjacent zones", done: false },
      { step: "Notify supervisor and quality", done: false },
      { step: "Log FOD incident and cordon area if product at risk", done: false },
      { step: "Check completed assemblies / shipped units for entrapment", done: false },
      { step: "Recover tool or disposition per FOD process", done: false },
    ];
  }
  if (kind === "BROKEN") {
    return [
      { step: "Gather and account for all broken pieces", done: false },
      { step: "Confirm no pieces entered product or work area", done: false },
      { step: "Place replacement purchase request", done: false },
      { step: "Retire / quarantine the broken tool", done: false },
    ];
  }
  return [
    { step: "Assess wear and remaining life", done: false },
    { step: "Decide repair vs. replace", done: false },
  ];
}

/** Add / toggle a piece on a broken-tool report. */
export async function updateToolReportPieces(params: {
  reportId: string;
  pieces: { piece: string; gathered: boolean }[];
  userId?: string;
}) {
  const report = await prisma.toolReport.findUnique({ where: { id: params.reportId } });
  if (!report) throw new Error("Report not found");
  await prisma.toolReport.update({
    where: { id: params.reportId },
    data: { pieces: JSON.stringify(params.pieces) },
  });
}

/**
 * Declare a broken piece unrecoverable. This escalates the report to a FOD
 * incident (a lost fragment is foreign-object risk) that runs the FOD process.
 */
export async function declarePieceUnrecoverable(params: { reportId: string; userId?: string }) {
  const report = await prisma.toolReport.findUnique({ where: { id: params.reportId }, include: { item: true } });
  if (!report) throw new Error("Report not found");
  if (report.fodEventId) {
    await prisma.toolReport.update({ where: { id: report.id }, data: { piecesRecovered: false } });
    return report.fodEventId;
  }
  const fodEventId = await raiseFodIncident({
    title: `Unrecoverable tool piece — ${report.item?.identifier ?? "tool"} (${report.number})`,
    detail: report.description ?? undefined,
    userId: params.userId,
  });
  await prisma.toolReport.update({
    where: { id: report.id },
    data: { piecesRecovered: false, fodEventId: fodEventId || undefined },
  });
  return fodEventId;
}

/** Raise a FOD incident (an OPEN INCIDENT event in the FOD program). */
export async function raiseFodIncident(params: { title: string; detail?: string; userId?: string }): Promise<string | null> {
  const fod = await getProgramByKey("fod");
  if (!fod) return null;
  const event = await prisma.qualityEvent.create({
    data: {
      programId: fod.id,
      type: "INCIDENT",
      result: "OPEN",
      notes: [params.title, params.detail].filter(Boolean).join(" — "),
      performedById: params.userId || null,
    },
  });
  await logAudit({ entityType: "QualityEvent", entityId: event.id, action: "FOD_FROM_TOOL", userId: params.userId, metadata: { title: params.title } });
  return event.id;
}

/** Place a DRAFT replacement PR for a broken/worn tool and link it to the report. */
export async function placeReplacementPr(params: { reportId: string; estimatedCost?: number; userId?: string }) {
  const report = await prisma.toolReport.findUnique({ where: { id: params.reportId }, include: { item: true } });
  if (!report) throw new Error("Report not found");
  if (report.replacementPrId) throw new Error("A replacement PR is already linked");

  const { createStandalonePurchaseRequest } = await import("@/lib/services/purchase-requests");
  const desc = `Replacement tool: ${report.item?.name ?? "tool"} (${report.item?.identifier ?? ""})`.trim();
  const pr = await createStandalonePurchaseRequest({
    lines: [{ description: desc, quantity: 1, estimatedUnitCost: params.estimatedCost || 0, uom: "EA" }],
    purpose: "OTHER",
    justification: `Tool Control report ${report.number} (${report.kind.toLowerCase()} tool)`,
    submit: false,
    userId: params.userId,
  });
  await prisma.toolReport.update({
    where: { id: report.id },
    data: { replacementPrId: pr.id, replacementPrNumber: pr.number, status: "IN_PROGRESS" },
  });
  return pr;
}

export async function updateToolReportSteps(params: { reportId: string; steps: { step: string; done: boolean }[]; userId?: string }) {
  await prisma.toolReport.update({ where: { id: params.reportId }, data: { steps: JSON.stringify(params.steps) } });
}

export async function setToolReportStatus(params: { reportId: string; status: string; userId?: string }) {
  const report = await prisma.toolReport.findUnique({ where: { id: params.reportId } });
  if (!report) throw new Error("Report not found");
  const resolved = ["RESOLVED", "CLOSED"].includes(params.status);
  await prisma.toolReport.update({
    where: { id: params.reportId },
    data: { status: params.status, resolvedAt: resolved ? new Date() : null },
  });
  // Return the tool to service when the report closes and it wasn't missing/scrapped.
  if (resolved && report.itemId && report.kind !== "MISSING") {
    await prisma.qualityItem.update({ where: { id: report.itemId }, data: { status: "ACTIVE" } });
  }
  await logAudit({ entityType: "ToolReport", entityId: report.id, action: "STATUS", userId: params.userId, metadata: { status: params.status } });
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
