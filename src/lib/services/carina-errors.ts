/**
 * Prisma-backed Carina error store. Pure classify/diagnose helpers live in
 * carina-errors-model.ts so client code can import them without db.ts.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { redactSecrets } from "@/lib/redact-secrets";
import {
  classifyError,
  diagnoseError,
  scrubPayload,
  newCorrelationId,
  type CapturedError,
  type Diagnosis,
  type ErrorClassification,
  type RecordState,
  ERROR_CLASSIFICATIONS,
} from "@/lib/services/carina-errors-model";

export * from "@/lib/services/carina-errors-model";

export type ErrorStore = {
  save(event: CapturedError): Promise<CapturedError>;
  latestForUser(userId: string): Promise<CapturedError | null>;
  getByCorrelation(correlationId: string): Promise<CapturedError | null>;
  markResolution(correlationId: string, resolution: string, resolvedBy?: string): Promise<void>;
  markBugReported(correlationId: string): Promise<void>;
  listRecent(limit?: number): Promise<CapturedError[]>;
};

export function memoryErrorStore(): ErrorStore {
  const rows: CapturedError[] = [];
  return {
    async save(event) {
      const row = { ...event, id: event.id || `err_${rows.length + 1}`, createdAt: event.createdAt || new Date() };
      const i = rows.findIndex((r) => r.correlationId === row.correlationId);
      if (i >= 0) rows[i] = { ...rows[i], ...row };
      else rows.unshift(row);
      return row;
    },
    async latestForUser(userId) {
      return rows.find((r) => r.userId === userId) || rows[0] || null;
    },
    async getByCorrelation(correlationId) {
      const id = correlationId.toUpperCase();
      return rows.find((r) => r.correlationId.toUpperCase() === id) || null;
    },
    async markResolution(correlationId, resolution, resolvedBy) {
      const row = await this.getByCorrelation(correlationId);
      if (row) {
        row.resolution = resolution;
        row.resolvedAt = new Date();
        row.resolvedBy = resolvedBy;
      }
    },
    async markBugReported(correlationId) {
      const row = await this.getByCorrelation(correlationId);
      if (row) {
        row.bugReportedAt = new Date();
        row.bugStatus = "OPEN";
        row.resolution = row.resolution || "REPORTED";
        row.resolvedAt = row.resolvedAt || new Date();
      }
    },
    async listRecent(limit = 50) {
      return rows.slice(0, limit);
    },
  };
}

export async function persistCapturedError(event: Omit<CapturedError, "id" | "createdAt"> & { id?: string }): Promise<CapturedError> {
  const classified = classifyError(event);
  const payload = scrubPayload(event.payload || null);
  const correlationId = event.correlationId || newCorrelationId();
  const row = await prisma.carinaErrorEvent.upsert({
    where: { correlationId },
    create: {
      correlationId,
      errorCode: classified.errorCode,
      classification: classified.classification,
      httpStatus: event.httpStatus ?? null,
      message: redactSecrets(event.message || classified.summary).slice(0, 1000),
      route: event.route ? redactSecrets(event.route).slice(0, 300) : null,
      entityType: event.entityType || null,
      entityId: event.entityId || null,
      actionAttempted: event.actionAttempted || null,
      userId: event.userId || null,
      userRole: event.userRole || null,
      source: event.source || "client-api",
      payloadJson: payload ? JSON.stringify(payload) : null,
      sessionId: event.sessionId || null,
    },
    update: {
      errorCode: classified.errorCode,
      classification: classified.classification,
      message: redactSecrets(event.message || classified.summary).slice(0, 1000),
    },
  });
  return fromRow(row);
}

export async function latestErrorForUser(userId: string): Promise<CapturedError | null> {
  const row = await prisma.carinaErrorEvent.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return row ? fromRow(row) : null;
}

export async function getErrorByCorrelation(correlationId: string): Promise<CapturedError | null> {
  const row = await prisma.carinaErrorEvent.findUnique({
    where: { correlationId: correlationId.toUpperCase() },
  });
  return row ? fromRow(row) : null;
}

export async function listRecentErrors(limit = 80): Promise<CapturedError[]> {
  const rows = await prisma.carinaErrorEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(fromRow);
}

export async function markErrorResolution(params: {
  correlationId: string;
  resolution: string;
  resolvedBy?: string;
}): Promise<void> {
  await prisma.carinaErrorEvent.updateMany({
    where: { correlationId: params.correlationId },
    data: { resolution: params.resolution, resolvedAt: new Date(), resolvedBy: params.resolvedBy || "carina" },
  });
}

export async function fileBugReport(params: {
  event: CapturedError;
  steps?: string;
}): Promise<{ notified: number }> {
  const classified = classifyError(params.event);
  await prisma.carinaErrorEvent.updateMany({
    where: { correlationId: params.event.correlationId },
    data: {
      bugReportedAt: new Date(),
      bugStatus: "OPEN",
      resolution: "REPORTED",
      resolvedAt: new Date(),
      resolvedBy: "carina",
    },
  });
  const admins = await prisma.user.findMany({
    where: { isActive: true, role: "ADMIN" },
    select: { id: true },
  });
  const title = `Carina bug report ${params.event.correlationId}`;
  const body = [
    `${classified.summary}`,
    params.event.route ? `Route: ${params.event.route}` : "",
    params.event.actionAttempted ? `Action: ${params.event.actionAttempted}` : "",
    `Error code: ${classified.errorCode}`,
    `Correlation: ${params.event.correlationId}`,
    params.steps ? `Steps: ${params.steps}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  let notified = 0;
  for (const admin of admins) {
    await prisma.userNotification.create({
      data: {
        userId: admin.id,
        type: "CARINA_BUG",
        title,
        body,
        href: "/admin/errors",
        entityType: "CarinaErrorEvent",
        entityId: params.event.correlationId,
      },
    });
    notified += 1;
  }
  await logAudit({
    entityType: "CarinaErrorEvent",
    entityId: params.event.correlationId,
    action: "CARINA_BUG_REPORTED",
    metadata: { errorCode: classified.errorCode, classification: classified.classification, source: "carina" },
  });
  return { notified };
}

function fromRow(row: {
  id: string;
  correlationId: string;
  errorCode: string;
  classification: string;
  httpStatus: number | null;
  message: string;
  route: string | null;
  entityType: string | null;
  entityId: string | null;
  actionAttempted: string | null;
  userId: string | null;
  userRole: string | null;
  source: string;
  payloadJson: string | null;
  sessionId: string | null;
  resolution: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  bugReportedAt: Date | null;
  bugStatus: string | null;
  createdAt: Date;
}): CapturedError {
  let payload: Record<string, unknown> | null = null;
  if (row.payloadJson) {
    try {
      payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }
  return {
    id: row.id,
    correlationId: row.correlationId,
    classification: ERROR_CLASSIFICATIONS.includes(row.classification as ErrorClassification)
      ? (row.classification as ErrorClassification)
      : "SYSTEM",
    errorCode: row.errorCode,
    httpStatus: row.httpStatus,
    message: row.message,
    route: row.route,
    entityType: row.entityType,
    entityId: row.entityId,
    actionAttempted: row.actionAttempted,
    userId: row.userId,
    userRole: row.userRole,
    source: row.source,
    payload,
    sessionId: row.sessionId,
    createdAt: row.createdAt,
    resolution: row.resolution,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
    bugReportedAt: row.bugReportedAt,
    bugStatus: row.bugStatus,
  };
}

export async function diagnoseCaptured(event: CapturedError, record?: RecordState | null): Promise<Diagnosis> {
  return diagnoseError({ event, record });
}

export async function prismaErrorStore(): Promise<ErrorStore> {
  return {
    save: (event) => persistCapturedError(event),
    latestForUser: latestErrorForUser,
    getByCorrelation: getErrorByCorrelation,
    markResolution: (id, resolution, resolvedBy) => markErrorResolution({ correlationId: id, resolution, resolvedBy }),
    markBugReported: async (id) => {
      const event = await getErrorByCorrelation(id);
      if (event) await fileBugReport({ event });
    },
    listRecent: listRecentErrors,
  };
}
