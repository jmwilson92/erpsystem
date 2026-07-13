/**
 * Custom report builder — whitelisted entities and columns so users can
 * compose their own tabular reports (pick columns, filter, sort) without
 * touching the database directly. Shared by the builder page, CSV export,
 * and the print view.
 */
import { prisma } from "@/lib/db";

type Row = Record<string, string | number>;

const day = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : "";
const money = (n: number) => Math.round(n * 100) / 100;

export type BuilderEntity = {
  key: string;
  title: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  /** Values offered in the status filter dropdown (empty = free text) */
  statuses?: string[];
  /** Label of the date the from/to range filters on */
  dateLabel: string;
  run: (opts: {
    status?: string;
    from?: Date;
    to?: Date;
  }) => Promise<Row[]>;
};

function range(from?: Date, to?: Date) {
  return from || to
    ? { gte: from || undefined, lte: to || undefined }
    : undefined;
}

export const BUILDER_ENTITIES: BuilderEntity[] = [
  {
    key: "work-orders",
    title: "Work orders",
    dateLabel: "Created",
    statuses: ["PLANNED", "RELEASED", "IN_PROGRESS", "ON_HOLD", "COMPLETE", "CLOSED", "CANCELLED"],
    columns: [
      { key: "number", label: "Number" },
      { key: "type", label: "Type" },
      { key: "status", label: "Status" },
      { key: "priority", label: "Priority" },
      { key: "part", label: "Part" },
      { key: "quantity", label: "Qty", numeric: true },
      { key: "workCenter", label: "Workcenter" },
      { key: "assignee", label: "Assignee" },
      { key: "department", label: "Department" },
      { key: "dueDate", label: "Due" },
      { key: "createdAt", label: "Created" },
    ],
    run: async ({ status, from, to }) => {
      const rows = await prisma.workOrder.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(range(from, to) ? { createdAt: range(from, to) } : {}),
        },
        include: {
          part: { select: { partNumber: true } },
          assignee: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 1000,
      });
      return rows.map((w) => ({
        number: w.number,
        type: w.type,
        status: w.status,
        priority: w.priority,
        part: w.part?.partNumber || "",
        quantity: w.quantity,
        workCenter: w.workCenter || "",
        assignee: w.assignee?.name || "",
        department: w.department || "",
        dueDate: day(w.dueDate),
        createdAt: day(w.createdAt),
      }));
    },
  },
  {
    key: "items",
    title: "Items / parts",
    dateLabel: "Created",
    columns: [
      { key: "partNumber", label: "Part number" },
      { key: "description", label: "Description" },
      { key: "revision", label: "Rev" },
      { key: "sourcingMethod", label: "Sourcing" },
      { key: "uom", label: "UOM" },
      { key: "standardCost", label: "Std cost", numeric: true },
      { key: "leadTimeDays", label: "Lead (d)", numeric: true },
      { key: "minStock", label: "Min", numeric: true },
      { key: "maxStock", label: "Max", numeric: true },
      { key: "isActive", label: "Active" },
    ],
    run: async ({ from, to }) => {
      const rows = await prisma.part.findMany({
        where: range(from, to) ? { createdAt: range(from, to) } : {},
        orderBy: { partNumber: "asc" },
        take: 2000,
      });
      return rows.map((p) => ({
        partNumber: p.partNumber,
        description: p.description,
        revision: p.revision,
        sourcingMethod: p.sourcingMethod,
        uom: p.uom,
        standardCost: money(p.standardCost),
        leadTimeDays: p.leadTimeDays,
        minStock: p.minStock,
        maxStock: p.maxStock,
        isActive: p.isActive ? "Yes" : "No",
      }));
    },
  },
  {
    key: "inventory",
    title: "Inventory on hand",
    dateLabel: "Received",
    columns: [
      { key: "partNumber", label: "Part number" },
      { key: "description", label: "Description" },
      { key: "location", label: "Location" },
      { key: "quantity", label: "Qty", numeric: true },
      { key: "unitCost", label: "Unit cost", numeric: true },
      { key: "extValue", label: "Ext value", numeric: true },
      { key: "lot", label: "Lot" },
    ],
    run: async ({ from, to }) => {
      const rows = await prisma.inventoryItem.findMany({
        where: range(from, to) ? { updatedAt: range(from, to) } : {},
        include: {
          part: {
            select: { partNumber: true, description: true, standardCost: true },
          },
          location: { select: { code: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 2000,
      });
      return rows.map((i) => ({
        partNumber: i.part.partNumber,
        description: i.part.description,
        location: i.location?.code || "",
        quantity: i.quantityOnHand,
        unitCost: money(i.unitCost || i.part.standardCost),
        extValue: money(
          i.quantityOnHand * (i.unitCost || i.part.standardCost)
        ),
        lot: i.lotNumber || "",
      }));
    },
  },
  {
    key: "sales-orders",
    title: "Sales orders",
    dateLabel: "Ordered",
    statuses: ["DRAFT", "CONFIRMED", "IN_FULFILLMENT", "SHIPPED", "INVOICED", "CLOSED", "CANCELLED"],
    columns: [
      { key: "number", label: "Number" },
      { key: "customer", label: "Customer" },
      { key: "status", label: "Status" },
      { key: "orderDate", label: "Ordered" },
      { key: "dueDate", label: "Due" },
      { key: "totalAmount", label: "Total", numeric: true },
      { key: "department", label: "Department" },
    ],
    run: async ({ status, from, to }) => {
      const rows = await prisma.salesOrder.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(range(from, to) ? { orderDate: range(from, to) } : {}),
        },
        include: { customer: { select: { name: true } } },
        orderBy: { orderDate: "desc" },
        take: 1000,
      });
      return rows.map((s) => ({
        number: s.number,
        customer: s.customer?.name || "",
        status: s.status,
        orderDate: day(s.orderDate),
        dueDate: day(s.requiredDate),
        totalAmount: money(s.totalAmount),
        department: s.department || "",
      }));
    },
  },
  {
    key: "purchase-orders",
    title: "Purchase orders",
    dateLabel: "Ordered",
    statuses: ["DRAFT", "APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT", "RECEIVED", "INVOICED", "CLOSED", "CANCELLED"],
    columns: [
      { key: "number", label: "Number" },
      { key: "supplier", label: "Supplier" },
      { key: "status", label: "Status" },
      { key: "orderDate", label: "Ordered" },
      { key: "promisedDate", label: "Promised" },
      { key: "totalAmount", label: "Total", numeric: true },
      { key: "paymentTerms", label: "Terms" },
    ],
    run: async ({ status, from, to }) => {
      const rows = await prisma.purchaseOrder.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(range(from, to) ? { orderDate: range(from, to) } : {}),
        },
        include: { supplier: { select: { name: true } } },
        orderBy: { orderDate: "desc" },
        take: 1000,
      });
      return rows.map((p) => ({
        number: p.number,
        supplier: p.supplier.name,
        status: p.status,
        orderDate: day(p.orderDate),
        promisedDate: day(p.promisedDate),
        totalAmount: money(p.totalAmount),
        paymentTerms: p.paymentTerms,
      }));
    },
  },
  {
    key: "ncrs",
    title: "Nonconformances",
    dateLabel: "Opened",
    statuses: ["OPEN", "IN_REVIEW", "DISPOSITIONED", "CLOSED"],
    columns: [
      { key: "number", label: "Number" },
      { key: "title", label: "Title" },
      { key: "status", label: "Status" },
      { key: "severity", label: "Severity" },
      { key: "source", label: "Source" },
      { key: "part", label: "Part" },
      { key: "createdAt", label: "Opened" },
    ],
    run: async ({ status, from, to }) => {
      const rows = await prisma.nonConformance.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(range(from, to) ? { createdAt: range(from, to) } : {}),
        },
        include: { part: { select: { partNumber: true } } },
        orderBy: { createdAt: "desc" },
        take: 1000,
      });
      return rows.map((n) => ({
        number: n.number,
        title: n.title,
        status: n.status,
        severity: n.severity,
        source: n.source || "",
        part: n.part?.partNumber || "",
        createdAt: day(n.createdAt),
      }));
    },
  },
  {
    key: "timesheets",
    title: "Timesheets",
    dateLabel: "Period start",
    statuses: ["OPEN", "SUBMITTED", "APPROVED", "REJECTED", "PROCESSED"],
    columns: [
      { key: "employee", label: "Employee" },
      { key: "periodStart", label: "Period start" },
      { key: "periodEnd", label: "Period end" },
      { key: "status", label: "Status" },
      { key: "totalHours", label: "Hours", numeric: true },
    ],
    run: async ({ status, from, to }) => {
      const rows = await prisma.timesheet.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(range(from, to) ? { periodStart: range(from, to) } : {}),
        },
        include: {
          user: { select: { name: true } },
          entries: { select: { hours: true } },
        },
        orderBy: { periodStart: "desc" },
        take: 1000,
      });
      return rows.map((t) => ({
        employee: t.user.name,
        periodStart: day(t.periodStart),
        periodEnd: day(t.periodEnd),
        status: t.status,
        totalHours: money(t.entries.reduce((s, e) => s + e.hours, 0)),
      }));
    },
  },
  {
    key: "requirements",
    title: "Requirements",
    dateLabel: "Created",
    statuses: ["DRAFT", "IN_REVIEW", "APPROVED", "VERIFIED", "WAIVED", "OBSOLETE"],
    columns: [
      { key: "number", label: "Number" },
      { key: "title", label: "Title" },
      { key: "category", label: "Category" },
      { key: "status", label: "Status" },
      { key: "verificationMethod", label: "Verify by" },
      { key: "traces", label: "Traces", numeric: true },
      { key: "product", label: "Product" },
    ],
    run: async ({ status, from, to }) => {
      const rows = await prisma.requirement.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(range(from, to) ? { createdAt: range(from, to) } : {}),
        },
        include: {
          product: { select: { code: true } },
          _count: { select: { traces: true } },
        },
        orderBy: { number: "asc" },
        take: 1000,
      });
      return rows.map((r) => ({
        number: r.number,
        title: r.title,
        category: r.category,
        status: r.status,
        verificationMethod: r.verificationMethod || "",
        traces: r._count.traces,
        product: r.product?.code || "",
      }));
    },
  },
];

export type CustomReportParams = {
  entity: string;
  cols: string[];
  status?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: "asc" | "desc";
};

export async function runCustomReport(params: CustomReportParams): Promise<{
  title: string;
  columns: string[];
  rows: (string | number)[][];
  colDefs: { key: string; label: string; numeric?: boolean }[];
}> {
  const entity = BUILDER_ENTITIES.find((e) => e.key === params.entity);
  if (!entity) throw new Error("Unknown entity");

  const validCols = entity.columns.filter((c) => params.cols.includes(c.key));
  const cols = validCols.length > 0 ? validCols : entity.columns;

  const from = params.from ? new Date(params.from) : undefined;
  const to = params.to ? new Date(`${params.to}T23:59:59`) : undefined;

  let data = await entity.run({
    status: params.status || undefined,
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    to: to && !Number.isNaN(to.getTime()) ? to : undefined,
  });

  if (params.sort && cols.some((c) => c.key === params.sort)) {
    const dir = params.dir === "desc" ? -1 : 1;
    const k = params.sort;
    data = [...data].sort((a, b) => {
      const av = a[k];
      const bv = b[k];
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  return {
    title: `Custom — ${entity.title}`,
    columns: cols.map((c) => c.label),
    rows: data.map((row) => cols.map((c) => row[c.key] ?? "")),
    colDefs: cols,
  };
}
