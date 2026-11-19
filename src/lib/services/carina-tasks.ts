/**
 * Carina to-do list and background runner.
 *
 * Tasks are created by the signed-in user (chat, voice, or the To-Do panel)
 * and executed as that user with their permissions. Read/report/lookup and
 * drafts (draft PRs, planned WOs, planning worksheets, forecasts) run
 * unattended. Confirm-gated changes to existing records run unattended only
 * when the user confirmed the read-back while adding the task; otherwise they
 * park as needs-approval and appear in the Approvals inbox as a "Carina action".
 * Approve executes as the requesting user; reject cancels with a note.
 */
import { logAudit } from "@/lib/audit";
import { userHasPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseVoiceActionIntent, type VoiceActionKind } from "@/lib/services/carina-voice-intent";
import { looksLikeRecordChange } from "@/lib/ai-help/answer";

export const CARINA_ACTION_ENTITY = "CarinaAction";
export const CARINA_ACTION_STAGE = "Carina action";

export const CARINA_TASK_STATUSES = [
  "queued",
  "working",
  "needs-approval",
  "needs-info",
  "done",
  "failed",
  "cancelled",
] as const;
export type CarinaTaskStatus = (typeof CARINA_TASK_STATUSES)[string extends never ? never : number] | (typeof CARINA_TASK_STATUSES)[number];

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

export type CarinaTaskSafety = "unattended" | "needs-approval" | "needs-info" | "excluded" | "needs-pin";

export type ClassifiedTask = {
  safety: CarinaTaskSafety;
  kind: string;
  reason: string;
  approvePermission: string | null;
  readbackText: string;
};

const UNATTENDED_KINDS = new Set<string>([
  "LOOKUP",
  "REPORT",
  "NAVIGATE",
  "HOWTO",
  "HIGH_RISK_PARTS",
  "CREATE_PURCHASE_REQUEST",
  "PLAN_DEMAND",
  "CREATE_PLANNING_WORKSHEET",
]);

const EXISTING_RECORD_KINDS = new Set<string>([
  "EDIT_PROJECT",
  "TIE_WO",
  "CYCLE_COUNT",
  "CONSUME_PARTS",
  "OUTPUT_WO",
]);

const APPROVE_PERMISSION: Record<string, string> = {
  EDIT_PROJECT: "pmo.project.manage",
  TIE_WO: "workorders.status.update",
  CYCLE_COUNT: "inventory.cyclecount",
  CONSUME_PARTS: "workorders.complete",
  OUTPUT_WO: "workorders.complete",
  CREATE_PURCHASE_REQUEST: "purchasing.pr.approve",
  PLAN_DEMAND: "planning.forecast.create",
  CREATE_PLANNING_WORKSHEET: "planning.mrs.release",
};

const EXCLUDED_RE =
  /\b(payroll|salary|salaries|wage|wages|direct deposit|bank account|wire transfer|ach |send (them )?money|pay(ing)? (an? )?(invoice|vendor|supplier|bill)|cut (a |the )?check|move funds|transfer funds|user access|reset (their |the )?password|promote (them|a user)|grant (admin|access)|hire|fire|terminate (them|employment)|open enrollment|benefits enrollment|ssn|social security)\b/i;

const ADD_PREFIX_RE =
  /^(?:hey |ok |okay |please )?(?:carina[,:]?\s+)?(?:(?:please|can you|could you)\s+)?(?:add (?:this |that |it )?(?:to (?:your|the|my) (?:to-?do )?list)[:\s-]*|(?:put|add) (?:this |that |it )?(?:on|onto) (?:your|the|my) (?:to-?do )?list[:\s-]*|when you (?:get a chance|can|have a (?:minute|moment|chance))[,:]?\s+|(?:please )?(?:do|handle|take care of) this (?:when you (?:can|get a chance)|later|in the background)[:\s-]*|add a (?:to-?do|task)[:\s-]*|remind yourself to\s+)/i;

const CONFIRMED_READBACK_RE =
  /\b(i confirm(?:ed)?(?: this| the read-?back| the change)?|read-?back confirmed|you have my (?:ok|okay|approval)|approved to (?:do|run) this|go ahead when you (?:can|get a chance)|i(?:['’]m| am) confirming (?:this|the read-?back))\b/i;

export function looksLikeAddToList(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^\s*how do i\b/i.test(t)) return false;
  return ADD_PREFIX_RE.test(t);
}

export function stripAddToListPrefix(text: string): string {
  return text.trim().replace(ADD_PREFIX_RE, "").replace(CONFIRMED_READBACK_RE, " ").replace(/\s+/g, " ").trim();
}

export function utteranceConfirmsReadback(text: string): boolean {
  return CONFIRMED_READBACK_RE.test(text);
}

export function isExcludedTaskText(text: string): boolean {
  return EXCLUDED_RE.test(text);
}

export function looksLikeAwaySummaryAsk(text: string): boolean {
  return /\b(while i was away|what did you (?:do|finish|get done)|any (?:updates?|tasks?) (?:done|finished|waiting)|status of (?:your|my|the) (?:to-?do )?list)\b/i.test(
    text
  );
}

function kindFromIntent(intent: { kind?: string } | null | undefined, text: string): string {
  if (intent?.kind) return intent.kind;
  const parsed = parseVoiceActionIntent(text);
  if (parsed?.kind) return parsed.kind;
  const lower = text.toLowerCase();
  if (/\b(draft|create|open|make|start|submit|raise|file|new|buy)\b/.test(lower) && /\b(purchase request|purchasing request|requisition)\b/.test(lower)) {
    return "CREATE_PURCHASE_REQUEST";
  }
  if (/\b(plan(?:ning)?(?: this)? demand|demand plan|planning worksheet)\b/.test(lower)) return "PLAN_DEMAND";
  if (/\b(how (do|can) i|walk me through)\b/.test(lower)) return "HOWTO";
  if (/\b(take me to|open|go to|show me|navigate)\b/.test(lower)) return "NAVIGATE";
  if (looksLikeRecordChange(text)) return "EXISTING_CHANGE";
  return "LOOKUP";
}

export function classifyCarinaTask(input: {
  text: string;
  intent?: { kind?: string } | null;
  confirmedReadback?: boolean;
}): ClassifiedTask {
  const text = input.text.trim();
  if (!text) {
    return {
      safety: "needs-info",
      kind: "LOOKUP",
      reason: "I need a bit more detail about what to do.",
      approvePermission: null,
      readbackText: "",
    };
  }
  if (isExcludedTaskText(text)) {
    return {
      safety: "excluded",
      kind: "EXCLUDED",
      reason: "I can’t take on payroll, money movement, HR, or user-access work. I didn’t add that to my list.",
      approvePermission: null,
      readbackText: "",
    };
  }
  const kind = kindFromIntent(input.intent, text);
  const approvePermission = APPROVE_PERMISSION[kind] || (kind === "EXISTING_CHANGE" ? null : null);
  const readbackText = buildReadback(kind, text);

  if (kind === "EXISTING_CHANGE" || EXISTING_RECORD_KINDS.has(kind)) {
    if (input.confirmedReadback) {
      return {
        safety: "unattended",
        kind,
        reason: "You confirmed the read-back, so I’ll do this when I get to it.",
        approvePermission: APPROVE_PERMISSION[kind] || "pmo.project.manage",
        readbackText,
      };
    }
    return {
      safety: "needs-approval",
      kind,
      reason: "This would change an existing record, so I’ll wait for your okay in Approvals.",
      approvePermission: APPROVE_PERMISSION[kind] || null,
      readbackText,
    };
  }
  if (UNATTENDED_KINDS.has(kind)) {
    return {
      safety: "unattended",
      kind,
      reason: "I can do this in the background without an approval item.",
      approvePermission: APPROVE_PERMISSION[kind] || null,
      readbackText,
    };
  }
  if (input.confirmedReadback) {
    return {
      safety: "unattended",
      kind,
      reason: "You confirmed the read-back, so I’ll do this when I get to it.",
      approvePermission: approvePermission,
      readbackText,
    };
  }
  return {
    safety: "needs-approval",
    kind,
    reason: "I’ll wait for your okay in Approvals before I change anything.",
    approvePermission,
    readbackText,
  };
}

export function buildReadback(kind: string, text: string): string {
  const cleaned = stripAddToListPrefix(text) || text.trim();
  switch (kind) {
    case "CREATE_PURCHASE_REQUEST":
      return `Draft a purchase request from: “${cleaned}”. It will stay unsubmitted.`;
    case "PLAN_DEMAND":
      return `Build a demand plan (planned work orders / buys) from: “${cleaned}”.`;
    case "CREATE_PLANNING_WORKSHEET":
      return `Create a planning worksheet from: “${cleaned}”.`;
    case "EDIT_PROJECT":
      return `Change the existing project as requested: “${cleaned}”.`;
    case "TIE_WO":
      return `Tie a work order as requested: “${cleaned}”.`;
    case "CYCLE_COUNT":
      return `Post a cycle count as requested: “${cleaned}”.`;
    case "CONSUME_PARTS":
      return `Consume parts on a work order as requested: “${cleaned}”.`;
    case "OUTPUT_WO":
      return `Record work-order output as requested: “${cleaned}”.`;
    case "LOOKUP":
    case "REPORT":
    case "HIGH_RISK_PARTS":
      return `Look this up and report back: “${cleaned}”.`;
    case "NAVIGATE":
    case "HOWTO":
      return `Prepare the page and steps for: “${cleaned}”.`;
    default:
      return `When approved, I will: “${cleaned}”.`;
  }
}

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

export type CarinaApprovalView = {
  approvalId: string;
  taskId: string;
  createdById: string;
  createdByName: string;
  text: string;
  readbackText: string;
  log: CarinaTaskLogEntry[];
  href: string;
  createdAt: Date;
};

export type AwaySummary = {
  finished: number;
  needsApproval: number;
  needsInfo: number;
  failed: number;
  text: string;
};

export function formatAwaySummary(s: { finished: number; needsApproval: number; needsInfo: number; failed: number }): string {
  const bits: string[] = [];
  if (s.finished) bits.push(`I finished ${s.finished}`);
  if (s.needsApproval) bits.push(`${s.needsApproval} need${s.needsApproval === 1 ? "s" : ""} your OK`);
  if (s.needsInfo) bits.push(`${s.needsInfo} need${s.needsInfo === 1 ? "s" : ""} a bit more info`);
  if (s.failed) bits.push(`${s.failed} failed`);
  if (!bits.length) return "";
  const head = bits[0].startsWith("I ") ? bits[0] : bits[0];
  const rest = bits.slice(1);
  const body = rest.length ? `${head}, ${rest.join(", ")}` : head;
  return `While you were away ${body.replace(/^I /, "I ")}.`;
}

export type CarinaTaskExecutor = {
  runAsUser(params: {
    userId: string;
    text: string;
    kind: string;
    confirmedOrApproved: boolean;
  }): Promise<{
    outcome: "done" | "needs-info" | "failed" | "needs-pin";
    text: string;
    href?: string;
    question?: string;
  }>;
};

export type CarinaTaskDeps = {
  now?: () => Date;
  hasPermission?: (userId: string, permission: string) => Promise<boolean>;
  notify?: (params: { userId: string; title: string; body: string; href?: string; entityId: string }) => Promise<void>;
  audit?: (params: { entityId: string; action: string; userId?: string; changes?: unknown }) => Promise<void>;
  createApproval?: (task: CarinaTaskRecord) => Promise<string>;
  decideApprovalRow?: (params: { approvalId: string; status: "APPROVED" | "REJECTED"; userId: string; comments?: string }) => Promise<void>;
  loadUserName?: (userId: string) => Promise<string>;
  executor?: CarinaTaskExecutor;
  tasks: {
    create(data: Omit<CarinaTaskRecord, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: Date; updatedAt?: Date }): Promise<CarinaTaskRecord>;
    get(id: string): Promise<CarinaTaskRecord | null>;
    listForUser(userId: string): Promise<CarinaTaskRecord[]>;
    listByStatus(statuses: string[]): Promise<CarinaTaskRecord[]>;
    listPendingApprovals(): Promise<CarinaTaskRecord[]>;
    update(id: string, data: Partial<CarinaTaskRecord>): Promise<CarinaTaskRecord>;
    claim(id: string, fromStatus: string, toStatus: string, extra: Partial<CarinaTaskRecord>): Promise<CarinaTaskRecord | null>;
    nextSortOrder(userId: string): Promise<number>;
  };
};

function iso(d: Date) {
  return d;
}

export async function addCarinaTask(
  deps: CarinaTaskDeps,
  params: {
    userId: string;
    text: string;
    confirmedReadback?: boolean;
    intent?: { kind?: string } | null;
    idempotencyKey?: string;
  }
): Promise<{ task: CarinaTaskRecord | null; text: string; href?: string }> {
  const original = params.text.trim();
  const confirmed = params.confirmedReadback ?? utteranceConfirmsReadback(original);
  const body = stripAddToListPrefix(original) || original;
  const intent = params.intent ?? parseVoiceActionIntent(body);
  const classified = classifyCarinaTask({ text: body, intent, confirmedReadback: confirmed });

  if (classified.safety === "excluded") {
    return { task: null, text: classified.reason };
  }
  if (classified.safety === "needs-info" && !body) {
    return { task: null, text: classified.reason };
  }

  const now = (deps.now || (() => new Date()))();
  const sortOrder = await deps.tasks.nextSortOrder(params.userId);
  const initialStatus =
    classified.safety === "needs-info"
      ? "needs-info"
      : classified.safety === "needs-approval"
        ? "needs-approval"
        : "queued";
  const log = appendTaskLog("[]", `Added to my list: ${body}`);
  let task = await deps.tasks.create({
    createdById: params.userId,
    text: body,
    parsedIntent: JSON.stringify(intent ?? { kind: classified.kind }),
    plan: JSON.stringify({ safety: classified.safety, kind: classified.kind, reason: classified.reason }),
    status: initialStatus,
    sortOrder,
    log: classified.safety === "needs-info" ? appendTaskLog(log, classified.reason) : log,
    resultHref: null,
    resultSummary: null,
    confirmedReadback: confirmed,
    readbackText: classified.readbackText,
    approvedAt: null,
    approvedById: null,
    rejectedNote: null,
    approvalId: null,
    approvePermission: classified.approvePermission,
    needsInfoQuestion: classified.safety === "needs-info" ? classified.reason : null,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    summarizedAt: null,
    idempotencyKey: params.idempotencyKey ?? null,
    createdAt: now,
    updatedAt: now,
  });

  if (classified.safety === "needs-approval" && deps.createApproval) {
    const approvalId = await deps.createApproval(task);
    task = await deps.tasks.update(task.id, {
      approvalId,
      log: appendTaskLog(task.log, "Parked for approval in the Approvals inbox as a Carina action."),
    });
  }

  await deps.audit?.({
    entityId: task.id,
    action: "CREATED",
    userId: params.userId,
    changes: { status: task.status, safety: classified.safety, kind: classified.kind },
  });

  if (task.status === "queued" && deps.executor) {
    task = (await runOneTask(deps, task.id)) || task;
  }
  if (task.status === "done" || task.status === "failed") {
    task = await deps.tasks.update(task.id, { summarizedAt: (deps.now || (() => new Date()))() });
  }

  const href = task.status === "needs-approval" ? `/approvals#carina-${task.id}` : `/ai?task=${task.id}`;
  let text: string;
  if (task.status === "done") {
    text = `Done. ${task.resultSummary || "I finished that."}`;
  } else if (task.status === "needs-approval") {
    text = `I added it to my list and parked it for your okay in Approvals as a Carina action. ${classified.readbackText}`;
  } else if (task.status === "needs-info") {
    text = task.needsInfoQuestion || classified.reason;
  } else if (task.status === "failed") {
    text = task.lastError || "I couldn’t finish that.";
  } else {
    text = `Added to my list. ${classified.reason}`;
  }
  return { task, text, href };
}

export async function cancelCarinaTask(deps: CarinaTaskDeps, params: { userId: string; taskId: string; note?: string }) {
  const task = await deps.tasks.get(params.taskId);
  if (!task) throw new Error("I couldn’t find that task.");
  if (task.createdById !== params.userId) throw new Error("You can only cancel your own Carina tasks.");
  if (task.status === "done" || task.status === "cancelled") {
    return task;
  }
  const updated = await deps.tasks.update(task.id, {
    status: "cancelled",
    rejectedNote: params.note || "Cancelled by the requester.",
    finishedAt: (deps.now || (() => new Date()))(),
    log: appendTaskLog(task.log, params.note || "Cancelled."),
  });
  if (task.approvalId && deps.decideApprovalRow) {
    await deps.decideApprovalRow({
      approvalId: task.approvalId,
      status: "REJECTED",
      userId: params.userId,
      comments: params.note || "Cancelled by the requester.",
    });
  }
  await deps.audit?.({ entityId: task.id, action: "CANCELLED", userId: params.userId });
  return updated;
}

export async function updateCarinaTaskText(deps: CarinaTaskDeps, params: { userId: string; taskId: string; text: string }) {
  const task = await deps.tasks.get(params.taskId);
  if (!task) throw new Error("I couldn’t find that task.");
  if (task.createdById !== params.userId) throw new Error("You can only edit your own Carina tasks.");
  if (task.status === "working" || task.status === "done") {
    throw new Error("I can’t edit a task that’s already running or finished.");
  }
  const text = params.text.trim();
  if (!text) throw new Error("Task text can’t be empty.");
  const classified = classifyCarinaTask({
    text,
    intent: safeJson(task.parsedIntent),
    confirmedReadback: task.confirmedReadback,
  });
  const nextStatus =
    task.status === "cancelled" || task.status === "failed"
      ? task.status
      : classified.safety === "needs-approval" && !task.approvedAt
        ? "needs-approval"
        : classified.safety === "needs-info"
          ? "needs-info"
          : "queued";
  return deps.tasks.update(task.id, {
    text,
    readbackText: classified.readbackText,
    approvePermission: classified.approvePermission,
    status: nextStatus,
    log: appendTaskLog(task.log, `Updated the request to: ${text}`),
  });
}

export async function reorderCarinaTasks(deps: CarinaTaskDeps, params: { userId: string; taskIds: string[] }) {
  const list = await deps.tasks.listForUser(params.userId);
  const mine = new Set(list.map((t) => t.id));
  for (const [i, id] of params.taskIds.entries()) {
    if (!mine.has(id)) continue;
    await deps.tasks.update(id, { sortOrder: i });
  }
  return deps.tasks.listForUser(params.userId);
}

export async function canDecideCarinaTask(deps: CarinaTaskDeps, userId: string, task: CarinaTaskRecord): Promise<boolean> {
  if (task.createdById === userId) return true;
  if (task.approvePermission && deps.hasPermission) {
    return deps.hasPermission(userId, task.approvePermission);
  }
  return false;
}

export async function decideCarinaAction(
  deps: CarinaTaskDeps,
  params: { userId: string; taskId?: string; approvalId?: string; decision: "APPROVED" | "REJECTED"; note?: string }
): Promise<{ task: CarinaTaskRecord; text: string }> {
  const task = params.taskId
    ? await deps.tasks.get(params.taskId)
    : (await deps.tasks.listPendingApprovals()).find((t) => t.approvalId === params.approvalId) || null;
  if (!task) throw new Error("I couldn’t find that Carina action.");
  if (!(await canDecideCarinaTask(deps, params.userId, task))) {
    throw new Error("You don’t have permission to decide this Carina action.");
  }
  if (task.status !== "needs-approval") {
    throw new Error("That Carina action is no longer waiting for a decision.");
  }
  if (params.decision === "REJECTED") {
    const note = params.note?.trim() || "Rejected.";
    const updated = await deps.tasks.update(task.id, {
      status: "cancelled",
      rejectedNote: note,
      finishedAt: (deps.now || (() => new Date()))(),
      log: appendTaskLog(task.log, `Rejected: ${note}`),
    });
    if (task.approvalId && deps.decideApprovalRow) {
      await deps.decideApprovalRow({
        approvalId: task.approvalId,
        status: "REJECTED",
        userId: params.userId,
        comments: note,
      });
    }
    await deps.audit?.({ entityId: task.id, action: "REJECTED", userId: params.userId, changes: { note } });
    await deps.notify?.({
      userId: task.createdById,
      title: "Carina action rejected",
      body: `Your task was cancelled: ${task.text}`,
      href: `/ai?task=${task.id}`,
      entityId: task.id,
    });
    return { task: updated, text: `Cancelled with the note: ${note}` };
  }

  const now = (deps.now || (() => new Date()))();
  let updated = await deps.tasks.update(task.id, {
    status: "queued",
    approvedAt: now,
    approvedById: params.userId,
    log: appendTaskLog(task.log, "Approved in the Approvals inbox. I’ll run this as the requester."),
  });
  if (task.approvalId && deps.decideApprovalRow) {
    await deps.decideApprovalRow({
      approvalId: task.approvalId,
      status: "APPROVED",
      userId: params.userId,
      comments: params.note,
    });
  }
  await deps.audit?.({ entityId: task.id, action: "APPROVED", userId: params.userId });
  updated = (await runOneTask(deps, updated.id)) || updated;
  return { task: updated, text: updated.status === "done" ? updated.resultSummary || "Done." : "Approved. I’ll run it as the requester." };
}

export async function listCarinaApprovalsForUser(
  deps: CarinaTaskDeps,
  params: { userId: string }
): Promise<CarinaApprovalView[]> {
  const pending = await deps.tasks.listPendingApprovals();
  const out: CarinaApprovalView[] = [];
  for (const task of pending) {
    if (!(await canDecideCarinaTask(deps, params.userId, task))) continue;
    const name = (await deps.loadUserName?.(task.createdById)) || "A teammate";
    out.push({
      approvalId: task.approvalId || task.id,
      taskId: task.id,
      createdById: task.createdById,
      createdByName: name,
      text: task.text,
      readbackText: task.readbackText || buildReadback(safeJson(task.parsedIntent)?.kind || "LOOKUP", task.text),
      log: parseTaskLog(task.log),
      href: `/ai?task=${task.id}`,
      createdAt: task.createdAt,
    });
  }
  return out;
}

export async function consumeAwaySummary(deps: CarinaTaskDeps, userId: string): Promise<AwaySummary> {
  const list = await deps.tasks.listForUser(userId);
  const pending = list.filter((t) => !t.summarizedAt && ["done", "needs-approval", "needs-info", "failed"].includes(t.status));
  const finished = pending.filter((t) => t.status === "done").length;
  const needsApproval = pending.filter((t) => t.status === "needs-approval").length;
  const needsInfo = pending.filter((t) => t.status === "needs-info").length;
  const failed = pending.filter((t) => t.status === "failed").length;
  const text = formatAwaySummary({ finished, needsApproval, needsInfo, failed });
  const now = (deps.now || (() => new Date()))();
  for (const t of pending) {
    await deps.tasks.update(t.id, { summarizedAt: now });
  }
  return { finished, needsApproval, needsInfo, failed, text };
}

export async function runDueTasks(deps: CarinaTaskDeps, opts?: { limit?: number; staleMs?: number }) {
  const limit = opts?.limit ?? 10;
  const staleMs = opts?.staleMs ?? 10 * 60 * 1000;
  const now = (deps.now || (() => new Date()))();
  const working = await deps.tasks.listByStatus(["working"]);
  for (const t of working) {
    if (t.startedAt && now.getTime() - t.startedAt.getTime() > staleMs) {
      await deps.tasks.update(t.id, {
        status: "queued",
        log: appendTaskLog(t.log, "Re-queued after a stale working lock."),
      });
    }
  }
  const queued = await deps.tasks.listByStatus(["queued"]);
  let ran = 0;
  for (const t of queued) {
    if (ran >= limit) break;
    const done = await runOneTask(deps, t.id);
    if (done) ran += 1;
  }
  return ran;
}

export async function runOneTask(deps: CarinaTaskDeps, taskId: string): Promise<CarinaTaskRecord | null> {
  const claimed = await deps.tasks.claim(taskId, "queued", "working", {
    startedAt: (deps.now || (() => new Date()))(),
  });
  if (!claimed) return null;
  const intent = safeJson(claimed.parsedIntent);
  const kind = intent?.kind || "LOOKUP";
  const confirmedOrApproved = !!(claimed.confirmedReadback || claimed.approvedAt);
  if (!deps.executor) {
    return deps.tasks.update(claimed.id, {
      status: "queued",
      log: appendTaskLog(claimed.log, "No executor bound; left queued."),
    });
  }
  try {
    const result = await deps.executor.runAsUser({
      userId: claimed.createdById,
      text: claimed.text,
      kind,
      confirmedOrApproved,
    });
    if (result.outcome === "needs-info") {
      const updated = await deps.tasks.update(claimed.id, {
        status: "needs-info",
        needsInfoQuestion: result.question || result.text,
        resultSummary: result.text,
        resultHref: result.href ?? null,
        log: appendTaskLog(claimed.log, result.text, result.href),
      });
      await deps.notify?.({
        userId: claimed.createdById,
        title: "Carina needs a bit more info",
        body: result.question || result.text,
        href: `/ai?task=${claimed.id}`,
        entityId: claimed.id,
      });
      await deps.audit?.({ entityId: claimed.id, action: "NEEDS_INFO", userId: claimed.createdById });
      return updated;
    }
    if (result.outcome === "needs-pin") {
      const msg = "This needs your sign-off PIN live — I won’t run a signature while you’re away.";
      const updated = await deps.tasks.update(claimed.id, {
        status: "needs-info",
        needsInfoQuestion: msg,
        lastError: msg,
        log: appendTaskLog(claimed.log, msg),
      });
      await deps.notify?.({
        userId: claimed.createdById,
        title: "Carina needs you live for a PIN",
        body: msg,
        href: `/ai?task=${claimed.id}`,
        entityId: claimed.id,
      });
      return updated;
    }
    if (result.outcome === "failed") {
      const updated = await deps.tasks.update(claimed.id, {
        status: "failed",
        lastError: result.text,
        finishedAt: (deps.now || (() => new Date()))(),
        log: appendTaskLog(claimed.log, result.text, result.href),
      });
      await deps.notify?.({
        userId: claimed.createdById,
        title: "Carina couldn’t finish a task",
        body: result.text,
        href: `/ai?task=${claimed.id}`,
        entityId: claimed.id,
      });
      await deps.audit?.({ entityId: claimed.id, action: "FAILED", userId: claimed.createdById });
      return updated;
    }
    const updated = await deps.tasks.update(claimed.id, {
      status: "done",
      resultSummary: result.text,
      resultHref: result.href ?? null,
      finishedAt: (deps.now || (() => new Date()))(),
      log: appendTaskLog(claimed.log, result.text, result.href),
    });
    await deps.notify?.({
      userId: claimed.createdById,
      title: "Carina finished a task",
      body: result.text,
      href: result.href || `/ai?task=${claimed.id}`,
      entityId: claimed.id,
    });
    await deps.audit?.({ entityId: claimed.id, action: "DONE", userId: claimed.createdById });
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "The task failed.";
    const updated = await deps.tasks.update(claimed.id, {
      status: "failed",
      lastError: message,
      finishedAt: (deps.now || (() => new Date()))(),
      log: appendTaskLog(claimed.log, message),
    });
    await deps.notify?.({
      userId: claimed.createdById,
      title: "Carina couldn’t finish a task",
      body: message,
      href: `/ai?task=${claimed.id}`,
      entityId: claimed.id,
    });
    return updated;
  }
}

function safeJson(raw: string | null | undefined): { kind?: string } | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { kind?: string };
  } catch {
    return null;
  }
}

/** In-memory store used by fixture tests. */
export function memoryCarinaTaskStore(seed: CarinaTaskRecord[] = []): CarinaTaskDeps["tasks"] {
  const rows = new Map<string, CarinaTaskRecord>(seed.map((r) => [r.id, { ...r }]));
  let seq = seed.length + 1;
  return {
    async create(data) {
      const id = data.id || `task_${seq++}`;
      const now = new Date();
      const row: CarinaTaskRecord = { ...data, id, createdAt: data.createdAt || now, updatedAt: now };
      rows.set(id, row);
      return { ...row };
    },
    async get(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async listForUser(userId) {
      return [...rows.values()].filter((r) => r.createdById === userId).sort((a, b) => a.sortOrder - b.sortOrder || +a.createdAt - +b.createdAt).map((r) => ({ ...r }));
    },
    async listByStatus(statuses) {
      const set = new Set(statuses);
      return [...rows.values()].filter((r) => set.has(r.status)).sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({ ...r }));
    },
    async listPendingApprovals() {
      return [...rows.values()].filter((r) => r.status === "needs-approval").map((r) => ({ ...r }));
    },
    async update(id, data) {
      const cur = rows.get(id);
      if (!cur) throw new Error("missing task");
      const next = { ...cur, ...data, id, updatedAt: new Date() };
      rows.set(id, next);
      return { ...next };
    },
    async claim(id, fromStatus, toStatus, extra) {
      const cur = rows.get(id);
      if (!cur || cur.status !== fromStatus) return null;
      const next = { ...cur, ...extra, status: toStatus, updatedAt: new Date() };
      rows.set(id, next);
      return { ...next };
    },
    async nextSortOrder(userId) {
      const mine = [...rows.values()].filter((r) => r.createdById === userId);
      return mine.reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1;
    },
  };
}

export async function prismaCarinaTaskDeps(): Promise<CarinaTaskDeps> {
  return {
    hasPermission: (userId, permission) => userHasPermission(userId, permission),
    async notify(params) {
      await prisma.userNotification.create({
        data: {
          userId: params.userId,
          type: "CARINA_TASK",
          title: params.title,
          body: params.body,
          href: params.href,
          entityType: "CarinaTask",
          entityId: params.entityId,
        },
      });
    },
    async audit(params) {
      await logAudit({
        entityType: "CarinaTask",
        entityId: params.entityId,
        action: params.action,
        userId: params.userId,
        changes: params.changes as Record<string, unknown> | undefined,
        metadata: { source: "carina" },
      });
    },
    async createApproval(task) {
      const row = await prisma.approval.create({
        data: {
          entityType: CARINA_ACTION_ENTITY,
          entityId: task.id,
          stage: CARINA_ACTION_STAGE,
          status: "PENDING",
          approverId: task.createdById,
        },
      });
      return row.id;
    },
    async decideApprovalRow(params) {
      await prisma.approval.update({
        where: { id: params.approvalId },
        data: {
          status: params.status,
          comments: params.comments,
          decidedAt: new Date(),
          approverId: params.userId,
        },
      });
    },
    async loadUserName(userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      return user?.name || "A teammate";
    },
    executor: liveCarinaTaskExecutor(),
    tasks: prismaCarinaTaskStore(),
  };
}

export function prismaCarinaTaskStore(): CarinaTaskDeps["tasks"] {
  return {
    async create(data) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = data;
      const row = await prisma.carinaTask.create({ data: rest });
      return row as CarinaTaskRecord;
    },
    async get(id) {
      const row = await prisma.carinaTask.findUnique({ where: { id } });
      return (row as CarinaTaskRecord | null) ?? null;
    },
    async listForUser(userId) {
      const rows = await prisma.carinaTask.findMany({
        where: { createdById: userId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      return rows as CarinaTaskRecord[];
    },
    async listByStatus(statuses) {
      const rows = await prisma.carinaTask.findMany({
        where: { status: { in: statuses } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      return rows as CarinaTaskRecord[];
    },
    async listPendingApprovals() {
      const rows = await prisma.carinaTask.findMany({
        where: { status: "needs-approval" },
        orderBy: { createdAt: "asc" },
      });
      return rows as CarinaTaskRecord[];
    },
    async update(id, data) {
      const row = await prisma.carinaTask.update({ where: { id }, data });
      return row as CarinaTaskRecord;
    },
    async claim(id, fromStatus, toStatus, extra) {
      const result = await prisma.carinaTask.updateMany({
        where: { id, status: fromStatus },
        data: { ...extra, status: toStatus },
      });
      if (result.count !== 1) return null;
      const row = await prisma.carinaTask.findUnique({ where: { id } });
      return (row as CarinaTaskRecord | null) ?? null;
    },
    async nextSortOrder(userId) {
      const agg = await prisma.carinaTask.aggregate({
        where: { createdById: userId },
        _max: { sortOrder: true },
      });
      return (agg._max.sortOrder ?? -1) + 1;
    },
  };
}

export function liveCarinaTaskExecutor(): CarinaTaskExecutor {
  return {
    async runAsUser(params) {
      const { getCarinaFeatures } = await import("@/lib/services/carina-features");
      const features = await getCarinaFeatures();
      const writeKind = EXISTING_RECORD_KINDS.has(params.kind) || UNATTENDED_KINDS.has(params.kind) && params.kind !== "LOOKUP" && params.kind !== "REPORT" && params.kind !== "NAVIGATE" && params.kind !== "HOWTO" && params.kind !== "HIGH_RISK_PARTS";
      if (writeKind && !features.voiceActions) {
        return {
          outcome: "failed",
          text: "Carina voice actions are turned off for this workspace, so I couldn’t make that change in the background.",
        };
      }
      if (writeKind) {
        const { handleCarinaVoiceTurn, executeCarinaDraft } = await import("@/lib/services/carina-voice-actions");
        const turn = await handleCarinaVoiceTurn({
          question: params.text,
          userId: params.userId,
        });
        if (!turn) {
          return { outcome: "needs-info", text: "I need a bit more detail before I can do that in the background.", question: "I need a bit more detail before I can do that in the background." };
        }
        if (turn.pendingAction?.phase === "clarify") {
          return { outcome: "needs-info", text: turn.text, question: turn.text, href: turn.href };
        }
        if (turn.pendingAction?.phase === "confirm" && turn.pendingAction.draft) {
          const draft = turn.pendingAction.draft as { execute?: { requiresPin?: boolean } };
          if (draft.execute?.requiresPin) {
            return { outcome: "needs-pin", text: "This needs your sign-off PIN live — I won’t run a signature while you’re away." };
          }
          if (!params.confirmedOrApproved && EXISTING_RECORD_KINDS.has(params.kind)) {
            return { outcome: "failed", text: "This change still needs your okay. I didn’t apply it." };
          }
          const key = turn.pendingAction.idempotencyKey || turn.pendingAction.partial?.idempotencyKey;
          if (!key) return { outcome: "failed", text: "I had a draft but no confirmation key." };
          const executed = await executeCarinaDraft({
            userId: params.userId,
            draft: turn.pendingAction.draft,
            idempotencyKey: key,
          });
          return { outcome: "done", text: executed.text, href: executed.href };
        }
        return { outcome: "done", text: turn.text, href: turn.href };
      }
      const { processAiConversation } = await import("@/lib/services/ai");
      const out = await processAiConversation([{ role: "user", content: params.text }], {
        userId: params.userId,
        skipCarinaTasks: true,
      } as { userId: string; skipCarinaTasks: boolean });
      return { outcome: "done", text: out.text, href: out.href };
    },
  };
}

export type { VoiceActionKind };
