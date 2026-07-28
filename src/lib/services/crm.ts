/**
 * CRM — the funnel that runs before a Customer record exists.
 *
 * The existing Customer model is a *billing* record: terms, credit limit,
 * addresses. It answers "how do we invoice them", not "are we going to win
 * them". This module is the other half:
 *
 *   Lead (someone got in touch)
 *     └── Opportunity (a real deal, with a value and a close date)
 *           └── Customer + Quote (won — hand off to the parts of the system
 *               that already exist)
 *
 * Weighted pipeline uses each deal's own probability rather than the stage
 * default, because a rep's read on a specific deal beats a stage average.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const LEAD_STATUSES = [
  "NEW",
  "WORKING",
  "QUALIFIED",
  "DISQUALIFIED",
  "CONVERTED",
] as const;

export const STAGES = [
  "PROSPECT",
  "QUALIFY",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;
export type Stage = (typeof STAGES)[number];

/** Stages still in play — everything the forecast is built from. */
export const OPEN_STAGES: Stage[] = [
  "PROSPECT",
  "QUALIFY",
  "PROPOSAL",
  "NEGOTIATION",
];

/** Starting probability for a stage. Editable per deal afterwards. */
export const STAGE_PROBABILITY: Record<Stage, number> = {
  PROSPECT: 10,
  QUALIFY: 25,
  PROPOSAL: 50,
  NEGOTIATION: 75,
  WON: 100,
  LOST: 0,
};

export const ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "NOTE", "TASK"] as const;

// ─── Leads ──────────────────────────────────────────────────────

export async function listLeads(status?: string) {
  return prisma.lead.findMany({
    where: status ? { status } : { status: { notIn: ["CONVERTED", "DISQUALIFIED"] } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

export async function createLead(params: {
  company: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  ownerId?: string | null;
  notes?: string | null;
  userId?: string;
}) {
  const company = params.company.trim();
  if (!company) throw new Error("Company name is required");
  const lead = await prisma.lead.create({
    data: {
      company,
      contactName: params.contactName?.trim() || null,
      email: params.email?.trim().toLowerCase() || null,
      phone: params.phone?.trim() || null,
      source: params.source?.trim() || null,
      ownerId: params.ownerId || null,
      notes: params.notes?.trim() || null,
    },
  });
  await logAudit({
    entityType: "Lead",
    entityId: lead.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { company },
  });
  return lead;
}

export async function updateLeadStatus(id: string, status: string, userId?: string) {
  return prisma.lead.update({ where: { id }, data: { status } });
}

/**
 * Promote a lead to a real deal. The lead is kept (marked CONVERTED and
 * pointed at the opportunity) rather than deleted — where deals come from is
 * worth being able to answer later.
 */
export async function convertLead(params: {
  leadId: string;
  value?: number;
  expectedCloseAt?: Date | null;
  ownerId?: string | null;
  userId?: string;
}) {
  const lead = await prisma.lead.findUnique({ where: { id: params.leadId } });
  if (!lead) throw new Error("Lead not found");

  const opp = await createOpportunity({
    name: lead.company,
    value: params.value ?? 0,
    expectedCloseAt: params.expectedCloseAt ?? null,
    ownerId: params.ownerId ?? lead.ownerId,
    source: lead.source,
    description: lead.notes,
    userId: params.userId,
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: "CONVERTED", convertedAt: new Date(), opportunityId: opp.id },
  });
  return opp;
}

// ─── Opportunities ──────────────────────────────────────────────

/** OPP-0001, OPP-0002 … derived from the current max so gaps don't repeat. */
async function nextOpportunityNumber(): Promise<string> {
  const last = await prisma.opportunity.findFirst({
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const n = last?.number?.match(/(\d+)$/)?.[1];
  return `OPP-${String((n ? parseInt(n, 10) : 0) + 1).padStart(4, "0")}`;
}

export async function createOpportunity(params: {
  name: string;
  customerId?: string | null;
  contactId?: string | null;
  stage?: string;
  value?: number;
  probability?: number;
  expectedCloseAt?: Date | null;
  ownerId?: string | null;
  source?: string | null;
  description?: string | null;
  userId?: string;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Opportunity name is required");
  const stage = (params.stage as Stage) || "PROSPECT";
  const opp = await prisma.opportunity.create({
    data: {
      number: await nextOpportunityNumber(),
      name,
      customerId: params.customerId || null,
      contactId: params.contactId || null,
      stage,
      value: params.value ?? 0,
      probability: params.probability ?? STAGE_PROBABILITY[stage] ?? 10,
      expectedCloseAt: params.expectedCloseAt ?? null,
      ownerId: params.ownerId || null,
      source: params.source?.trim() || null,
      description: params.description?.trim() || null,
    },
  });
  await logAudit({
    entityType: "Opportunity",
    entityId: opp.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number: opp.number, value: opp.value },
  });
  return opp;
}

export async function listOpportunities(params?: {
  stage?: string;
  open?: boolean;
  ownerId?: string;
}) {
  return prisma.opportunity.findMany({
    where: {
      ...(params?.stage ? { stage: params.stage } : {}),
      ...(params?.open ? { stage: { in: OPEN_STAGES } } : {}),
      ...(params?.ownerId ? { ownerId: params.ownerId } : {}),
    },
    orderBy: [{ expectedCloseAt: "asc" }, { value: "desc" }],
    take: 500,
  });
}

export async function getOpportunity(id: string) {
  return prisma.opportunity.findUnique({
    where: { id },
    include: { activities: { orderBy: { occurredAt: "desc" }, take: 100 } },
  });
}

export async function updateOpportunity(
  id: string,
  data: Record<string, unknown>,
  userId?: string
) {
  const opp = await prisma.opportunity.update({ where: { id }, data });
  await logAudit({ entityType: "Opportunity", entityId: id, action: "UPDATED", userId });
  return opp;
}

/**
 * Move a deal along. Probability follows the stage unless it was set by hand,
 * and WON/LOST stamp a close date so the pipeline stops counting them.
 * A lost deal requires a reason — the field is the most useful thing in the
 * module and nobody fills it in later.
 */
export async function setStage(params: {
  id: string;
  stage: Stage;
  probability?: number | null;
  lostReason?: string | null;
  userId?: string;
}) {
  const closing = params.stage === "WON" || params.stage === "LOST";
  if (params.stage === "LOST" && !params.lostReason?.trim()) {
    throw new Error("A reason is required when marking a deal lost");
  }
  const opp = await prisma.opportunity.update({
    where: { id: params.id },
    data: {
      stage: params.stage,
      probability: params.probability ?? STAGE_PROBABILITY[params.stage],
      lostReason: params.stage === "LOST" ? params.lostReason?.trim() : null,
      closedAt: closing ? new Date() : null,
    },
  });
  await logAudit({
    entityType: "Opportunity",
    entityId: params.id,
    action: `STAGE_${params.stage}`,
    userId: params.userId,
    metadata: { value: opp.value, lostReason: opp.lostReason },
  });
  return opp;
}

/**
 * Win a deal and create the Customer it becomes, unless it's already linked to
 * one. The customer code is derived from the name and de-duplicated, since
 * Customer.code is unique and a collision here would fail the whole handoff.
 */
export async function convertToCustomer(params: {
  opportunityId: string;
  paymentTerms?: string;
  creditLimit?: number;
  userId?: string;
}) {
  const opp = await prisma.opportunity.findUnique({
    where: { id: params.opportunityId },
  });
  if (!opp) throw new Error("Opportunity not found");
  if (opp.customerId) return { customerId: opp.customerId, created: false };

  const base =
    opp.name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8) || "CUST";
  let code = base;
  for (let i = 1; await prisma.customer.findUnique({ where: { code } }); i++) {
    code = `${base}${i}`;
  }

  const customer = await prisma.customer.create({
    data: {
      code,
      name: opp.name,
      paymentTerms: params.paymentTerms || "NET30",
      creditLimit: params.creditLimit ?? 0,
    },
  });
  await prisma.opportunity.update({
    where: { id: opp.id },
    data: { customerId: customer.id },
  });
  await logAudit({
    entityType: "Customer",
    entityId: customer.id,
    action: "CREATED_FROM_OPPORTUNITY",
    userId: params.userId,
    metadata: { opportunity: opp.number },
  });
  return { customerId: customer.id, created: true };
}

// ─── Activities ─────────────────────────────────────────────────

export async function addActivity(params: {
  opportunityId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  type: string;
  subject: string;
  body?: string | null;
  dueAt?: Date | null;
  userId?: string;
}) {
  const subject = params.subject.trim();
  if (!subject) throw new Error("A subject is required");
  return prisma.crmActivity.create({
    data: {
      opportunityId: params.opportunityId || null,
      contactId: params.contactId || null,
      leadId: params.leadId || null,
      type: params.type || "NOTE",
      subject,
      body: params.body?.trim() || null,
      dueAt: params.dueAt ?? null,
      userId: params.userId || null,
    },
  });
}

export async function completeActivity(id: string) {
  return prisma.crmActivity.update({
    where: { id },
    data: { completedAt: new Date() },
  });
}

/** Open tasks with a due date — the rep's to-do list. */
export async function getOpenTasks(limit = 20) {
  return prisma.crmActivity.findMany({
    where: { type: "TASK", completedAt: null, dueAt: { not: null } },
    orderBy: { dueAt: "asc" },
    take: limit,
  });
}

// ─── Contacts ───────────────────────────────────────────────────

export async function listContacts(customerId?: string) {
  return prisma.contact.findMany({
    where: customerId ? { customerId } : {},
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    take: 500,
  });
}

export async function createContact(params: {
  customerId?: string | null;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Name is required");
  // Only one primary per customer, or "primary" stops meaning anything.
  if (params.isPrimary && params.customerId) {
    await prisma.contact.updateMany({
      where: { customerId: params.customerId, isPrimary: true },
      data: { isPrimary: false },
    });
  }
  return prisma.contact.create({
    data: {
      customerId: params.customerId || null,
      name,
      title: params.title?.trim() || null,
      email: params.email?.trim().toLowerCase() || null,
      phone: params.phone?.trim() || null,
      isPrimary: params.isPrimary ?? false,
      notes: params.notes?.trim() || null,
    },
  });
}

// ─── Pipeline ───────────────────────────────────────────────────

export type PipelineStage = {
  stage: Stage;
  count: number;
  value: number;
  weighted: number;
};

/** The board: one column per open stage, with raw and weighted totals. */
export async function getPipeline(): Promise<PipelineStage[]> {
  const open = await prisma.opportunity.findMany({
    where: { stage: { in: OPEN_STAGES } },
    select: { stage: true, value: true, probability: true },
    take: 1000,
  });
  return OPEN_STAGES.map((stage) => {
    const rows = open.filter((o) => o.stage === stage);
    return {
      stage,
      count: rows.length,
      value: rows.reduce((n, r) => n + r.value, 0),
      weighted: rows.reduce((n, r) => n + (r.value * r.probability) / 100, 0),
    };
  });
}

export async function getCrmSummary(days = 90) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [openRows, won, lost, leads, overdueTasks] = await Promise.all([
    prisma.opportunity.findMany({
      where: { stage: { in: OPEN_STAGES } },
      select: { value: true, probability: true },
      take: 1000,
    }),
    prisma.opportunity.findMany({
      where: { stage: "WON", closedAt: { gte: since } },
      select: { value: true },
      take: 1000,
    }),
    prisma.opportunity.count({ where: { stage: "LOST", closedAt: { gte: since } } }),
    prisma.lead.count({ where: { status: { notIn: ["CONVERTED", "DISQUALIFIED"] } } }),
    prisma.crmActivity.count({
      where: { type: "TASK", completedAt: null, dueAt: { lt: new Date() } },
    }),
  ]);

  const openValue = openRows.reduce((n, r) => n + r.value, 0);
  const weighted = openRows.reduce((n, r) => n + (r.value * r.probability) / 100, 0);
  const wonValue = won.reduce((n, r) => n + r.value, 0);
  const decided = won.length + lost;

  return {
    openCount: openRows.length,
    openValue,
    weighted,
    wonCount: won.length,
    wonValue,
    lostCount: lost,
    winRate: decided > 0 ? Math.round((won.length / decided) * 100) : 0,
    leadCount: leads,
    overdueTasks,
  };
}

/** Why deals are lost, most common first. Drives the hard conversations. */
export async function getLostReasons(days = 180) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.opportunity.findMany({
    where: { stage: "LOST", closedAt: { gte: since }, lostReason: { not: null } },
    select: { lostReason: true, value: true },
    take: 500,
  });
  const map = new Map<string, { reason: string; count: number; value: number }>();
  for (const r of rows) {
    const reason = (r.lostReason || "").trim() || "Unspecified";
    const hit = map.get(reason);
    if (hit) {
      hit.count += 1;
      hit.value += r.value;
    } else {
      map.set(reason, { reason, count: 1, value: r.value });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
