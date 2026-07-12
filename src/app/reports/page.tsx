import Link from "next/link";
import { REPORT_CATALOG, runReport } from "@/lib/services/reports";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Landmark,
  Factory,
  FlaskConical,
  Users2,
  Download,
  FileBarChart,
} from "lucide-react";

export const dynamic = "force-dynamic";

const GROUP_ICON = {
  Financial: Landmark,
  Operations: Factory,
  Quality: FlaskConical,
  People: Users2,
} as const;

const GROUP_TONE: Record<string, string> = {
  Financial: "text-teal-400",
  Operations: "text-sky-400",
  Quality: "text-amber-400",
  People: "text-violet-400",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const viewKey = (Array.isArray(sp.view) ? sp.view[0] : sp.view) || "";
  const active = REPORT_CATALOG.find((r) => r.key === viewKey);
  const table = active ? await runReport(active.key) : null;

  const groups = ["Financial", "Operations", "Quality", "People"] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Run any report on screen, download as CSV for Excel, or print. Live data, no setup."
      />

      <div className="grid gap-4 lg:grid-cols-4">
        {groups.map((g) => {
          const Icon = GROUP_ICON[g];
          return (
            <Card key={g}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Icon className={`h-4 w-4 ${GROUP_TONE[g]}`} />
                  {g}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {REPORT_CATALOG.filter((r) => r.group === g).map((r) => (
                  <div
                    key={r.key}
                    className={`rounded-lg border px-2.5 py-2 transition-colors ${
                      viewKey === r.key
                        ? "border-teal-500/50 bg-teal-500/10"
                        : "border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <Link href={`/reports?view=${r.key}`} className="block">
                      <p className="text-sm text-slate-200">{r.title}</p>
                      <p className="text-[11px] leading-tight text-slate-500">
                        {r.description}
                      </p>
                    </Link>
                    <a
                      href={`/reports/export?key=${r.key}`}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-sky-400 hover:underline"
                    >
                      <Download className="h-3 w-3" /> CSV
                    </a>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {table && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileBarChart className="h-4 w-4 text-teal-400" />
              {table.title}
              <span className="text-xs font-normal text-slate-500">
                {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
              </span>
            </CardTitle>
            <Button asChild size="sm" variant="outline">
              <a href={`/reports/export?key=${active!.key}`}>
                <Download className="mr-1 h-3.5 w-3.5" /> Download CSV
              </a>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
                    {table.columns.map((c) => (
                      <th key={c} className="px-2 py-1.5">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-slate-800/50 hover:bg-slate-900/40"
                    >
                      {row.map((cell, j) => (
                        <td
                          key={j}
                          className={`px-2 py-1 ${
                            typeof cell === "number"
                              ? "text-right tabular-nums text-slate-300"
                              : "text-slate-400"
                          }`}
                        >
                          {typeof cell === "number"
                            ? cell.toLocaleString()
                            : cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {table.rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={table.columns.length}
                        className="px-2 py-4 text-center text-slate-500"
                      >
                        No data for this report yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!table && (
        <p className="text-center text-sm text-slate-500">
          Pick a report above to run it on screen.
        </p>
      )}
    </div>
  );
}
