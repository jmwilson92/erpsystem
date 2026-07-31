/**
 * Contracts, CLINs, modifications and CDRL deliverables.
 *
 * The unit a defense shop actually operates in is the contract line item, not
 * the sales order: funding, delivery, invoicing and data deliverables all hang
 * off a CLIN. Programs and projects describe how work is organised; contracts
 * describe what was bought and what may be billed.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const CONTRACT_TYPES = [
  "FFP",
  "FFP_LOE",
  "CPFF",
  "CPIF",
  "CPAF",
  "T_AND_M",
  "IDIQ",
  "BOA",
  "COMMERCIAL",
] as const;

export const CLIN_CATEGORIES = [
  "SUPPLY",
  "SERVICE",
  "DATA",
  "TRAVEL",
  "ODC",
] as const;

/** DD 1423 block 8 — approval required, or delivered for information only. */
export const CDRL_APPROVAL_CODES = ["A", "I"] as const;

/**
 * Contract value is always the sum of its CLINs — never the running total of
 * modification deltas.
 *
 * Both numbers describe the same change, so adding them together double-counts
 * every mod. Deltas stay on the modification record as what the SF 30 actually
 * said, which makes them useful for reconciliation (see `reconcileModDeltas`)
 * without letting them drive the balance.
 *
 * Unexercised options are excluded. An option is priced but not obligated, so
 * counting it as contract value overstates both backlog and what can be billed.
 */
export type RollupClin = {
  id: string;
  parentId?: string | null;
  isInformational?: boolean;
  totalValue: number;
  fundedValue: number;
  isOption?: boolean;
  optionExercisedAt?: Date | null;
};

/**
 * Which lines carry the money.
 *
 * A contract's value must be counted at exactly one level of the CLIN tree or
 * it is counted twice. An informational SLIN is a funding subdivision of its
 * parent, so it never contributes. A separately priced SLIN does contribute,
 * and then its parent is a header whose own value must be skipped — otherwise
 * a 0001 header holding $1M with two $500k SLINs beneath it rolls up as $2M.
 */
export function countsTowardValue(c: RollupClin, all: RollupClin[]): boolean {
  if (c.isOption && !c.optionExercisedAt) return false;
  if (c.isInformational) return false;
  const hasPricedChild = all.some(
    (x) => x.parentId === c.id && !x.isInformational
  );
  return !hasPricedChild;
}

export function rollupTotals(clins: RollupClin[]) {
  let totalValue = 0;
  let fundedValue = 0;
  for (const c of clins) {
    if (!countsTowardValue(c, clins)) continue;
    totalValue += c.totalValue;
    fundedValue += c.fundedValue;
  }
  return { totalValue: round2(totalValue), fundedValue: round2(fundedValue) };
}

/**
 * A SLIN number extends its parent's: 0001 gives 000101 or 0001AA. Rejecting
 * anything else keeps the tree readable from the numbers alone, which is how
 * the numbering is used on an invoice or a receiving report.
 */
export function isValidSlinNumber(parentNumber: string, slinNumber: string) {
  const p = parentNumber.trim().toUpperCase();
  const s = slinNumber.trim().toUpperCase();
  if (!p || !s) return false;
  if (!s.startsWith(p)) return false;
  const suffix = s.slice(p.length);
  return /^([0-9]{2}|[A-Z]{2})$/.test(suffix);
}

export async function recomputeContractTotals(contractId: string) {
  const clins = await prisma.clin.findMany({
    where: { contractId, status: { not: "CANCELLED" } },
    select: {
      id: true,
      parentId: true,
      isInformational: true,
      totalValue: true,
      fundedValue: true,
      isOption: true,
      optionExercisedAt: true,
    },
  });

  const { totalValue, fundedValue } = rollupTotals(clins);

  return prisma.contract.update({
    where: { id: contractId },
    data: { totalValue, fundedValue },
  });
}

/**
 * Where the CLIN rollup disagrees with what the executed modifications claim.
 *
 * A mismatch is not automatically an error — an administrative mod legitimately
 * carries a zero delta — but a gap between the paperwork and the line items is
 * exactly what an auditor asks about, so it is surfaced rather than quietly
 * reconciled.
 */
export async function reconcileModDeltas(contractId: string) {
  const [contract, mods] = await Promise.all([
    prisma.contract.findUnique({
      where: { id: contractId },
      select: { totalValue: true, fundedValue: true },
    }),
    prisma.contractMod.findMany({
      where: { contractId, status: "EXECUTED" },
      select: { valueDelta: true, fundingDelta: true },
    }),
  ]);
  if (!contract) return null;

  const modTotal = mods.reduce((s, m) => s + m.valueDelta, 0);
  const modFunded = mods.reduce((s, m) => s + m.fundingDelta, 0);

  return {
    clinTotal: contract.totalValue,
    clinFunded: contract.fundedValue,
    modTotal: round2(modTotal),
    modFunded: round2(modFunded),
    valueVariance: round2(contract.totalValue - modTotal),
    fundingVariance: round2(contract.fundedValue - modFunded),
  };
}

/**
 * DPAS ratings have a fixed shape: DO or DX, then a program identifier symbol
 * (e.g. "DO-A1"). Normalised on the way in so the floor can filter on rated
 * work without matching six spellings of the same thing.
 */
export function normalizeDpasRating(raw?: string | null): string | null {
  const v = (raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!v) return null;
  const m = v.match(/^(DO|DX)-?([A-Z]\d{1,2})$/);
  if (!m) throw new Error(`Invalid DPAS rating "${raw}" — expected e.g. DO-A1`);
  return `${m[1]}-${m[2]}`;
}

export async function createContract(params: {
  number: string;
  name: string;
  customerId?: string | null;
  programId?: string | null;
  contractType?: string;
  isPrime?: boolean;
  primeContractor?: string | null;
  contractingOfficer?: string | null;
  dpasRating?: string | null;
  awardDate?: Date | null;
  startDate?: Date | null;
  endDate?: Date | null;
  ownerId?: string | null;
  description?: string | null;
  userId?: string;
}) {
  const number = params.number.trim().toUpperCase();
  if (!number) throw new Error("Contract number is required");
  if (!params.name.trim()) throw new Error("Contract name is required");

  const existing = await prisma.contract.findUnique({ where: { number } });
  if (existing) throw new Error(`Contract ${number} already exists`);

  const contract = await prisma.contract.create({
    data: {
      number,
      name: params.name.trim(),
      description: params.description?.trim() || null,
      customerId: params.customerId || null,
      programId: params.programId || null,
      contractType: params.contractType || "FFP",
      isPrime: params.isPrime ?? true,
      primeContractor: params.primeContractor?.trim() || null,
      contractingOfficer: params.contractingOfficer?.trim() || null,
      dpasRating: normalizeDpasRating(params.dpasRating),
      awardDate: params.awardDate ?? null,
      startDate: params.startDate ?? null,
      endDate: params.endDate ?? null,
      ownerId: params.ownerId || null,
    },
  });

  await logAudit({
    entityType: "Contract",
    entityId: contract.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number },
  });
  return contract;
}

export async function addClin(params: {
  contractId: string;
  number: string;
  description: string;
  category?: string;
  clinType?: string | null;
  partId?: string | null;
  quantity?: number;
  uom?: string;
  unitPrice?: number;
  fundedValue?: number;
  isOption?: boolean;
  isInformational?: boolean;
  parentId?: string | null;
  deliveryDate?: Date | null;
  userId?: string;
}) {
  const number = params.number.trim().toUpperCase();
  if (!number) throw new Error("CLIN number is required");
  if (!params.description.trim()) throw new Error("CLIN description is required");

  // A SLIN has to extend its parent's number and belong to the same contract.
  if (params.parentId) {
    const parent = await prisma.clin.findUnique({
      where: { id: params.parentId },
      select: { number: true, contractId: true, parentId: true },
    });
    if (!parent) throw new Error("Parent CLIN not found");
    if (parent.contractId !== params.contractId) {
      throw new Error("A SLIN must sit under a CLIN on the same contract");
    }
    if (parent.parentId) {
      throw new Error("SLINs do not nest — 000101 cannot itself carry sub-lines");
    }
    if (!isValidSlinNumber(parent.number, number)) {
      throw new Error(
        `${number} is not a sub-line of ${parent.number} — a SLIN extends its parent with two digits or two letters, such as ${parent.number}01`
      );
    }
  }

  const quantity = params.quantity ?? 0;
  const unitPrice = params.unitPrice ?? 0;
  const totalValue = round2(quantity * unitPrice);
  // Funding cannot exceed the line's own value: obligating more than the line
  // is worth is a data-entry slip, not an accounting position.
  const fundedValue = Math.min(params.fundedValue ?? 0, totalValue);

  const clin = await prisma.clin.create({
    data: {
      contractId: params.contractId,
      number,
      parentId: params.parentId || null,
      description: params.description.trim(),
      category: params.category || "SUPPLY",
      clinType: params.clinType?.trim() || null,
      partId: params.partId || null,
      quantity,
      uom: params.uom || "EA",
      unitPrice,
      totalValue,
      fundedValue,
      isOption: params.isOption ?? false,
      isInformational: params.isInformational ?? false,
      deliveryDate: params.deliveryDate ?? null,
    },
  });

  await recomputeContractTotals(params.contractId);
  await logAudit({
    entityType: "Clin",
    entityId: clin.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number, totalValue },
  });
  return clin;
}

/** Exercising an option is what turns priced-but-optional into real backlog. */
export async function exerciseOption(params: { clinId: string; userId?: string }) {
  const clin = await prisma.clin.findUnique({ where: { id: params.clinId } });
  if (!clin) throw new Error("CLIN not found");
  if (!clin.isOption) throw new Error(`CLIN ${clin.number} is not an option line`);
  if (clin.optionExercisedAt) {
    throw new Error(`CLIN ${clin.number} was already exercised`);
  }

  const updated = await prisma.clin.update({
    where: { id: params.clinId },
    data: { optionExercisedAt: new Date() },
  });
  await recomputeContractTotals(clin.contractId);
  await logAudit({
    entityType: "Clin",
    entityId: clin.id,
    action: "OPTION_EXERCISED",
    userId: params.userId,
    metadata: { number: clin.number, value: clin.totalValue },
  });
  return updated;
}

export async function addMod(params: {
  contractId: string;
  number: string;
  description: string;
  modType?: string;
  valueDelta?: number;
  fundingDelta?: number;
  newEndDate?: Date | null;
  effectiveDate?: Date | null;
  userId?: string;
}) {
  const number = params.number.trim().toUpperCase();
  if (!number) throw new Error("Modification number is required");

  const mod = await prisma.contractMod.create({
    data: {
      contractId: params.contractId,
      number,
      modType: params.modType || "BILATERAL",
      description: params.description.trim(),
      valueDelta: params.valueDelta ?? 0,
      fundingDelta: params.fundingDelta ?? 0,
      newEndDate: params.newEndDate ?? null,
      effectiveDate: params.effectiveDate ?? null,
    },
  });
  await logAudit({
    entityType: "ContractMod",
    entityId: mod.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number },
  });
  return mod;
}

/**
 * Executing a modification is the point at which it takes effect. Period-of-
 * performance changes apply here; value changes do not, because the balance is
 * owned by the CLINs (see `recomputeContractTotals`).
 */
export async function executeMod(params: { modId: string; userId?: string }) {
  const mod = await prisma.contractMod.findUnique({ where: { id: params.modId } });
  if (!mod) throw new Error("Modification not found");
  if (mod.status === "EXECUTED") {
    throw new Error(`Modification ${mod.number} is already executed`);
  }

  const updated = await prisma.contractMod.update({
    where: { id: params.modId },
    data: {
      status: "EXECUTED",
      executedAt: new Date(),
      executedById: params.userId || null,
    },
  });

  if (mod.newEndDate) {
    await prisma.contract.update({
      where: { id: mod.contractId },
      data: { endDate: mod.newEndDate },
    });
  }

  await logAudit({
    entityType: "ContractMod",
    entityId: mod.id,
    action: "EXECUTED",
    userId: params.userId,
    metadata: { number: mod.number, valueDelta: mod.valueDelta },
  });
  return updated;
}

export async function addCdrl(params: {
  contractId: string;
  number: string;
  title: string;
  clinId?: string | null;
  didNumber?: string | null;
  frequency?: string;
  approvalCode?: string;
  reviewDays?: number;
  firstDueDate?: Date | null;
  ownerId?: string | null;
  userId?: string;
}) {
  const number = params.number.trim().toUpperCase();
  if (!number) throw new Error("CDRL number is required");
  if (!params.title.trim()) throw new Error("CDRL title is required");

  const approvalCode = (params.approvalCode || "A").toUpperCase();
  if (!CDRL_APPROVAL_CODES.includes(approvalCode as "A" | "I")) {
    throw new Error(
      `Invalid approval code "${params.approvalCode}" — expected A or I`
    );
  }

  const cdrl = await prisma.cdrl.create({
    data: {
      contractId: params.contractId,
      clinId: params.clinId || null,
      number,
      title: params.title.trim(),
      didNumber: params.didNumber?.trim().toUpperCase() || null,
      frequency: params.frequency || "ONE_TIME",
      approvalCode,
      reviewDays: params.reviewDays ?? 30,
      firstDueDate: params.firstDueDate ?? null,
      nextDueDate: params.firstDueDate ?? null,
      ownerId: params.ownerId || null,
    },
  });

  await logAudit({
    entityType: "Cdrl",
    entityId: cdrl.id,
    action: "CREATED",
    userId: params.userId,
    metadata: { number },
  });
  return cdrl;
}

/**
 * Record a delivery. Each submission is a new revision rather than an update,
 * so a rejected-then-resubmitted deliverable keeps both rows — the history an
 * approval-code "A" item exists to prove.
 */
export async function submitCdrl(params: {
  cdrlId: string;
  documentUrl?: string | null;
  documentName?: string | null;
  userId?: string;
}) {
  const cdrl = await prisma.cdrl.findUnique({
    where: { id: params.cdrlId },
    include: { submissions: { orderBy: { revision: "desc" }, take: 1 } },
  });
  if (!cdrl) throw new Error("CDRL not found");

  const revision = (cdrl.submissions[0]?.revision ?? 0) + 1;
  const submission = await prisma.cdrlSubmission.create({
    data: {
      cdrlId: params.cdrlId,
      revision,
      dueDate: cdrl.nextDueDate,
      submittedAt: new Date(),
      submittedById: params.userId || null,
      status: "SUBMITTED",
      documentUrl: params.documentUrl || null,
      documentName: params.documentName || null,
    },
  });

  await prisma.cdrl.update({
    where: { id: params.cdrlId },
    data: { status: "SUBMITTED" },
  });

  await logAudit({
    entityType: "Cdrl",
    entityId: cdrl.id,
    action: "SUBMITTED",
    userId: params.userId,
    metadata: { number: cdrl.number, revision },
  });
  return submission;
}

/**
 * Deliverables coming due, soonest first. Overdue items sort in naturally
 * because their due date is already in the past.
 */
export async function getCdrlsDue(withinDays = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);

  return prisma.cdrl.findMany({
    where: {
      status: { in: ["OPEN", "REJECTED"] },
      nextDueDate: { not: null, lte: cutoff },
    },
    orderBy: { nextDueDate: "asc" },
    include: {
      contract: { select: { number: true, name: true } },
      owner: { select: { name: true } },
    },
  });
}

export async function listContracts(params?: { status?: string }) {
  return prisma.contract.findMany({
    where: params?.status ? { status: params.status } : undefined,
    orderBy: [{ status: "asc" }, { number: "asc" }],
    include: {
      customer: { select: { name: true } },
      program: { select: { code: true, name: true } },
      _count: { select: { clins: true, cdrls: true, mods: true } },
    },
  });
}

export async function getContract(id: string) {
  return prisma.contract.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      program: { select: { id: true, code: true, name: true } },
      owner: { select: { id: true, name: true } },
      clins: {
        orderBy: { number: "asc" },
        include: { part: { select: { partNumber: true } } },
      },
      mods: { orderBy: { number: "desc" } },
      cdrls: {
        orderBy: { number: "asc" },
        include: { submissions: { orderBy: { revision: "desc" } } },
      },
    },
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
