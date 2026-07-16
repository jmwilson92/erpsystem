import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createWorkOrder } from "@/lib/services/work-orders";
import { startPrApprovalWorkflow } from "@/lib/services/pr-approval";

/** Record a genealogical / process event for full traceability. */
export async function recordTrace(params: {
  eventType: string;
  partId?: string | null;
  lotNumber?: string | null;
  serialNumber?: string | null;
  quantity?: number | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  workOrderId?: string | null;
  salesOrderId?: string | null;
  purchaseOrderId?: string | null;
  kitOrderId?: string | null;
  shipmentId?: string | null;
  inspectionId?: string | null;
  photoUrls?: string[] | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  userId?: string | null;
}) {
  return prisma.traceEvent.create({
    data: {
      eventType: params.eventType,
      partId: params.partId || undefined,
      lotNumber: params.lotNumber || undefined,
      serialNumber: params.serialNumber || undefined,
      quantity: params.quantity ?? undefined,
      fromLocation: params.fromLocation || undefined,
      toLocation: params.toLocation || undefined,
      workOrderId: params.workOrderId || undefined,
      salesOrderId: params.salesOrderId || undefined,
      purchaseOrderId: params.purchaseOrderId || undefined,
      kitOrderId: params.kitOrderId || undefined,
      shipmentId: params.shipmentId || undefined,
      inspectionId: params.inspectionId || undefined,
      photoUrls: params.photoUrls ? JSON.stringify(params.photoUrls) : undefined,
      notes: params.notes || undefined,
      metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
      userId: params.userId || undefined,
    },
  });
}

/** Available stock = storage/shipping locations, not quarantine, not WIP. */
export async function getAvailableQty(partId: string): Promise<number> {
  const items = await prisma.inventoryItem.findMany({
    where: {
      partId,
      quantityAvailable: { gt: 0 },
      location: { type: { in: ["STORAGE", "SHIPPING"] } },
    },
  });
  return items.reduce((s, i) => s + i.quantityAvailable, 0);
}

export async function getAvailableInventory(partId: string) {
  return prisma.inventoryItem.findMany({
    where: {
      partId,
      quantityAvailable: { gt: 0 },
      location: { type: { in: ["STORAGE", "SHIPPING", "GFP"] } },
    },
    include: { location: true, part: true },
    orderBy: { updatedAt: "asc" }, // FIFO-ish
  });
}

// ─── Sales Order ────────────────────────────────────────────────

export type SalesDocumentLineInput = {
  partId: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
};

export type SalesDocumentInput = {
  department?: string;
  customerId: string;
  requiredDate: Date;
  shipDate?: Date;
  allowEarlyShip?: boolean;
  shipNotBefore?: Date;
  customerPo?: string;
  paymentTerms?: string;
  isFob?: boolean;
  fobPoint?: string;
  billToName?: string;
  billToAddress?: string;
  shipToName?: string;
  shipToAddress?: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
  quoteId?: string;
  lines: SalesDocumentLineInput[];
  createdById?: string;
};

export async function createSalesOrder(params: SalesDocumentInput) {
  if (!params.lines.length) throw new Error("Sales order needs at least one line");
  if (!params.requiredDate) throw new Error("Due date is mandatory");

  const customer = await prisma.customer.findUnique({ where: { id: params.customerId } });
  if (!customer) throw new Error("Customer not found");

  const parts = await prisma.part.findMany({
    where: { id: { in: params.lines.map((l) => l.partId) } },
  });
  const partMap = Object.fromEntries(parts.map((p) => [p.id, p]));

  for (const line of params.lines) {
    if (!partMap[line.partId]) throw new Error(`Part not found: ${line.partId}`);
  }

  const count = await prisma.salesOrder.count();
  const number = `SO-${String(count + 1).padStart(5, "0")}`;

  const totalAmount = params.lines.reduce((s, l) => {
    const part = partMap[l.partId];
    const price = l.unitPrice ?? part?.standardCost ?? 0;
    return s + price * l.quantity;
  }, 0);

  // Credit limit → deposit required when order would exceed available credit
  const { getCustomerCreditSnapshot, evaluateDepositRequirement } = await import(
    "@/lib/services/credit"
  );
  const credit = await getCustomerCreditSnapshot(params.customerId);
  const deposit = evaluateDepositRequirement(credit, totalAmount);

  const depositNote = deposit.depositRequired
    ? `DEPOSIT REQUIRED: ${deposit.depositAmount.toFixed(2)} USD (customer credit exposure ${credit.exposure.toFixed(2)} / limit ${credit.creditLimit.toFixed(2)}; order exceeds by ${deposit.overBy.toFixed(2)}).`
    : null;
  const notes = [params.notes, depositNote].filter(Boolean).join("\n") || undefined;

  const so = await prisma.salesOrder.create({
    data: {
      number,
      department: params.department || "PRODUCTION",
      customerId: params.customerId,
      status: "OPEN",
      requiredDate: params.requiredDate,
      shipDate: params.shipDate,
      allowEarlyShip: params.allowEarlyShip ?? false,
      shipNotBefore: params.shipNotBefore ?? params.shipDate,
      customerPo: params.customerPo,
      paymentTerms: params.paymentTerms || customer.paymentTerms || "NET30",
      isFob: params.isFob ?? false,
      fobPoint: params.isFob ? params.fobPoint || "ORIGIN" : null,
      billToName: params.billToName || customer.name,
      billToAddress: params.billToAddress || customer.billToAddress || undefined,
      shipToName: params.shipToName || customer.name,
      shipToAddress:
        params.shipToAddress || customer.shipToAddress || customer.billToAddress || undefined,
      contactName: params.contactName || customer.contactName || undefined,
      contactEmail: params.contactEmail || customer.contactEmail || undefined,
      notes,
      quoteId: params.quoteId,
      totalAmount,
      depositRequired: deposit.depositRequired,
      depositAmount: deposit.depositAmount,
      depositStatus: deposit.depositStatus,
      creditHold: deposit.creditHold,
      lines: {
        create: params.lines.map((l) => {
          const part = partMap[l.partId];
          return {
            partId: l.partId,
            description: l.description || part?.description || "Line item",
            quantity: l.quantity,
            unitPrice: l.unitPrice ?? part?.standardCost ?? 0,
            fulfillmentStatus: "OPEN",
          };
        }),
      },
    },
    include: { lines: true, customer: true },
  });

  await recordTrace({
    eventType: "SO_CREATED",
    salesOrderId: so.id,
    notes: `Sales order ${so.number} created for ${so.customer.name}`,
    metadata: {
      lineCount: so.lines.length,
      totalAmount,
      requiredDate: params.requiredDate,
      quoteId: params.quoteId,
      depositRequired: deposit.depositRequired,
      depositAmount: deposit.depositAmount,
    },
    userId: params.createdById,
  });

  await logAudit({
    entityType: "SalesOrder",
    entityId: so.id,
    action: "CREATED",
    userId: params.createdById,
    metadata: {
      number: so.number,
      depositRequired: deposit.depositRequired,
    },
  });

  return so;
}

export async function createQuote(params: SalesDocumentInput & { validUntil?: Date }) {
  if (!params.lines.length) throw new Error("Quote needs at least one line");

  const customer = await prisma.customer.findUnique({ where: { id: params.customerId } });
  if (!customer) throw new Error("Customer not found");

  const parts = await prisma.part.findMany({
    where: { id: { in: params.lines.map((l) => l.partId) } },
  });
  const partMap = Object.fromEntries(parts.map((p) => [p.id, p]));

  const count = await prisma.quote.count();
  const number = `QT-${String(count + 1).padStart(5, "0")}`;

  const totalAmount = params.lines.reduce((s, l) => {
    const part = partMap[l.partId];
    const price = l.unitPrice ?? part?.standardCost ?? 0;
    return s + price * l.quantity;
  }, 0);

  const quote = await prisma.quote.create({
    data: {
      number,
      customerId: params.customerId,
      status: "DRAFT",
      requiredDate: params.requiredDate,
      shipDate: params.shipDate,
      validUntil: params.validUntil,
      customerPo: params.customerPo,
      paymentTerms: params.paymentTerms || customer.paymentTerms || "NET30",
      isFob: params.isFob ?? false,
      fobPoint: params.isFob ? params.fobPoint || "ORIGIN" : null,
      billToName: params.billToName || customer.name,
      billToAddress: params.billToAddress || customer.billToAddress || undefined,
      shipToName: params.shipToName || customer.name,
      shipToAddress:
        params.shipToAddress || customer.shipToAddress || customer.billToAddress || undefined,
      contactName: params.contactName || customer.contactName || undefined,
      contactEmail: params.contactEmail || customer.contactEmail || undefined,
      notes: params.notes,
      totalAmount,
      lines: {
        create: params.lines.map((l, i) => {
          const part = partMap[l.partId];
          return {
            partId: l.partId,
            description: l.description || part?.description || "Line item",
            quantity: l.quantity,
            unitPrice: l.unitPrice ?? part?.standardCost ?? 0,
            lineNumber: i + 1,
          };
        }),
      },
    },
    include: { lines: true, customer: true },
  });

  await logAudit({
    entityType: "Quote",
    entityId: quote.id,
    action: "CREATED",
    userId: params.createdById,
    metadata: { number: quote.number },
  });

  return quote;
}

/** Accept quote → create Sales Order (and optionally plan fulfillment). */
export async function convertQuoteToSalesOrder(params: {
  quoteId: string;
  userId?: string;
  autoPlan?: boolean;
}) {
  const quote = await prisma.quote.findUnique({
    where: { id: params.quoteId },
    include: { lines: true, salesOrder: true },
  });
  if (!quote) throw new Error("Quote not found");
  if (quote.salesOrder) throw new Error(`Already converted to ${quote.salesOrder.number}`);
  if (["REJECTED", "EXPIRED", "CONVERTED"].includes(quote.status)) {
    throw new Error(`Cannot convert quote in status ${quote.status}`);
  }
  if (!quote.lines.length) throw new Error("Quote has no lines");

  const due =
    quote.requiredDate ||
    quote.shipDate ||
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const so = await createSalesOrder({
    customerId: quote.customerId,
    requiredDate: due,
    shipDate: quote.shipDate || undefined,
    customerPo: quote.customerPo || undefined,
    paymentTerms: quote.paymentTerms,
    isFob: quote.isFob,
    fobPoint: quote.fobPoint || undefined,
    billToName: quote.billToName || undefined,
    billToAddress: quote.billToAddress || undefined,
    shipToName: quote.shipToName || undefined,
    shipToAddress: quote.shipToAddress || undefined,
    contactName: quote.contactName || undefined,
    contactEmail: quote.contactEmail || undefined,
    notes: quote.notes || undefined,
    quoteId: quote.id,
    lines: quote.lines
      .filter((l) => l.partId)
      .map((l) => ({
        partId: l.partId!,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    createdById: params.userId,
  });

  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "CONVERTED" },
  });

  await logAudit({
    entityType: "Quote",
    entityId: quote.id,
    action: "CONVERTED_TO_SO",
    userId: params.userId,
    metadata: { salesOrderId: so.id, soNumber: so.number },
  });

  if (params.autoPlan) {
    await planSalesOrderFulfillment({
      salesOrderId: so.id,
      userId: params.userId,
    });
  }

  return so;
}

/**
 * Plan fulfillment for every SO line:
 *  - stock check finished goods (unless bypassStockCheck)
 *  - allocate if available
 *  - else create production WO (BOM + WI + due date schedule)
 *  - material shortage check → PRs for purchasing
 *  - bypassStockCheck: skip FG allocation and order full BOM qty via PR
 */
export async function planSalesOrderFulfillment(params: {
  salesOrderId: string;
  userId?: string;
  workCenter?: string;
  /** Skip finished-goods stock check and treat full line qty as make/buy. */
  bypassStockCheck?: boolean;
  /** When planning materials for WOs, PR the full BOM qty (ignore on-hand). */
  bypassMaterialStockCheck?: boolean;
}) {
  const so = await prisma.salesOrder.findUnique({
    where: { id: params.salesOrderId },
    include: {
      lines: { include: { part: true } },
      customer: true,
    },
  });
  if (!so) throw new Error("Sales order not found");
  if (["SHIPPED", "CLOSED", "CANCELLED"].includes(so.status)) {
    throw new Error(`Cannot plan SO in status ${so.status}`);
  }

  const results: {
    lineId: string;
    action: "ALLOCATED" | "MAKE_ORDERED" | "PARTIAL" | "NO_BOM" | "BUY_SHORT";
    workOrderId?: string;
    allocatedQty: number;
    makeQty: number;
    prNumber?: string;
    materialShortages?: number;
    message?: string;
  }[] = [];

  for (const line of so.lines) {
    if (!line.partId) continue;
    if (["READY", "SHIPPED"].includes(line.fulfillmentStatus)) {
      results.push({
        lineId: line.id,
        action: "ALLOCATED",
        allocatedQty: line.quantityAllocated,
        makeQty: 0,
      });
      continue;
    }

    // Remaining demand not yet covered by FG allocation
    const remaining = Math.max(0, line.quantity - line.quantityAllocated);
    // If a WO already covers remaining make qty, skip re-planning
    if (line.workOrderId && remaining > 0) {
      const existingWo = await prisma.workOrder.findUnique({ where: { id: line.workOrderId } });
      if (existingWo && !["COMPLETED", "CLOSED", "CANCELLED"].includes(existingWo.status)) {
        results.push({
          lineId: line.id,
          action: "MAKE_ORDERED",
          workOrderId: existingWo.id,
          allocatedQty: line.quantityAllocated,
          makeQty: existingWo.quantity,
        });
        continue;
      }
    }

    const available = params.bypassStockCheck
      ? 0
      : await getAvailableQty(line.partId);
    const allocateQty = params.bypassStockCheck
      ? 0
      : Math.min(available, remaining);

    if (allocateQty > 0) {
      await allocateFinishedGoods({
        partId: line.partId,
        quantity: allocateQty,
        salesOrderId: so.id,
        salesOrderLineId: line.id,
        userId: params.userId,
      });
      await prisma.salesOrderLine.update({
        where: { id: line.id },
        data: {
          quantityAllocated: line.quantityAllocated + allocateQty,
          fulfillmentStatus:
            allocateQty >= remaining ? "ALLOCATED" : "STOCK_CHECK",
        },
      });
    }

    const makeQty = remaining - allocateQty;
    let workOrderId: string | undefined;
    let prNumber: string | undefined;
    let materialShortages = 0;
    let lineAction: (typeof results)[number]["action"] =
      makeQty > 0 ? (allocateQty > 0 ? "PARTIAL" : "MAKE_ORDERED") : "ALLOCATED";
    let message: string | undefined;

    if (makeQty > 0) {
      // Prefer certified BOM for production
      const bom = await prisma.bomHeader.findFirst({
        where: { partId: line.partId, status: "CERTIFIED" },
        orderBy: { certifiedAt: "desc" },
      });

      if (!bom) {
        // BUY / catalog parts without BOM: open a PR for the shortfall instead of failing
        const isBuy = line.part?.partType === "BUY";
        if (isBuy) {
          const preferred = await prisma.supplier.findFirst({
            where: { status: { in: ["APPROVED", "CONDITIONAL"] } },
            orderBy: { overallScore: "desc" },
          });
          const prCount = await prisma.purchaseRequest.count();
          const pr = await prisma.purchaseRequest.create({
            data: {
              number: `PR-${String(prCount + 1).padStart(5, "0")}`,
              status: "SUBMITTED",
              requestedById: params.userId,
              department: "Sales",
              neededBy: so.requiredDate || so.shipDate || daysFromNow(14),
              justification: params.bypassStockCheck
                ? `Bypass stock — buy full demand for ${so.number} — ${line.part?.partNumber}`
                : `Stock short for ${so.number} line — ${line.part?.partNumber}`,
              totalEstimate: makeQty * (line.part?.standardCost || line.unitPrice || 0),
              supplierId: preferred?.id,
              salesOrderId: so.id,
              lines: {
                create: [
                  {
                    partId: line.partId,
                    description: line.description,
                    quantity: makeQty,
                    estimatedUnitCost: line.part?.standardCost || line.unitPrice || 0,
                    notes: `SO ${so.number}`,
                  },
                ],
              },
            },
          });
          await startPrApprovalWorkflow({
            purchaseRequestId: pr.id,
            userId: params.userId,
          });
          prNumber = pr.number;
          lineAction = "BUY_SHORT";
          message = `No certified BOM — opened ${pr.number} for ${makeQty} ${line.part?.partNumber}`;
          await prisma.salesOrderLine.update({
            where: { id: line.id },
            data: {
              fulfillmentStatus: allocateQty > 0 ? "PARTIAL" : "OPEN",
            },
          });
          await recordTrace({
            eventType: "PR_CREATED",
            partId: line.partId,
            quantity: makeQty,
            salesOrderId: so.id,
            notes: message,
            userId: params.userId,
          });
        } else {
          // Make/assembly without certified BOM — keep SO, block make path
          lineAction = "NO_BOM";
          message = `No CERTIFIED BOM for ${line.part?.partNumber || "part"} — order saved; certify a BOM or allocate stock to fulfill`;
          await prisma.salesOrderLine.update({
            where: { id: line.id },
            data: {
              fulfillmentStatus: allocateQty > 0 ? "PARTIAL" : "OPEN",
            },
          });
          await recordTrace({
            eventType: "PLAN_BLOCKED",
            partId: line.partId,
            quantity: makeQty,
            salesOrderId: so.id,
            notes: message,
            userId: params.userId,
          });
        }
      } else {
        const dueDate = so.requiredDate || new Date();
        const wo = await createWorkOrder({
          type: "PRODUCTION",
          sourceType: "SALES_ORDER",
          partId: line.partId,
          bomHeaderId: bom.id,
          quantity: makeQty,
          createdById: params.userId,
          workCenter: params.workCenter || "ASM-01",
          description: `Build for ${so.number} — ${line.description}`,
          dueDate,
          salesOrderId: so.id,
          salesOrderLineId: line.id,
          salesOrderRef: so.number,
          // Pure commercial demand — no project/WBS on SO-driven WOs
          priority:
            so.requiredDate && so.requiredDate < daysFromNow(14) ? "HIGH" : "NORMAL",
        });
        workOrderId = wo.id;

        await prisma.salesOrderLine.update({
          where: { id: line.id },
          data: {
            workOrderId: wo.id,
            fulfillmentStatus: allocateQty > 0 ? "PARTIAL" : "MAKE_ORDERED",
          },
        });

        await recordTrace({
          eventType: "WO_CREATED",
          partId: line.partId,
          quantity: makeQty,
          workOrderId: wo.id,
          salesOrderId: so.id,
          notes: `WO ${wo.number} created from SO ${so.number} stock shortage`,
          metadata: { dueDate, bomId: bom.id, allocateQty, makeQty },
          userId: params.userId,
        });

        // Material availability → PRs
        const mat = await planWorkOrderMaterials({
          workOrderId: wo.id,
          userId: params.userId,
          bypassStockCheck:
            params.bypassMaterialStockCheck || params.bypassStockCheck,
        });
        prNumber = mat.pr?.number;
        materialShortages = mat.shortages.length;
      }
    } else if (allocateQty >= remaining) {
      await prisma.salesOrderLine.update({
        where: { id: line.id },
        data: { fulfillmentStatus: "READY" },
      });
    }

    await recordTrace({
      eventType: params.bypassStockCheck ? "STOCK_CHECK_BYPASS" : "STOCK_CHECK",
      partId: line.partId,
      quantity: remaining,
      salesOrderId: so.id,
      workOrderId,
      notes: params.bypassStockCheck
        ? `Stock check bypassed — order full demand: make ${makeQty}${
            message ? ` · ${message}` : ""
          }`
        : `Stock check: available ${available}, allocated ${allocateQty}, make ${makeQty}${
            message ? ` · ${message}` : ""
          }`,
      metadata: {
        available,
        allocateQty,
        makeQty,
        lineAction,
        bypassStockCheck: !!params.bypassStockCheck,
      },
      userId: params.userId,
    });

    results.push({
      lineId: line.id,
      action: lineAction,
      workOrderId,
      allocatedQty: allocateQty,
      makeQty: lineAction === "NO_BOM" || lineAction === "BUY_SHORT" ? 0 : makeQty,
      prNumber,
      materialShortages,
      message,
    });
  }

  const anyMake = results.some(
    (r) => r.action === "MAKE_ORDERED" || (r.action === "PARTIAL" && r.workOrderId)
  );
  const anyBlocked = results.some(
    (r) => r.action === "NO_BOM" || r.action === "BUY_SHORT"
  );
  // Ready only when every line is fully allocated/ready
  const fullyCovered = (
    await prisma.salesOrderLine.findMany({ where: { salesOrderId: so.id } })
  ).every(
    (l) =>
      l.fulfillmentStatus === "READY" ||
      l.fulfillmentStatus === "ALLOCATED" ||
      l.fulfillmentStatus === "SHIPPED" ||
      l.quantityAllocated >= l.quantity
  );

  await prisma.salesOrder.update({
    where: { id: so.id },
    data: {
      status: fullyCovered
        ? "READY_TO_SHIP"
        : anyMake
          ? "IN_PRODUCTION"
          : anyBlocked
            ? "PLANNED"
            : "PLANNED",
    },
  });

  await logAudit({
    entityType: "SalesOrder",
    entityId: so.id,
    action: "PLANNED",
    userId: params.userId,
    metadata: { results },
  });

  // If fully allocated from stock, try ship queue
  if (fullyCovered) {
    await ensureShipmentForSalesOrder({ salesOrderId: so.id, userId: params.userId });
  }

  return { salesOrderId: so.id, results };
}

async function allocateFinishedGoods(params: {
  partId: string;
  quantity: number;
  salesOrderId: string;
  salesOrderLineId: string;
  userId?: string;
}) {
  let remaining = params.quantity;
  const items = await getAvailableInventory(params.partId);

  for (const item of items) {
    if (remaining <= 0) break;
    const take = Math.min(item.quantityAvailable, remaining);
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        quantityAvailable: item.quantityAvailable - take,
        quantityCommitted: item.quantityCommitted + take,
      },
    });
    await prisma.materialTransaction.create({
      data: {
        type: "TRANSFER",
        partId: params.partId,
        inventoryItemId: item.id,
        salesOrderId: params.salesOrderId,
        quantity: take,
        lotNumber: item.lotNumber,
        serialNumber: item.serialNumber,
        fromLocation: item.location.code,
        reference: params.salesOrderId,
        notes: "Committed to sales order",
        userId: params.userId,
      },
    });
    await recordTrace({
      eventType: "FG_ALLOCATED",
      partId: params.partId,
      lotNumber: item.lotNumber,
      serialNumber: item.serialNumber,
      quantity: take,
      salesOrderId: params.salesOrderId,
      notes: `Allocated FG to SO line`,
      userId: params.userId,
    });
    remaining -= take;
  }

  if (remaining > 0.0001) {
    throw new Error(`Could not fully allocate FG; short ${remaining}`);
  }
}

// ─── Material planning / PRs ────────────────────────────────────

export async function checkBomMaterialAvailability(workOrderId: string) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      bomHeader: { include: { lines: { include: { componentPart: true } } } },
      part: true,
    },
  });
  if (!wo?.bomHeader) return { wo, requirements: [], allAvailable: true };

  const requirements: {
    bomLineId: string;
    partId: string;
    partNumber: string;
    description: string;
    required: number;
    available: number;
    short: number;
    uom: string;
    standardCost: number;
  }[] = [];

  for (const line of wo.bomHeader.lines) {
    const required =
      line.quantity * wo.quantity * (1 + (line.scrapFactor || 0));
    const available = await getAvailableQty(line.componentPartId);
    requirements.push({
      bomLineId: line.id,
      partId: line.componentPartId,
      partNumber: line.componentPart.partNumber,
      description: line.componentPart.description,
      required,
      available,
      short: Math.max(0, required - available),
      uom: line.componentPart.uom,
      standardCost: line.componentPart.standardCost,
    });
  }

  return {
    wo,
    requirements,
    allAvailable: requirements.every((r) => r.short <= 0),
  };
}

/**
 * Check BOM component availability. Create purchase request for shortages.
 * Sets WO kitStatus + status accordingly.
 * bypassStockCheck: PR full required qty for every BOM line (ignore on-hand).
 */
export async function planWorkOrderMaterials(params: {
  workOrderId: string;
  userId?: string;
  supplierId?: string;
  bypassStockCheck?: boolean;
}) {
  const { wo, requirements } = await checkBomMaterialAvailability(
    params.workOrderId
  );
  if (!wo) throw new Error("Work order not found");

  // When bypassing stock, treat every line as fully short (order full BOM demand)
  const effectiveRequirements = params.bypassStockCheck
    ? requirements.map((r) => ({
        ...r,
        available: 0,
        short: r.required,
      }))
    : requirements;

  const shortages = effectiveRequirements.filter((r) => r.short > 0);
  const allAvailable = shortages.length === 0;

  let pr: { id: string; number: string } | null = null;

  if (shortages.length > 0) {
    // Prefer supplier from first BUY part with open history, else first active supplier
    let supplierId = params.supplierId;
    if (!supplierId) {
      const preferred = await prisma.supplier.findFirst({
        where: { status: { in: ["APPROVED", "CONDITIONAL"] } },
        orderBy: { overallScore: "desc" },
      });
      supplierId = preferred?.id;
    }

    const prCount = await prisma.purchaseRequest.count();
    const number = `PR-${String(prCount + 1).padStart(5, "0")}`;
    const totalEstimate = shortages.reduce(
      (s, r) => s + r.short * r.standardCost,
      0
    );

    const created = await prisma.purchaseRequest.create({
      data: {
        number,
        status: "SUBMITTED",
        requestedById: params.userId,
        department: "Production",
        neededBy: wo.dueDate || wo.plannedEnd || daysFromNow(14),
        justification: params.bypassStockCheck
          ? `Bypass stock check — order full BOM for ${wo.number} traveler`
          : `Material shortage for ${wo.number} traveler / kitting`,
        totalEstimate,
        supplierId,
        workOrderId: wo.id,
        projectId: wo.projectId || undefined,
        salesOrderId: wo.salesOrderId || undefined,
        lines: {
          create: shortages.map((r) => ({
            partId: r.partId,
            description: `${r.partNumber} — ${r.description}`,
            quantity: r.short,
            estimatedUnitCost: r.standardCost,
            uom: r.uom,
            notes: params.bypassStockCheck
              ? `Full BOM demand for WO ${wo.number} (stock bypass)`
              : `Required for WO ${wo.number}`,
          })),
        },
      },
    });
    pr = { id: created.id, number: created.number };

    await startPrApprovalWorkflow({
      purchaseRequestId: created.id,
      userId: params.userId,
    });

    await recordTrace({
      eventType: "PR_CREATED",
      workOrderId: wo.id,
      salesOrderId: wo.salesOrderId,
      notes: `PR ${number} for ${shortages.length} line(s)${
        params.bypassStockCheck ? " (stock bypass)" : ""
      }`,
      metadata: {
        shortages: shortages.map((s) => ({ part: s.partNumber, short: s.short })),
        bypassStockCheck: !!params.bypassStockCheck,
      },
      userId: params.userId,
    });

    await logAudit({
      entityType: "PurchaseRequest",
      entityId: created.id,
      action: "CREATED_FROM_WO",
      userId: params.userId,
      metadata: {
        workOrderId: wo.id,
        number,
        bypassStockCheck: !!params.bypassStockCheck,
      },
    });
  }

  const kitStatus = allAvailable ? "READY_TO_KIT" : "WAITING_MATERIAL";
  const status = allAvailable
    ? wo.status === "PLANNED" || wo.status === "WAITING_MATERIAL"
      ? "READY_TO_KIT"
      : wo.status
    : "WAITING_MATERIAL";

  await prisma.workOrder.update({
    where: { id: wo.id },
    data: {
      kitStatus,
      status,
      statusHistory: {
        create: {
          fromStatus: wo.status,
          toStatus: status,
          userId: params.userId,
          notes: allAvailable
            ? "All BOM material available — ready to kit"
            : `Waiting material — ${shortages.length} line(s)${pr ? `, ${pr.number}` : ""}${
                params.bypassStockCheck ? " (stock bypass)" : ""
              }`,
        },
      },
    },
  });

  await recordTrace({
    eventType: "MATERIAL_CHECK",
    workOrderId: wo.id,
    salesOrderId: wo.salesOrderId,
    partId: wo.partId,
    notes: allAvailable
      ? "Material check passed — ready to kit"
      : params.bypassStockCheck
        ? `Stock bypass — PR full BOM (${shortages.length} part(s))`
        : `Material short on ${shortages.length} part(s)`,
    metadata: {
      requirements: effectiveRequirements,
      prNumber: pr?.number,
      bypassStockCheck: !!params.bypassStockCheck,
    },
    userId: params.userId,
  });

  return {
    requirements: effectiveRequirements,
    shortages,
    allAvailable,
    pr,
    kitStatus,
    status,
  };
}

/**
 * Re-check materials after receipts/putaway.
 * Promote to READY_TO_KIT when full; demote back to WAITING_MATERIAL when short.
 */
export async function refreshWorkOrderMaterialReadiness(
  workOrderId: string,
  userId?: string
) {
  const check = await checkBomMaterialAvailability(workOrderId);
  const shortages = check.requirements.filter((r) => r.short > 0);
  const { allAvailable } = check;
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
  if (!wo) return { allAvailable, shortages };

  if (allAvailable && ["WAITING_MATERIAL", "PLANNED"].includes(wo.status)) {
    await prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        kitStatus: "READY_TO_KIT",
        status: "READY_TO_KIT",
        statusHistory: {
          create: {
            fromStatus: wo.status,
            toStatus: "READY_TO_KIT",
            userId,
            notes: "Materials received and available — ready to kit",
          },
        },
      },
    });
    await recordTrace({
      eventType: "READY_TO_KIT",
      workOrderId,
      salesOrderId: wo.salesOrderId,
      notes: "All components available after receipt/putaway",
      userId,
    });
  } else if (
    !allAvailable &&
    (wo.status === "READY_TO_KIT" || wo.kitStatus === "READY_TO_KIT")
  ) {
    // Stock moved / overstated ready — send back to waiting material
    await prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        kitStatus: "WAITING_MATERIAL",
        status: "WAITING_MATERIAL",
        statusHistory: {
          create: {
            fromStatus: wo.status,
            toStatus: "WAITING_MATERIAL",
            userId,
            notes: `Material short: ${shortages
              .map((s) => `${s.partNumber} (−${s.short})`)
              .join(", ")}`,
          },
        },
      },
    });
  }

  return { allAvailable, shortages };
}

/** After any putaway, refresh WOs that were waiting on material. */
export async function refreshAllWaitingMaterial(userId?: string) {
  const waiting = await prisma.workOrder.findMany({
    where: { status: "WAITING_MATERIAL" },
    select: { id: true },
  });
  for (const w of waiting) {
    await refreshWorkOrderMaterialReadiness(w.id, userId);
  }
  return waiting.length;
}

// ─── Receiving photos + putaway ─────────────────────────────────

export async function captureReceivingPhotos(params: {
  partId?: string;
  receiptId?: string;
  receiptLineId?: string;
  inventoryItemId?: string;
  purchaseOrderId?: string;
  lotNumber?: string;
  captions?: string[];
  /** Explicit photo payloads (data URLs or paths) from the dock form */
  photoInputs?: { url: string; caption?: string }[];
  userId?: string;
}) {
  const photos = [];

  if (params.photoInputs?.length) {
    for (const input of params.photoInputs) {
      const photo = await prisma.receivingPhoto.create({
        data: {
          partId: params.partId,
          receiptId: params.receiptId,
          receiptLineId: params.receiptLineId,
          inventoryItemId: params.inventoryItemId,
          purchaseOrderId: params.purchaseOrderId,
          lotNumber: params.lotNumber,
          url: input.url,
          caption: input.caption || "Receiving photo",
          takenById: params.userId,
        },
      });
      photos.push(photo);
    }
    // First dock photo → item card when the part has no primary image yet
    if (params.partId && photos[0]?.url) {
      const part = await prisma.part.findUnique({
        where: { id: params.partId },
        select: { primaryImageUrl: true },
      });
      if (part && !part.primaryImageUrl) {
        await prisma.part.update({
          where: { id: params.partId },
          data: { primaryImageUrl: photos[0].url },
        });
      }
    }
    await recordTrace({
      eventType: "PHOTO",
      partId: params.partId,
      lotNumber: params.lotNumber,
      purchaseOrderId: params.purchaseOrderId,
      photoUrls: photos.map((p) => p.url),
      notes: `Captured ${photos.length} dock photo(s)`,
      userId: params.userId,
    });
    return photos;
  }

  const captions =
    params.captions?.length
      ? params.captions
      : ["Overall package", "Part label / lot", "Visual condition"];

  for (let i = 0; i < captions.length; i++) {
    const stamp = Date.now().toString(36);
    const url = `/mock-photos/rcv-${params.lotNumber || stamp}-${i + 1}.jpg`;
    const photo = await prisma.receivingPhoto.create({
      data: {
        partId: params.partId,
        receiptId: params.receiptId,
        receiptLineId: params.receiptLineId,
        inventoryItemId: params.inventoryItemId,
        purchaseOrderId: params.purchaseOrderId,
        lotNumber: params.lotNumber,
        url,
        caption: captions[i],
        takenById: params.userId,
      },
    });
    photos.push(photo);
  }

  if (params.partId && photos[0]?.url) {
    const part = await prisma.part.findUnique({
      where: { id: params.partId },
      select: { primaryImageUrl: true },
    });
    if (part && !part.primaryImageUrl) {
      await prisma.part.update({
        where: { id: params.partId },
        data: { primaryImageUrl: photos[0].url },
      });
    }
  }

  await recordTrace({
    eventType: "PHOTO",
    partId: params.partId,
    lotNumber: params.lotNumber,
    purchaseOrderId: params.purchaseOrderId,
    photoUrls: photos.map((p) => p.url),
    notes: `Captured ${photos.length} receiving photo(s)`,
    userId: params.userId,
  });

  return photos;
}

/**
 * Move inspected material from RECEIVING → STORAGE (putaway).
 * Optionally attaches mock photos if none exist yet.
 */
export async function putAwayInventory(params: {
  inventoryItemId: string;
  userId?: string;
  capturePhotos?: boolean;
  targetLocationCode?: string;
}) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id: params.inventoryItemId },
    include: { location: true, part: true },
  });
  if (!item) throw new Error("Inventory item not found");
  if (item.quantityQuarantine > 0 || item.mrbCaseId) {
    throw new Error("Cannot put away quarantined / MRB material");
  }

  const storageLoc =
    (await prisma.location.findFirst({
      where: params.targetLocationCode
        ? { code: params.targetLocationCode }
        : { type: "STORAGE" },
    })) ||
    (await prisma.location.findFirst({ where: { type: "STORAGE" } })) ||
    (await prisma.location.findFirst({ where: { type: "GFP" } }));

  if (!storageLoc) throw new Error("No STORAGE/GFP location configured");

  let photoUrls: string[] = [];
  if (params.capturePhotos !== false) {
    const existing = await prisma.receivingPhoto.count({
      where: { inventoryItemId: item.id },
    });
    if (existing === 0) {
      const photos = await captureReceivingPhotos({
        partId: item.partId,
        inventoryItemId: item.id,
        lotNumber: item.lotNumber || undefined,
        userId: params.userId,
      });
      photoUrls = photos.map((p) => p.url);
    }
  }

  // GFP area putaway → material is government-owned instance (P/N itself is not GFP)
  const isGfpArea =
    storageLoc.type === "GFP" ||
    storageLoc.code.toUpperCase().startsWith("GFP");
  const ownership = isGfpArea
    ? "GOVERNMENT"
    : item.ownership === "GOVERNMENT"
      ? "GOVERNMENT"
      : "COMPANY";

  const fromCode = item.location.code;
  const updated = await prisma.inventoryItem.update({
    where: { id: item.id },
    data: {
      locationId: storageLoc.id,
      ownership,
      // ensure available after putaway (inspection already passed)
      quantityAvailable: item.quantityOnHand - item.quantityCommitted,
    },
  });

  await prisma.materialTransaction.create({
    data: {
      type: "PUTAWAY",
      partId: item.partId,
      inventoryItemId: item.id,
      quantity: item.quantityOnHand,
      unitCost: item.unitCost,
      fromLocation: fromCode,
      toLocation: storageLoc.code,
      lotNumber: item.lotNumber,
      serialNumber: item.serialNumber,
      reference: `PUTAWAY-${item.id.slice(-6)}`,
      notes: "Put away after receiving inspection",
      photoUrls: photoUrls.length ? JSON.stringify(photoUrls) : undefined,
      userId: params.userId,
    },
  });

  await recordTrace({
    eventType: "PUTAWAY",
    partId: item.partId,
    lotNumber: item.lotNumber,
    serialNumber: item.serialNumber,
    quantity: item.quantityOnHand,
    fromLocation: fromCode,
    toLocation: storageLoc.code,
    photoUrls: photoUrls.length ? photoUrls : undefined,
    notes: `Put away ${item.part.partNumber} to ${storageLoc.code}`,
    userId: params.userId,
  });

  await refreshAllWaitingMaterial(params.userId);

  await logAudit({
    entityType: "InventoryItem",
    entityId: item.id,
    action: "PUTAWAY",
    userId: params.userId,
    metadata: { from: fromCode, to: storageLoc.code },
  });

  // Re-evaluate kanban (may clear need if stock now above min, or still low)
  await triggerKanbanReplenishment({
    userId: params.userId,
    partIds: [item.partId],
  });

  return updated;
}

/** Put away all RECEIVING stock that passed inspection (available, not quarantine). */
export async function putAwayAllReceiving(userId?: string) {
  const receiving = await prisma.location.findMany({ where: { type: "RECEIVING" } });
  const locIds = receiving.map((l) => l.id);
  const items = await prisma.inventoryItem.findMany({
    where: {
      locationId: { in: locIds },
      quantityOnHand: { gt: 0 },
      quantityQuarantine: 0,
      mrbCaseId: null,
    },
  });

  const results = [];
  for (const item of items) {
    results.push(await putAwayInventory({ inventoryItemId: item.id, userId }));
  }
  return results;
}

// ─── Kitting ────────────────────────────────────────────────────

export async function createKitOrder(params: {
  workOrderId: string;
  userId?: string;
}) {
  const check = await checkBomMaterialAvailability(params.workOrderId);
  if (!check.wo?.bomHeader) throw new Error("Work order has no BOM for kitting");
  if (!check.allAvailable) {
    throw new Error(
      `Cannot kit — material short: ${check.requirements
        .filter((r) => r.short > 0)
        .map((r) => `${r.partNumber} (−${r.short})`)
        .join(", ")}`
    );
  }

  const openKit = await prisma.kitOrder.findFirst({
    where: {
      workOrderId: params.workOrderId,
      status: { in: ["OPEN", "PICKING"] },
    },
  });
  if (openKit) return openKit;

  const count = await prisma.kitOrder.count();
  const number = `KIT-${String(count + 1).padStart(5, "0")}`;

  const kit = await prisma.kitOrder.create({
    data: {
      number,
      workOrderId: params.workOrderId,
      status: "OPEN",
      notes: `Traveler kit for ${check.wo.number}`,
      lines: {
        create: check.requirements.map((r) => ({
          partId: r.partId,
          bomLineId: r.bomLineId,
          quantityRequired: r.required,
          status: "OPEN",
        })),
      },
    },
    include: { lines: { include: { part: true } } },
  });

  await prisma.workOrder.update({
    where: { id: params.workOrderId },
    data: {
      kitStatus: "KITTING",
      status: "KITTING",
      statusHistory: {
        create: {
          fromStatus: check.wo.status,
          toStatus: "KITTING",
          userId: params.userId,
          notes: `Kit order ${number} created — travels with WO`,
        },
      },
    },
  });

  await recordTrace({
    eventType: "KIT_CREATED",
    workOrderId: params.workOrderId,
    salesOrderId: check.wo.salesOrderId,
    kitOrderId: kit.id,
    notes: `Kit ${number} opened for traveler ${check.wo.number}`,
    userId: params.userId,
  });

  return kit;
}

/**
 * Pick all kit lines from stock → issue to WO (WIP). Completes kit.
 */
export async function completeKitOrder(params: {
  kitOrderId: string;
  userId?: string;
  /** Optional per-line preferred inventory item / location picks: lineId → inventoryItemId */
  linePicks?: Record<string, string>;
}) {
  const kit = await prisma.kitOrder.findUnique({
    where: { id: params.kitOrderId },
    include: {
      lines: { include: { part: true } },
      workOrder: {
        include: {
          project: true,
          salesOrder: true,
        },
      },
    },
  });
  if (!kit) throw new Error("Kit order not found");
  if (kit.status === "COMPLETE") return kit;

  const wipLoc =
    (await prisma.location.findFirst({ where: { type: "WIP" } })) ||
    (await prisma.location.findFirst({ where: { code: "WIP-01" } })) ||
    (await prisma.location.findFirst({ where: { type: "STORAGE" } }));

  const chargeNumber =
    kit.workOrder.project?.number ||
    kit.workOrder.salesOrder?.number ||
    null;

  await prisma.kitOrder.update({
    where: { id: kit.id },
    data: {
      status: "PICKING",
      startedAt: kit.startedAt || new Date(),
      pickedById: params.userId,
    },
  });

  for (const line of kit.lines) {
    let remaining = line.quantityRequired - line.quantityPicked;
    let items = await getAvailableInventory(line.partId);

    // GFP rules: government stock only if WO charges a project and contract matches
    const gfpItems = items.filter(
      (i) =>
        i.ownership === "GOVERNMENT" ||
        i.location.type === "GFP" ||
        i.location.code.toUpperCase().startsWith("GFP")
    );
    const companyItems = items.filter(
      (i) =>
        !(
          i.ownership === "GOVERNMENT" ||
          i.location.type === "GFP" ||
          i.location.code.toUpperCase().startsWith("GFP")
        )
    );

    if (gfpItems.length > 0) {
      if (!kit.workOrder.projectId) {
        // Cannot kit GFP without project charge
        items = companyItems;
      } else {
        // Load GFP contract tags for these inventory items
        const invIds = gfpItems.map((i) => i.id);
        const props = await prisma.governmentProperty.findMany({
          where: { inventoryItemId: { in: invIds } },
        });
        const propByInv = Object.fromEntries(
          props
            .filter((p) => p.inventoryItemId)
            .map((p) => [p.inventoryItemId!, p])
        );
        const allowedGfp = gfpItems.filter((i) => {
          const p = propByInv[i.id];
          if (!p?.contractNumber) return false;
          // Contract / charge number must match project number or free-text match
          const c = p.contractNumber.toUpperCase();
          const charge = (chargeNumber || "").toUpperCase();
          const projName = (kit.workOrder.project?.name || "").toUpperCase();
          return (
            c === charge ||
            c.includes(charge) ||
            charge.includes(c) ||
            projName.includes(c) ||
            c.includes(projName.slice(0, 8))
          );
        });
        if (gfpItems.length && allowedGfp.length === 0 && companyItems.length === 0) {
          throw new Error(
            `GFP stock for ${line.part.partNumber} requires a WO project whose contract/charge number matches the government property contract. ` +
              `WO project: ${kit.workOrder.project?.number || "none"}.`
          );
        }
        items = [...allowedGfp, ...companyItems];
      }
    }

    // Preferred pick location/item from UI
    const preferredId = params.linePicks?.[line.id];
    if (preferredId) {
      items = [
        ...items.filter((i) => i.id === preferredId),
        ...items.filter((i) => i.id !== preferredId),
      ];
    }

    let picked = 0;
    let lastLot: string | null = null;
    let lastLocId: string | null = null;
    let lastInvId: string | null = null;

    for (const item of items) {
      if (remaining <= 0) break;
      const take = Math.min(item.quantityAvailable, remaining);

      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: {
          quantityOnHand: item.quantityOnHand - take,
          quantityAvailable: item.quantityAvailable - take,
        },
      });

      await prisma.materialTransaction.create({
        data: {
          type: "KIT",
          partId: line.partId,
          inventoryItemId: item.id,
          workOrderId: kit.workOrderId,
          kitOrderId: kit.id,
          quantity: take,
          unitCost: item.unitCost,
          fromLocation: item.location.code,
          toLocation: wipLoc?.code || "WIP",
          lotNumber: item.lotNumber,
          serialNumber: item.serialNumber,
          reference: kit.number,
          notes: `Kitted to ${kit.workOrder.number}`,
          userId: params.userId,
        },
      });

      await recordTrace({
        eventType: "KIT",
        partId: line.partId,
        lotNumber: item.lotNumber,
        serialNumber: item.serialNumber,
        quantity: take,
        fromLocation: item.location.code,
        toLocation: wipLoc?.code || "WIP",
        workOrderId: kit.workOrderId,
        salesOrderId: kit.workOrder.salesOrderId,
        kitOrderId: kit.id,
        notes: `Kitted ${line.part.partNumber} lot ${item.lotNumber || "—"}`,
        userId: params.userId,
      });

      lastLot = item.lotNumber;
      lastLocId = item.locationId;
      lastInvId = item.id;
      picked += take;
      remaining -= take;
    }

    if (remaining > 0.0001) {
      await prisma.kitOrderLine.update({
        where: { id: line.id },
        data: {
          quantityPicked: line.quantityPicked + picked,
          lotNumber: lastLot,
          fromLocationId: lastLocId,
          inventoryItemId: lastInvId,
          status: "SHORT",
        },
      });
      await prisma.kitOrder.update({
        where: { id: kit.id },
        data: { status: "SHORT" },
      });
      await prisma.workOrder.update({
        where: { id: kit.workOrderId },
        data: {
          kitStatus: "WAITING_MATERIAL",
          status: "WAITING_MATERIAL",
          statusHistory: {
            create: {
              fromStatus: "KITTING",
              toStatus: "WAITING_MATERIAL",
              userId: params.userId,
              notes: `Kit short on ${line.part.partNumber}`,
            },
          },
        },
      });
      throw new Error(`Kit short on ${line.part.partNumber}: need ${remaining} more`);
    }

    await prisma.kitOrderLine.update({
      where: { id: line.id },
      data: {
        quantityPicked: line.quantityRequired,
        lotNumber: lastLot,
        fromLocationId: lastLocId,
        inventoryItemId: lastInvId,
        status: "PICKED",
      },
    });
  }

  await prisma.kitOrder.update({
    where: { id: kit.id },
    data: { status: "COMPLETE", completedAt: new Date() },
  });

  await prisma.workOrder.update({
    where: { id: kit.workOrderId },
    data: {
      kitStatus: "KITTED",
      status: "KITTED",
      statusHistory: {
        create: {
          fromStatus: "KITTING",
          toStatus: "KITTED",
          userId: params.userId,
          notes: `Kit ${kit.number} complete — ready for production`,
        },
      },
    },
  });

  await recordTrace({
    eventType: "KIT_COMPLETE",
    workOrderId: kit.workOrderId,
    salesOrderId: kit.workOrder.salesOrderId,
    kitOrderId: kit.id,
    notes: `Kit ${kit.number} complete — traveler moves to production`,
    userId: params.userId,
  });

  await logAudit({
    entityType: "KitOrder",
    entityId: kit.id,
    action: "COMPLETED",
    userId: params.userId,
  });

  // Kit issue often drives kanban components below min → auto PR
  await triggerKanbanReplenishment({
    userId: params.userId,
    partIds: kit.lines.map((l) => l.partId),
  });

  return prisma.kitOrder.findUnique({
    where: { id: kit.id },
    include: { lines: { include: { part: true } }, workOrder: true },
  });
}

/** KITTED → RELEASED → IN_PROGRESS (start first production step). */
export async function startProductionFromKit(params: {
  workOrderId: string;
  userId?: string;
}) {
  // Shared start path: seed WI steps + IN_PROGRESS
  const { startWorkOrderProduction } = await import(
    "@/lib/services/work-orders"
  );
  const updated = await startWorkOrderProduction({
    workOrderId: params.workOrderId,
    userId: params.userId,
  });

  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
  });
  await recordTrace({
    eventType: "PRODUCTION_START",
    workOrderId: params.workOrderId,
    salesOrderId: wo?.salesOrderId,
    partId: wo?.partId,
    notes: "Assembly process started on floor — traveler steps active",
    userId: params.userId,
  });

  return updated;
}

// ─── Complete WO → FG stock → shipping ──────────────────────────

export async function completeWorkOrderToStock(params: {
  workOrderId: string;
  userId?: string;
  serialNumber?: string;
  lotNumber?: string;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: params.workOrderId },
    include: { part: true, salesOrder: true, salesOrderLine: true },
  });
  if (!wo) throw new Error("Work order not found");
  if (["COMPLETED", "CLOSED", "CANCELLED"].includes(wo.status)) {
    throw new Error(`WO already ${wo.status}`);
  }

  // Require all traveler steps signed if any exist
  const pendingSteps = await prisma.workOrderStepCompletion.count({
    where: {
      workOrderId: wo.id,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
  });
  const failedSteps = await prisma.workOrderStepCompletion.count({
    where: { workOrderId: wo.id, status: "FAILED" },
  });
  if (pendingSteps > 0) {
    throw new Error(
      `${pendingSteps} traveler step(s) still open — sign off before putaway`
    );
  }
  if (failedSteps > 0) {
    throw new Error(
      "Failed test steps on traveler — resolve NCR / hold before putaway"
    );
  }
  // Putaway to stock only after unit is at Receiving putaway queue
  if (wo.status !== "READY_FOR_PUTAWAY") {
    throw new Error(
      `WO must be at Receiving putaway first (status=${wo.status}). Send to Receiving (RCV-01), then put away there.`
    );
  }
  const recCodes = await prisma.workCenter.findMany({
    where: {
      isActive: true,
      OR: [
        { area: "RECEIVING" },
        { code: { startsWith: "RCV" } },
        { code: { startsWith: "REC" } },
      ],
    },
    select: { code: true },
  });
  const recSet = new Set(recCodes.map((c) => c.code.toUpperCase()));
  recSet.add("RCV-01");
  recSet.add("REC-01");
  if (
    !wo.workCenter ||
    !recSet.has(wo.workCenter.toUpperCase())
  ) {
    throw new Error(
      `WO workcenter is ${wo.workCenter || "unset"} — deliver to RCV-01 Receiving before putaway`
    );
  }

  const storageLoc =
    (await prisma.location.findFirst({ where: { type: "STORAGE" } })) ||
    (await prisma.location.findFirst());
  if (!storageLoc || !wo.partId) throw new Error("Cannot complete — missing storage or part");

  const lotNumber =
    params.lotNumber || `LOT-WO-${wo.number.replace(/\W/g, "")}`;
  const serialNumber =
    params.serialNumber ||
    (wo.part?.isSerialized
      ? `SN-${wo.number}-${Date.now().toString(36).toUpperCase()}`
      : undefined);

  // Create FG inventory — committed to SO if linked, else available
  const commitToSo = Boolean(wo.salesOrderId && wo.salesOrderLineId);
  const inv = await prisma.inventoryItem.create({
    data: {
      partId: wo.partId,
      locationId: storageLoc.id,
      quantityOnHand: wo.quantity,
      quantityAvailable: commitToSo ? 0 : wo.quantity,
      quantityCommitted: commitToSo ? wo.quantity : 0,
      lotNumber,
      serialNumber,
      unitCost: wo.standardCost / (wo.quantity || 1),
      ownership: "COMPANY",
    },
  });

  await prisma.materialTransaction.create({
    data: {
      type: "WO_COMPLETE",
      partId: wo.partId,
      inventoryItemId: inv.id,
      workOrderId: wo.id,
      salesOrderId: wo.salesOrderId || undefined,
      quantity: wo.quantity,
      unitCost: inv.unitCost,
      toLocation: storageLoc.code,
      lotNumber,
      serialNumber,
      reference: wo.number,
      notes: "Finished assembly received to stock from traveler",
      userId: params.userId,
    },
  });

  if (serialNumber && wo.partId) {
    await prisma.serialNumber
      .create({
        data: {
          serial: serialNumber,
          partId: wo.partId,
          status: "IN_STOCK",
          workOrderId: wo.id,
          lotNumber,
        },
      })
      .catch(() => null);
  }

  await prisma.workOrder.update({
    where: { id: wo.id },
    data: {
      status: "COMPLETED",
      quantityCompleted: wo.quantity,
      actualEnd: new Date(),
      statusHistory: {
        create: {
          fromStatus: wo.status,
          toStatus: "COMPLETED",
          userId: params.userId,
          notes: `FG to stock lot ${lotNumber}${serialNumber ? ` SN ${serialNumber}` : ""}`,
        },
      },
    },
  });

  await recordTrace({
    eventType: "WO_COMPLETE",
    partId: wo.partId,
    lotNumber,
    serialNumber,
    quantity: wo.quantity,
    toLocation: storageLoc.code,
    workOrderId: wo.id,
    salesOrderId: wo.salesOrderId,
    notes: `Assembly complete — ${wo.number} put into stock`,
    metadata: { inventoryItemId: inv.id },
    userId: params.userId,
  });

  // Update SO line readiness
  if (wo.salesOrderLineId) {
    const line = await prisma.salesOrderLine.findUnique({
      where: { id: wo.salesOrderLineId },
    });
    if (line) {
      const newAlloc = line.quantityAllocated + wo.quantity;
      await prisma.salesOrderLine.update({
        where: { id: line.id },
        data: {
          quantityAllocated: newAlloc,
          fulfillmentStatus: newAlloc >= line.quantity ? "READY" : "PARTIAL",
        },
      });
    }
  }

  if (wo.salesOrderId) {
    await syncSalesOrderReadyStatus(wo.salesOrderId, params.userId);
  }

  await logAudit({
    entityType: "WorkOrder",
    entityId: wo.id,
    action: "COMPLETED_TO_STOCK",
    userId: params.userId,
    metadata: { lotNumber, serialNumber, inventoryItemId: inv.id },
  });

  return { workOrderId: wo.id, inventoryItemId: inv.id, lotNumber, serialNumber };
}

export async function syncSalesOrderReadyStatus(salesOrderId: string, userId?: string) {
  const so = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: { lines: true },
  });
  if (!so) return;

  const allReady = so.lines.every(
    (l) =>
      l.fulfillmentStatus === "READY" ||
      l.fulfillmentStatus === "SHIPPED" ||
      l.quantityAllocated >= l.quantity
  );

  if (allReady && !["SHIPPED", "CLOSED"].includes(so.status)) {
    await prisma.salesOrder.update({
      where: { id: so.id },
      data: { status: "READY_TO_SHIP" },
    });
    await recordTrace({
      eventType: "READY_TO_SHIP",
      salesOrderId: so.id,
      notes: "All lines ready — shipping may pull (subject to early-ship rules)",
      userId,
    });
    await ensureShipmentForSalesOrder({ salesOrderId: so.id, userId });
  }
}

export type ShipBlockCode = "DEPOSIT" | "DATE";

/** Deposit hold is a hard block (cannot force). Date gate can be force-shipped. */
export function canShipNow(so: {
  allowEarlyShip: boolean;
  shipNotBefore: Date | null;
  requiredDate: Date | null;
  depositRequired?: boolean;
  depositStatus?: string | null;
  depositAmount?: number;
}): { ok: boolean; reason?: string; code?: ShipBlockCode } {
  // Hard block: deposit must be received or waived before any ship
  if (
    so.depositRequired &&
    !["RECEIVED", "WAIVED"].includes((so.depositStatus || "").toUpperCase())
  ) {
    const amt =
      so.depositAmount != null && so.depositAmount > 0
        ? ` (${so.depositAmount.toFixed(2)} USD)`
        : "";
    return {
      ok: false,
      code: "DEPOSIT",
      reason: `Deposit required${amt} before shipping — current status: ${
        so.depositStatus || "PENDING"
      }. Mark deposit received or waive on the sales order.`,
    };
  }

  const now = new Date();
  if (so.allowEarlyShip) return { ok: true };

  const gate = so.shipNotBefore || so.requiredDate;
  if (gate && now < gate) {
    return {
      ok: false,
      code: "DATE",
      reason: `Early ship not allowed until ${gate.toISOString().slice(0, 10)}`,
    };
  }
  return { ok: true };
}

export async function ensureShipmentForSalesOrder(params: {
  salesOrderId: string;
  userId?: string;
}) {
  const so = await prisma.salesOrder.findUnique({
    where: { id: params.salesOrderId },
    include: { lines: { include: { part: true } }, customer: true, shipments: true },
  });
  if (!so) throw new Error("SO not found");

  const shipCheck = canShipNow(so);
  const existingOpen = so.shipments.find((s) =>
    ["DRAFT", "PICKING", "PACKED"].includes(s.status)
  );

  if (existingOpen) {
    return { shipment: existingOpen, blocked: !shipCheck.ok, reason: shipCheck.reason };
  }

  // Only create shipment queue entry when ready
  if (so.status !== "READY_TO_SHIP" && so.status !== "IN_PRODUCTION") {
    // allow draft when any line ready
    const anyReady = so.lines.some(
      (l) => l.fulfillmentStatus === "READY" || l.quantityAllocated > 0
    );
    if (!anyReady) return { shipment: null, blocked: true, reason: "Nothing ready to ship" };
  }

  const count = await prisma.shipment.count();
  const number = `SHP-${String(count + 1).padStart(5, "0")}`;

  // Prefer ready / allocated lines; fall back to all SO lines so queue is never empty
  let lineCreate = so.lines
    .filter(
      (l) =>
        l.quantityAllocated > l.quantityShipped ||
        l.fulfillmentStatus === "READY"
    )
    .map((l) => ({
      partId: l.partId,
      description: l.description,
      quantity: Math.max(
        0,
        (l.quantityAllocated || l.quantity) - l.quantityShipped
      ),
    }))
    .filter((l) => l.quantity > 0);

  if (!lineCreate.length) {
    lineCreate = so.lines.map((l) => ({
      partId: l.partId,
      description: l.description,
      quantity: Math.max(0, l.quantity - (l.quantityShipped || 0)),
    }));
  }

  const shipment = await prisma.shipment.create({
    data: {
      number,
      salesOrderId: so.id,
      status: shipCheck.ok ? "PICKING" : "DRAFT",
      shipToAddress:
        so.shipToAddress || `${so.customer.name} (address TBD)`,
      carrier: "TBD",
      notes: shipCheck.ok
        ? "Auto-created when FG became available"
        : `HOLD: ${shipCheck.reason}`,
      lines: {
        create: lineCreate,
      },
    },
    include: { lines: true },
  });

  await recordTrace({
    eventType: "SHIPMENT_CREATED",
    salesOrderId: so.id,
    shipmentId: shipment.id,
    notes: shipCheck.ok
      ? `Shipment ${number} queued for pick`
      : `Shipment ${number} held — ${shipCheck.reason}`,
    metadata: { allowEarlyShip: so.allowEarlyShip, shipNotBefore: so.shipNotBefore },
    userId: params.userId,
  });

  return { shipment, blocked: !shipCheck.ok, reason: shipCheck.reason };
}

/** Verify packing list before pack/ship. */
export async function verifyShipmentPackingList(params: {
  shipmentId: string;
  userId?: string;
}) {
  const s = await prisma.shipment.findUnique({
    where: { id: params.shipmentId },
    include: { salesOrder: { include: { lines: true, customer: true } }, lines: true },
  });
  if (!s) throw new Error("Shipment not found");
  if (["SHIPPED", "DELIVERED"].includes(s.status)) {
    throw new Error("Shipment already shipped");
  }
  return prisma.shipment.update({
    where: { id: s.id },
    data: {
      packingListVerified: true,
      verifiedAt: new Date(),
      verifiedById: params.userId,
      status: s.status === "DRAFT" ? "PICKING" : s.status === "PICKING" ? "VERIFIED" : s.status,
    },
  });
}

/** Pack shipment — requires verified packing list + pack photos. */
export async function packShipment(params: {
  shipmentId: string;
  packPhotos: { url: string; fileName?: string; caption?: string }[];
  userId?: string;
  notes?: string;
}) {
  const s = await prisma.shipment.findUnique({ where: { id: params.shipmentId } });
  if (!s) throw new Error("Shipment not found");
  if (!s.packingListVerified) {
    throw new Error("Verify packing list before packing");
  }
  if (!params.packPhotos?.length) {
    throw new Error("Attach pack photos before marking packed");
  }
  return prisma.shipment.update({
    where: { id: s.id },
    data: {
      status: "PACKED",
      packedAt: new Date(),
      packedById: params.userId,
      packPhotos: JSON.stringify(params.packPhotos),
      notes: params.notes || s.notes,
    },
  });
}

export async function shipSalesOrder(params: {
  salesOrderId: string;
  shipmentId?: string;
  carrier?: string;
  trackingNumber?: string;
  userId?: string;
  force?: boolean;
}) {
  const so = await prisma.salesOrder.findUnique({
    where: { id: params.salesOrderId },
    include: {
      lines: true,
      customer: true,
      shipments: { include: { lines: true } },
    },
  });
  if (!so) throw new Error("Sales order not found");

  const shipCheck = canShipNow(so);
  // Deposit is never force-bypassable; date gate can use force
  if (!shipCheck.ok) {
    if (shipCheck.code === "DEPOSIT" || !params.force) {
      throw new Error(shipCheck.reason || "Cannot ship yet");
    }
  }

  let shipment = params.shipmentId
    ? so.shipments.find((s) => s.id === params.shipmentId)
    : so.shipments.find((s) =>
        ["DRAFT", "PICKING", "VERIFIED", "PACKED"].includes(s.status)
      );

  if (shipment && shipment.status !== "PACKED" && !params.force) {
    throw new Error(
      "Pack the shipment (verify packing list + attach pack photos) before shipping"
    );
  }

  if (!shipment) {
    const created = await ensureShipmentForSalesOrder({
      salesOrderId: so.id,
      userId: params.userId,
    });
    if (!created.shipment) throw new Error("No shipment available");
    const loaded = await prisma.shipment.findUnique({
      where: { id: created.shipment.id },
      include: { lines: true },
    });
    if (!loaded) throw new Error("Shipment not found after create");
    shipment = loaded;
  }

  // Relieve committed / available FG inventory
  for (const line of so.lines) {
    if (!line.partId) continue;
    let toShip = line.quantity - line.quantityShipped;
    if (toShip <= 0) continue;

    // Prefer committed stock
    const committed = await prisma.inventoryItem.findMany({
      where: {
        partId: line.partId,
        OR: [{ quantityCommitted: { gt: 0 } }, { quantityAvailable: { gt: 0 } }],
      },
      include: { location: true },
      orderBy: { updatedAt: "asc" },
    });

    for (const item of committed) {
      if (toShip <= 0) break;
      const pool = item.quantityCommitted + item.quantityAvailable;
      const take = Math.min(pool, toShip);
      const fromCommit = Math.min(item.quantityCommitted, take);
      const fromAvail = take - fromCommit;

      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: {
          quantityOnHand: item.quantityOnHand - take,
          quantityCommitted: item.quantityCommitted - fromCommit,
          quantityAvailable: item.quantityAvailable - fromAvail,
        },
      });

      await prisma.materialTransaction.create({
        data: {
          type: "SHIP",
          partId: line.partId,
          inventoryItemId: item.id,
          salesOrderId: so.id,
          quantity: take,
          fromLocation: item.location.code,
          lotNumber: item.lotNumber,
          serialNumber: item.serialNumber,
          reference: shipment!.number,
          notes: `Shipped on ${so.number}`,
          userId: params.userId,
        },
      });

      await recordTrace({
        eventType: "SHIP",
        partId: line.partId,
        lotNumber: item.lotNumber,
        serialNumber: item.serialNumber,
        quantity: take,
        fromLocation: item.location.code,
        salesOrderId: so.id,
        shipmentId: shipment!.id,
        notes: `Shipped to customer`,
        userId: params.userId,
      });

      toShip -= take;
    }

    await prisma.salesOrderLine.update({
      where: { id: line.id },
      data: {
        quantityShipped: line.quantity,
        fulfillmentStatus: "SHIPPED",
      },
    });
  }

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      status: "SHIPPED",
      shipDate: new Date(),
      carrier: params.carrier || shipment.carrier || "FedEx Priority",
      trackingNumber:
        params.trackingNumber ||
        `1Z${Date.now().toString(36).toUpperCase()}`,
      packedById: params.userId,
    },
  });

  await prisma.salesOrder.update({
    where: { id: so.id },
    data: { status: "SHIPPED" },
  });

  // Shipping closes the revenue loop: raise the AR invoice and post
  // revenue / COGS journals automatically.
  {
    const { raiseArInvoiceForShipment } = await import(
      "@/lib/services/billing"
    );
    await raiseArInvoiceForShipment({
      salesOrderId: so.id,
      userId: params.userId,
    });
  }

  await logAudit({
    entityType: "SalesOrder",
    entityId: so.id,
    action: "SHIPPED",
    userId: params.userId,
    metadata: { shipmentId: shipment.id },
  });

  // FG kanban parts may need refill after ship
  await triggerKanbanReplenishment({
    userId: params.userId,
    partIds: so.lines.map((l) => l.partId).filter((id): id is string => !!id),
  });

  return prisma.shipment.findUnique({
    where: { id: shipment.id },
    include: { lines: true, salesOrder: true },
  });
}

/** Non-fatal kanban PR auto-create after stock moves. */
async function triggerKanbanReplenishment(params: {
  userId?: string;
  partIds?: string[];
}) {
  try {
    const { ensureKanbanReplenishmentPrs } = await import(
      "@/lib/services/kanban-replenishment"
    );
    await ensureKanbanReplenishmentPrs({
      userId: params.userId,
      partIds: params.partIds,
    });
  } catch (err) {
    console.error("Kanban replenishment PR auto-create failed:", err);
  }
}

// ─── Traveler aggregate ─────────────────────────────────────────

export async function getDigitalTraveler(workOrderId: string) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      part: true,
      bomHeader: {
        include: {
          lines: { include: { componentPart: true }, orderBy: { sortOrder: "asc" } },
        },
      },
      instructions: {
        include: {
          workInstruction: {
            include: { steps: { orderBy: { stepNumber: "asc" } } },
          },
        },
        orderBy: { sequence: "asc" },
      },
      stepCompletions: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
      kitOrders: {
        include: { lines: { include: { part: true } } },
        orderBy: { createdAt: "desc" },
      },
      purchaseRequests: { include: { lines: true }, orderBy: { createdAt: "desc" } },
      materialIssues: { orderBy: { createdAt: "desc" }, take: 50 },
      ncrs: true,
      inspections: true,
      salesOrder: { include: { customer: true } },
      salesOrderLine: true,
      assignee: true,
      createdBy: true,
      project: true,
      traceEvents: { orderBy: { createdAt: "asc" }, take: 100 },
    },
  });
  if (!wo) return null;

  const material = await checkBomMaterialAvailability(workOrderId);
  return { ...wo, materialCheck: material };
}

function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}
