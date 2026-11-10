/**
 * Shop-floor events → the general ledger.
 *
 * Account codes come from GlAccountMap when the company has changed them,
 * otherwise from the defaults below. Each event is idempotent: posting the
 * same material issue or labor line twice returns the original journal.
 *
 * Government-owned material is not put on the company's books.
 * G&A is not loaded into inventory; only fringe and shop overhead are.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { postJournal } from "@/lib/services/gaap";
import { completionEntry, roundMoney } from "@/lib/services/posting-rules";

export const DEFAULT_ACCOUNT_MAP: {
  eventKey: string;
  label: string;
  debitCode: string;
  creditCode: string;
  notes: string;
}[] = [
  {
    eventKey: "MATERIAL_ISSUE",
    label: "Material issued to a job",
    debitCode: "1210",
    creditCode: "1200",
    notes: "Moves raw material into work in process for the job.",
  },
  {
    eventKey: "LABOR_APPLIED",
    label: "Direct labor applied to a job",
    debitCode: "1210",
    creditCode: "6050",
    notes: "Payroll still records the wage. This moves the direct portion onto the job.",
  },
  {
    eventKey: "FRINGE_APPLIED",
    label: "Fringe applied to direct labor",
    debitCode: "1210",
    creditCode: "6070",
    notes: "Provisional fringe rate times direct labor on the job.",
  },
  {
    eventKey: "OVERHEAD_APPLIED",
    label: "Shop overhead applied to a job",
    debitCode: "1210",
    creditCode: "6060",
    notes: "Provisional shop-overhead rate times direct labor. G&A is not included.",
  },
  {
    eventKey: "WO_COMPLETE",
    label: "Finished job moved to finished goods",
    debitCode: "1220",
    creditCode: "1210",
    notes: "Standard cost to finished goods. Difference goes to materials variance.",
  },
  {
    eventKey: "SCRAP",
    label: "Material scrapped",
    debitCode: "6210",
    creditCode: "1200",
    notes: "Company-owned stock only. On a job, WIP is relieved instead of raw material.",
  },
  {
    eventKey: "INV_ADJUST",
    label: "Inventory count difference",
    debitCode: "6200",
    creditCode: "1200",
    notes: "A shortage debits the variance account. A surplus swaps the sides.",
  },
  {
    eventKey: "OSP",
    label: "Outside processing on a job",
    debitCode: "1210",
    creditCode: "2000",
    notes: "Vendor work charged to the job and owed to the supplier.",
  },
];

const EXTRA_ACCOUNTS: {
  code: string;
  name: string;
  type: string;
  poolCode?: string;
  allowability?: string;
  farCitation?: string;
}[] = [
  { code: "6020", name: "Fringe benefits", type: "EXPENSE", poolCode: "FRINGE" },
  { code: "6050", name: "Applied direct labor", type: "EXPENSE" },
  { code: "6060", name: "Applied shop overhead", type: "EXPENSE" },
  { code: "6070", name: "Applied fringe", type: "EXPENSE" },
  { code: "6110", name: "Shop overhead pool", type: "EXPENSE", poolCode: "OVERHEAD" },
  { code: "6210", name: "Scrap", type: "EXPENSE" },
  { code: "6300", name: "General and administrative", type: "EXPENSE", poolCode: "GA" },
  {
    code: "6800",
    name: "Unallowable costs",
    type: "EXPENSE",
    allowability: "UNALLOWABLE",
    farCitation: "31.205",
  },
];

const DEFAULT_POOLS = [
  {
    code: "FRINGE",
    name: "Fringe benefits",
    allocationBase: "DIRECT_LABOR",
    provisionalRate: 0.3,
    description: "Benefits loaded onto labor dollars.",
  },
  {
    code: "OVERHEAD",
    name: "Shop overhead",
    allocationBase: "DIRECT_LABOR",
    provisionalRate: 0.4,
    description: "Shop supervision, supplies, and facilities loaded on direct labor.",
  },
  {
    code: "GA",
    name: "General and administrative",
    allocationBase: "TOTAL_COST_INPUT",
    provisionalRate: 0.1,
    description:
      "Company-wide cost used for billing worksheets. It is not put into inventory.",
  },
];

let defaultsReady = false;

/** Chart rows, rate pools, account map, default company, and this year's months. */
export async function ensureAccountingDefaults() {
  if (defaultsReady) return;
  for (const spec of EXTRA_ACCOUNTS) {
    const existing = await prisma.account.findUnique({ where: { code: spec.code } });
    if (!existing) {
      await prisma.account.create({
        data: {
          code: spec.code,
          name: spec.name,
          type: spec.type,
          poolCode: spec.poolCode || null,
          allowability: spec.allowability || null,
          farCitation: spec.farCitation || null,
        },
      });
    } else if (
      (spec.poolCode && !existing.poolCode) ||
      (spec.allowability && !existing.allowability)
    ) {
      await prisma.account.update({
        where: { id: existing.id },
        data: {
          poolCode: existing.poolCode || spec.poolCode || null,
          allowability: existing.allowability || spec.allowability || null,
          farCitation: existing.farCitation || spec.farCitation || null,
        },
      });
    }
  }
  for (const row of DEFAULT_ACCOUNT_MAP) {
    await prisma.glAccountMap.upsert({
      where: { eventKey: row.eventKey },
      create: row,
      update: {},
    });
  }
  for (const pool of DEFAULT_POOLS) {
    await prisma.indirectPool.upsert({
      where: { code: pool.code },
      create: pool,
      update: {},
    });
  }
  const entity = await prisma.legalEntity.findFirst({ where: { isDefault: true } });
  if (!entity) {
    await prisma.legalEntity.create({
      data: { code: "MAIN", name: "Main company", isDefault: true },
    });
  }
  await ensureFiscalPeriods();
  defaultsReady = true;
}

export async function ensureFiscalPeriods(year = new Date().getFullYear()) {
  for (let m = 0; m < 12; m++) {
    const start = new Date(year, m, 1, 0, 0, 0, 0);
    const end = new Date(year, m + 1, 0, 23, 59, 59, 999);
    const name = `${year}-${String(m + 1).padStart(2, "0")}`;
    await prisma.accountingPeriod.upsert({
      where: { name },
      create: { name, startDate: start, endDate: end, status: "OPEN" },
      update: {},
    });
  }
}

async function accountByCode(code: string) {
  await ensureAccountingDefaults();
  const found = await prisma.account.findUnique({ where: { code } });
  if (found) return found;
  return prisma.account.create({
    data: { code, name: `Account ${code}`, type: "EXPENSE" },
  });
}

async function mappedPair(eventKey: string) {
  await ensureAccountingDefaults();
  const row =
    (await prisma.glAccountMap.findUnique({ where: { eventKey } })) ||
    DEFAULT_ACCOUNT_MAP.find((d) => d.eventKey === eventKey);
  if (!row) throw new Error(`No account mapping for ${eventKey}`);
  const [debit, credit] = await Promise.all([
    accountByCode(row.debitCode),
    accountByCode(row.creditCode),
  ]);
  return { debit, credit, label: row.label };
}

async function resolveCharge(workOrderId?: string | null, projectId?: string | null) {
  if (workOrderId) {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        id: true,
        projectId: true,
        project: { select: { programId: true } },
      },
    });
    return {
      workOrderId: wo?.id || workOrderId,
      projectId: projectId || wo?.projectId || null,
      programId: wo?.project?.programId || null,
    };
  }
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { programId: true },
    });
    return { workOrderId: null, projectId, programId: project?.programId || null };
  }
  return { workOrderId: null, projectId: null, programId: null };
}

type MappedPost = {
  eventKey: string;
  amount: number;
  description: string;
  source: string;
  sourceId?: string;
  idempotencyKey: string;
  memo?: string;
  costElement?: string;
  workOrderId?: string | null;
  projectId?: string | null;
  programId?: string | null;
  userId?: string | null;
  date?: Date;
  /** Shortage vs surplus: swap which account is debited. */
  swap?: boolean;
  /** Credit this account instead of the map (scrap on a job credits WIP). */
  creditCode?: string;
};

async function postMapped(params: MappedPost) {
  const amount = roundMoney(params.amount);
  if (amount <= 0.001) return null;
  const pair = await mappedPair(params.eventKey);
  const debit = params.swap ? pair.credit : pair.debit;
  const credit = params.creditCode
    ? await accountByCode(params.creditCode)
    : params.swap
      ? pair.debit
      : pair.credit;
  const charge = await resolveCharge(params.workOrderId, params.projectId);
  const programId = params.programId || charge.programId;
  const projectId = params.projectId || charge.projectId;
  const workOrderId = params.workOrderId || charge.workOrderId;
  try {
    return await postJournal({
      description: params.description,
      source: params.source,
      sourceId: params.sourceId,
      idempotencyKey: params.idempotencyKey,
      programId: programId || undefined,
      projectId: projectId || undefined,
      workOrderId: workOrderId || undefined,
      createdById: params.userId || undefined,
      date: params.date,
      status: "POSTED",
      lines: [
        {
          accountId: debit.id,
          debit: amount,
          memo: params.memo,
          // A job relief (scrap out of WIP) keeps the cost element on the
          // credit so the job total goes down. The expense line is not job cost.
          costElement: params.creditCode ? undefined : params.costElement,
          programId: programId || undefined,
          projectId: projectId || undefined,
          workOrderId: workOrderId || undefined,
        },
        {
          accountId: credit.id,
          credit: amount,
          memo: params.memo,
          costElement: params.creditCode ? params.costElement : undefined,
          programId: params.creditCode ? programId || undefined : undefined,
          projectId: params.creditCode ? projectId || undefined : undefined,
          workOrderId: params.creditCode ? workOrderId || undefined : undefined,
        },
      ],
    });
  } catch (err) {
    await logAudit({
      entityType: "JournalEntry",
      entityId: params.idempotencyKey,
      action: "GL_POST_FAILED",
      userId: params.userId,
      metadata: {
        eventKey: params.eventKey,
        message: err instanceof Error ? err.message : "post failed",
      },
    });
    throw err;
  }
}

export async function postMaterialIssue(params: {
  materialTransactionId: string;
  workOrderId: string;
  amount: number;
  userId?: string | null;
  memo?: string;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    select: { number: true },
  });
  return postMapped({
    eventKey: "MATERIAL_ISSUE",
    amount: params.amount,
    description: `Material issued to ${wo?.number || "job"}`,
    source: "INVENTORY",
    sourceId: params.materialTransactionId,
    idempotencyKey: `material-issue:${params.materialTransactionId}`,
    memo: params.memo,
    costElement: "MATERIAL",
    workOrderId: params.workOrderId,
    userId: params.userId,
  });
}

export async function postDirectLabor(params: {
  timeEntryId: string;
  amount: number;
  workOrderId?: string | null;
  projectId?: string | null;
  userId?: string | null;
  date?: Date;
  memo?: string;
}) {
  if (!params.workOrderId && !params.projectId) return null;
  const labor = await postMapped({
    eventKey: "LABOR_APPLIED",
    amount: params.amount,
    description: params.memo || "Direct labor applied to a job",
    source: "LABOR",
    sourceId: params.timeEntryId,
    idempotencyKey: `labor:${params.timeEntryId}`,
    memo: params.memo,
    costElement: "LABOR",
    workOrderId: params.workOrderId,
    projectId: params.projectId,
    userId: params.userId,
    date: params.date,
  });
  const pools = await prisma.indirectPool.findMany({
    where: { code: { in: ["FRINGE", "OVERHEAD"] } },
  });
  const fringe = pools.find((p) => p.code === "FRINGE");
  const overhead = pools.find((p) => p.code === "OVERHEAD");
  if (fringe && fringe.provisionalRate > 0) {
    await postMapped({
      eventKey: "FRINGE_APPLIED",
      amount: roundMoney(params.amount * fringe.provisionalRate),
      description: "Fringe applied to direct labor",
      source: "LABOR",
      sourceId: params.timeEntryId,
      idempotencyKey: `fringe:${params.timeEntryId}`,
      costElement: "FRINGE",
      workOrderId: params.workOrderId,
      projectId: params.projectId,
      userId: params.userId,
      date: params.date,
    });
  }
  if (overhead && overhead.provisionalRate > 0) {
    await postMapped({
      eventKey: "OVERHEAD_APPLIED",
      amount: roundMoney(params.amount * overhead.provisionalRate),
      description: "Shop overhead applied to direct labor",
      source: "LABOR",
      sourceId: params.timeEntryId,
      idempotencyKey: `oh:${params.timeEntryId}`,
      costElement: "OVERHEAD",
      workOrderId: params.workOrderId,
      projectId: params.projectId,
      userId: params.userId,
      date: params.date,
    });
  }
  return labor;
}

export async function postWorkOrderCompletion(params: {
  workOrderId: string;
  standardCost: number;
  userId?: string | null;
}) {
  const pair = await mappedPair("WO_COMPLETE");
  const variance = await accountByCode("6200");
  const lines = await prisma.journalLine.findMany({
    where: {
      workOrderId: params.workOrderId,
      accountId: pair.credit.id,
      journalEntry: { status: "POSTED" },
    },
    select: { debit: true, credit: true },
  });
  const wipBalance = lines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0);
  const entry = completionEntry({
    wipBalance,
    standardCost: params.standardCost,
    fgAccountId: pair.debit.id,
    wipAccountId: pair.credit.id,
    varianceAccountId: variance.id,
  });
  if (!entry) return null;
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    select: { number: true, projectId: true },
  });
  return postJournal({
    description: `Finished ${wo?.number || "job"} moved to finished goods`,
    source: "WO",
    sourceId: params.workOrderId,
    idempotencyKey: `wo-complete:${params.workOrderId}`,
    workOrderId: params.workOrderId,
    projectId: wo?.projectId || undefined,
    createdById: params.userId || undefined,
    status: "POSTED",
    lines: entry,
  });
}

export async function postScrap(params: {
  materialTransactionId: string;
  amount: number;
  workOrderId?: string | null;
  userId?: string | null;
  memo?: string;
  /** Government-owned material stays off the company ledger. */
  governmentOwned?: boolean;
}) {
  if (params.governmentOwned) return null;
  return postMapped({
    eventKey: "SCRAP",
    amount: params.amount,
    description: params.memo || "Material scrapped",
    source: "SCRAP",
    sourceId: params.materialTransactionId,
    idempotencyKey: `scrap:${params.materialTransactionId}`,
    memo: params.memo,
    costElement: params.workOrderId ? "MATERIAL" : undefined,
    creditCode: params.workOrderId ? "1210" : undefined,
    workOrderId: params.workOrderId,
    userId: params.userId,
  });
}

/** Signed dollar amount: positive means more stock was counted than the books showed. */
export async function postInventoryAdjustment(params: {
  sourceId: string;
  amount: number;
  userId?: string | null;
  memo?: string;
}) {
  const amount = roundMoney(params.amount);
  if (Math.abs(amount) <= 0.001) return null;
  return postMapped({
    eventKey: "INV_ADJUST",
    amount: Math.abs(amount),
    swap: amount > 0,
    description: params.memo || "Inventory count adjustment",
    source: "INVENTORY",
    sourceId: params.sourceId,
    idempotencyKey: `inv-adjust:${params.sourceId}`,
    memo: params.memo,
    userId: params.userId,
  });
}

export async function postOutsideProcessing(params: {
  sourceId: string;
  amount: number;
  workOrderId?: string | null;
  projectId?: string | null;
  userId?: string | null;
  memo?: string;
}) {
  return postMapped({
    eventKey: "OSP",
    amount: params.amount,
    description: params.memo || "Outside processing charged to a job",
    source: "AP",
    sourceId: params.sourceId,
    idempotencyKey: `osp:${params.sourceId}`,
    memo: params.memo,
    costElement: "OSP",
    workOrderId: params.workOrderId,
    projectId: params.projectId,
    userId: params.userId,
  });
}

/** Program on a sales order, via the work order that builds it. */
export async function chargeForSalesOrder(salesOrderId: string) {
  const wo = await prisma.workOrder.findFirst({
    where: { salesOrderId },
    select: {
      id: true,
      projectId: true,
      project: { select: { programId: true } },
    },
  });
  return {
    workOrderId: wo?.id || null,
    projectId: wo?.projectId || null,
    programId: wo?.project?.programId || null,
  };
}

/** Program on a purchase order, via its project. */
export async function chargeForPurchaseOrder(purchaseOrderId: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      projectId: true,
      clin: true,
      project: { select: { programId: true } },
    },
  });
  let clinId: string | null = null;
  if (po?.clin && po.project?.programId) {
    const clin = await prisma.programClin.findUnique({
      where: {
        programId_clinNumber: {
          programId: po.project.programId,
          clinNumber: po.clin,
        },
      },
      select: { id: true },
    });
    clinId = clin?.id || null;
  }
  return {
    projectId: po?.projectId || null,
    programId: po?.project?.programId || null,
    clinId,
  };
}
