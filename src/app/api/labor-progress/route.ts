import { NextRequest, NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/api-auth";
import {
  laborProgressToCsv,
  readLaborProgress,
  summarizeLaborProgressForCarina,
} from "@/lib/services/labor-progress";

export const dynamic = "force-dynamic";

/** Read service for labor progress (WO / project / budget / report). Carina-safe. */
export async function GET(req: NextRequest) {
  const { error } = await requireApiPermission("work-orders.view");
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  try {
    const result = await readLaborProgress({
      workOrderId: sp.get("workOrderId"),
      workOrderNumber: sp.get("workOrderNumber") || sp.get("wo"),
      projectId: sp.get("projectId"),
      projectNumber: sp.get("projectNumber") || sp.get("project"),
      budgetId: sp.get("budgetId"),
      from: sp.get("from") ? new Date(sp.get("from")!) : null,
      to: sp.get("to") ? new Date(sp.get("to")!) : null,
    });
    if (sp.get("format") === "csv" && result.kind !== "work_order") {
      const rollup = result.rollup;
      return new NextResponse(laborProgressToCsv(rollup), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="labor-progress.csv"`,
        },
      });
    }
    if (sp.get("format") === "text") {
      return new NextResponse(summarizeLaborProgressForCarina(result), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return NextResponse.json({
      ok: true,
      summary: summarizeLaborProgressForCarina(result),
      result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Labor progress lookup failed";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
