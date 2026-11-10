/**
 * Program money, read from the ledger and from the PMO record.
 *
 * The program (PMO) is the contract. Incurred cost is the sum of journal
 * lines stamped with that program and a cost element. Funding, ceiling,
 * CLINs, and contract type live on the program. Project budget / earned
 * value stay the planning numbers entered on the project — they are not
 * a second set of books.
 *
 * Rates and billings here are worksheets. They are not a DCAA submission
 * and they do not decide what the government will pay.
 */
import { prisma } from "@/lib/db";
import {
  actualIndirectRate,
  allocateIndirect,
  netIncurred,
  programOutlook,
  provisionalBilling,
  roundMoney,
  type IncurredLine,
} from "@/lib/services/posting-rules";

const money = (n: number) => roundMoney(n);

function asIncurred(
  lines: {
    programId: string | null;
    projectId: string | null;
    workOrderId: string | null;
    costElement: string | null;
    unallowable: boolean;
    debit: number;
    credit: number;
  }[]
): IncurredLine[] {
  return lines;
}

export async function getProgramFinancials(programId: string) {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      clins: { orderBy: { clinNumber: "asc" } },
      laborCategories: { orderBy: { code: "asc" } },
      projects: {
        select: {
          id: true,
          number: true,
          name: true,
          budgetCost: true,
          actualCost: true,
          earnedValue: true,
          plannedValue: true,
          percentComplete: true,
          contractValue: true,
        },
        orderBy: { number: "asc" },
      },
    },
  });
  if (!program) return null;

  const lines = await prisma.journalLine.findMany({
    where: { programId, journalEntry: { status: "POSTED" } },
    include: {
      account: { select: { type: true, code: true, name: true } },
    },
  });
  const incurred = netIncurred(asIncurred(lines));
  const billed = money(
    lines
      .filter((l) => l.account.type === "REVENUE")
      .reduce((s, l) => s + (l.credit || 0) - (l.debit || 0), 0)
  );
  const wip = money(
    lines
      .filter((l) => l.account.code === "1210")
      .reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)
  );
  const pct = program.projects.length
    ? program.projects.reduce((s, p) => s + (p.percentComplete || 0), 0) /
      program.projects.length
    : 0;
  const budget =
    program.projects.reduce((s, p) => s + p.budgetCost, 0) || program.budgetCost;
  const performanceActual = program.projects.reduce((s, p) => s + p.actualCost, 0);
  const earned = program.projects.reduce((s, p) => s + p.earnedValue, 0);
  const planned = program.projects.reduce((s, p) => s + p.plannedValue, 0);
  const funded =
    program.fundedAmount ||
    program.clins.reduce((s, c) => s + c.fundedAmount, 0);
  const ceiling =
    program.ceilingAmount ||
    program.clins.reduce((s, c) => s + c.ceilingAmount, 0);
  const outlook = programOutlook({
    funded,
    ceiling,
    billed,
    incurredAllowable: incurred.allowable,
    percentComplete: pct,
    budget,
  });

  const hours = await prisma.timeEntry.findMany({
    where: {
      OR: [
        { project: { programId } },
        { workOrder: { project: { programId } } },
      ],
    },
    include: { laborCategory: true },
  });
  const tmHours = new Map<string, { name: string; hours: number; billingRate: number }>();
  for (const e of hours) {
    const code = e.laborCategory?.code || "UNASSIGNED";
    const row = tmHours.get(code) || {
      name: e.laborCategory?.name || "No labor category",
      hours: 0,
      billingRate: e.laborCategory?.billingRate || 0,
    };
    row.hours = money(row.hours + e.hours);
    tmHours.set(code, row);
  }
  const billing = provisionalBilling({
    contractType: program.contractType,
    allowableCost: incurred.allowable,
    feePercent: program.feePercent,
    tmHours: [...tmHours.values()],
    funded,
  });

  return {
    program,
    incurred,
    billed,
    wip,
    outlook,
    funded,
    ceiling,
    budget,
    performanceActual,
    earned,
    planned,
    percentComplete: pct,
    billing,
    laborCategories: [...tmHours.entries()].map(([code, row]) => ({ code, ...row })),
  };
}

/** Incurred-on-the-books by program, for the PMO home cards. */
export async function booksIncurredByProgram() {
  const lines = await prisma.journalLine.findMany({
    where: {
      programId: { not: null },
      costElement: { not: null },
      unallowable: false,
      journalEntry: { status: "POSTED" },
    },
    select: { programId: true, debit: true, credit: true },
  });
  const map = new Map<string, number>();
  for (const l of lines) {
    if (!l.programId) continue;
    map.set(
      l.programId,
      money((map.get(l.programId) || 0) + (l.debit || 0) - (l.credit || 0))
    );
  }
  return map;
}

export async function computeIndirectRates() {
  const [pools, accounts, lines] = await Promise.all([
    prisma.indirectPool.findMany({ orderBy: { code: "asc" } }),
    prisma.account.findMany({
      where: { poolCode: { not: null }, isActive: true },
    }),
    prisma.journalLine.findMany({
      where: {
        costElement: { in: ["MATERIAL", "LABOR", "FRINGE", "OVERHEAD", "OSP", "ODC"] },
        journalEntry: { status: "POSTED" },
      },
      select: {
        costElement: true,
        unallowable: true,
        debit: true,
        credit: true,
        programId: true,
      },
    }),
  ]);
  const allowable = lines.filter((l) => !l.unallowable);
  const directLabor = money(
    allowable
      .filter((l) => l.costElement === "LABOR")
      .reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)
  );
  const totalCostInput = money(
    allowable.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)
  );
  const byProgram = new Map<string, number>();
  for (const l of allowable.filter((x) => x.costElement === "LABOR" && x.programId)) {
    byProgram.set(
      l.programId!,
      money((byProgram.get(l.programId!) || 0) + (l.debit || 0) - (l.credit || 0))
    );
  }

  return pools.map((pool) => {
    const poolAccounts = accounts.filter(
      (a) => a.poolCode === pool.code && a.allowability !== "UNALLOWABLE"
    );
    const poolCosts = money(poolAccounts.reduce((s, a) => s + a.balance, 0));
    const base = pool.allocationBase === "TOTAL_COST_INPUT" ? totalCostInput : directLabor;
    const actual = actualIndirectRate(poolCosts, base);
    const allocations = allocateIndirect(
      [...byProgram.entries()].map(([key, b]) => ({ key, base: b })),
      actual ?? pool.provisionalRate
    );
    return {
      code: pool.code,
      name: pool.name,
      description: pool.description,
      allocationBase: pool.allocationBase,
      provisionalRate: pool.provisionalRate,
      actualRate: actual,
      poolCosts,
      base,
      accounts: poolAccounts.map((a) => ({
        code: a.code,
        name: a.name,
        balance: a.balance,
      })),
      allocations,
    };
  });
}

export async function jobCostRows() {
  const [orders, lines] = await Promise.all([
    prisma.workOrder.findMany({
      where: { projectId: { not: null } },
      select: {
        id: true,
        number: true,
        status: true,
        standardCost: true,
        actualCost: true,
        quantity: true,
        project: {
          select: {
            number: true,
            name: true,
            program: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { number: "asc" },
      take: 300,
    }),
    prisma.journalLine.findMany({
      where: {
        workOrderId: { not: null },
        costElement: { not: null },
        journalEntry: { status: "POSTED" },
      },
      select: {
        workOrderId: true,
        programId: true,
        projectId: true,
        costElement: true,
        unallowable: true,
        debit: true,
        credit: true,
      },
    }),
  ]);
  return orders.map((wo) => {
    const buckets = netIncurred(asIncurred(lines), { workOrderId: wo.id });
    return {
      number: wo.number,
      status: wo.status,
      program: wo.project?.program?.code || "—",
      project: wo.project ? `${wo.project.number} ${wo.project.name}` : "—",
      estimate: wo.standardCost,
      shopActual: wo.actualCost,
      books: buckets.allowable,
      unallowable: buckets.unallowable,
      material: buckets.material,
      labor: buckets.labor,
      fringe: buckets.fringe,
      overhead: buckets.overhead,
      osp: buckets.osp,
    };
  });
}

export async function laborDistributionRows() {
  const entries = await prisma.timeEntry.findMany({
    orderBy: { date: "desc" },
    take: 1000,
    include: {
      user: { select: { name: true } },
      laborCategory: { select: { code: true, name: true, billingRate: true } },
      workOrder: {
        select: {
          number: true,
          project: { select: { program: { select: { code: true, contractNumber: true } } } },
        },
      },
      project: { select: { number: true, program: { select: { code: true, contractNumber: true } } } },
    },
  });
  return entries.map((e) => {
    const program =
      e.workOrder?.project?.program || e.project?.program || null;
    const charge = e.workOrder
      ? e.workOrder.number
      : e.project
        ? e.project.number
        : e.chargeCode || e.indirectPool || e.type;
    return {
      date: e.date.toISOString().slice(0, 10),
      person: e.user.name,
      hours: e.hours,
      charge,
      direct: Boolean(e.workOrderId || e.projectId),
      program: program?.code || "Indirect / none",
      contract: program?.contractNumber || "",
      category: e.laborCategory ? `${e.laborCategory.code} ${e.laborCategory.name}` : "",
      status: e.status,
      cost: e.costAmount || 0,
    };
  });
}

export async function wipValuationRows() {
  const lines = await prisma.journalLine.findMany({
    where: {
      account: { code: "1210" },
      journalEntry: { status: "POSTED" },
      workOrderId: { not: null },
    },
    select: {
      workOrderId: true,
      debit: true,
      credit: true,
      costElement: true,
      unallowable: true,
    },
  });
  const byWo = new Map<string, { balance: number; allowable: number }>();
  for (const l of lines) {
    if (!l.workOrderId) continue;
    const row = byWo.get(l.workOrderId) || { balance: 0, allowable: 0 };
    const amt = (l.debit || 0) - (l.credit || 0);
    row.balance = money(row.balance + amt);
    if (l.costElement && !l.unallowable) row.allowable = money(row.allowable + amt);
    byWo.set(l.workOrderId, row);
  }
  const ids = [...byWo.keys()];
  if (!ids.length) return [];
  const orders = await prisma.workOrder.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      number: true,
      status: true,
      project: { select: { program: { select: { code: true } } } },
    },
  });
  return orders.map((wo) => {
    const row = byWo.get(wo.id)!;
    return {
      number: wo.number,
      status: wo.status,
      program: wo.project?.program?.code || "—",
      wipBalance: row.balance,
    };
  });
}

type Table = { title: string; columns: string[]; rows: (string | number)[][] };

export async function reportProgramPl(): Promise<Table> {
  const programs = await prisma.program.findMany({ orderBy: { code: "asc" } });
  const rows: (string | number)[][] = [];
  for (const p of programs) {
    const fin = await getProgramFinancials(p.id);
    if (!fin) continue;
    rows.push([
      p.code,
      p.name,
      p.contractType,
      p.contractNumber || "",
      money(fin.funded),
      money(fin.billed),
      money(fin.incurred.allowable),
      money(fin.incurred.unallowable),
      money(fin.wip),
      fin.outlook.eac,
      fin.outlook.burn == null ? "" : Math.round(fin.outlook.burn * 1000) / 10,
    ]);
  }
  return {
    title: "Program profit and loss (from the books)",
    columns: [
      "Program",
      "Name",
      "Type",
      "Contract",
      "Funded",
      "Billed",
      "Allowable cost",
      "Unallowable (excluded)",
      "Still in WIP",
      "Estimate at completion",
      "Burn % of funding",
    ],
    rows,
  };
}

export async function reportJobProfit(): Promise<Table> {
  const jobs = await jobCostRows();
  return {
    title: "Job profitability",
    columns: [
      "Job",
      "Status",
      "Program",
      "Project",
      "Estimate",
      "Shop log",
      "On the books",
      "Unallowable",
      "Material",
      "Labor",
      "Fringe",
      "Overhead",
      "Outside processing",
    ],
    rows: jobs.map((j) => [
      j.number,
      j.status,
      j.program,
      j.project,
      money(j.estimate),
      money(j.shopActual),
      money(j.books),
      money(j.unallowable),
      money(j.material),
      money(j.labor),
      money(j.fringe),
      money(j.overhead),
      money(j.osp),
    ]),
  };
}

export async function reportWipBooks(): Promise<Table> {
  const rows = await wipValuationRows();
  return {
    title: "Work in process on the books",
    columns: ["Job", "Status", "Program", "WIP balance"],
    rows: rows.map((r) => [r.number, r.status, r.program, money(r.wipBalance)]),
  };
}

export async function reportLaborDistribution(): Promise<Table> {
  const rows = await laborDistributionRows();
  return {
    title: "Labor distribution",
    columns: [
      "Date",
      "Person",
      "Hours",
      "Charged to",
      "Direct?",
      "Program",
      "Contract",
      "Labor category",
      "Status",
      "Cost",
    ],
    rows: rows.map((r) => [
      r.date,
      r.person,
      r.hours,
      r.charge,
      r.direct ? "Direct" : "Indirect",
      r.program,
      r.contract,
      r.category,
      r.status,
      money(r.cost),
    ]),
  };
}

export async function reportIndirectRates(): Promise<Table> {
  const rates = await computeIndirectRates();
  return {
    title: "Indirect rates (worksheet)",
    columns: [
      "Pool",
      "Base",
      "Pool costs",
      "Base amount",
      "Provisional rate",
      "Actual rate",
    ],
    rows: rates.map((r) => [
      r.name,
      r.allocationBase === "TOTAL_COST_INPUT" ? "All cost except G&A and unallowable" : "Direct labor",
      money(r.poolCosts),
      money(r.base),
      r.provisionalRate,
      r.actualRate == null ? "" : r.actualRate,
    ]),
  };
}

export async function reportUnallowables(): Promise<Table> {
  const [accounts, lines] = await Promise.all([
    prisma.account.findMany({
      where: { allowability: "UNALLOWABLE" },
      orderBy: { code: "asc" },
    }),
    prisma.journalLine.findMany({
      where: { unallowable: true, journalEntry: { status: "POSTED" } },
      include: {
        account: { select: { code: true, name: true } },
        journalEntry: { select: { number: true, date: true, description: true } },
      },
      orderBy: { journalEntry: { date: "desc" } },
      take: 500,
    }),
  ]);
  return {
    title: "Unallowable costs left out of billings and rates",
    columns: ["Date", "Journal", "Account", "FAR note", "Program", "Amount", "Description"],
    rows: [
      ...accounts.map((a) => [
        "",
        "",
        `${a.code} ${a.name}`,
        a.farCitation || "",
        "",
        money(a.balance),
        "Account flagged unallowable",
      ]),
      ...lines.map((l) => [
        l.journalEntry.date.toISOString().slice(0, 10),
        l.journalEntry.number,
        `${l.account.code} ${l.account.name}`,
        l.farCitation || "",
        l.programId || "",
        money((l.debit || 0) - (l.credit || 0)),
        l.journalEntry.description,
      ]),
    ],
  };
}

/** Incurred-cost worksheet in the shape of an ICE package. Not a submission. */
export async function reportIce(): Promise<Table> {
  const [programs, rates, unallow] = await Promise.all([
    prisma.program.findMany({
      where: { isGovernment: true },
      orderBy: { code: "asc" },
    }),
    computeIndirectRates(),
    prisma.account.findMany({
      where: { allowability: "UNALLOWABLE" },
      orderBy: { code: "asc" },
    }),
  ]);
  const rows: (string | number)[][] = [
    ["Schedule", "Indirect rates — provisional vs actual", "", "", ""],
  ];
  for (const r of rates) {
    rows.push([
      r.code,
      r.name,
      r.allocationBase,
      r.provisionalRate,
      r.actualRate == null ? "" : r.actualRate,
    ]);
  }
  rows.push(["Schedule", "Contract cost — allowable only", "", "", ""]);
  for (const p of programs) {
    const fin = await getProgramFinancials(p.id);
    if (!fin) continue;
    rows.push([
      p.contractNumber || p.code,
      p.name,
      p.contractType,
      money(fin.incurred.allowable),
      money(fin.billed),
    ]);
    rows.push(["", "Material", "", money(fin.incurred.material), ""]);
    rows.push(["", "Direct labor", "", money(fin.incurred.labor), ""]);
    rows.push(["", "Fringe applied", "", money(fin.incurred.fringe), ""]);
    rows.push(["", "Shop overhead applied", "", money(fin.incurred.overhead), ""]);
    rows.push(["", "Outside processing", "", money(fin.incurred.osp), ""]);
    rows.push(["", "Unallowable excluded", "", money(fin.incurred.unallowable), ""]);
    rows.push([
      "",
      "Billing worksheet",
      fin.billing.basis,
      money(fin.billing.amount),
      money(fin.billing.fee),
    ]);
  }
  rows.push(["Schedule", "Unallowable accounts", "", "", ""]);
  for (const a of unallow) {
    rows.push([a.code, a.name, a.farCitation || "", money(a.balance), ""]);
  }
  return {
    title: "Incurred cost worksheet (not a government submission)",
    columns: ["Ref", "Item", "Note", "Amount", "Compare"],
    rows,
  };
}

export async function reportGlDetail(): Promise<Table> {
  const lines = await prisma.journalLine.findMany({
    where: { journalEntry: { status: "POSTED" } },
    include: {
      account: { select: { code: true, name: true } },
      journalEntry: {
        select: {
          number: true,
          date: true,
          description: true,
          source: true,
          programId: true,
          workOrderId: true,
        },
      },
    },
    orderBy: [{ journalEntry: { date: "desc" } }],
    take: 1000,
  });
  return {
    title: "General ledger detail",
    columns: [
      "Date",
      "Journal",
      "Source",
      "Account",
      "Debit",
      "Credit",
      "Cost element",
      "Unallowable",
      "Description",
    ],
    rows: lines.map((l) => [
      l.journalEntry.date.toISOString().slice(0, 10),
      l.journalEntry.number,
      l.journalEntry.source || "",
      `${l.account.code} ${l.account.name}`,
      money(l.debit || 0),
      money(l.credit || 0),
      l.costElement || "",
      l.unallowable ? "Yes" : "",
      l.memo || l.journalEntry.description,
    ]),
  };
}
