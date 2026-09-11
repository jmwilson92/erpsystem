/**
 * Traceability — full genealogy for any record.
 */
import { prisma } from "@/lib/db";

export type MaterialGenealogyRow = {
  partId: string;
  partNumber: string;
  description: string;
  lotNumber: string | null;
  quantity: number;
  kitNumber: string;
  kitStatus: string;
  poId: string | null;
  poNumber: string | null;
  supplier: string | null;
  receiptNumber: string | null;
  receivedAt: Date | null;
  inspections: { number: string; type: string; status: string }[];
  useAsIs: boolean;
  useAsIsNote: string | null;
};

export async function getWoMaterialGenealogy(
  workOrderId: string
): Promise<MaterialGenealogyRow[]> {
  const kits = await prisma.kitOrder.findMany({
    where: { workOrderId },
    include: { lines: { include: { part: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (kits.length === 0) return [];

  const lots = [
    ...new Set(
      kits.flatMap((k) => k.lines.map((l) => l.lotNumber)).filter((x): x is string => !!x)
    ),
  ];
  const partIds = [...new Set(kits.flatMap((k) => k.lines.map((l) => l.partId)))];

  const [receiptLines, inspections, uaiDispositions] = await Promise.all([
    prisma.receiptLine.findMany({
      where: {
        OR: [
          ...(lots.length ? [{ lotNumber: { in: lots } }] : []),
          { partId: { in: partIds }, lotNumber: null },
        ],
      },
      include: {
        receipt: {
          include: {
            purchaseOrder: {
              select: { id: true, number: true, supplier: { select: { name: true } } },
            },
          },
        },
      },
    }),
    prisma.inspection.findMany({
      where: lots.length ? { lotNumber: { in: lots } } : { id: "__none__" },
      select: { number: true, type: true, status: true, lotNumber: true, partId: true },
    }),
    lots.length
      ? prisma.mrbDisposition.findMany({
          where: {
            disposition: "USE_AS_IS",
            mrbCase: { ncr: { lotNumber: { in: lots } } },
          },
          select: {
            justification: true,
            mrbCase: { select: { number: true, ncr: { select: { lotNumber: true, number: true } } } },
          },
        })
      : Promise.resolve([]),
  ]);

  const rows: MaterialGenealogyRow[] = [];
  for (const kit of kits) {
    for (const line of kit.lines) {
      const rl = line.lotNumber
        ? receiptLines.find((r) => r.lotNumber === line.lotNumber) || null
        : null;
      const insp = line.lotNumber
        ? inspections.filter((i) => i.lotNumber === line.lotNumber)
        : [];
      const uai = line.lotNumber
        ? uaiDispositions.find((d) => d.mrbCase.ncr.lotNumber === line.lotNumber)
        : undefined;
      rows.push({
        partId: line.partId,
        partNumber: line.part.partNumber,
        description: line.part.description,
        lotNumber: line.lotNumber,
        quantity: line.quantityPicked || line.quantityRequired,
        kitNumber: kit.number,
        kitStatus: kit.status,
        poId: rl?.receipt.purchaseOrder?.id || null,
        poNumber: rl?.receipt.purchaseOrder?.number || null,
        supplier: rl?.receipt.purchaseOrder?.supplier?.name || null,
        receiptNumber: rl?.receipt.number || null,
        receivedAt: rl?.receipt.receivedAt || null,
        inspections: insp.map((i) => ({ number: i.number, type: i.type, status: i.status })),
        useAsIs: !!uai,
        useAsIsNote: uai
          ? `${uai.mrbCase.number} USE AS IS${uai.justification ? ` — ${uai.justification}` : ""}`
          : null,
      });
    }
  }
  return rows;
}

export type TraceChainEvent = {
  id: string;
  at: Date;
  eventType: string;
  partNumber: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  quantity: number | null;
  from: string | null;
  to: string | null;
  notes: string | null;
  links: { label: string; href: string }[];
};

export async function getTraceChain(params: {
  workOrderId?: string;
  salesOrderId?: string;
  kitOrderId?: string;
  purchaseOrderId?: string;
  shipmentId?: string;
  lotNumbers?: string[];
  limit?: number;
}): Promise<TraceChainEvent[]> {
  const or: object[] = [];
  if (params.workOrderId) or.push({ workOrderId: params.workOrderId });
  if (params.salesOrderId) or.push({ salesOrderId: params.salesOrderId });
  if (params.kitOrderId) or.push({ kitOrderId: params.kitOrderId });
  if (params.purchaseOrderId) or.push({ purchaseOrderId: params.purchaseOrderId });
  if (params.shipmentId) or.push({ shipmentId: params.shipmentId });
  if (params.lotNumbers?.length) or.push({ lotNumber: { in: params.lotNumbers } });
  if (or.length === 0) return [];

  const events = await prisma.traceEvent.findMany({
    where: { OR: or },
    include: {
      part: { select: { partNumber: true } },
      workOrder: { select: { id: true, number: true } },
      salesOrder: { select: { id: true, number: true } },
      kitOrder: { select: { id: true, number: true } },
      shipment: { select: { id: true, number: true } },
    },
    orderBy: { createdAt: "asc" },
    take: params.limit || 120,
  });

  const poIds = [...new Set(events.map((e) => e.purchaseOrderId).filter((x): x is string => !!x))];
  const pos = poIds.length
    ? await prisma.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, number: true } })
    : [];
  const poNumById = Object.fromEntries(pos.map((p) => [p.id, p.number]));

  return events.map((e) => {
    const links: { label: string; href: string }[] = [];
    if (e.workOrder) links.push({ label: e.workOrder.number, href: `/work-orders/${e.workOrder.id}` });
    if (e.salesOrder) links.push({ label: e.salesOrder.number, href: `/sales/${e.salesOrder.id}` });
    if (e.kitOrder) links.push({ label: e.kitOrder.number, href: "/kitting" });
    if (e.purchaseOrderId) links.push({ label: poNumById[e.purchaseOrderId] || "PO", href: `/purchasing/po/${e.purchaseOrderId}` });
    if (e.shipment) links.push({ label: e.shipment.number, href: "/shipping" });
    return {
      id: e.id,
      at: e.createdAt,
      eventType: e.eventType,
      partNumber: e.part?.partNumber || null,
      lotNumber: e.lotNumber,
      serialNumber: e.serialNumber,
      quantity: e.quantity,
      from: e.fromLocation,
      to: e.toLocation,
      notes: e.notes,
      links,
    };
  });
}
