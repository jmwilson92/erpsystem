import { NextRequest, NextResponse } from "next/server";
import { runCustomReport } from "@/lib/services/report-builder";
import { toCsv } from "@/lib/services/reports";
import { requireApiPermission } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { error } = await requireApiPermission("accounting.reports.read");
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  try {
    const table = await runCustomReport({
      entity: sp.get("entity") || "",
      cols: sp.getAll("cols"),
      status: sp.get("status") || undefined,
      from: sp.get("from") || undefined,
      to: sp.get("to") || undefined,
      sort: sp.get("sort") || undefined,
      dir: sp.get("dir") === "desc" ? "desc" : "asc",
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(
      toCsv({ title: table.title, columns: table.columns, rows: table.rows }),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="custom-${sp.get("entity")}-${stamp}.csv"`,
        },
      }
    );
  } catch {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }
}
