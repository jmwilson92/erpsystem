import { NextRequest, NextResponse } from "next/server";
import { runReport, toCsv, REPORT_CATALOG } from "@/lib/services/reports";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") || "";
  const known = REPORT_CATALOG.find((r) => r.key === key);
  if (!known) {
    return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  }
  const table = await runReport(key);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${key}-${stamp}.csv`;
  return new NextResponse(toCsv(table), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
