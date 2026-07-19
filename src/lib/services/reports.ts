/**
 * Reports Center — one place to run and export the reports every
 * department asks for. Each report returns { columns, rows } so the
 * hub page and the CSV export route share one definition.
 */
import { prisma } from "@/lib/db";
import { getGaapReportPack } from "@/lib/services/gaap";

export type ReportTable = {
  title: string;
  columns: string[];
  rows: (string | number)[][];
};

const money = (n: number) => Math.round(n * 100) / 100;
const day = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : "";

export const REPORT_CATALOG: {
  key: string;
  title: string;
  group: "Financial" | "Operations" | "Quality" | "People";
  description: string;
}[] = [
  { key: "pl", title: "Income Statement", group: "Financial", description: "Revenue, COGS, expenses, net income by account" },
  { key: "bs", title: "Balance Sheet", group: "Financial", description: "Assets, liabilities, equity + current earnings" },
  { key: "ar-aging", title: "AR Aging", group: "Financial", description: "Open receivables bucketed by days outstanding" },
  { key: "ap-aging", title: "AP Aging", group: "Financial", description: "Open payables bucketed by days outstanding" },
  { key: "wip", title: "Open Work Orders / WIP", group: "Operations", description: "Active WOs with status, priority, and standard cost" },
  { key: "inventory", title: "Inventory Valuation", group: "Operations", description: "On-hand stock by part and location with extended value" },
  {
    key: "inventory-onhand-cost",
    title: "On-Hand Inventory Total Cost",
    group: "Operations",
    description:
      "Grand total and by-ownership cost of all on-hand inventory (qty × unit cost)",
  },
  {
    key: "gp-inventory-cost",
    title: "Government Property Inventory Cost",
    group: "Operations",
    description:
      "On-hand GOVERNMENT-owned stock cost — extended value with total",
  },
  {
    key: "bom-cost",
    title: "BOM Cost Rollup (w/ subassemblies)",
    group: "Operations",
    description:
      "Unit cost of each BOM including nested subassembly BOMs — summary + explosion",
  },
  { key: "open-pos", title: "Open Purchase Orders", group: "Operations", description: "Outstanding POs with open commitments" },
  { key: "otd", title: "Sales Order Status", group: "Operations", description: "Orders with dates, departments, and fulfillment state" },
  { key: "ncr", title: "NCR Log", group: "Quality", description: "Nonconformances with source, severity, and disposition state" },
  { key: "scorecards", title: "Supplier Scorecards", group: "Quality", description: "OTD, quality PPM, and overall grade per supplier" },
  { key: "timecards", title: "Timecard Summary", group: "People", description: "Hours by employee and status for recent periods" },
  { key: "pto", title: "PTO Ledger", group: "People", description: "Requests with dates, hours, and approval state" },
  { key: "training-compliance", title: "Training Compliance", group: "People", description: "Recurring training matrix — missing, overdue, due-soon by person" },
  { key: "req-coverage", title: "Requirements Coverage", group: "Quality", description: "Requirement status, verification method, and engineering trace count" },
  { key: "bank-recon", title: "Bank Reconciliation", group: "Financial", description: "Bank/CC transactions by status — what still needs categorizing" },
];

function ageBucket(days: number): string {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export async function runReport(key: string): Promise<ReportTable> {
  switch (key) {
    case "pl": {
      const { incomeStatement: pl } = await getGaapReportPack();
      const rows: (string | number)[][] = [
        ...pl.revenueAccounts.map((a) => ["Revenue", a.code, a.name, money(a.balance)]),
        ...pl.cogsAccounts.map((a) => ["COGS", a.code, a.name, money(a.balance)]),
        ...pl.expenseAccounts.map((a) => ["Expense", a.code, a.name, money(a.balance)]),
        ["", "", "Gross profit", money(pl.grossProfit)],
        ["", "", "Net income", money(pl.netIncome)],
      ];
      return { title: "Income Statement", columns: ["Section", "Account", "Name", "Amount"], rows };
    }
    case "bs": {
      const { balanceSheet: bs } = await getGaapReportPack();
      const rows: (string | number)[][] = [
        ...bs.assetAccounts.map((a) => ["Assets", a.code, a.name, money(a.balance)]),
        ...bs.liabilityAccounts.map((a) => ["Liabilities", a.code, a.name, money(a.balance)]),
        ...bs.equityAccounts.map((a) => ["Equity", a.code, a.name, money(a.balance)]),
        ["Equity", "", "Current period earnings", money(bs.currentEarnings)],
        ["", "", "Total assets", money(bs.assets)],
        ["", "", "Total liabilities + equity", money(bs.liabilitiesAndEquity)],
      ];
      return { title: "Balance Sheet", columns: ["Section", "Account", "Name", "Amount"], rows };
    }
    case "ar-aging": {
      const invoices = await prisma.arInvoice.findMany({
        where: { status: { in: ["OPEN", "PARTIAL"] } },
        include: { customer: true },
        orderBy: { dueDate: "asc" },
      });
      const now = Date.now();
      return {
        title: "AR Aging",
        columns: ["Invoice", "Customer", "Invoice date", "Due date", "Days past due", "Bucket", "Open amount"],
        rows: invoices.map((i) => {
          const due = i.dueDate ?? i.invoiceDate;
          const days = Math.max(0, Math.floor((now - due.getTime()) / 86_400_000));
          return [i.number, i.customer.name, day(i.invoiceDate), day(i.dueDate), days, ageBucket(days), money(i.total - i.amountPaid)];
        }),
      };
    }
    case "ap-aging": {
      const invoices = await prisma.apInvoice.findMany({
        where: { status: { in: ["OPEN", "PARTIAL"] } },
        include: { purchaseOrder: true },
        orderBy: { invoiceDate: "asc" },
      });
      const now = Date.now();
      return {
        title: "AP Aging",
        columns: ["Invoice", "PO", "Invoice date", "Days open", "Bucket", "Open amount"],
        rows: invoices.map((i) => {
          const days = Math.max(0, Math.floor((now - i.invoiceDate.getTime()) / 86_400_000));
          return [i.number, i.purchaseOrder?.number || "Manual", day(i.invoiceDate), days, ageBucket(days), money(i.total - i.amountPaid)];
        }),
      };
    }
    case "wip": {
      const wos = await prisma.workOrder.findMany({
        where: { status: { notIn: ["COMPLETE", "CLOSED", "CANCELLED"] } },
        include: { part: true, assignee: { select: { name: true } } },
        orderBy: { number: "asc" },
      });
      return {
        title: "Open Work Orders / WIP",
        columns: ["WO", "Type", "Part", "Qty", "Status", "Priority", "Dept", "Assignee", "Std cost"],
        rows: wos.map((w) => [
          w.number, w.type, w.part?.partNumber || "—", w.quantity, w.status,
          w.priority, w.department || "—", w.assignee?.name || "—", money(w.standardCost),
        ]),
      };
    }
    case "inventory": {
      const items = await prisma.inventoryItem.findMany({
        where: { quantityOnHand: { gt: 0 } },
        include: { part: true, location: true },
        orderBy: [{ part: { partNumber: "asc" } }],
      });
      const total = items.reduce(
        (s, i) => s + i.unitCost * i.quantityOnHand,
        0
      );
      return {
        title: "Inventory Valuation",
        columns: ["Part", "Description", "Location", "Lot/Serial", "On hand", "Available", "Unit cost", "Extended value", "Ownership"],
        rows: [
          ...items.map((i) => [
            i.part.partNumber, i.part.description, i.location.code,
            i.lotNumber || i.serialNumber || "—", i.quantityOnHand, i.quantityAvailable,
            money(i.unitCost), money(i.unitCost * i.quantityOnHand), i.ownership,
          ]),
          ["", "", "", "", "", "", "TOTAL", money(total), ""],
        ],
      };
    }
    case "inventory-onhand-cost": {
      return runOnHandInventoryCostReport();
    }
    case "gp-inventory-cost": {
      return runGpInventoryCostReport();
    }
    case "bom-cost": {
      return runBomCostRollupReport();
    }
    case "open-pos": {
      const pos = await prisma.purchaseOrder.findMany({
        where: { status: { in: ["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT"] } },
        include: { supplier: true, lines: true },
        orderBy: { number: "asc" },
      });
      return {
        title: "Open Purchase Orders",
        columns: ["PO", "Supplier", "Status", "PO date", "Promise date", "Open qty", "Open commitment"],
        rows: pos.map((p) => {
          const openQty = p.lines.reduce((s, l) => s + (l.quantity - l.quantityReceived), 0);
          const openVal = p.lines.reduce((s, l) => s + (l.quantity - l.quantityReceived) * l.unitCost, 0);
          return [p.number, p.supplier.name, p.status, day(p.orderDate), day(p.promisedDate), openQty, money(openVal)];
        }),
      };
    }
    case "otd": {
      const sos = await prisma.salesOrder.findMany({
        include: { customer: true, lines: true },
        orderBy: { number: "asc" },
      });
      return {
        title: "Sales Order Status",
        columns: ["SO", "Customer", "Dept", "Status", "Order date", "Required", "Lines", "Value"],
        rows: sos.map((s) => [
          s.number, s.customer.name, s.department, s.status, day(s.orderDate),
          day(s.requiredDate), s.lines.length,
          money(s.lines.reduce((t, l) => t + l.quantity * l.unitPrice, 0)),
        ]),
      };
    }
    case "ncr": {
      const ncrs = await prisma.nonConformance.findMany({
        include: { part: true, supplier: true },
        orderBy: { createdAt: "desc" },
      });
      return {
        title: "NCR Log",
        columns: ["NCR", "Part", "Qty", "Severity", "Source", "Supplier", "Status", "Opened"],
        rows: ncrs.map((n) => [
          n.number, n.part?.partNumber || "—", n.quantity, n.severity,
          n.source || "—", n.supplier?.name || "—", n.status, day(n.createdAt),
        ]),
      };
    }
    case "scorecards": {
      const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
      return {
        title: "Supplier Scorecards",
        columns: ["Supplier", "Code", "OTD %", "Quality PPM", "Rating", "ASL status"],
        rows: suppliers.map((s) => [
          s.name, s.code, money(s.onTimeDeliveryPct), Math.round(s.qualityPpm),
          s.rating || "—", s.status || "—",
        ]),
      };
    }
    case "timecards": {
      const sheets = await prisma.timesheet.findMany({
        include: { user: { select: { name: true, department: true } }, entries: true },
        orderBy: { periodStart: "desc" },
        take: 100,
      });
      return {
        title: "Timecard Summary",
        columns: ["Employee", "Dept", "Period start", "Period end", "Hours", "Status"],
        rows: sheets.map((t) => [
          t.user.name, t.user.department || "—", day(t.periodStart), day(t.periodEnd),
          money(t.entries.reduce((s, e) => s + e.hours, 0)), t.status,
        ]),
      };
    }
    case "pto": {
      const pto = await prisma.ptoRequest.findMany({
        include: { user: { select: { name: true } } },
        orderBy: { startDate: "desc" },
      });
      return {
        title: "PTO Ledger",
        columns: ["Employee", "Type", "Start", "End", "Hours", "Status", "Reason"],
        rows: pto.map((p) => [
          p.user.name, p.type, day(p.startDate), day(p.endDate), p.hours, p.status, p.reason || "",
        ]),
      };
    }
    case "training-compliance": {
      const { getTrainingMatrix } = await import("@/lib/services/hr");
      const gaps = await getTrainingMatrix();
      return {
        title: "Training Compliance",
        columns: ["Employee", "Department", "Training", "Cycle", "Status", "Due", "Days out"],
        rows: gaps.map((g) => [
          g.employeeName,
          g.department || "",
          g.requirementName,
          g.frequencyMonths > 0 ? `Every ${g.frequencyMonths} mo` : "One-time",
          g.status.replace(/_/g, " "),
          day(g.dueDate),
          g.daysOut ?? "",
        ]),
      };
    }
    case "req-coverage": {
      const reqs = await prisma.requirement.findMany({
        where: { status: { notIn: ["OBSOLETE"] } },
        include: {
          product: { select: { code: true } },
          _count: { select: { traces: true } },
        },
        orderBy: { number: "asc" },
      });
      return {
        title: "Requirements Coverage",
        columns: ["Number", "Title", "Category", "Status", "Verify by", "Traces", "Product"],
        rows: reqs.map((r) => [
          r.number,
          r.title,
          r.category,
          r.status.replace(/_/g, " "),
          r.verificationMethod || "",
          r._count.traces,
          r.product?.code || "",
        ]),
      };
    }
    case "bank-recon": {
      const txns = await prisma.bankTransaction.findMany({
        include: {
          bankAccount: { select: { name: true } },
          categoryAccount: { select: { code: true, name: true } },
        },
        orderBy: { date: "desc" },
        take: 500,
      });
      return {
        title: "Bank Reconciliation",
        columns: ["Account", "Date", "Description", "Amount", "Status", "Category"],
        rows: txns.map((t) => [
          t.bankAccount.name,
          day(t.date),
          t.description,
          money(t.amount),
          t.status,
          t.categoryAccount ? `${t.categoryAccount.code} ${t.categoryAccount.name}` : "",
        ]),
      };
    }
    default:
      throw new Error(`Unknown report: ${key}`);
  }
}

export function toCsv(table: ReportTable): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    table.columns.map(esc).join(","),
    ...table.rows.map((r) => r.map(esc).join(",")),
  ].join("\n");
}

// ── Cost reports ───────────────────────────────────────────────────────────

function invUnitCost(i: {
  unitCost: number;
  part: { standardCost: number; lastBuyCost: number; averageCost: number };
}): number {
  if (i.unitCost > 0) return i.unitCost;
  if (i.part.averageCost > 0) return i.part.averageCost;
  if (i.part.standardCost > 0) return i.part.standardCost;
  if (i.part.lastBuyCost > 0) return i.part.lastBuyCost;
  return 0;
}

async function runOnHandInventoryCostReport(): Promise<ReportTable> {
  const items = await prisma.inventoryItem.findMany({
    where: { quantityOnHand: { gt: 0 } },
    include: {
      part: {
        select: {
          partNumber: true,
          description: true,
          standardCost: true,
          lastBuyCost: true,
          averageCost: true,
        },
      },
      location: { select: { code: true, type: true } },
    },
    orderBy: [{ ownership: "asc" }, { part: { partNumber: "asc" } }],
  });

  type Agg = { qty: number; ext: number; lines: number };
  const byOwn = new Map<string, Agg>();
  let grandQty = 0;
  let grandExt = 0;

  const detail: (string | number)[][] = [];
  for (const i of items) {
    const unit = invUnitCost(i);
    const ext = unit * i.quantityOnHand;
    grandQty += i.quantityOnHand;
    grandExt += ext;
    const o = i.ownership || "COMPANY";
    const a = byOwn.get(o) || { qty: 0, ext: 0, lines: 0 };
    a.qty += i.quantityOnHand;
    a.ext += ext;
    a.lines += 1;
    byOwn.set(o, a);
    detail.push([
      "DETAIL",
      o,
      i.part.partNumber,
      i.part.description,
      i.location.code,
      i.location.type,
      i.lotNumber || i.serialNumber || "—",
      money(i.quantityOnHand),
      money(unit),
      money(ext),
    ]);
  }

  const summary: (string | number)[][] = [
    [
      "SUMMARY",
      "ALL",
      "",
      "Grand total on-hand inventory",
      "",
      "",
      "",
      money(grandQty),
      "",
      money(grandExt),
    ],
  ];
  for (const [own, a] of [...byOwn.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    summary.push([
      "SUMMARY",
      own,
      "",
      `${a.lines} stock line(s)`,
      "",
      "",
      "",
      money(a.qty),
      "",
      money(a.ext),
    ]);
  }

  return {
    title: "On-Hand Inventory Total Cost",
    columns: [
      "Section",
      "Ownership",
      "Part",
      "Description",
      "Location",
      "Loc type",
      "Lot/Serial",
      "On hand",
      "Unit cost",
      "Extended cost",
    ],
    rows: [...summary, ...detail],
  };
}

async function runGpInventoryCostReport(): Promise<ReportTable> {
  const items = await prisma.inventoryItem.findMany({
    where: {
      quantityOnHand: { gt: 0 },
      ownership: "GOVERNMENT",
    },
    include: {
      part: {
        select: {
          partNumber: true,
          description: true,
          standardCost: true,
          lastBuyCost: true,
          averageCost: true,
        },
      },
      location: { select: { code: true, type: true, name: true } },
      governmentProperty: {
        select: {
          assetTag: true,
          contractNumber: true,
          acquisitionCost: true,
          propertyType: true,
        },
      },
    },
    orderBy: [{ part: { partNumber: "asc" } }],
  });

  let grandQty = 0;
  let grandExt = 0;
  const rows: (string | number)[][] = [];

  for (const i of items) {
    // Prefer inventory unit cost; fall back to GFP acquisition cost if stock cost is 0
    let unit = invUnitCost(i);
    if (unit <= 0 && i.governmentProperty?.acquisitionCost) {
      unit = i.governmentProperty.acquisitionCost;
    }
    const ext = unit * i.quantityOnHand;
    grandQty += i.quantityOnHand;
    grandExt += ext;
    rows.push([
      i.part.partNumber,
      i.part.description,
      i.location.code,
      i.location.type,
      i.lotNumber || i.serialNumber || "—",
      i.governmentProperty?.assetTag || "—",
      i.governmentProperty?.contractNumber || "—",
      i.governmentProperty?.propertyType || "—",
      money(i.quantityOnHand),
      money(unit),
      money(ext),
    ]);
  }

  rows.push([
    "",
    "TOTAL GOVERNMENT PROPERTY",
    "",
    "",
    "",
    "",
    "",
    "",
    money(grandQty),
    "",
    money(grandExt),
  ]);

  return {
    title: "Government Property Inventory Cost",
    columns: [
      "Part",
      "Description",
      "Location",
      "Loc type",
      "Lot/Serial",
      "Asset tag",
      "Contract",
      "GP type",
      "On hand",
      "Unit cost",
      "Extended cost",
    ],
    rows,
  };
}

type BomLineNode = {
  componentPartId: string;
  quantity: number;
  scrapFactor: number;
  componentPart: {
    partNumber: string;
    description: string;
    standardCost: number;
    lastBuyCost: number;
    averageCost: number;
    sourcingMethod: string;
  };
};

type BomHeaderNode = {
  id: string;
  revision: string;
  status: string;
  partId: string;
  part: { partNumber: string; description: string };
  lines: BomLineNode[];
};

/**
 * Multi-level BOM unit cost: each component uses its certified/prototype BOM
 * rollup when present, else average → standard → last buy cost.
 */
async function runBomCostRollupReport(): Promise<ReportTable> {
  const headers = (await prisma.bomHeader.findMany({
    where: { status: { in: ["CERTIFIED", "PROTOTYPE", "IN_REVIEW"] } },
    include: {
      part: { select: { partNumber: true, description: true } },
      lines: {
        include: {
          componentPart: {
            select: {
              partNumber: true,
              description: true,
              standardCost: true,
              lastBuyCost: true,
              averageCost: true,
              sourcingMethod: true,
            },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ part: { partNumber: "asc" } }, { revision: "desc" }],
  })) as BomHeaderNode[];

  // Prefer latest CERTIFIED per part for subassembly lookup; fall back to PROTOTYPE
  const byPartId = new Map<string, BomHeaderNode>();
  for (const h of headers) {
    const existing = byPartId.get(h.partId);
    if (!existing) {
      byPartId.set(h.partId, h);
      continue;
    }
    const rank = (s: string) =>
      s === "CERTIFIED" ? 0 : s === "PROTOTYPE" ? 1 : 2;
    if (rank(h.status) < rank(existing.status)) {
      byPartId.set(h.partId, h);
    }
  }

  const memo = new Map<string, number>(); // partId → unit rollup

  function leafCost(p: BomLineNode["componentPart"]): number {
    if (p.averageCost > 0) return p.averageCost;
    if (p.standardCost > 0) return p.standardCost;
    if (p.lastBuyCost > 0) return p.lastBuyCost;
    return 0;
  }

  function rollupPart(partId: string, chain: Set<string>): number {
    if (memo.has(partId)) return memo.get(partId)!;
    if (chain.has(partId)) return 0; // cycle
    const bom = byPartId.get(partId);
    if (!bom || !bom.lines.length) {
      // No BOM — try part master from any line that referenced it
      return 0;
    }
    const next = new Set(chain);
    next.add(partId);
    let total = 0;
    for (const line of bom.lines) {
      const qty = line.quantity * (1 + (line.scrapFactor || 0));
      const subBom = byPartId.get(line.componentPartId);
      let unit: number;
      if (subBom && subBom.lines.length && !next.has(line.componentPartId)) {
        unit = rollupPart(line.componentPartId, next);
        if (unit <= 0) unit = leafCost(line.componentPart);
      } else {
        unit = leafCost(line.componentPart);
      }
      total += qty * unit;
    }
    memo.set(partId, total);
    return total;
  }

  // Seed leaf costs for parts without BOM via their own standard on header part?
  // Components only appear on lines — leafCost handles them.

  const summaryRows: (string | number)[][] = [];
  const detailRows: (string | number)[][] = [];

  const ordered = [...headers].sort((a, b) => {
    const c = a.part.partNumber.localeCompare(b.part.partNumber);
    if (c !== 0) return c;
    const rank = (s: string) =>
      s === "CERTIFIED" ? 0 : s === "PROTOTYPE" ? 1 : 2;
    return rank(a.status) - rank(b.status);
  });

  for (const h of ordered) {
    // Show all listed BOM revs, but rollup uses preferred subassembly BOMs
    const unit = rollupPart(h.partId, new Set());
    // Recompute this header's own lines (may differ if multiple revs)
    let headerUnit = 0;
    const explosion: {
      level: number;
      path: string;
      partNumber: string;
      description: string;
      qty: number;
      unit: number;
      extended: number;
      source: string;
    }[] = [];

    function explode(
      bom: BomHeaderNode,
      level: number,
      path: string,
      chain: Set<string>
    ) {
      if (chain.has(bom.partId)) return;
      const next = new Set(chain);
      next.add(bom.partId);
      for (const line of bom.lines) {
        const qty = line.quantity * (1 + (line.scrapFactor || 0));
        const sub = byPartId.get(line.componentPartId);
        let unitC: number;
        let source: string;
        if (sub && sub.lines.length && !next.has(line.componentPartId)) {
          unitC = rollupPart(line.componentPartId, next);
          source =
            unitC > 0
              ? `BOM ${sub.part.partNumber} rev ${sub.revision}`
              : "leaf cost";
          if (unitC <= 0) {
            unitC = leafCost(line.componentPart);
            source = costSourceLabel(line.componentPart);
          }
        } else {
          unitC = leafCost(line.componentPart);
          source = costSourceLabel(line.componentPart);
        }
        const ext = qty * unitC;
        if (level === 0) headerUnit += ext;
        explosion.push({
          level,
          path,
          partNumber: line.componentPart.partNumber,
          description: line.componentPart.description,
          qty,
          unit: unitC,
          extended: ext,
          source,
        });
        if (sub && sub.lines.length && !next.has(line.componentPartId)) {
          explode(
            sub,
            level + 1,
            `${path}/${line.componentPart.partNumber}`,
            next
          );
        }
      }
    }

    // For multi-rev of same part, rollup this specific header's lines
    explode(h, 0, h.part.partNumber, new Set([h.partId]));
    // Prefer line-sum for this revision
    const rollup = headerUnit > 0 ? headerUnit : unit;

    summaryRows.push([
      "SUMMARY",
      h.part.partNumber,
      h.revision,
      h.status,
      h.part.description,
      money(rollup),
      h.lines.length,
      explosion.filter((e) => e.level > 0).length
        ? "includes subassemblies"
        : "flat / purchased comps",
    ]);

    for (const e of explosion) {
      detailRows.push([
        "DETAIL",
        h.part.partNumber,
        h.revision,
        e.level,
        e.partNumber,
        e.description,
        money(e.qty),
        money(e.unit),
        money(e.extended),
        e.source,
      ]);
    }
  }

  return {
    title: "BOM Cost Rollup (w/ subassemblies)",
    columns: [
      "Section",
      "BOM part",
      "Rev",
      "Status",
      "Level",
      "Component",
      "Description",
      "Qty (w/ scrap)",
      "Unit cost",
      "Extended cost",
      "Cost source",
    ],
    rows: [
      // Summary: one row per BOM with total unit rollup in Extended
      ...summaryRows.map((r) => [
        "SUMMARY",
        r[1], // part
        r[2], // rev
        r[3], // status
        "",
        "",
        r[4], // description
        "",
        "",
        r[5], // unit rollup $
        String(r[7]),
      ]),
      ...detailRows.map((r) => [
        "DETAIL",
        r[1], // parent BOM part
        r[2], // rev
        "",
        r[3], // level
        r[4], // component PN
        r[5], // description
        r[6], // qty
        r[7], // unit
        r[8], // extended
        r[9], // source
      ]),
    ],
  };
}

function costSourceLabel(p: {
  averageCost: number;
  standardCost: number;
  lastBuyCost: number;
}): string {
  if (p.averageCost > 0) return "avg cost";
  if (p.standardCost > 0) return "std cost";
  if (p.lastBuyCost > 0) return "last buy";
  return "no cost";
}
