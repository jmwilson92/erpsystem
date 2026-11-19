/**
 * Tenant-scoped, permission-checked, read-only record lookup for Carina.
 * Never writes, never crosses tenants, never returns payroll/HR/money fields.
 */
import { getCurrentUser, userCanView } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  LOOKUP_ENTITIES,
  LOOKUP_PERMISSIONS,
  LOOKUP_SEARCH_LIMIT,
  type LookupEntityId,
  type LookupHit,
  type LookupResult,
  isExcludedLookupQuery,
  isLookupEntity,
  LOOKUP_EXCLUDED_MESSAGE,
  notFoundResult,
  permissionDeniedResult,
  stripSensitiveFields,
} from "./lookup-policy";

export type LookupStore = {
  search(entity: LookupEntityId, query: string, take: number): Promise<LookupHit[]>;
  get(entity: LookupEntityId, idOrNumber: string): Promise<LookupHit | null>;
};

export type LookupCanView = (userId: string, module: string) => Promise<boolean>;

const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

function hit(
  entity: LookupEntityId,
  rec: {
    id: string;
    number: string;
    title: string;
    status?: string | null;
    href: string;
    summary: string;
    fields?: Record<string, string | number | boolean | null>;
  }
): LookupHit {
  const clean = stripSensitiveFields({
    entity,
    id: rec.id,
    number: rec.number,
    title: rec.title,
    status: rec.status || undefined,
    href: rec.href,
    summary: rec.summary,
    fields: rec.fields || {},
  });
  return clean;
}

function like(q: string) {
  return q.trim().slice(0, 80);
}

export function createPrismaLookupStore(db: typeof prisma = prisma): LookupStore {
  return {
    async search(entity, query, take) {
      const q = like(query);
      if (q.length < 2) return [];
      const limit = Math.max(1, Math.min(LOOKUP_SEARCH_LIMIT, take));
      switch (entity) {
        case "part": {
          const rows = await db.part.findMany({
            where: {
              OR: [
                { partNumber: contains(q) },
                { description: contains(q) },
                { drawingNumber: contains(q) },
              ],
            },
            select: {
              id: true,
              partNumber: true,
              description: true,
              revision: true,
              isActive: true,
              isSerialized: true,
              isLotControlled: true,
              drawingNumber: true,
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("part", {
              id: r.id,
              number: r.partNumber,
              title: `Part ${r.partNumber}`,
              status: r.isActive ? "ACTIVE" : "INACTIVE",
              href: `/parts/${r.id}`,
              summary: [r.description, r.revision && `rev ${r.revision}`, r.drawingNumber && `drawing ${r.drawingNumber}`]
                .filter(Boolean)
                .join(" · "),
              fields: {
                partNumber: r.partNumber,
                description: r.description,
                revision: r.revision,
                drawingNumber: r.drawingNumber,
                isSerialized: r.isSerialized,
                isLotControlled: r.isLotControlled,
              },
            })
          );
        }
        case "inventory": {
          const rows = await db.inventoryItem.findMany({
            where: {
              OR: [
                { lotNumber: contains(q) },
                { serialNumber: contains(q) },
                { part: { partNumber: contains(q) } },
                { location: { code: contains(q) } },
              ],
            },
            select: {
              id: true,
              quantityOnHand: true,
              quantityAvailable: true,
              lotNumber: true,
              serialNumber: true,
              part: { select: { id: true, partNumber: true, description: true } },
              location: { select: { code: true, name: true } },
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("inventory", {
              id: r.id,
              number: r.part?.partNumber || r.id,
              title: `Bin ${r.location?.code || "—"} · ${r.part?.partNumber || "part"}`,
              href: r.part?.id ? `/inventory/committed/${r.part.id}` : "/inventory",
              summary: `${r.quantityAvailable ?? 0} available, ${r.quantityOnHand ?? 0} on hand${r.lotNumber ? `, lot ${r.lotNumber}` : ""}`,
              fields: {
                partNumber: r.part?.partNumber ?? null,
                partId: r.part?.id ?? null,
                location: r.location?.code ?? null,
                quantityOnHand: r.quantityOnHand,
                quantityAvailable: r.quantityAvailable,
                lotNumber: r.lotNumber,
                serialNumber: r.serialNumber,
              },
            })
          );
        }
        case "work_order": {
          const rows = await db.workOrder.findMany({
            where: {
              OR: [{ number: contains(q) }, { part: { partNumber: contains(q) } }],
            },
            select: {
              id: true,
              number: true,
              status: true,
              quantity: true,
              quantityCompleted: true,
              dueDate: true,
              part: { select: { id: true, partNumber: true } },
              project: { select: { id: true, number: true, name: true } },
            },
            take: limit,
            orderBy: { number: "asc" },
          });
          return rows.map((r) =>
            hit("work_order", {
              id: r.id,
              number: r.number,
              title: `Work order ${r.number}`,
              status: r.status,
              href: `/work-orders/${r.id}`,
              summary: [
                r.part?.partNumber,
                `qty ${r.quantityCompleted}/${r.quantity}`,
                r.dueDate && `due ${r.dueDate.toISOString().slice(0, 10)}`,
                r.project?.number && `project ${r.project.number}`,
              ]
                .filter(Boolean)
                .join(" · "),
              fields: {
                partNumber: r.part?.partNumber ?? null,
                partId: r.part?.id ?? null,
                projectNumber: r.project?.number ?? null,
                projectId: r.project?.id ?? null,
                quantity: r.quantity,
                quantityCompleted: r.quantityCompleted,
              },
            })
          );
        }
        case "sales_order": {
          const rows = await db.salesOrder.findMany({
            where: {
              OR: [
                { number: contains(q) },
                { customerPo: contains(q) },
                { customer: { name: contains(q) } },
              ],
            },
            select: {
              id: true,
              number: true,
              status: true,
              customerPo: true,
              customer: { select: { id: true, name: true, code: true } },
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("sales_order", {
              id: r.id,
              number: r.number,
              title: `Sales order ${r.number}`,
              status: r.status,
              href: `/sales/${r.id}`,
              summary: [r.customer?.name, r.customerPo && `customer PO ${r.customerPo}`]
                .filter(Boolean)
                .join(" · "),
              fields: {
                customerId: r.customer?.id ?? null,
                customerName: r.customer?.name ?? null,
                customerPo: r.customerPo,
              },
            })
          );
        }
        case "quote": {
          const rows = await db.quote.findMany({
            where: {
              OR: [{ number: contains(q) }, { customer: { name: contains(q) } }],
            },
            select: {
              id: true,
              number: true,
              status: true,
              validUntil: true,
              customer: { select: { id: true, name: true } },
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("quote", {
              id: r.id,
              number: r.number,
              title: `Quote ${r.number}`,
              status: r.status,
              href: `/sales/quotes/${r.id}`,
              summary: [r.customer?.name, r.validUntil && `valid until ${r.validUntil.toISOString().slice(0, 10)}`]
                .filter(Boolean)
                .join(" · "),
              fields: { customerId: r.customer?.id ?? null, customerName: r.customer?.name ?? null },
            })
          );
        }
        case "purchase_order": {
          const rows = await db.purchaseOrder.findMany({
            where: {
              OR: [{ number: contains(q) }, { supplier: { name: contains(q) } }],
            },
            select: {
              id: true,
              number: true,
              status: true,
              supplier: { select: { id: true, name: true, code: true } },
              project: { select: { id: true, number: true } },
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("purchase_order", {
              id: r.id,
              number: r.number,
              title: `Purchase order ${r.number}`,
              status: r.status,
              href: `/purchasing/po/${r.id}`,
              summary: [r.supplier?.name, r.project?.number && `project ${r.project.number}`]
                .filter(Boolean)
                .join(" · "),
              fields: {
                supplierId: r.supplier?.id ?? null,
                supplierName: r.supplier?.name ?? null,
                projectId: r.project?.id ?? null,
              },
            })
          );
        }
        case "vendor": {
          const rows = await db.supplier.findMany({
            where: { OR: [{ name: contains(q) }, { code: contains(q) }] },
            select: { id: true, code: true, name: true, status: true, isApprovedVendor: true },
            take: limit,
          });
          return rows.map((r) =>
            hit("vendor", {
              id: r.id,
              number: r.code || r.id,
              title: r.name,
              status: r.status,
              href: `/suppliers/${r.id}`,
              summary: [r.code, r.isApprovedVendor ? "approved vendor" : "vendor"].filter(Boolean).join(" · "),
              fields: { code: r.code, isApprovedVendor: r.isApprovedVendor },
            })
          );
        }
        case "customer": {
          const rows = await db.customer.findMany({
            where: { OR: [{ name: contains(q) }, { code: contains(q) }] },
            select: { id: true, code: true, name: true },
            take: limit,
          });
          return rows.map((r) =>
            hit("customer", {
              id: r.id,
              number: r.code || r.id,
              title: r.name,
              href: `/customers/${r.id}`,
              summary: r.code ? `Customer ${r.code}` : "Customer",
              fields: { code: r.code, name: r.name },
            })
          );
        }
        case "project": {
          const rows = await db.project.findMany({
            where: {
              OR: [{ number: contains(q) }, { name: contains(q) }, { customerName: contains(q) }],
            },
            select: {
              id: true,
              number: true,
              name: true,
              status: true,
              customerName: true,
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("project", {
              id: r.id,
              number: r.number,
              title: `Project ${r.number} · ${r.name}`,
              status: r.status,
              href: `/projects/${r.id}`,
              summary: r.customerName || r.name,
              fields: { name: r.name, customerName: r.customerName },
            })
          );
        }
        case "budget": {
          const rows = await db.budget.findMany({
            where: {
              OR: [
                { number: contains(q) },
                { name: contains(q) },
                { chargeCode: contains(q) },
              ],
            },
            select: {
              id: true,
              number: true,
              name: true,
              status: true,
              chargeCode: true,
              project: { select: { id: true, number: true } },
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("budget", {
              id: r.id,
              number: r.number,
              title: `Budget ${r.number} · ${r.name}`,
              status: r.status,
              href: `/budgets/${r.id}`,
              summary: [r.chargeCode && `charge code ${r.chargeCode}`, r.project?.number && `project ${r.project.number}`]
                .filter(Boolean)
                .join(" · ") || r.name,
              fields: {
                name: r.name,
                chargeCode: r.chargeCode,
                projectId: r.project?.id ?? null,
                projectNumber: r.project?.number ?? null,
              },
            })
          );
        }
        case "ncr": {
          const rows = await db.nonConformance.findMany({
            where: {
              OR: [{ number: contains(q) }, { title: contains(q) }, { serialNumber: contains(q) }],
            },
            select: {
              id: true,
              number: true,
              title: true,
              status: true,
              workOrderId: true,
              part: { select: { partNumber: true } },
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("ncr", {
              id: r.id,
              number: r.number,
              title: `NCR ${r.number}`,
              status: r.status,
              href: `/quality/ncr/${r.id}`,
              summary: [r.title, r.part?.partNumber].filter(Boolean).join(" · "),
              fields: { title: r.title, workOrderId: r.workOrderId, partNumber: r.part?.partNumber ?? null },
            })
          );
        }
        case "mrb": {
          const rows = await db.mrbCase.findMany({
            where: { number: contains(q) },
            select: { id: true, number: true, status: true, ncrId: true },
            take: limit,
          });
          return rows.map((r) =>
            hit("mrb", {
              id: r.id,
              number: r.number,
              title: `MRB ${r.number}`,
              status: r.status,
              href: `/mrb?case=${r.id}`,
              summary: r.ncrId ? `linked NCR` : "MRB case",
              fields: { ncrId: r.ncrId },
            })
          );
        }
        case "bom": {
          const rows = await db.bomHeader.findMany({
            where: {
              OR: [
                { revision: contains(q) },
                { drawingNumber: contains(q) },
                { part: { partNumber: contains(q) } },
              ],
            },
            select: {
              id: true,
              revision: true,
              status: true,
              drawingNumber: true,
              part: { select: { id: true, partNumber: true, description: true } },
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("bom", {
              id: r.id,
              number: `${r.part?.partNumber || "BOM"}-${r.revision}`,
              title: `BOM ${r.part?.partNumber || ""} rev ${r.revision}`,
              status: r.status,
              href: `/bom/${r.id}`,
              summary: [r.part?.description, r.drawingNumber].filter(Boolean).join(" · "),
              fields: {
                partId: r.part?.id ?? null,
                partNumber: r.part?.partNumber ?? null,
                revision: r.revision,
                drawingNumber: r.drawingNumber,
              },
            })
          );
        }
        case "serial": {
          const rows = await db.serialNumber.findMany({
            where: {
              OR: [{ serial: contains(q) }, { part: { partNumber: contains(q) } }],
            },
            select: {
              id: true,
              serial: true,
              status: true,
              lotNumber: true,
              workOrderId: true,
              part: { select: { id: true, partNumber: true } },
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("serial", {
              id: r.id,
              number: r.serial,
              title: `Serial ${r.serial}`,
              status: r.status,
              href: `/trace/serials/${encodeURIComponent(r.serial)}`,
              summary: [r.part?.partNumber, r.lotNumber && `lot ${r.lotNumber}`].filter(Boolean).join(" · "),
              fields: {
                partId: r.part?.id ?? null,
                partNumber: r.part?.partNumber ?? null,
                lotNumber: r.lotNumber,
                workOrderId: r.workOrderId,
              },
            })
          );
        }
        case "lot": {
          const rows = await db.lot.findMany({
            where: {
              OR: [{ lotNumber: contains(q) }, { part: { partNumber: contains(q) } }],
            },
            select: {
              id: true,
              lotNumber: true,
              status: true,
              quantity: true,
              part: { select: { id: true, partNumber: true } },
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("lot", {
              id: r.id,
              number: r.lotNumber,
              title: `Lot ${r.lotNumber}`,
              status: r.status,
              href: "/inventory",
              summary: [r.part?.partNumber, `qty ${r.quantity}`].filter(Boolean).join(" · "),
              fields: { partId: r.part?.id ?? null, partNumber: r.part?.partNumber ?? null, quantity: r.quantity },
            })
          );
        }
        case "asset": {
          const rows = await db.asset.findMany({
            where: {
              OR: [
                { name: contains(q) },
                { serialNumber: contains(q) },
                { homeLocation: contains(q) },
              ],
            },
            select: {
              id: true,
              name: true,
              serialNumber: true,
              status: true,
              homeLocation: true,
              workOrderId: true,
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("asset", {
              id: r.id,
              number: r.serialNumber || r.id,
              title: r.name,
              status: r.status,
              href: `/assets/${r.id}`,
              summary: [r.serialNumber, r.homeLocation].filter(Boolean).join(" · "),
              fields: { serialNumber: r.serialNumber, homeLocation: r.homeLocation, workOrderId: r.workOrderId },
            })
          );
        }
        case "work_center": {
          const rows = await db.workCenter.findMany({
            where: { OR: [{ code: contains(q) }, { name: contains(q) }] },
            select: { id: true, code: true, name: true },
            take: limit,
          });
          return rows.map((r) =>
            hit("work_center", {
              id: r.id,
              number: r.code,
              title: `Work center ${r.code}`,
              href: `/workcenters/${r.id}`,
              summary: r.name,
              fields: { name: r.name, code: r.code },
            })
          );
        }
        case "shipment": {
          const rows = await db.shipment.findMany({
            where: {
              OR: [{ number: contains(q) }, { trackingNumber: contains(q) }],
            },
            select: {
              id: true,
              number: true,
              status: true,
              trackingNumber: true,
              salesOrderId: true,
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("shipment", {
              id: r.id,
              number: r.number,
              title: `Shipment ${r.number}`,
              status: r.status,
              href: `/shipping/${r.id}`,
              summary: r.trackingNumber ? `tracking ${r.trackingNumber}` : "Shipment",
              fields: { trackingNumber: r.trackingNumber, salesOrderId: r.salesOrderId },
            })
          );
        }
        case "rma": {
          const rows = await db.rma.findMany({
            where: {
              OR: [
                { number: contains(q) },
                { customerSn: contains(q) },
                { customer: { name: contains(q) } },
              ],
            },
            select: {
              id: true,
              number: true,
              status: true,
              customerSn: true,
              customer: { select: { id: true, name: true } },
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("rma", {
              id: r.id,
              number: r.number,
              title: `RMA ${r.number}`,
              status: r.status,
              href: `/rma/${r.id}`,
              summary: [r.customer?.name, r.customerSn && `SN ${r.customerSn}`].filter(Boolean).join(" · "),
              fields: { customerId: r.customer?.id ?? null, customerName: r.customer?.name ?? null, customerSn: r.customerSn },
            })
          );
        }
        case "quality": {
          const rows = await db.qualityItem.findMany({
            where: {
              OR: [{ identifier: contains(q) }, { name: contains(q) }],
            },
            select: {
              id: true,
              identifier: true,
              name: true,
              status: true,
              location: true,
              program: { select: { name: true } },
            },
            take: limit,
          });
          return rows.map((r) =>
            hit("quality", {
              id: r.id,
              number: r.identifier,
              title: r.name,
              status: r.status,
              href: "/quality",
              summary: [r.program?.name, r.location].filter(Boolean).join(" · "),
              fields: { identifier: r.identifier, location: r.location },
            })
          );
        }
        case "document": {
          const rows = await db.cmDocument.findMany({
            where: {
              OR: [{ number: contains(q) }, { title: contains(q) }],
            },
            select: { id: true, number: true, title: true, revision: true, status: true },
            take: limit,
          });
          return rows.map((r) =>
            hit("document", {
              id: r.id,
              number: r.number,
              title: r.title,
              status: r.status,
              href: `/docs/pages/${r.id}`,
              summary: `rev ${r.revision}`,
              fields: { revision: r.revision },
            })
          );
        }
        default:
          return [];
      }
    },

    async get(entity, idOrNumber) {
      const q = like(idOrNumber);
      if (!q) return null;
      const matches = await this.search(entity, q, 8);
      const lower = q.toLowerCase();
      return (
        matches.find((h) => h.id === q || h.number.toLowerCase() === lower) ||
        matches.find((h) => h.number.toLowerCase().includes(lower) || h.id === q) ||
        null
      );
    },
  };
}

export async function userCanViewAny(
  userId: string,
  modules: string[],
  canView: LookupCanView = userCanView
): Promise<boolean> {
  for (const moduleName of modules) {
    if (await canView(userId, moduleName)) return true;
  }
  return false;
}

export function createLookupApi(opts: {
  store: LookupStore;
  canView?: LookupCanView;
}) {
  const canView = opts.canView || userCanView;

  async function ensureAllowed(
    userId: string | undefined,
    entity: LookupEntityId
  ): Promise<Extract<LookupResult, { ok: false }> | null> {
    if (!userId) {
      return {
        ok: false,
        reason: "unsigned",
        message: "Sign in to look up live records in this workspace.",
      };
    }
    const allowed = await userCanViewAny(userId, LOOKUP_PERMISSIONS[entity], canView);
    if (!allowed) return permissionDeniedResult(entity);
    return null;
  }

  async function search(params: {
    userId?: string;
    query: string;
    entity?: LookupEntityId | LookupEntityId[];
  }): Promise<LookupResult> {
    if (isExcludedLookupQuery(params.query)) {
      return { ok: false, reason: "excluded", message: LOOKUP_EXCLUDED_MESSAGE };
    }
    const q = params.query.trim();
    if (q.length < 2) {
      return { ok: false, reason: "invalid", message: "Please give a record number or a more specific search." };
    }
    const entities = params.entity
      ? ([] as LookupEntityId[]).concat(params.entity)
      : LOOKUP_ENTITIES;
    const hits: LookupHit[] = [];
    let denied: Extract<LookupResult, { ok: false }> | null = null;
    for (const entity of entities) {
      if (!isLookupEntity(entity)) continue;
      const block = await ensureAllowed(params.userId, entity);
      if (block) {
        if (params.entity) return block;
        if (block.reason === "permission-denied") denied = block;
        continue;
      }
      const found = await opts.store.search(entity, q, LOOKUP_SEARCH_LIMIT);
      hits.push(...found);
      if (hits.length >= LOOKUP_SEARCH_LIMIT) break;
    }
    if (hits.length) return { ok: true, hits: hits.slice(0, LOOKUP_SEARCH_LIMIT) };
    if (denied && entities.length === 1) return denied;
    const only = entities.length === 1 ? entities[0] : undefined;
    return only
      ? notFoundResult(only, q)
      : { ok: false, reason: "not-found", message: `I couldn’t find records matching “${q.slice(0, 80)}” that you can view.` };
  }

  async function get(params: {
    userId?: string;
    entity: LookupEntityId;
    idOrNumber: string;
  }): Promise<LookupResult> {
    if (isExcludedLookupQuery(`${params.entity} ${params.idOrNumber}`)) {
      return { ok: false, reason: "excluded", message: LOOKUP_EXCLUDED_MESSAGE };
    }
    if (!isLookupEntity(params.entity)) {
      return { ok: false, reason: "invalid", message: "That record type isn’t available for lookup." };
    }
    const block = await ensureAllowed(params.userId, params.entity);
    if (block) return block;
    const rec = await opts.store.get(params.entity, params.idOrNumber);
    if (!rec) return notFoundResult(params.entity, params.idOrNumber);
    return { ok: true, hits: [rec] };
  }

  return { search, get };
}

const defaultApi = createLookupApi({ store: createPrismaLookupStore() });

export async function lookupSearch(
  params: Parameters<ReturnType<typeof createLookupApi>["search"]>[0]
): Promise<LookupResult> {
  const user = params.userId ? { id: params.userId } : await getCurrentUser();
  return defaultApi.search({ ...params, userId: user?.id });
}

export async function lookupGet(
  params: Parameters<ReturnType<typeof createLookupApi>["get"]>[0]
): Promise<LookupResult> {
  const user = params.userId ? { id: params.userId } : await getCurrentUser();
  return defaultApi.get({ ...params, userId: user?.id });
}

export { defaultApi as defaultLookupApi };
