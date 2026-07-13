import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

function toCsv(columns: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    columns.join(","),
    ...rows.map((r) => r.map(esc).join(",")),
  ].join("\n");
}

/** In-module CSV export for supply-chain data. Permission-gated. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entity = req.nextUrl.searchParams.get("entity") || "";
  let columns: string[] = [];
  let rows: (string | number | null)[][] = [];
  const filename = entity;

  if (entity === "parts") {
    if (!(await userHasPermission(user.id, "items.view")) && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const parts = await prisma.part.findMany({ orderBy: { partNumber: "asc" } });
    columns = [
      "partNumber", "description", "uom", "partType", "sourcingMethod",
      "standardCost", "leadTimeDays", "minStock", "maxStock", "isActive",
    ];
    rows = parts.map((p) => [
      p.partNumber, p.description, p.uom, p.partType, p.sourcingMethod,
      p.standardCost, p.leadTimeDays, p.minStock, p.maxStock, p.isActive ? "true" : "false",
    ]);
  } else if (entity === "inventory") {
    if (!(await userHasPermission(user.id, "inventory.view")) && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const items = await prisma.inventoryItem.findMany({
      include: { part: true, location: { include: { warehouse: true } } },
      orderBy: [{ part: { partNumber: "asc" } }],
    });
    columns = [
      "partNumber", "description", "warehouse", "location", "lotNumber",
      "serialNumber", "quantityOnHand", "quantityAvailable", "unitCost", "ownership",
    ];
    rows = items.map((i) => [
      i.part.partNumber, i.part.description, i.location.warehouse.code,
      i.location.code, i.lotNumber, i.serialNumber, i.quantityOnHand,
      i.quantityAvailable, i.unitCost, i.ownership,
    ]);
  } else if (entity === "suppliers") {
    if (!(await userHasPermission(user.id, "suppliers.view")) && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
    columns = ["name", "code", "status", "contactName", "contactEmail", "paymentTerms", "onTimeDeliveryPct", "rating"];
    rows = suppliers.map((s) => [
      s.name, s.code, s.status, s.contactName, s.contactEmail, s.paymentTerms,
      s.onTimeDeliveryPct, s.rating,
    ]);
  } else {
    return NextResponse.json({ error: "Unknown entity" }, { status: 404 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(columns, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}-${stamp}.csv"`,
    },
  });
}
