/**
 * Carina agent actions — create/finish ERP records by voice or chat.
 *
 * Pattern for every action:
 *   1. Detect intent
 *   2. Parse what we can from the utterance
 *   3. If missing required fields → clarify (multi-turn via pendingAction)
 *   4. Confirm when the change is destructive or creates a record
 *   5. Execute the same service path the UI uses + audit
 */

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { completeWorkOrderToStock } from "@/lib/services/order-fulfillment";
import {
  createWorkOrder,
  updateWorkOrderStatus,
} from "@/lib/services/work-orders";
import { createStandalonePurchaseRequest } from "@/lib/services/purchase-requests";
import { createCustomer } from "@/lib/services/customers";
import { createPart } from "@/lib/services/items";
import { createPtoRequest } from "@/lib/services/hr";
import { getCarinaFeatures } from "@/lib/services/carina-features";

export type ClarifyField = {
  id: string;
  question: string;
  examples?: string;
};

export type CarinaActionResult =
  | { kind: "done"; speak: string; detail?: string; href?: string }
  | {
      kind: "clarify";
      speak: string;
      pendingAction: string;
      fields: ClarifyField[];
      partial: Record<string, string>;
    }
  | {
      kind: "confirm";
      speak: string;
      pendingAction: string;
      partial: Record<string, string>;
      summary: string;
    }
  | { kind: "blocked"; speak: string }
  | { kind: "error"; speak: string }
  | { kind: "none" };

// ─── Shared helpers ───────────────────────────────────────────────

const WO_NUM = /\b((?:WO|MWO|PWO)[- ]?\d{2,}[- ]?\d*|\d{4,}[- ]\d+)\b/i;

function extractWoNumber(text: string): string | null {
  const m = text.match(WO_NUM);
  if (!m) return null;
  return m[1].replace(/\s+/g, "-").toUpperCase().replace(/WO-?/, "WO-");
}

function isAffirmative(text: string): boolean {
  return /^(yes|yep|yeah|confirm|do it|go ahead|please|ok|okay|sure|affirmative|y)\b/i.test(
    text.trim()
  );
}

function isNegative(text: string): boolean {
  return /^(no|nope|cancel|stop|never\s*mind|don't|do not|n)\b/i.test(
    text.trim()
  );
}

function extractQuantity(text: string, fallback = 1): number {
  const m = text.match(/\b(\d+(?:\.\d+)?)\s*(x|ea|pcs|pieces|units|of|hours?|hrs?)?\b/i);
  if (!m) return fallback;
  const n = Number(m[1]);
  return n > 0 && n < 1_000_000 ? n : fallback;
}

function stripFiller(text: string, extra: RegExp[] = []): string {
  let t = text;
  const base = [
    /\b(hey|hi|carina|please|can you|could you|i need|i want|i'd like|id like|to|a|an|the|me|us|for|some|my)\b/gi,
    ...extra,
  ];
  for (const re of base) t = t.replace(re, " ");
  return t.replace(/\s+/g, " ").trim();
}

async function findWorkOrder(numberOrFragment: string) {
  const n = numberOrFragment.trim();
  const exact = await prisma.workOrder.findFirst({
    where: {
      OR: [
        { number: { equals: n, mode: "insensitive" } },
        { number: { equals: n.replace(/^WO-?/i, "WO-"), mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      number: true,
      status: true,
      quantity: true,
      part: { select: { partNumber: true, description: true } },
    },
  });
  if (exact) return exact;
  return prisma.workOrder.findFirst({
    where: {
      number: { contains: n.replace(/^WO-?/i, ""), mode: "insensitive" },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      number: true,
      status: true,
      quantity: true,
      part: { select: { partNumber: true, description: true } },
    },
  });
}

async function findPart(hint: string) {
  const h = hint.trim();
  if (!h) return null;
  const exact = await prisma.part.findFirst({
    where: {
      isActive: true,
      OR: [
        { partNumber: { equals: h, mode: "insensitive" } },
        { partNumber: { equals: h.replace(/\s+/g, "-"), mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      partNumber: true,
      description: true,
      standardCost: true,
      uom: true,
    },
  });
  if (exact) return exact;
  return prisma.part.findFirst({
    where: {
      isActive: true,
      OR: [
        { partNumber: { contains: h, mode: "insensitive" } },
        { description: { contains: h, mode: "insensitive" } },
      ],
    },
    orderBy: { partNumber: "asc" },
    select: {
      id: true,
      partNumber: true,
      description: true,
      standardCost: true,
      uom: true,
    },
  });
}

function requireAgent(features: Awaited<ReturnType<typeof getCarinaFeatures>>) {
  if (!features.agentActions) {
    return {
      kind: "blocked" as const,
      speak:
        features.agentBlockedReason ||
        "I can't run that action right now. I can still guide you on screen.",
    };
  }
  return null;
}

// ─── Intent detectors ─────────────────────────────────────────────

function wantsFinishWo(text: string) {
  return (
    /\b(finish|complete|close|mark\s+done|wrap\s+up)\b/i.test(text) &&
    /\b(work\s*order|wo\b|job|traveler)\b/i.test(text)
  );
}

function wantsReleaseWo(text: string) {
  return (
    /\b(release|start|kick\s*off|begin)\b/i.test(text) &&
    /\b(work\s*order|wo\b|job|production|build)\b/i.test(text)
  );
}

function wantsCreatePr(text: string) {
  const t = text.toLowerCase();
  if (
    /\b(open|create|make|start|submit|raise|new|file)\b/.test(t) &&
    /\b(purchase\s*request|\bpr\b|requisition)\b/.test(t)
  )
    return true;
  if (
    /\b(buy|purchase|procure|order)\b/.test(t) &&
    /\b(item|part|material|component|supply|supplies|stock)\b/.test(t)
  )
    return true;
  if (/\b(need|want|get)\s+(to\s+)?(buy|purchase|order|procure)\b/.test(t))
    return true;
  if (/\bbuy\s+(me\s+)?(an?\s+)?/i.test(t) && t.length > 8) return true;
  return false;
}

function wantsCreateWo(text: string) {
  return (
    /\b(create|open|make|start|new|raise)\b/i.test(text) &&
    /\b(work\s*order|wo\b|job|traveler|build|production\s*order)\b/i.test(text)
  );
}

function wantsCreateCustomer(text: string) {
  return (
    /\b(create|add|new|open|register)\b/i.test(text) &&
    /\b(customer|account|client)\b/i.test(text)
  );
}

function wantsCreatePart(text: string) {
  return (
    /\b(create|add|new|register)\b/i.test(text) &&
    /\b(part|item|sku|catalog)\b/i.test(text) &&
    !/\bpurchase|pr\b|buy\b/i.test(text)
  );
}

function wantsCreatePto(text: string) {
  return (
    /\b(pto|time\s*off|vacation|sick\s*day|leave)\b/i.test(text) &&
    /\b(request|submit|create|put\s*in|book|take)\b/i.test(text)
  );
}

function wantsOpenModule(text: string) {
  return /\b(open|go\s+to|take\s+me\s+to|navigate\s+to|show\s+me)\b/i.test(
    text
  ) &&
    /\b(work\s*orders?|purchasing|receiving|inventory|mrb|quality|floor|sales|customers?|shipping|accounting|hr|planning|kitting|bom|suppliers?|dashboard|home)\b/i.test(
      text
    );
}

// ─── Main entry ───────────────────────────────────────────────────

export async function tryCarinaAction(params: {
  userText: string;
  pending?: {
    action: string;
    partial: Record<string, string>;
    phase?: "clarify" | "confirm";
  } | null;
}): Promise<CarinaActionResult> {
  const features = await getCarinaFeatures();
  const text = params.userText.trim();
  const pending = params.pending;

  if (pending?.action) {
    if (isNegative(text)) {
      return {
        kind: "done",
        speak: "Okay, cancelled. Nothing was changed.",
      };
    }
    switch (pending.action) {
      case "finish_work_order":
        return continueFinishWo(text, pending, features);
      case "release_work_order":
        return continueReleaseWo(text, pending, features);
      case "create_purchase_request":
        return continueCreatePr(text, pending, features);
      case "create_work_order":
        return continueCreateWo(text, pending, features);
      case "create_customer":
        return continueCreateCustomer(text, pending, features);
      case "create_part":
        return continueCreatePart(text, pending, features);
      case "create_pto":
        return continueCreatePto(text, pending, features);
      default:
        break;
    }
  }

  // New intents (order: specific mutations before generic open)
  if (wantsFinishWo(text)) return startFinishWo(text, features);
  if (wantsReleaseWo(text)) return startReleaseWo(text, features);
  if (wantsCreatePr(text)) return startCreatePr(text, features);
  if (wantsCreateWo(text)) return startCreateWo(text, features);
  if (wantsCreateCustomer(text)) return startCreateCustomer(text, features);
  if (wantsCreatePart(text)) return startCreatePart(text, features);
  if (wantsCreatePto(text)) return startCreatePto(text, features);
  if (wantsOpenModule(text)) return doOpenModule(text);

  return { kind: "none" };
}

// ─── Finish WO ────────────────────────────────────────────────────

async function startFinishWo(
  text: string,
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const woNumber = extractWoNumber(text);
  if (!woNumber) {
    return {
      kind: "clarify",
      speak: "Which work order should I finish? Give me the number.",
      pendingAction: "finish_work_order",
      fields: [{ id: "woNumber", question: "Work order number", examples: "WO-10042" }],
      partial: {},
    };
  }
  return resolveFinishWo({ woNumber });
}

async function continueFinishWo(
  text: string,
  pending: { partial: Record<string, string>; phase?: string },
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const partial = { ...pending.partial };
  if (!partial.woNumber) {
    const n = extractWoNumber(text);
    if (n) partial.woNumber = n;
    else if (/^[A-Za-z0-9-]+$/.test(text) && text.length >= 3) {
      partial.woNumber = text.toUpperCase();
    }
  }
  if (pending.phase === "confirm") {
    if (isAffirmative(text)) return executeFinishWo(partial);
    return {
      kind: "confirm",
      speak: `Say yes to complete ${partial.woNumber || "that work order"}, or no to cancel.`,
      pendingAction: "finish_work_order",
      partial,
      summary: partial.summary || "",
    };
  }
  if (!partial.woNumber) {
    return {
      kind: "clarify",
      speak: "What's the work order number?",
      pendingAction: "finish_work_order",
      fields: [{ id: "woNumber", question: "Work order number" }],
      partial,
    };
  }
  return resolveFinishWo(partial);
}

async function resolveFinishWo(
  partial: Record<string, string>
): Promise<CarinaActionResult> {
  const wo = await findWorkOrder(partial.woNumber!);
  if (!wo) {
    return {
      kind: "clarify",
      speak: `I couldn't find work order ${partial.woNumber}. What's the exact number?`,
      pendingAction: "finish_work_order",
      fields: [{ id: "woNumber", question: "Work order number" }],
      partial: {},
    };
  }
  if (["COMPLETED", "CLOSED", "CANCELLED"].includes(wo.status)) {
    return {
      kind: "done",
      speak: `${wo.number} is already ${wo.status.toLowerCase()}.`,
    };
  }
  const summary = `${wo.number} (${wo.part?.partNumber || "no part"}) — ${wo.status}`;
  return {
    kind: "confirm",
    speak: `I'll mark ${summary} complete. Say yes to confirm, or no to cancel.`,
    pendingAction: "finish_work_order",
    partial: { woNumber: wo.number, woId: wo.id, summary },
    summary,
  };
}

async function executeFinishWo(
  partial: Record<string, string>
): Promise<CarinaActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { kind: "error", speak: "Sign in is required to finish a work order." };
  }
  let woId = partial.woId;
  if (!woId && partial.woNumber) {
    const wo = await findWorkOrder(partial.woNumber);
    woId = wo?.id || "";
  }
  if (!woId) {
    return {
      kind: "clarify",
      speak: "Which work order number?",
      pendingAction: "finish_work_order",
      fields: [{ id: "woNumber", question: "Work order number" }],
      partial: {},
    };
  }
  const woBefore = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: { number: true, status: true },
  });
  if (!woBefore) {
    return { kind: "error", speak: "That work order is gone." };
  }
  try {
    if (woBefore.status === "READY_FOR_PUTAWAY") {
      await completeWorkOrderToStock({ workOrderId: woId, userId: user.id });
    } else {
      const pendingSteps = await prisma.workOrderStepCompletion.count({
        where: {
          workOrderId: woId,
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
      });
      if (pendingSteps > 0) {
        return {
          kind: "error",
          speak: `${woBefore.number} still has ${pendingSteps} open traveler step(s). Those need sign-off first.`,
        };
      }
      await updateWorkOrderStatus({
        workOrderId: woId,
        toStatus: "COMPLETED",
        userId: user.id,
        notes: "Completed via Carina agent",
      });
    }
  } catch (e) {
    return {
      kind: "error",
      speak: `Couldn't finish it: ${e instanceof Error ? e.message : "error"}`,
    };
  }
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: { number: true, status: true },
  });
  await logAudit({
    entityType: "WorkOrder",
    entityId: woId,
    action: "CARINA_AGENT_COMPLETE",
    userId: user.id,
    changes: { via: "carina", to: wo?.status },
  });
  return {
    kind: "done",
    speak: `Done. ${wo?.number} is now ${wo?.status?.toLowerCase()}.`,
    detail: wo?.number,
    href: `/work-orders/${woId}`,
  };
}

// ─── Release / start WO ───────────────────────────────────────────

async function startReleaseWo(
  text: string,
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const woNumber = extractWoNumber(text);
  if (!woNumber) {
    return {
      kind: "clarify",
      speak: "Which work order should I release or start?",
      pendingAction: "release_work_order",
      fields: [{ id: "woNumber", question: "Work order number" }],
      partial: {},
    };
  }
  return resolveReleaseWo({ woNumber });
}

async function continueReleaseWo(
  text: string,
  pending: { partial: Record<string, string>; phase?: string },
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const partial = { ...pending.partial };
  if (!partial.woNumber) {
    const n = extractWoNumber(text) || (/^[A-Za-z0-9-]+$/.test(text) ? text.toUpperCase() : "");
    if (n) partial.woNumber = n;
  }
  if (pending.phase === "confirm" && isAffirmative(text)) {
    return executeReleaseWo(partial);
  }
  if (!partial.woNumber) {
    return {
      kind: "clarify",
      speak: "Work order number?",
      pendingAction: "release_work_order",
      fields: [{ id: "woNumber", question: "Work order number" }],
      partial,
    };
  }
  return resolveReleaseWo(partial);
}

async function resolveReleaseWo(
  partial: Record<string, string>
): Promise<CarinaActionResult> {
  const wo = await findWorkOrder(partial.woNumber!);
  if (!wo) {
    return {
      kind: "clarify",
      speak: `Couldn't find ${partial.woNumber}. Exact number?`,
      pendingAction: "release_work_order",
      fields: [{ id: "woNumber", question: "Work order number" }],
      partial: {},
    };
  }
  const toStatus =
    wo.status === "PLANNED" || wo.status === "BACKLOG" ? "RELEASED" : "IN_PROGRESS";
  const summary = `${wo.number} ${wo.status} → ${toStatus}`;
  return {
    kind: "confirm",
    speak: `I'll set ${wo.number} from ${wo.status} to ${toStatus}. Yes or no?`,
    pendingAction: "release_work_order",
    partial: { woNumber: wo.number, woId: wo.id, toStatus, summary },
    summary,
  };
}

async function executeReleaseWo(
  partial: Record<string, string>
): Promise<CarinaActionResult> {
  const user = await getCurrentUser();
  if (!user) return { kind: "error", speak: "Sign in required." };
  const woId = partial.woId;
  if (!woId) return { kind: "error", speak: "Missing work order." };
  try {
    await updateWorkOrderStatus({
      workOrderId: woId,
      toStatus: partial.toStatus || "RELEASED",
      userId: user.id,
      notes: "Status change via Carina",
    });
  } catch (e) {
    return {
      kind: "error",
      speak: e instanceof Error ? e.message : "Status change failed",
    };
  }
  return {
    kind: "done",
    speak: `Done. ${partial.woNumber} is now ${partial.toStatus}.`,
    href: `/work-orders/${woId}`,
  };
}

// ─── Create PR ────────────────────────────────────────────────────

function extractPrDetails(text: string) {
  const quantity = extractQuantity(text, 1);
  const pnMatch = text.match(/\b([A-Za-z]{1,8}[-_]?\d{2,}[A-Za-z0-9._-]*)\b/);
  const partHint = pnMatch?.[1] || null;
  const description = stripFiller(text, [
    /\b(open|create|make|start|submit|raise|new|file|buy|purchase|order|procure|request|requisition|pr|item|items)\b/gi,
    /\bpurchase\s*request\b/gi,
    /\b\d+(?:\.\d+)?\s*(x|ea|pcs|pieces|units|of)?\b/gi,
  ]);
  return { quantity, partHint, description };
}

async function startCreatePr(
  text: string,
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const details = extractPrDetails(text);
  const partial: Record<string, string> = {
    quantity: String(details.quantity || 1),
  };
  await fillPrItem(partial, details);
  if (!partial.description && !partial.partId) {
    return {
      kind: "clarify",
      speak: "What should I buy? Give a part number or description.",
      pendingAction: "create_purchase_request",
      fields: [
        {
          id: "description",
          question: "Part number or description",
          examples: "M8 bolts or PN-10042",
        },
      ],
      partial: {},
    };
  }
  return confirmCreatePr(partial);
}

async function continueCreatePr(
  text: string,
  pending: { partial: Record<string, string>; phase?: string },
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const partial = { ...pending.partial };
  const details = extractPrDetails(text);
  if (!partial.description && !partial.partId) {
    await fillPrItem(partial, details);
  }
  if (details.quantity > 1) partial.quantity = String(details.quantity);
  if (!partial.quantity) partial.quantity = "1";

  if (pending.phase === "confirm") {
    if (isAffirmative(text)) return executeCreatePr(partial);
    if (details.description.length >= 2) {
      await fillPrItem(partial, details);
    } else {
      return {
        kind: "confirm",
        speak: `Say yes to create the PR for ${partial.quantity} × ${partial.description}, or no to cancel.`,
        pendingAction: "create_purchase_request",
        partial,
        summary: partial.summary || "",
      };
    }
  }
  if (!partial.description && !partial.partId) {
    return {
      kind: "clarify",
      speak: "Part number or what to buy?",
      pendingAction: "create_purchase_request",
      fields: [{ id: "description", question: "Item" }],
      partial,
    };
  }
  return confirmCreatePr(partial);
}

async function fillPrItem(
  partial: Record<string, string>,
  details: { quantity: number; partHint: string | null; description: string }
) {
  const hint = details.partHint || details.description;
  if (!hint || hint.length < 2) return;
  const part = await findPart(hint);
  if (part) {
    partial.partId = part.id;
    partial.partNumber = part.partNumber;
    partial.description = `${part.partNumber} — ${part.description}`;
    if (part.standardCost) partial.unitCost = String(part.standardCost);
    if (part.uom) partial.uom = part.uom;
  } else {
    partial.description = details.description || details.partHint || hint;
  }
}

function confirmCreatePr(partial: Record<string, string>): CarinaActionResult {
  const summary = `PR draft: ${partial.quantity} × ${partial.description}`;
  return {
    kind: "confirm",
    speak: `I'll create a draft purchase request for ${partial.quantity} × ${partial.description}. Yes or no?`,
    pendingAction: "create_purchase_request",
    partial: { ...partial, summary },
    summary,
  };
}

async function executeCreatePr(
  partial: Record<string, string>
): Promise<CarinaActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { kind: "error", speak: "Sign in required to create a PR." };
  }
  const description = (partial.description || "").trim();
  const quantity = Math.max(1, Number(partial.quantity) || 1);
  if (!description && !partial.partId) {
    return {
      kind: "clarify",
      speak: "What item goes on the PR?",
      pendingAction: "create_purchase_request",
      fields: [{ id: "description", question: "Item" }],
      partial: {},
    };
  }
  try {
    const pr = await createStandalonePurchaseRequest({
      lines: [
        {
          partId: partial.partId || null,
          description: description || partial.partNumber || "Item",
          quantity,
          estimatedUnitCost: Number(partial.unitCost) || 0,
          uom: partial.uom || "EA",
        },
      ],
      purpose: "OTHER",
      chargeType: "INDIRECT",
      justification: "Created by Carina assistant",
      submit: false,
      userId: user.id,
    });
    await logAudit({
      entityType: "PurchaseRequest",
      entityId: pr.id,
      action: "CARINA_AGENT_CREATE_PR",
      userId: user.id,
      metadata: { number: pr.number },
    });
    return {
      kind: "done",
      speak: `Done. Draft purchase request ${pr.number} for ${quantity} × ${description}. Open it under Purchasing to review and submit.`,
      detail: pr.number,
      href: `/purchasing/pr/${pr.id}`,
    };
  } catch (e) {
    return {
      kind: "error",
      speak: `Couldn't create the PR: ${e instanceof Error ? e.message : "error"}`,
    };
  }
}

// ─── Create work order ────────────────────────────────────────────

async function startCreateWo(
  text: string,
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const qty = extractQuantity(text, 1);
  const rest = stripFiller(text, [
    /\b(create|open|make|start|new|raise|work\s*order|wo|job|traveler|build|production\s*order)\b/gi,
    /\b\d+(?:\.\d+)?\s*(x|ea|of)?\b/gi,
  ]);
  const partial: Record<string, string> = { quantity: String(qty) };
  if (rest.length >= 2) {
    const part = await findPart(rest);
    if (part) {
      partial.partId = part.id;
      partial.partNumber = part.partNumber;
      partial.description = part.description;
    } else {
      partial.description = rest;
    }
  }
  if (!partial.partId && !partial.description) {
    return {
      kind: "clarify",
      speak: "What part or description is this work order for?",
      pendingAction: "create_work_order",
      fields: [
        {
          id: "description",
          question: "Part number or description",
          examples: "ASM-100 or assembly housing",
        },
      ],
      partial: { quantity: String(qty) },
    };
  }
  if (!partial.partId) {
    return {
      kind: "clarify",
      speak: `I need a catalog part number to create a production work order for “${partial.description}”. What's the part number?`,
      pendingAction: "create_work_order",
      fields: [{ id: "partNumber", question: "Part number" }],
      partial,
    };
  }
  return confirmCreateWo(partial);
}

async function continueCreateWo(
  text: string,
  pending: { partial: Record<string, string>; phase?: string },
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const partial = { ...pending.partial };
  if (pending.phase === "confirm" && isAffirmative(text)) {
    return executeCreateWo(partial);
  }
  const qty = extractQuantity(text, Number(partial.quantity) || 1);
  partial.quantity = String(qty);
  if (!partial.partId) {
    const hint = stripFiller(text, [/\b\d+\b/g]) || text.trim();
    const part = await findPart(hint);
    if (part) {
      partial.partId = part.id;
      partial.partNumber = part.partNumber;
      partial.description = part.description;
    } else if (hint.length >= 2) {
      return {
        kind: "clarify",
        speak: `No catalog part matched “${hint}”. Try another part number.`,
        pendingAction: "create_work_order",
        fields: [{ id: "partNumber", question: "Part number" }],
        partial,
      };
    }
  }
  if (!partial.partId) {
    return {
      kind: "clarify",
      speak: "Part number for the work order?",
      pendingAction: "create_work_order",
      fields: [{ id: "partNumber", question: "Part number" }],
      partial,
    };
  }
  return confirmCreateWo(partial);
}

function confirmCreateWo(partial: Record<string, string>): CarinaActionResult {
  const summary = `WO: ${partial.quantity} × ${partial.partNumber || partial.description}`;
  return {
    kind: "confirm",
    speak: `I'll create a planned work order for ${partial.quantity} × ${partial.partNumber}. Yes or no?`,
    pendingAction: "create_work_order",
    partial: { ...partial, summary },
    summary,
  };
}

async function executeCreateWo(
  partial: Record<string, string>
): Promise<CarinaActionResult> {
  const user = await getCurrentUser();
  if (!user) return { kind: "error", speak: "Sign in required." };
  if (!partial.partId) {
    return {
      kind: "clarify",
      speak: "Part number?",
      pendingAction: "create_work_order",
      fields: [{ id: "partNumber", question: "Part number" }],
      partial,
    };
  }
  try {
    const wo = await createWorkOrder({
      partId: partial.partId,
      quantity: Math.max(1, Number(partial.quantity) || 1),
      type: "PRODUCTION",
      status: "PLANNED",
      createdById: user.id,
      description: partial.description || undefined,
    });
    await logAudit({
      entityType: "WorkOrder",
      entityId: wo.id,
      action: "CARINA_AGENT_CREATE_WO",
      userId: user.id,
      metadata: { number: wo.number },
    });
    return {
      kind: "done",
      speak: `Done. Created work order ${wo.number}. You can open it under Work Orders.`,
      detail: wo.number,
      href: `/work-orders/${wo.id}`,
    };
  } catch (e) {
    return {
      kind: "error",
      speak: `Couldn't create the work order: ${e instanceof Error ? e.message : "error"}`,
    };
  }
}

// ─── Create customer ──────────────────────────────────────────────

async function startCreateCustomer(
  text: string,
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const name = stripFiller(text, [
    /\b(create|add|new|open|register|customer|account|client|called|named)\b/gi,
  ]);
  if (name.length < 2) {
    return {
      kind: "clarify",
      speak: "What's the customer name?",
      pendingAction: "create_customer",
      fields: [{ id: "name", question: "Customer name", examples: "Acme Aerospace" }],
      partial: {},
    };
  }
  return {
    kind: "confirm",
    speak: `I'll add customer “${name}”. Yes or no?`,
    pendingAction: "create_customer",
    partial: { name },
    summary: name,
  };
}

async function continueCreateCustomer(
  text: string,
  pending: { partial: Record<string, string>; phase?: string },
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const partial = { ...pending.partial };
  if (pending.phase === "confirm" && isAffirmative(text)) {
    return executeCreateCustomer(partial);
  }
  if (!partial.name) {
    const name = stripFiller(text, [/\b(customer|named|called)\b/gi]);
    if (name.length >= 2) partial.name = name;
  }
  if (!partial.name) {
    return {
      kind: "clarify",
      speak: "Customer name?",
      pendingAction: "create_customer",
      fields: [{ id: "name", question: "Customer name" }],
      partial,
    };
  }
  return {
    kind: "confirm",
    speak: `Create customer “${partial.name}”? Yes or no.`,
    pendingAction: "create_customer",
    partial,
    summary: partial.name,
  };
}

async function executeCreateCustomer(
  partial: Record<string, string>
): Promise<CarinaActionResult> {
  const user = await getCurrentUser();
  if (!user) return { kind: "error", speak: "Sign in required." };
  try {
    const c = await createCustomer({
      name: partial.name,
      userId: user.id,
    });
    return {
      kind: "done",
      speak: `Done. Customer ${c.code} — ${c.name} is in the system.`,
      detail: c.code,
      href: `/customers/${c.id}`,
    };
  } catch (e) {
    return {
      kind: "error",
      speak: e instanceof Error ? e.message : "Could not create customer",
    };
  }
}

// ─── Create part / item ───────────────────────────────────────────

async function startCreatePart(
  text: string,
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const rest = stripFiller(text, [
    /\b(create|add|new|register|part|item|sku|catalog|called|named)\b/gi,
  ]);
  const tokens = rest.split(/\s+/).filter(Boolean);
  const partNumber = tokens[0] || "";
  const description = tokens.slice(1).join(" ") || partNumber;
  if (!partNumber || partNumber.length < 2) {
    return {
      kind: "clarify",
      speak: "What part number should I create?",
      pendingAction: "create_part",
      fields: [
        {
          id: "partNumber",
          question: "Part number and optional description",
          examples: "BRK-200 brake bracket",
        },
      ],
      partial: {},
    };
  }
  return {
    kind: "confirm",
    speak: `I'll add catalog part ${partNumber}${description !== partNumber ? ` — ${description}` : ""}. Yes or no?`,
    pendingAction: "create_part",
    partial: { partNumber, description },
    summary: partNumber,
  };
}

async function continueCreatePart(
  text: string,
  pending: { partial: Record<string, string>; phase?: string },
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const partial = { ...pending.partial };
  if (pending.phase === "confirm" && isAffirmative(text)) {
    return executeCreatePart(partial);
  }
  if (!partial.partNumber) {
    const rest = stripFiller(text, []);
    const tokens = rest.split(/\s+/).filter(Boolean);
    if (tokens[0]) {
      partial.partNumber = tokens[0];
      partial.description = tokens.slice(1).join(" ") || tokens[0];
    }
  }
  if (!partial.partNumber) {
    return {
      kind: "clarify",
      speak: "Part number?",
      pendingAction: "create_part",
      fields: [{ id: "partNumber", question: "Part number" }],
      partial,
    };
  }
  return {
    kind: "confirm",
    speak: `Create part ${partial.partNumber}? Yes or no.`,
    pendingAction: "create_part",
    partial,
    summary: partial.partNumber,
  };
}

async function executeCreatePart(
  partial: Record<string, string>
): Promise<CarinaActionResult> {
  const user = await getCurrentUser();
  if (!user) return { kind: "error", speak: "Sign in required." };
  try {
    const part = await createPart({
      partNumber: partial.partNumber,
      description: partial.description || partial.partNumber,
      sourcingMethod: "PURCHASE",
      itemStructure: "N_A",
      userId: user.id,
    });
    return {
      kind: "done",
      speak: `Done. Part ${part.partNumber} is in the item master.`,
      detail: part.partNumber,
      href: `/items/${part.id}`,
    };
  } catch (e) {
    return {
      kind: "error",
      speak: e instanceof Error ? e.message : "Could not create part",
    };
  }
}

// ─── PTO request ──────────────────────────────────────────────────

function parseDateLoose(s: string): Date | null {
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t);
  const m = s.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (m) {
    const year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : new Date().getFullYear();
    return new Date(year, Number(m[1]) - 1, Number(m[2]));
  }
  return null;
}

async function startCreatePto(
  text: string,
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const type = /\bsick\b/i.test(text)
    ? "SICK"
    : /\bvacation\b/i.test(text)
      ? "PTO"
      : "PTO";
  const hours = extractQuantity(text, 8);
  const dates = text.match(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/g) || [];
  const partial: Record<string, string> = {
    type,
    hours: String(hours),
  };
  if (dates[0]) {
    const d = parseDateLoose(dates[0]);
    if (d) partial.startDate = d.toISOString();
  }
  if (dates[1]) {
    const d = parseDateLoose(dates[1]);
    if (d) partial.endDate = d.toISOString();
  } else if (partial.startDate) {
    partial.endDate = partial.startDate;
  }
  if (!partial.startDate) {
    return {
      kind: "clarify",
      speak: "What start date for the time off? For example 7/28 or July 28 2026.",
      pendingAction: "create_pto",
      fields: [{ id: "startDate", question: "Start date", examples: "7/28/2026" }],
      partial,
    };
  }
  return confirmCreatePto(partial);
}

async function continueCreatePto(
  text: string,
  pending: { partial: Record<string, string>; phase?: string },
  features: Awaited<ReturnType<typeof getCarinaFeatures>>
): Promise<CarinaActionResult> {
  const blocked = requireAgent(features);
  if (blocked) return blocked;
  const partial = { ...pending.partial };
  if (pending.phase === "confirm" && isAffirmative(text)) {
    return executeCreatePto(partial);
  }
  const d = parseDateLoose(text) || parseDateLoose(text.replace(/[^\d\/\-]/g, " "));
  if (!partial.startDate && d) {
    partial.startDate = d.toISOString();
    if (!partial.endDate) partial.endDate = partial.startDate;
  } else if (partial.startDate && !partial.endDate && d) {
    partial.endDate = d.toISOString();
  }
  const hours = extractQuantity(text, 0);
  if (hours > 0) partial.hours = String(hours);
  if (!partial.startDate) {
    return {
      kind: "clarify",
      speak: "Start date for PTO?",
      pendingAction: "create_pto",
      fields: [{ id: "startDate", question: "Start date" }],
      partial,
    };
  }
  return confirmCreatePto(partial);
}

function confirmCreatePto(partial: Record<string, string>): CarinaActionResult {
  const start = partial.startDate
    ? new Date(partial.startDate).toLocaleDateString()
    : "?";
  return {
    kind: "confirm",
    speak: `I'll submit a ${partial.type} request for ${partial.hours || 8} hours starting ${start}. Yes or no?`,
    pendingAction: "create_pto",
    partial,
    summary: `${partial.type} ${partial.hours}h ${start}`,
  };
}

async function executeCreatePto(
  partial: Record<string, string>
): Promise<CarinaActionResult> {
  const user = await getCurrentUser();
  if (!user) return { kind: "error", speak: "Sign in required." };
  const start = partial.startDate ? new Date(partial.startDate) : null;
  if (!start) {
    return {
      kind: "clarify",
      speak: "Start date?",
      pendingAction: "create_pto",
      fields: [{ id: "startDate", question: "Start date" }],
      partial,
    };
  }
  const end = partial.endDate ? new Date(partial.endDate) : start;
  try {
    const pto = await createPtoRequest({
      userId: user.id,
      type: partial.type || "PTO",
      startDate: start,
      endDate: end,
      hours: Math.max(1, Number(partial.hours) || 8),
      reason: "Requested via Carina",
    });
    return {
      kind: "done",
      speak: `Done. ${partial.type} request submitted for ${partial.hours} hours starting ${start.toLocaleDateString()}.`,
      detail: pto.id,
      href: "/hr",
    };
  } catch (e) {
    return {
      kind: "error",
      speak: e instanceof Error ? e.message : "Could not submit PTO",
    };
  }
}

// ─── Open module (navigate — client handles href) ─────────────────

function doOpenModule(text: string): CarinaActionResult {
  const map: [RegExp, string, string][] = [
    [/work\s*orders?/i, "/work-orders", "Work Orders"],
    [/purchas/i, "/purchasing", "Purchasing"],
    [/receiv/i, "/receiving", "Receiving"],
    [/inventory/i, "/inventory", "Inventory"],
    [/\bmrb\b/i, "/mrb", "MRB"],
    [/quality/i, "/quality", "Quality"],
    [/floor|shop\s*floor/i, "/floor", "Production Floor"],
    [/sales/i, "/sales", "Sales Orders"],
    [/customers?/i, "/customers", "Customers"],
    [/ship/i, "/shipping", "Shipping"],
    [/account/i, "/accounting", "Accounting"],
    [/\bhr\b|human\s*resources|workforce/i, "/hr", "HR"],
    [/planning|mrp/i, "/planning", "Planning"],
    [/kit/i, "/kitting", "Kitting"],
    [/\bbom\b/i, "/bom", "BOMs"],
    [/supplier/i, "/suppliers", "Suppliers"],
    [/dashboard|home/i, "/", "Dashboard"],
  ];
  for (const [re, href, label] of map) {
    if (re.test(text)) {
      return {
        kind: "done",
        speak: `Opening ${label}.`,
        href,
      };
    }
  }
  return { kind: "none" };
}
