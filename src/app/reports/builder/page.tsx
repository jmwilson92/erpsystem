import Link from "next/link";
import {
  BUILDER_ENTITIES,
  runCustomReport,
} from "@/lib/services/report-builder";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Printer, Hammer } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

function pick(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string {
  const v = sp[key];
  return Array.isArray(v) ? v[0] || "" : v || "";
}
function pickAll(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string[] {
  const v = sp[key];
  return Array.isArray(v) ? v : v ? [v] : [];
}

export default async function ReportBuilderPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const entityKey = pick(sp, "entity");
  const cols = pickAll(sp, "cols");
  const status = pick(sp, "status");
  const from = pick(sp, "from");
  const to = pick(sp, "to");
  const sort = pick(sp, "sort");
  const dir = pick(sp, "dir") === "desc" ? "desc" : "asc";

  const entity = BUILDER_ENTITIES.find((e) => e.key === entityKey) || null;
  const result = entity
    ? await runCustomReport({ entity: entity.key, cols, status, from, to, sort, dir })
    : null;

  // Query string for CSV / print links (mirror current selection)
  const qs = new URLSearchParams();
  if (entity) {
    qs.set("entity", entity.key);
    for (const c of cols) qs.append("cols", c);
    if (status) qs.set("status", status);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (sort) qs.set("sort", sort);
    if (dir) qs.set("dir", dir);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custom report builder"
        description="Pick a dataset, choose columns, filter, sort — then export CSV or print. No SQL, no setup."
        actions={
          <Link href="/reports">
            <Button size="sm" variant="outline">
              Reports Center
            </Button>
          </Link>
        }
      />

      <Card className="border-teal-900/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Hammer className="h-4 w-4 text-teal-400" />
            Build
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action="/reports/builder" className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-500">
                Dataset
                <select
                  name="entity"
                  required
                  className={`${selectClass} mt-1 block`}
                  defaultValue={entityKey}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {BUILDER_ENTITIES.map((e) => (
                    <option key={e.key} value={e.key}>
                      {e.title}
                    </option>
                  ))}
                </select>
              </label>
              {entity && (
                <>
                  <label className="text-xs text-slate-500">
                    Status
                    <select
                      name="status"
                      className={`${selectClass} mt-1 block`}
                      defaultValue={status}
                    >
                      <option value="">Any</option>
                      {(entity.statuses || []).map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-slate-500">
                    {entity.dateLabel} from
                    <Input
                      name="from"
                      type="date"
                      defaultValue={from}
                      className="mt-1 h-9 w-36"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    to
                    <Input
                      name="to"
                      type="date"
                      defaultValue={to}
                      className="mt-1 h-9 w-36"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    Sort by
                    <select
                      name="sort"
                      className={`${selectClass} mt-1 block`}
                      defaultValue={sort}
                    >
                      <option value="">—</option>
                      {entity.columns.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-slate-500">
                    Direction
                    <select
                      name="dir"
                      className={`${selectClass} mt-1 block`}
                      defaultValue={dir}
                    >
                      <option value="asc">A → Z / low → high</option>
                      <option value="desc">Z → A / high → low</option>
                    </select>
                  </label>
                </>
              )}
              <Button type="submit" size="sm" className="h-9">
                {entity ? "Run report" : "Load columns"}
              </Button>
            </div>

            {entity && (
              <div className="border-t border-slate-800 pt-3">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Columns (none checked = all)
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {entity.columns.map((c) => (
                    <label
                      key={c.key}
                      className="flex items-center gap-1.5 text-sm text-slate-300"
                    >
                      <input
                        type="checkbox"
                        name="cols"
                        value={c.key}
                        defaultChecked={cols.includes(c.key)}
                        className="accent-teal-500"
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">
              {result.title}
              <span className="ml-2 text-xs font-normal text-slate-500">
                {result.rows.length} row(s)
              </span>
            </CardTitle>
            <div className="flex gap-2">
              <a href={`/reports/builder/export?${qs.toString()}`}>
                <Button size="sm" variant="outline">
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
              </a>
              <Link href={`/print/report?${qs.toString()}`} target="_blank">
                <Button size="sm" variant="outline">
                  <Printer className="h-3.5 w-3.5" /> Print
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-[10px] uppercase text-slate-500">
                    {result.colDefs.map((c) => (
                      <th
                        key={c.key}
                        className={`pb-2 pr-3 ${c.numeric ? "text-right" : ""}`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 500).map((r, i) => (
                    <tr key={i} className="border-b border-slate-800/50">
                      {r.map((v, j) => (
                        <td
                          key={j}
                          className={`py-1.5 pr-3 ${
                            result.colDefs[j]?.numeric
                              ? "text-right tabular-nums"
                              : ""
                          }`}
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {result.rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={result.columns.length}
                        className="py-6 text-center text-slate-500"
                      >
                        No rows match the filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
