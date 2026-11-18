/**
 * Paste-from-Excel data import. Accepts CSV / TSV / semicolon text,
 * fuzzy-maps headers to fields, and upserts by natural key so the
 * import is safe to re-run. Every row reports back: created, updated,
 * or an error with the reason.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export type ImportEntity = "parts" | "customers" | "suppliers" | "people";

export type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
  total: number;
};

/** Parse delimited text: auto-detect tab / comma / semicolon, honor quotes. */
export function parseDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.includes("\t")
    ? "\t"
    : (firstLine.match(/;/g)?.length || 0) > (firstLine.match(/,/g)?.length || 0)
      ? ";"
      : ",";

  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** header aliases per entity, normalized */
const FIELD_ALIASES: Record<ImportEntity, Record<string, string[]>> = {
  parts: {
    partNumber: ["partnumber", "pn", "part", "itemnumber", "item", "sku"],
    description: ["description", "desc", "name", "itemdescription"],
    uom: ["uom", "unit", "unitofmeasure"],
    standardCost: ["standardcost", "cost", "stdcost", "unitcost", "price"],
    leadTimeDays: ["leadtimedays", "leadtime", "lt"],
    minStock: ["minstock", "min", "reordermin", "safetymin"],
    maxStock: ["maxstock", "max", "binmax"],
    partType: ["parttype", "type", "class"],
    sourcingMethod: ["sourcingmethod", "sourcing", "makebuy", "makeorbuy"],
  },
  customers: {
    name: ["name", "customer", "customername", "company"],
    code: ["code", "customercode", "id", "accountcode"],
    contactEmail: ["contactemail", "email", "contact"],
    paymentTerms: ["paymentterms", "terms"],
    creditLimit: ["creditlimit", "credit"],
  },
  suppliers: {
    name: ["name", "supplier", "suppliername", "vendor", "vendorname", "company"],
    code: ["code", "suppliercode", "vendorcode", "id"],
    contactName: ["contactname", "contact"],
    contactEmail: ["contactemail", "email"],
    paymentTerms: ["paymentterms", "terms"],
  },
  people: {
    name: ["name", "employeename", "fullname", "employee"],
    email: ["email", "workemail", "emailaddress"],
    title: ["title", "jobtitle", "position"],
    department: ["department", "dept"],
    role: ["role", "systemrole", "accessrole"],
    managerEmail: ["manageremail", "manager", "supervisoremail", "reportsto"],
  },
};

export const IMPORT_TEMPLATES: Record<
  ImportEntity,
  { headers: string; example: string; keyLabel: string }
> = {
  parts: {
    headers: "partNumber,description,uom,standardCost,leadTimeDays,minStock,maxStock,partType,sourcingMethod",
    example: "BRK-1001,Steel mounting bracket,EA,12.50,14,10,50,BUY,PURCHASE",
    keyLabel: "part number",
  },
  customers: {
    headers: "name,code,contactEmail,paymentTerms,creditLimit",
    example: "Acme Aerospace,ACME,po@acme.example,NET30,250000",
    keyLabel: "customer name",
  },
  suppliers: {
    headers: "name,code,contactName,contactEmail,paymentTerms",
    example: "Precision Metals Inc,PMI,Sam Lee,sales@pmi.example,NET30",
    keyLabel: "supplier name",
  },
  people: {
    headers: "name,email,title,department,role,managerEmail",
    example: "Jordan Smith,jordan@yourco.com,Machinist,Production,OPERATOR,taylor@yourco.com",
    keyLabel: "email",
  },
};

function mapHeaders(entity: ImportEntity, headerRow: string[]) {
  const aliases = FIELD_ALIASES[entity];
  const mapping: Record<number, string> = {};
  headerRow.forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    for (const [field, alts] of Object.entries(aliases)) {
      if (alts.includes(n)) {
        mapping[i] = field;
        break;
      }
    }
  });
  return mapping;
}

function rowToObject(row: string[], mapping: Record<number, string>) {
  const obj: Record<string, string> = {};
  for (const [idxStr, field] of Object.entries(mapping)) {
    const v = (row[Number(idxStr)] || "").trim();
    if (v) obj[field] = v;
  }
  return obj;
}

function parseNumber(
  label: string,
  v: string | undefined,
  opts: { min?: number; integer?: boolean } = {},
) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
  if (opts.integer && !Number.isInteger(n)) throw new Error(`${label} must be a whole number`);
  if (opts.min != null && n < opts.min) throw new Error(`${label} cannot be negative`);
  return n;
}

const VALID_ROLES = [
  "ADMIN", "ENGINEERING", "CM", "QUALITY", "PURCHASING",
  "PRODUCTION", "ACCOUNTING", "HR", "VIEWER", "OPERATOR",
];

/**
 * Fields that must be present in every data row (all template columns except
 * genuinely optional ones like an org-root's manager and any photo columns).
 */
const REQUIRED_ROW_FIELDS: Record<ImportEntity, string[]> = {
  parts: [
    "partNumber",
    "description",
    "uom",
    "standardCost",
    "leadTimeDays",
    "minStock",
    "maxStock",
    "partType",
    "sourcingMethod",
  ],
  customers: ["name", "code", "contactEmail", "paymentTerms", "creditLimit"],
  suppliers: ["name", "code", "contactName", "contactEmail", "paymentTerms"],
  // managerEmail is optional — the top of the org chart has no manager.
  people: ["name", "email", "title", "department", "role"],
};

export async function runImport(params: {
  entity: ImportEntity;
  text: string;
  userId?: string | null;
  /** "skip" (default) leaves existing rows untouched; "update" overwrites. */
  mode?: "skip" | "update";
}): Promise<ImportResult> {
  const mode = params.mode || "skip";
  const rows = parseDelimited(params.text);
  const result: ImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    total: Math.max(0, rows.length - 1),
  };
  if (rows.length < 2) {
    result.errors.push({
      row: 0,
      message: "Need a header row plus at least one data row.",
    });
    return result;
  }

  const mapping = mapHeaders(params.entity, rows[0]);
  const mappedFields = new Set(Object.values(mapping));
  const required: Record<ImportEntity, string[]> = {
    parts: ["partNumber"],
    customers: ["name"],
    suppliers: ["name"],
    people: ["name", "email"],
  };
  for (const req of required[params.entity]) {
    if (!mappedFields.has(req)) {
      result.errors.push({
        row: 1,
        message: `Could not find a "${req}" column in the header row. Recognized columns: ${Object.keys(FIELD_ALIASES[params.entity]).join(", ")}.`,
      });
      return result;
    }
  }

  // Deferred manager links for people (managers may appear later in file)
  const managerLinks: { row: number; email: string; managerEmail: string }[] = [];

  for (let r = 1; r < rows.length; r++) {
    const obj = rowToObject(rows[r], mapping);
    // Every field is required (photos excepted) — flag incomplete rows.
    const missing = REQUIRED_ROW_FIELDS[params.entity].filter(
      (f) => !obj[f] || obj[f].trim() === ""
    );
    if (missing.length > 0) {
      result.errors.push({
        row: r + 1,
        message: `Missing required field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. All columns are required (photos excepted).`,
      });
      continue;
    }
    try {
      if (params.entity === "parts") {
        if (!obj.partNumber) throw new Error("Missing part number");
        const standardCost = parseNumber("standardCost", obj.standardCost, { min: 0 });
        const leadTimeDays = parseNumber("leadTimeDays", obj.leadTimeDays, { min: 0, integer: true });
        const minStock = parseNumber("minStock", obj.minStock, { min: 0 });
        const maxStock = parseNumber("maxStock", obj.maxStock, { min: 0 });
        if (minStock > maxStock) throw new Error("minStock cannot be greater than maxStock");
        const data = {
          description: obj.description || obj.partNumber,
          uom: obj.uom?.toUpperCase() || "EA",
          standardCost,
          leadTimeDays,
          minStock,
          maxStock,
          partType: ["MAKE", "BUY", "PHANTOM", "ASSEMBLY"].includes(
            obj.partType?.toUpperCase() || ""
          )
            ? obj.partType!.toUpperCase()
            : "BUY",
          sourcingMethod:
            obj.sourcingMethod?.toUpperCase() === "PURCHASE" ||
            obj.sourcingMethod?.toUpperCase() === "BUY"
              ? "PURCHASE"
              : obj.sourcingMethod
                ? "BUILD"
                : "PURCHASE",
        };
        const existing = await prisma.part.findUnique({
          where: { partNumber: obj.partNumber },
        });
        if (existing) {
          if (mode === "skip") {
            result.skipped++;
          } else {
            await prisma.part.update({ where: { id: existing.id }, data });
            result.updated++;
          }
        } else {
          await prisma.part.create({
            data: { partNumber: obj.partNumber, ...data },
          });
          result.created++;
        }
      } else if (params.entity === "customers") {
        if (!obj.name) throw new Error("Missing customer name");
        const data = {
          contactEmail: obj.contactEmail || null,
          paymentTerms: obj.paymentTerms?.toUpperCase().replace(/\s+/g, "") || "NET30",
          creditLimit: parseNumber("creditLimit", obj.creditLimit, { min: 0 }),
        };
        const existing = await prisma.customer.findFirst({
          where: { name: obj.name },
        });
        if (existing) {
          if (mode === "skip") {
            result.skipped++;
          } else {
            // Never touch the code on update — it's the key others reference
            await prisma.customer.update({ where: { id: existing.id }, data });
            result.updated++;
          }
        } else {
          await prisma.customer.create({
            data: {
              name: obj.name,
              code:
                obj.code ||
                obj.name.slice(0, 12).toUpperCase().replace(/\s+/g, "-"),
              ...data,
            },
          });
          result.created++;
        }
      } else if (params.entity === "suppliers") {
        if (!obj.name) throw new Error("Missing supplier name");
        const data = {
          contactName: obj.contactName || null,
          contactEmail: obj.contactEmail || null,
          paymentTerms: obj.paymentTerms?.toUpperCase().replace(/\s+/g, "") || "NET30",
        };
        const existing = await prisma.supplier.findFirst({
          where: { name: obj.name },
        });
        if (existing) {
          if (mode === "skip") {
            result.skipped++;
          } else {
            await prisma.supplier.update({ where: { id: existing.id }, data });
            result.updated++;
          }
        } else {
          await prisma.supplier.create({
            data: {
              name: obj.name,
              code:
                obj.code ||
                `SUP-${obj.name.slice(0, 8).toUpperCase().replace(/\s+/g, "")}`,
              // Imported from the company's own vendor list — treat as approved
              isApprovedVendor: true,
              ...data,
            },
          });
          result.created++;
        }
      } else {
        // people
        if (!obj.email) throw new Error("Missing email");
        if (!obj.name) throw new Error("Missing name");
        const email = obj.email.toLowerCase();
        const role = VALID_ROLES.includes(obj.role?.toUpperCase() || "")
          ? obj.role!.toUpperCase()
          : "OPERATOR";
        const data = {
          name: obj.name,
          title: obj.title || null,
          department: obj.department || null,
          role,
        };
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          if (mode === "skip") {
            result.skipped++;
          } else {
            await prisma.user.update({ where: { id: existing.id }, data });
            result.updated++;
          }
        } else {
          await prisma.user.create({ data: { email, ...data } });
          result.created++;
        }
        // Wire the org chart for newly-created people (and everyone in update
        // mode); don't re-touch existing people that were skipped.
        if (obj.managerEmail && (!existing || mode === "update")) {
          managerLinks.push({ row: r + 1, email, managerEmail: obj.managerEmail.toLowerCase() });
        }
      }
    } catch (e) {
      result.errors.push({
        row: r + 1,
        message: e instanceof Error ? e.message : "Import failed",
      });
    }
  }

  // Second pass: wire the org chart once everyone exists, rejecting cycles.
  if (managerLinks.length > 0) {
    const users = await prisma.user.findMany({ select: { id: true, email: true, managerId: true } });
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
    const proposed = new Map(users.map((u) => [u.id, u.managerId as string | null]));
    const candidates: { row: number; email: string; empId: string; managerId: string }[] = [];
    for (const link of managerLinks) {
      const emp = byEmail.get(link.email);
      const mgr = byEmail.get(link.managerEmail);
      if (!emp) continue;
      if (!mgr) {
        result.errors.push({ row: link.row, message: `Manager ${link.managerEmail} was not found.` });
        continue;
      }
      if (emp.id === mgr.id) {
        result.errors.push({ row: link.row, message: `${link.email} cannot report to themselves.` });
        continue;
      }
      proposed.set(emp.id, mgr.id);
      candidates.push({ row: link.row, email: link.email, empId: emp.id, managerId: mgr.id });
    }
    const inCycle = new Set<string>();
    for (const start of proposed.keys()) {
      const seen: string[] = [];
      const index = new Map<string, number>();
      let current: string | null | undefined = start;
      while (current) {
        const prior = index.get(current);
        if (prior != null) {
          for (const id of seen.slice(prior)) inCycle.add(id);
          break;
        }
        index.set(current, seen.length);
        seen.push(current);
        current = proposed.get(current) ?? null;
      }
    }
    for (const link of candidates) {
      if (inCycle.has(link.empId)) {
        result.errors.push({
          row: link.row,
          message: `Reporting cycle rejected for ${link.email}.`,
        });
        continue;
      }
      await prisma.user.update({
        where: { id: link.empId },
        data: { managerId: link.managerId },
      });
    }
  }

  await logAudit({
    entityType: "DataImport",
    entityId: params.entity,
    action: "IMPORT_RUN",
    userId: params.userId,
    metadata: {
      entity: params.entity,
      mode,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
    },
  });

  return result;
}
