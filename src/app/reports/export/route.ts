import { NextRequest, NextResponse } from "next/server";
import { runReport, toCsv, REPORT_CATALOG } from "@/lib/services/reports";
import { requireApiPermission } from "@/lib/api-auth";
import { laborProgressToCsv, queryLaborProgressReport } from "@/lib/services/labor-progress";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { error } = await requireApiPermission("accounting.reports.read");
  if (error) return error;

  const key = req.nextUrl.searchParams.get("key") || "";
  const known = REPORT_CATALOG.find((r) => r.key === key);
  if (!known) {
    return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  }
  const sp = req.nextUrl.searchParams;
  const filters = {
    projectId: sp.get("projectId") || undefined,
    budgetId: sp.get("budgetId") || undefined,
    from: sp.get("from") ? new Date(sp.get("from")!) : undefined,
    to: sp.get("to") ? new Date(sp.get("to")!) : undefined,
    includeCompleted: sp.get("includeCompleted") === "1",
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${key}-${stamp}.csv`;
  let csv: string;
  if (key === "labor-progress") {
    const rollup = await queryLaborProgressReport(filters);
    csv = laborProgressToCsv(rollup);
  } else {
    csv = toCsv(await runReport(key, filters));
  }
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
