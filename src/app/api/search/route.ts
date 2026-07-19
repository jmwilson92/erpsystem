import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export type SearchHit = {
  type: string;
  label: string;
  sublabel: string;
  href: string;
};

const PER_TYPE = 5;

/**
 * Global record search for the ⌘K palette. SQLite LIKE is
 * case-insensitive for ASCII, so `contains` matches naturally.
 */
export async function GET(req: NextRequest) {
  const { requireApiUser, unauthorized } = await import("@/lib/api-auth");
  const user = await requireApiUser();
  if (!user) return unauthorized();

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const [
    workOrders,
    pos,
    sos,
    quotes,
    parts,
    customers,
    suppliers,
    people,
    projects,
    shipments,
    travelers,
    boms,
    wis,
    serials,
    rmas,
  ] = await Promise.all([
    prisma.workOrder.findMany({
      where: {
        OR: [{ number: { contains: q } }, { description: { contains: q } }],
      },
      include: { part: { select: { partNumber: true } } },
      take: PER_TYPE,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.purchaseOrder.findMany({
      where: { number: { contains: q } },
      include: { supplier: { select: { name: true } } },
      take: PER_TYPE,
    }),
    prisma.salesOrder.findMany({
      where: { number: { contains: q } },
      include: { customer: { select: { name: true } } },
      take: PER_TYPE,
    }),
    prisma.quote.findMany({
      where: { number: { contains: q } },
      include: { customer: { select: { name: true } } },
      take: PER_TYPE,
    }),
    prisma.part.findMany({
      where: {
        OR: [
          { partNumber: { contains: q } },
          { description: { contains: q } },
        ],
      },
      take: PER_TYPE,
    }),
    prisma.customer.findMany({
      where: { name: { contains: q } },
      take: PER_TYPE,
    }),
    prisma.supplier.findMany({
      where: {
        OR: [{ name: { contains: q } }, { code: { contains: q } }],
      },
      take: PER_TYPE,
    }),
    prisma.user.findMany({
      where: { isActive: true, name: { contains: q } },
      take: PER_TYPE,
    }),
    prisma.project.findMany({
      where: {
        OR: [{ number: { contains: q } }, { name: { contains: q } }],
      },
      take: PER_TYPE,
    }),
    prisma.shipment.findMany({
      where: { number: { contains: q } },
      take: PER_TYPE,
    }),
    prisma.receivingTraveler.findMany({
      where: { number: { contains: q } },
      take: PER_TYPE,
    }),
    prisma.bomHeader.findMany({
      where: { part: { partNumber: { contains: q } } },
      include: { part: { select: { partNumber: true, description: true } } },
      take: PER_TYPE,
    }),
    prisma.workInstruction.findMany({
      where: {
        OR: [{ documentNumber: { contains: q } }, { title: { contains: q } }],
      },
      take: PER_TYPE,
    }),
    prisma.serialNumber.findMany({
      where: {
        OR: [
          { serial: { contains: q.toUpperCase() } },
          { lotNumber: { contains: q } },
        ],
      },
      include: { part: { select: { partNumber: true } } },
      take: PER_TYPE,
    }),
    prisma.rma.findMany({
      where: {
        OR: [
          { number: { contains: q } },
          { customerSn: { contains: q.toUpperCase() } },
        ],
      },
      include: { customer: { select: { name: true } } },
      take: PER_TYPE,
    }),
  ]);

  const hits: SearchHit[] = [
    ...workOrders.map((w) => ({
      type: "Work order",
      label: w.number,
      sublabel: `${w.part?.partNumber || w.type} · ${w.status.replace(/_/g, " ")}`,
      href: `/work-orders/${w.id}`,
    })),
    ...serials.map((s) => ({
      type: "Serial",
      label: s.serial,
      sublabel: `${s.part.partNumber} · ${s.status}`,
      href: `/trace/serials/${encodeURIComponent(s.serial)}`,
    })),
    ...rmas.map((r) => ({
      type: "RMA",
      label: r.number,
      sublabel: `${r.customer.name} · ${r.customerSn} · ${r.status}`,
      href: `/rma/${r.id}`,
    })),
    ...sos.map((s) => ({
      type: "Sales order",
      label: s.number,
      sublabel: `${s.customer.name} · ${s.status.replace(/_/g, " ")}`,
      href: `/sales/${s.id}`,
    })),
    ...pos.map((p) => ({
      type: "Purchase order",
      label: p.number,
      sublabel: `${p.supplier.name} · ${p.status.replace(/_/g, " ")}`,
      href: `/purchasing/po/${p.id}`,
    })),
    ...quotes.map((qt) => ({
      type: "Quote",
      label: qt.number,
      sublabel: `${qt.customer?.name || ""} · ${qt.status.replace(/_/g, " ")}`,
      href: `/sales/quotes/${qt.id}`,
    })),
    ...parts.map((p) => ({
      type: "Part",
      label: p.partNumber,
      sublabel: p.description,
      href: `/items/${p.id}`,
    })),
    ...boms.map((b) => ({
      type: "BOM",
      label: `${b.part.partNumber} Rev ${b.revision}`,
      sublabel: `${b.part.description} · ${b.status}`,
      href: `/bom/${b.id}`,
    })),
    ...customers.map((c) => ({
      type: "Customer",
      label: c.name,
      sublabel: c.code || "Customer",
      href: `/customers/${c.id}`,
    })),
    ...suppliers.map((s) => ({
      type: "Supplier",
      label: s.name,
      sublabel: `${s.code} · ${s.rating || ""}`,
      href: `/suppliers/${s.id}`,
    })),
    ...people.map((u) => ({
      type: "Person",
      label: u.name,
      sublabel: `${u.title || u.role}${u.department ? ` · ${u.department}` : ""}`,
      href: `/hr/person/${u.id}`,
    })),
    ...projects.map((p) => ({
      type: "Project",
      label: p.number,
      sublabel: p.name,
      href: `/projects/${p.id}`,
    })),
    ...shipments.map((s) => ({
      type: "Shipment",
      label: s.number,
      sublabel: s.status.replace(/_/g, " "),
      href: `/shipping/${s.id}`,
    })),
    ...travelers.map((t) => ({
      type: "Receiving",
      label: t.number,
      sublabel: t.status.replace(/_/g, " "),
      href: `/receiving/${t.id}`,
    })),
    ...wis.map((w) => ({
      type: "Work instruction",
      label: w.documentNumber,
      sublabel: w.title,
      href: `/work-instructions/${w.id}`,
    })),
  ].slice(0, 25);

  return NextResponse.json({ hits });
}
