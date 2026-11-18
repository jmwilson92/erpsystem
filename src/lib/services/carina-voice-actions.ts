/**
 * Carina voice / chat record actions.
 *
 * Off by default (CompanySettings.carinaVoiceActions). When an admin opts in,
 * Carina proposes a draft of the exact change and only writes after Confirm
 * (button or voice). Signature-gated work also needs voice "approve" plus the
 * user's PIN. Execution goes through the same services the UI uses, under the
 * signed-in user's permissions. No service-role bypass.
 */
import { createHash, randomUUID } from "node:crypto";
import { userCanView, userHasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { AiConversationOutput, AiPendingAction } from "@/lib/services/ai";
import {
  isApproveUtterance,
  isCancelUtterance,
  isConfirmUtterance,
  isExcludedDomain,
  parseVoiceActionIntent,
  type ParsedVoiceIntent,
  type VoiceActionKind,
} from "@/lib/services/carina-voice-intent";
import { getCarinaFeatures } from "@/lib/services/carina-features";

export type CarinaDraftChange = {
  entityType: string;
  entityId: string;
  entityLabel: string;
  field: string;
  from: string;
  to: string;
};

export type CarinaExecutePlan = {
  kind: VoiceActionKind;
  permission: string;
  requiresPin: boolean;
  params: Record<string, string | number | null | undefined>;
};

export type CarinaActionDraft = {
  title: string;
  summary: string;
  changes: CarinaDraftChange[];
  execute: CarinaExecutePlan;
};

const DISCLOSE =
  "I’m Carina, Protessera’s AI assistant. I can make mistakes. I haven’t changed any records until you confirm.";

function fmt(v: unknown): string {
  if (v == null || v === "") return "(none)";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function parseLooseDate(s: string): Date | null {
  const t = s.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    const d = new Date(`${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

async function resolveUnique<T extends { id: string }>(
  rows: T[],
  label: string,
  describe: (row: T) => string
): Promise<T> {
  if (rows.length === 0) throw new Error(`I couldn’t find that ${label}. Please give the exact number.`);
  if (rows.length > 1) {
    const opts = rows.slice(0, 8).map(describe).join("; ");
    throw new Error(
      `I found ${rows.length} matching ${label}s. Please specify the exact number so I don’t change the wrong one: ${opts}.`
    );
  }
  return rows[0];
}

async function findWorkOrder(hint?: string, numbers?: string[]) {
  const token =
    numbers?.find((n) => /^(WO|SWO|BWO|MWO)-/i.test(n)) || hint?.trim();
  if (!token) throw new Error("Which work order? Please include the WO number, like WO-00012.");
  const rows = await prisma.workOrder.findMany({
    where: {
      OR: [
        { number: { equals: token, mode: "insensitive" } },
        { number: { endsWith: token, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      number: true,
      status: true,
      type: true,
      projectId: true,
      wbsElementId: true,
      workCenter: true,
      project: { select: { number: true, name: true } },
      wbsElement: { select: { code: true, name: true } },
    },
    take: 8,
  });
  return resolveUnique(rows, "work order", (r) => `${r.number} (${r.status})`);
}

async function findProject(hint?: string, numbers?: string[]) {
  const token =
    numbers?.find((n) => /^(PRJ|PROJ)-/i.test(n)) || hint?.trim();
  if (!token) throw new Error("Which project? Please include the project number, like PRJ-00012, or the exact name.");
  const rows = await prisma.project.findMany({
    where: {
      OR: [
        { number: { equals: token, mode: "insensitive" } },
        { number: { contains: token, mode: "insensitive" } },
        { name: { equals: token, mode: "insensitive" } },
        { name: { contains: token, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      number: true,
      name: true,
      status: true,
      phase: true,
      description: true,
      startDate: true,
      endDate: true,
    },
    take: 8,
  });
  return resolveUnique(rows, "project", (r) => `${r.number} “${r.name}”`);
}

async function findBudget(hint?: string, numbers?: string[]) {
  const token =
    numbers?.find((n) => /^(BDGT|BUDGET)-/i.test(n)) || hint?.trim();
  if (!token) throw new Error("Which budget? Please include the budget number or charge code.");
  const rows = await prisma.budget.findMany({
    where: {
      OR: [
        { number: { equals: token, mode: "insensitive" } },
        { number: { contains: token, mode: "insensitive" } },
        { chargeCode: { equals: token, mode: "insensitive" } },
        { name: { equals: token, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      number: true,
      name: true,
      chargeCode: true,
      status: true,
      projectId: true,
      wbsElementId: true,
      project: { select: { id: true, number: true, name: true } },
      wbsElement: { select: { id: true, code: true, name: true } },
    },
    take: 8,
  });
  return resolveUnique(rows, "budget", (r) => `${r.number} “${r.name}”`);
}

async function findPart(hint?: string, numbers?: string[]) {
  const token =
    numbers?.find((n) => !/^(WO|SWO|BWO|MWO|PRJ|PROJ|BDGT|BUDGET|CC)-/i.test(n)) ||
    hint?.trim();
  if (!token) throw new Error("Which part? Please include the part number.");
  const rows = await prisma.part.findMany({
    where: {
      isActive: true,
      OR: [
        { partNumber: { equals: token, mode: "insensitive" } },
        { partNumber: { contains: token, mode: "insensitive" } },
      ],
    },
    select: { id: true, partNumber: true, description: true, abcClass: true, minStock: true },
    take: 8,
  });
  return resolveUnique(rows, "part", (r) => r.partNumber);
}

async function draftPending(
  draft: CarinaActionDraft,
  text: string,
  userId: string
): Promise<AiConversationOutput> {
  const idempotencyKey = randomUUID();
  const pending: AiPendingAction = {
    action: draft.execute.kind,
    partial: { idempotencyKey },
    phase: "confirm",
    draft,
    idempotencyKey,
    requiresPin: draft.execute.requiresPin,
  };
  await prisma.carinaVoiceActionReceipt.create({
    data: {
      idempotencyKey,
      userId,
      action: draft.execute.kind,
      entityType: draft.changes[0]?.entityType || "Unknown",
      entityId: draft.changes[0]?.entityId || "unknown",
      status: "PENDING",
      requestHash: await requestHash(draft.execute),
      result: JSON.stringify(draft),
    },
  });
  return {
    text,
    source: "local",
    pendingAction: pending,
  };
}

async function buildDraft(
  intent: ParsedVoiceIntent,
  userId: string
): Promise<AiConversationOutput> {
  switch (intent.kind) {
    case "EDIT_PROJECT": {
      const project = await findProject(intent.projectHint, intent.numbers);
      const fields = intent.projectFields || {};
      const allowed = ["name", "description", "status", "phase", "startDate", "endDate"] as const;
      const changes: CarinaDraftChange[] = [];
      const params: Record<string, string | number | null | undefined> = { projectId: project.id };
      for (const key of allowed) {
        if (fields[key] == null || fields[key] === "") continue;
        let to = fields[key];
        let from: unknown = project[key as keyof typeof project];
        if (key === "startDate" || key === "endDate") {
          const d = parseLooseDate(fields[key]);
          if (!d) throw new Error(`I couldn’t read the ${key} “${fields[key]}”. Use YYYY-MM-DD.`);
          to = d.toISOString().slice(0, 10);
          from = project[key];
          params[key] = to;
        } else if (key === "status") {
          const ok = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];
          if (!ok.includes(fields[key])) throw new Error(`Status must be one of ${ok.join(", ")}.`);
          to = fields[key];
          params[key] = to;
        } else if (key === "phase") {
          const ok = ["INITIATION", "PLANNING", "EXECUTION", "MONITORING", "CLOSURE"];
          if (!ok.includes(fields[key])) throw new Error(`Phase must be one of ${ok.join(", ")}.`);
          to = fields[key];
          params[key] = to;
        } else {
          params[key] = fields[key];
        }
        if (fmt(from) === fmt(to)) continue;
        changes.push({
          entityType: "Project",
          entityId: project.id,
          entityLabel: `${project.number} ${project.name}`,
          field: key,
          from: fmt(from),
          to: fmt(to),
        });
      }
      if (!changes.length) {
        throw new Error(
          `I found ${project.number} “${project.name}”, but I need the exact field to change (name, description, status, phase, start date or end date). I won’t edit budgets or contract values.`
        );
      }
      return await draftPending(
        {
          title: `Edit project ${project.number}`,
          summary: `Update ${changes.length} field(s) on ${project.number} “${project.name}”. I will not change money fields.`,
          changes,
          execute: { kind: "EDIT_PROJECT", permission: "pmo.project.manage", requiresPin: false, params },
        },
        `Here’s the exact project change I would make. Confirm to apply it, or cancel.\n${changes
          .map((c) => `• ${c.field}: ${c.from} → ${c.to}`)
          .join("\n")}\n${DISCLOSE}`,
        userId
      );
    }
    case "TIE_WO": {
      const wo = await findWorkOrder(intent.workOrderHint, intent.numbers);
      let projectId: string;
      let projectLabel: string;
      let wbsElementId: string | null = wo.wbsElementId;
      let wbsLabel = wo.wbsElement ? `${wo.wbsElement.code} ${wo.wbsElement.name}` : "(none)";
      if (intent.budgetHint || intent.numbers?.some((n) => /^(BDGT|BUDGET)-/i.test(n))) {
        const budget = await findBudget(intent.budgetHint, intent.numbers);
        if (!budget.projectId || !budget.project) {
          throw new Error(
            `${budget.number} isn’t linked to a project, so I can’t attach ${wo.number} to it.`
          );
        }
        projectId = budget.projectId;
        projectLabel = `${budget.project.number} ${budget.project.name} (via ${budget.number})`;
        if (budget.wbsElementId && budget.wbsElement) {
          wbsElementId = budget.wbsElementId;
          wbsLabel = `${budget.wbsElement.code} ${budget.wbsElement.name} (via ${budget.number})`;
        }
      } else {
        const project = await findProject(intent.projectHint, intent.numbers);
        projectId = project.id;
        projectLabel = `${project.number} ${project.name}`;
      }
      const changes: CarinaDraftChange[] = [
        {
          entityType: "WorkOrder",
          entityId: wo.id,
          entityLabel: wo.number,
          field: "project",
          from: wo.project ? `${wo.project.number} ${wo.project.name}` : "(none)",
          to: projectLabel,
        },
      ];
      if (wbsElementId !== wo.wbsElementId) {
        changes.push({
          entityType: "WorkOrder",
          entityId: wo.id,
          entityLabel: wo.number,
          field: "WBS",
          from: wo.wbsElement ? `${wo.wbsElement.code} ${wo.wbsElement.name}` : "(none)",
          to: wbsLabel,
        });
      }
      return await draftPending(
        {
          title: `Tie ${wo.number} to a project`,
          summary: `Set the project (and WBS if provided) on ${wo.number}. This does not change budget dollar amounts.`,
          changes,
          execute: {
            kind: "TIE_WO",
            permission: "workorders.status.update",
            requiresPin: false,
            params: { workOrderId: wo.id, projectId, wbsElementId },
          },
        },
        `Here’s the exact work-order link I would make. Confirm to apply it, or cancel.\n${changes
          .map((c) => `• ${c.field}: ${c.from} → ${c.to}`)
          .join("\n")}\n${DISCLOSE}`,
        userId
      );
    }
    case "CYCLE_COUNT": {
      if (intent.countedQty == null || intent.countedQty < 0) {
        throw new Error("What is the counted quantity? For example: cycle count part ABC-123 at RM-01 to 12 because cycle count.");
      }
      const part = await findPart(intent.partHint, intent.numbers);
      const items = await prisma.inventoryItem.findMany({
        where: {
          partId: part.id,
          ...(intent.locationHint ? {} : { quantityOnHand: { gt: 0 } }),
          ...(intent.locationHint
            ? {
                OR: [
                  { location: { code: { equals: intent.locationHint, mode: "insensitive" } } },
                  { location: { code: { contains: intent.locationHint, mode: "insensitive" } } },
                ],
              }
            : {}),
        },
        include: { location: { include: { warehouse: true } } },
        take: 12,
      });
      if (!items.length) {
        throw new Error(
          `I couldn’t find inventory for ${part.partNumber}${intent.locationHint ? ` at ${intent.locationHint}` : ""}. Please give the exact part number and bin.`
        );
      }
      if (!intent.locationHint && items.length > 1) {
        const opts = items
          .map((i) => `${i.location.warehouse.code}/${i.location.code} (on hand ${i.quantityOnHand})`)
          .join("; ");
        throw new Error(
          `${part.partNumber} is in ${items.length} locations. Please specify the bin so I don’t adjust the wrong one: ${opts}.`
        );
      }
      if (intent.locationHint && items.length > 1) {
        const opts = items
          .map((i) => `${i.location.warehouse.code}/${i.location.code}`)
          .join("; ");
        throw new Error(`That location is ambiguous. Please use the exact bin code: ${opts}.`);
      }
      const item = items[0];
      const loc = `${item.location.warehouse.code}/${item.location.code}`;
      const reason = intent.reason?.trim() || "Cycle count adjustment via Carina";
      const changes: CarinaDraftChange[] = [
        {
          entityType: "InventoryItem",
          entityId: item.id,
          entityLabel: `${part.partNumber} at ${loc}`,
          field: "quantityOnHand",
          from: fmt(item.quantityOnHand),
          to: fmt(intent.countedQty),
        },
      ];
      return await draftPending(
        {
          title: `Cycle count ${part.partNumber}`,
          summary: `Post a cycle count for ${part.partNumber} at ${loc}: ${item.quantityOnHand} → ${intent.countedQty}. Reason: ${reason}.`,
          changes,
          execute: {
            kind: "CYCLE_COUNT",
            permission: "inventory.cyclecount",
            requiresPin: false,
            params: {
              partId: part.id,
              locationCode: item.location.code,
              countedQty: intent.countedQty,
              reason,
            },
          },
        },
        `Here’s the exact inventory count I would post through the cycle-count process. Confirm to apply it, or cancel.\n• ${part.partNumber} at ${loc}: ${item.quantityOnHand} → ${intent.countedQty}\nReason: ${reason}\n${DISCLOSE}`, userId);
    }
    case "CONSUME_PARTS": {
      const wo = await findWorkOrder(intent.workOrderHint, intent.numbers);
      const openKit = await prisma.kitOrder.findFirst({
        where: { workOrderId: wo.id, status: { not: "COMPLETE" } },
        include: { lines: { include: { part: { select: { partNumber: true } } } } },
        orderBy: { createdAt: "desc" },
      });
      const changes: CarinaDraftChange[] = [];
      if (openKit) {
        for (const line of openKit.lines) {
          const remaining = line.quantityRequired - line.quantityPicked;
          if (remaining <= 0.0001) continue;
          changes.push({
            entityType: "KitOrder",
            entityId: openKit.id,
            entityLabel: openKit.number,
            field: `${line.part.partNumber} picked`,
            from: fmt(line.quantityPicked),
            to: fmt(line.quantityRequired),
          });
        }
        if (!changes.length) {
          throw new Error(`${openKit.number} is already fully picked. There is nothing left to consume.`);
        }
      } else {
        changes.push({
          entityType: "WorkOrder",
          entityId: wo.id,
          entityLabel: wo.number,
          field: "kit",
          from: "(no open kit)",
          to: "Create a kit and pick available inventory into staging",
        });
      }
      return await draftPending(
        {
          title: `Consume parts to ${wo.number}`,
          summary: openKit
            ? `Complete kit ${openKit.number} for ${wo.number} using the standard pick order.`
            : `Open a kit for ${wo.number} and complete it from available inventory, using the same kitting services as the floor.`,
          changes,
          execute: {
            kind: "CONSUME_PARTS",
            permission: openKit ? "kitting.complete" : "kitting.create",
            requiresPin: false,
            params: { workOrderId: wo.id, kitOrderId: openKit?.id || null },
          },
        },
        `Here’s the exact kitting change I would make for ${wo.number}. Confirm to apply it, or cancel.\n${changes
          .map((c) => `• ${c.field}: ${c.from} → ${c.to}`)
          .join("\n")}\n${DISCLOSE}`,
        userId
      );
    }
    case "OUTPUT_WO": {
      const wo = await findWorkOrder(intent.workOrderHint, intent.numbers);
      if (["COMPLETED", "CLOSED", "CANCELLED"].includes(wo.status)) {
        throw new Error(`${wo.number} is already ${wo.status}.`);
      }
      const mode = wo.status === "READY_FOR_PUTAWAY" ? "STOCK" : "RECEIVING";
      const to = mode === "STOCK" ? "COMPLETED (put away to stock)" : "READY_FOR_PUTAWAY (park at Receiving; not stocked yet)";
      const permission = mode === "STOCK" ? "workorders.complete" : "workorders.status.update";
      const changes: CarinaDraftChange[] = [
        {
          entityType: "WorkOrder",
          entityId: wo.id,
          entityLabel: wo.number,
          field: "status",
          from: wo.status,
          to,
        },
      ];
      return await draftPending(
        {
          title: mode === "STOCK" ? `Put away ${wo.number} to stock` : `Send ${wo.number} to Receiving`,
          summary:
            mode === "STOCK"
              ? `${wo.number} is already at Receiving putaway. Confirming will complete it to stock using the same putaway service as the Receiving board.`
              : `${wo.number} will be sent to the Receiving work center (READY_FOR_PUTAWAY). It is not stocked until a later putaway. Traveler sign-off still has to be finished first.`,
          changes,
          execute: {
            kind: "OUTPUT_WO",
            permission,
            requiresPin: false,
            params: { workOrderId: wo.id, mode },
          },
        },
        `Here’s the exact work-order status change I would make. Confirm to apply it, or cancel.\n• status: ${wo.status} → ${to}\n${DISCLOSE}`, userId);
    }
    case "HIGH_RISK_PARTS":
      throw new Error("HIGH_RISK_PARTS is read-only and should be answered directly");
  }
}

async function highRiskReply(): Promise<AiConversationOutput> {
  const parts = await prisma.part.findMany({
    where: { isActive: true, abcClass: { equals: "A", mode: "insensitive" } },
    select: {
      id: true,
      partNumber: true,
      description: true,
      minStock: true,
      abcClass: true,
      inventoryItems: {
        select: { quantityOnHand: true, quantityAvailable: true },
      },
    },
    orderBy: { partNumber: "asc" },
    take: 50,
  });
  if (!parts.length) {
    return {
      text: `I don’t see any active parts classified ABC class A (the high-risk / high-value class) in this workspace. Open Inventory to review other risk views. ${DISCLOSE}`,
      source: "local",
      pendingAction: null,
    };
  }
  const lines = parts.slice(0, 15).map((p) => {
    const onHand = p.inventoryItems.reduce((s, i) => s + i.quantityOnHand, 0);
    const available = p.inventoryItems.reduce((s, i) => s + i.quantityAvailable, 0);
    const low = p.minStock > 0 && available <= p.minStock ? " (at or below min)" : "";
    return `• ${p.partNumber}: on hand ${onHand}, available ${available}, min ${p.minStock || 0}${low}`;
  });
  const more = parts.length > 15 ? `\n…and ${parts.length - 15} more class A parts.` : "";
  return {
    text: `High-risk parts in this workspace are ABC class A. I found ${parts.length}:\n${lines.join("\n")}${more}\nThese are read-only counts from your current inventory. ${DISCLOSE}`,
    source: "local",
    pendingAction: null,
  };
}

async function requestHash(plan: CarinaExecutePlan): Promise<string> {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export async function executeCarinaDraft(params: {
  userId: string;
  draft?: CarinaActionDraft | null;
  idempotencyKey: string;
  pinCode?: string | null;
  voiceApproved?: boolean;
}): Promise<{ text: string; href?: string }> {
  const { userId, idempotencyKey } = params;
  const existing = await prisma.carinaVoiceActionReceipt.findUnique({
    where: { idempotencyKey },
  });
  if (existing?.status === "CONFIRMED") {
    return {
      text: existing.result || "That confirmation was already applied. I didn’t change anything again.",
    };
  }
  if (existing && existing.userId !== userId) {
    throw new Error("That confirmation belongs to another session. I didn’t change any records.");
  }
  if (existing?.status === "CANCELLED") {
    throw new Error("That draft was cancelled. Ask me to prepare the change again.");
  }
  let draft = params.draft;
  if (existing?.status === "PENDING" && existing.result) {
    try {
      draft = JSON.parse(existing.result) as CarinaActionDraft;
    } catch {
      draft = params.draft;
    }
  }
  if (!draft?.execute || existing?.status !== "PENDING") {
    throw new Error("That confirmation expired or was not found. Please ask me to prepare the change again.");
  }
  if (draft.execute.requiresPin) {
    if (!params.voiceApproved) {
      throw new Error("This change needs a voice “approve” and your sign-off PIN. Voice alone is not a signature.");
    }
    if (!params.pinCode?.trim()) {
      throw new Error("Enter your sign-off PIN on the card. I will not accept a voice-only signature.");
    }
    const { verifySignaturePin } = await import("@/lib/services/signature-pin");
    await verifySignaturePin(userId, params.pinCode);
  }

  const allowed = await userHasPermission(userId, draft.execute.permission);
  if (!allowed) {
    throw new Error(
      `You don’t have permission to do this (${draft.execute.permission}). I didn’t change any records.`
    );
  }

  const hash = await requestHash(draft.execute);
  const kind = draft.execute.kind;
  const p = draft.execute.params;
  let href: string | undefined;
  let text = "Done.";

  try {
    if (kind === "EDIT_PROJECT") {
      const { updateProjectCharter } = await import("@/lib/services/pmo");
      const startDate = typeof p.startDate === "string" ? parseLooseDate(p.startDate) : undefined;
      const endDate = typeof p.endDate === "string" ? parseLooseDate(p.endDate) : undefined;
      await updateProjectCharter({
        id: String(p.projectId),
        name: typeof p.name === "string" ? p.name : undefined,
        description: typeof p.description === "string" ? p.description : undefined,
        status: typeof p.status === "string" ? p.status : undefined,
        phase: typeof p.phase === "string" ? p.phase : undefined,
        startDate: startDate === null ? undefined : startDate,
        endDate: endDate === null ? undefined : endDate,
        userId,
      });
      href = `/pmo/projects/${p.projectId}`;
      text = `I updated the project. ${draft.changes
        .map((c) => `${c.field}: ${c.from} → ${c.to}`)
        .join("; ")}.`;
    } else if (kind === "TIE_WO") {
      const { assignWorkOrderProject } = await import("@/lib/services/work-orders");
      await assignWorkOrderProject({
        workOrderId: String(p.workOrderId),
        projectId: String(p.projectId),
        wbsElementId: p.wbsElementId ? String(p.wbsElementId) : null,
        userId,
      });
      href = `/work-orders/${p.workOrderId}`;
      text = `I linked the work order to the project. ${draft.changes
        .map((c) => `${c.field}: ${c.from} → ${c.to}`)
        .join("; ")}.`;
    } else if (kind === "CYCLE_COUNT") {
      const { createCycleCount, recordCycleCountLine, completeCycleCount } = await import(
        "@/lib/services/cycle-counts"
      );
      const cc = await createCycleCount({
        partId: String(p.partId),
        locationCode: p.locationCode ? String(p.locationCode) : undefined,
        notes: p.reason ? String(p.reason) : "Cycle count via Carina",
        userId,
      });
      if (cc.lines.length !== 1) {
        const { cancelCycleCount } = await import("@/lib/services/cycle-counts");
        await cancelCycleCount(cc.id);
        throw new Error(
          `The cycle count matched ${cc.lines.length} lines, so I cancelled it. Please name the exact part and bin.`
        );
      }
      await recordCycleCountLine({
        lineId: cc.lines[0].id,
        countedQty: Number(p.countedQty),
        userId,
      });
      await completeCycleCount({ cycleCountId: cc.id, userId });
      href = `/inventory/cycle-counts/${cc.id}`;
      text = `I posted cycle count ${cc.number}: ${draft.changes
        .map((c) => `${c.entityLabel} ${c.from} → ${c.to}`)
        .join("; ")}.`;
    } else if (kind === "CONSUME_PARTS") {
      const { createKitOrder, completeKitOrder } = await import(
        "@/lib/services/order-fulfillment"
      );
      let kitId = p.kitOrderId ? String(p.kitOrderId) : "";
      if (!kitId) {
        const canCreate = await userHasPermission(userId, "kitting.create");
        const canComplete = await userHasPermission(userId, "kitting.complete");
        if (!canCreate || !canComplete) {
          throw new Error("You don’t have permission to create and complete a kit. I didn’t change any records.");
        }
        const kit = await createKitOrder({ workOrderId: String(p.workOrderId), userId });
        kitId = kit.id;
      } else {
        const canComplete = await userHasPermission(userId, "kitting.complete");
        if (!canComplete) {
          throw new Error("You don’t have permission to complete a kit. I didn’t change any records.");
        }
      }
      const kit = await completeKitOrder({ kitOrderId: kitId, userId });
      href = `/work-orders/${p.workOrderId}`;
      text = `I consumed kit material for the work order${kit?.number ? ` (${kit.number})` : ""}.`;
    } else if (kind === "OUTPUT_WO") {
      if (p.mode === "STOCK") {
        const { completeWorkOrderToStock } = await import("@/lib/services/order-fulfillment");
        await completeWorkOrderToStock({ workOrderId: String(p.workOrderId), userId });
        text = "I put the work order away to stock.";
      } else {
        const { sendWorkOrderToReceivingPutaway } = await import("@/lib/services/work-orders");
        const r = await sendWorkOrderToReceivingPutaway({
          workOrderId: String(p.workOrderId),
          userId,
          reason: "Carina voice action: send to Receiving putaway",
        });
        text = r.alreadyThere
          ? `The work order is already at ${r.workCenter}. Open Receiving to put it away to stock.`
          : `I parked the work order at ${r.workCenter}. It is not stocked until Receiving putaway.`;
        href = "/receiving?tab=putaway";
      }
      href = href || `/work-orders/${p.workOrderId}`;
    } else {
      throw new Error("Unknown Carina action");
    }

    const result = `${text} ${DISCLOSE}`;
    await prisma.carinaVoiceActionReceipt.update({
      where: { idempotencyKey },
      data: { status: "CONFIRMED", requestHash: hash, result },
    });
    await logAudit({
      entityType: draft.changes[0]?.entityType || "CarinaVoiceAction",
      entityId: draft.changes[0]?.entityId || idempotencyKey,
      action: "CARINA_VOICE_ACTION",
      userId,
      changes: { kind, changes: draft.changes, via: "carina" },
      metadata: { via: "carina", idempotencyKey, voiceApproved: !!params.voiceApproved },
    });
    return { text: result, href };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The change could not be applied.";
    try {
      await prisma.carinaVoiceActionReceipt.create({
        data: {
          idempotencyKey: `${idempotencyKey}:failed:${Date.now()}`,
          userId,
          action: kind,
          entityType: draft.changes[0]?.entityType || "Unknown",
          entityId: draft.changes[0]?.entityId || "unknown",
          status: "FAILED",
          requestHash: hash,
          result: msg,
        },
      });
    } catch {
      // ignore receipt collision on failure path
    }
    throw new Error(msg);
  }
}

export async function handleCarinaVoiceTurn(params: {
  question: string;
  pendingAction?: AiPendingAction | null;
  userId: string;
}): Promise<AiConversationOutput | null> {
  const features = await getCarinaFeatures();
  const pending = params.pendingAction;
  const question = params.question.trim();

  const pendingKey = pending?.idempotencyKey || pending?.partial?.idempotencyKey;
  if (pending?.phase === "confirm" && (pending.draft || pendingKey)) {
    if (isCancelUtterance(question)) {
      if (pendingKey) {
        await prisma.carinaVoiceActionReceipt.updateMany({
          where: { idempotencyKey: pendingKey, userId: params.userId, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
      }
      return {
        text: `Cancelled. I didn’t change any records. ${DISCLOSE}`,
        source: "local",
        pendingAction: null,
      };
    }
    if (isApproveUtterance(question) && pending.requiresPin && !isConfirmUtterance(question)) {
      return {
        text: "Voice approval noted. Enter your sign-off PIN on the card, then confirm. I will not accept a voice-only signature.",
        source: "local",
        pendingAction: { ...pending, voiceApproved: true },
      };
    }
    if (isConfirmUtterance(question) || (isApproveUtterance(question) && !pending.requiresPin)) {
      if (!features.voiceActions) {
        return {
          text: "Carina voice actions are turned off for this workspace. An administrator can enable them in Admin → Settings.",
          source: "local",
          pendingAction: null,
        };
      }
      try {
        if (!pendingKey) {
          throw new Error("That confirmation expired or was not found. Please ask me to prepare the change again.");
        }
        const out = await executeCarinaDraft({
          userId: params.userId,
          draft: pending.draft,
          idempotencyKey: pendingKey,
          voiceApproved: pending.voiceApproved || isApproveUtterance(question),
        });
        return { text: out.text, href: out.href, source: "local", pendingAction: null };
      } catch (e) {
        return {
          text: `${e instanceof Error ? e.message : "The change could not be applied."} ${DISCLOSE}`,
          source: "local",
          pendingAction: pending,
        };
      }
    }
  }

  const excluded = isExcludedDomain(question);
  const intent = parseVoiceActionIntent(question);
  if (!intent && !excluded) return null;

  if (!features.voiceActions) {
    if (intent || excluded) {
      return {
        text:
          excluded ||
          "Carina voice actions are turned off for this workspace, so I can’t change records. An administrator can enable them in Admin → Settings. I can still answer permission-checked counts and how-to questions. " +
            DISCLOSE,
        source: "local",
        pendingAction: null,
      };
    }
    return null;
  }

  if (excluded) {
    return { text: `${excluded} ${DISCLOSE}`, source: "local", pendingAction: null };
  }
  if (!intent) return null;

  if (intent.kind === "HIGH_RISK_PARTS") {
    const ok = await userCanView(params.userId, "inventory");
    if (!ok) {
      return {
        text: `You don’t have permission to view inventory, so I can’t list high-risk part counts. ${DISCLOSE}`,
        source: "local",
        pendingAction: null,
      };
    }
    return highRiskReply();
  }

  try {
    return await buildDraft(intent, params.userId);
  } catch (e) {
    return {
      text: `${e instanceof Error ? e.message : "I couldn’t prepare that change."} ${DISCLOSE}`,
      source: "local",
      pendingAction: null,
    };
  }
}
