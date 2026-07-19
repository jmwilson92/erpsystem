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
  { key: "open-pos", title: "Open Purchase Orders", group: "Operations", description: "Outstanding POs with open commitments" },
  { key: "otd", title: "Sales Order Status", group: "Operations", description: "Orders with dates, departments, and fulfillment state" },
  { key: "ncr", title: "NCR Log", group: "Quality", description: "Nonconformances with source, severity, and disposition state" },
  { key: "serial-genealogy", title: "Serial Genealogy", group: "Quality", description: "Per-unit as-built: every serialized unit with its component serials and lots" },
  { key: "rma-log", title: "RMA Log", group: "Quality", description: "Customer returns with status, disposition, and linked serials" },
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
      return {
        title: "Inventory Valuation",
        columns: ["Part", "Description", "Location", "Lot/Serial", "On hand", "Available", "Unit cost", "Extended value", "Ownership"],
        rows: items.map((i) => [
          i.part.partNumber, i.part.description, i.location.code,
          i.lotNumber || i.serialNumber || "—", i.quantityOnHand, i.quantityAvailable,
          money(i.unitCost), money(i.unitCost * i.quantityOnHand), i.ownership,
        ]),
      };
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
    case "serial-genealogy": {
      const components = await prisma.serialComponent.findMany({
        include: {
          parent: {
            include: { part: { select: { partNumber: true } } },
          },
          componentPart: { select: { partNumber: true, isSerialized: true } },
          componentSerial: { select: { serial: true, status: true } },
        },
        orderBy: [{ parentId: "asc" }, { createdAt: "asc" }],
        take: 5000,
      });
      const woIds = [
        ...new Set(
          components.map((c) => c.workOrderId).filter((x): x is string => !!x)
        ),
      ];
      const wos = woIds.length
        ? await prisma.workOrder.findMany({
            where: { id: { in: woIds } },
            select: { id: true, number: true },
          })
        : [];
      const woById = Object.fromEntries(wos.map((w) => [w.id, w.number]));
      return {
        title: "Serial Genealogy",
        columns: [
          "Unit serial",
          "Unit part",
          "Unit status",
          "Component part",
          "Serialized",
          "Component serial",
          "Component status",
          "Lot",
          "Qty",
          "Work order",
        ],
        rows: components.map((c) => [
          c.parent.serial,
          c.parent.part.partNumber,
          c.parent.status,
          c.componentPart.partNumber,
          c.componentPart.isSerialized ? "YES" : "no",
          c.componentSerial?.serial || "",
          c.componentSerial?.status || "",
          c.lotNumber || "",
          c.quantity,
          (c.workOrderId && woById[c.workOrderId]) || "",
        ]),
      };
    }
    case "rma-log": {
      const rmas = await prisma.rma.findMany({
        include: {
          customer: { select: { name: true } },
          part: { select: { partNumber: true } },
          serialNumber: { select: { serial: true } },
          salesOrder: { select: { number: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 2000,
      });
      return {
        title: "RMA Log",
        columns: [
          "RMA",
          "Status",
          "Customer",
          "Part",
          "Serial",
          "Sales order",
          "Qty",
          "Reason",
          "Disposition",
          "Received",
          "Closed",
        ],
        rows: rmas.map((r) => [
          r.number,
          r.status,
          r.customer.name,
          r.part?.partNumber || "",
          r.serialNumber?.serial || "",
          r.salesOrder?.number || "",
          r.quantity,
          r.reason,
          r.disposition || "",
          r.receivedAt ? day(r.receivedAt) : "",
          r.closedAt ? day(r.closedAt) : "",
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
