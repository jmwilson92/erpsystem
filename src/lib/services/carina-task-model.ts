/** Client-safe Carina task types and log helpers. No server imports. */
export type CarinaTaskLogEntry = { at: string; message: string; href?: string };

export type CarinaTaskRecord = {
  id: string;
  createdById: string;
  text: string;
  parsedIntent: string | null;
  plan: string | null;
  status: string;
  sortOrder: number;
  log: string;
  resultHref: string | null;
  resultSummary: string | null;
  confirmedReadback: boolean;
  readbackText: string | null;
  approvedAt: Date | null;
  approvedById: string | null;
  rejectedNote: string | null;
  approvalId: string | null;
  approvePermission: string | null;
  needsInfoQuestion: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastError: string | null;
  summarizedAt: Date | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function parseTaskLog(raw: string | null | undefined): CarinaTaskLogEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CarinaTaskLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendTaskLog(raw: string | null | undefined, message: string, href?: string): string {
  const entries = parseTaskLog(raw);
  entries.push({ at: new Date().toISOString(), message, href });
  return JSON.stringify(entries);
}
