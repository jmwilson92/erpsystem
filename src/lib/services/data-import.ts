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

const num = (v: string | undefined) => {
  if (!v) return undefined;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

const VALID_ROLES = [
  "ADMIN", "ENGINEERING", "CM", "QUALITY", "PURCHASING",
  "PRODUCTION", "ACCOUNTING", "HR", "VIEWER", "OPERATOR",
];

export async function runImport(params: {
  entity: ImportEntity;
  text: string;
  userId?: string | null;
}): Promise<ImportResult> {
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
  const managerLinks: { email: string; managerEmail: string }[] = [];

  for (let r = 1; r < rows.length; r++) {
    const obj = rowToObject(rows[r], mapping);
    try {
      if (params.entity === "parts") {
        if (!obj.partNumber) throw new Error("Missing part number");
        const data = {
          description: obj.description || obj.partNumber,
          uom: obj.uom?.toUpperCase() || "EA",
          standardCost: num(obj.standardCost) ?? 0,
          leadTimeDays: Math.round(num(obj.leadTimeDays) ?? 0),
          minStock: num(obj.minStock) ?? 0,
          maxStock: num(obj.maxStock) ?? 0,
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
          await prisma.part.update({ where: { id: existing.id }, data });
          result.updated++;
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
          creditLimit: num(obj.creditLimit) ?? 0,
        };
        const existing = await prisma.customer.findFirst({
          where: { name: obj.name },
        });
        if (existing) {
          // Never touch the code on update — it's the unique key others reference
          await prisma.customer.update({ where: { id: existing.id }, data });
          result.updated++;
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
          await prisma.supplier.update({ where: { id: existing.id }, data });
          result.updated++;
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
          await prisma.user.update({ where: { id: existing.id }, data });
          result.updated++;
        } else {
          await prisma.user.create({ data: { email, ...data } });
          result.created++;
        }
        if (obj.managerEmail) {
          managerLinks.push({ email, managerEmail: obj.managerEmail.toLowerCase() });
        }
      }
    } catch (e) {
      result.errors.push({
        row: r + 1,
        message: e instanceof Error ? e.message : "Import failed",
      });
    }
  }

  // Second pass: wire the org chart once everyone exists
  for (const link of managerLinks) {
    const [emp, mgr] = await Promise.all([
      prisma.user.findUnique({ where: { email: link.email } }),
      prisma.user.findUnique({ where: { email: link.managerEmail } }),
    ]);
    if (emp && mgr && emp.id !== mgr.id) {
      await prisma.user.update({
        where: { id: emp.id },
        data: { managerId: mgr.id },
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
      created: result.created,
      updated: result.updated,
      errors: result.errors.length,
    },
  });

  return result;
}
