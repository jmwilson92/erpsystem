import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EXPORT_JURISDICTIONS,
  JURISDICTION_LABELS,
  getExportSummary,
  getUsmlBreakdown,
  isExportControlled,
  listClassifiedParts,
  USML_CATEGORY_TITLES,
} from "@/lib/services/export-control";
import { actionClassifyPart } from "./actions";

export const dynamic = "force-dynamic";

const selectClass =
  "w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";
const th = "pb-2 text-left text-xs uppercase tracking-wide text-slate-500";

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export default async function ExportControlPage({
  searchParams,
}: {
  searchParams: Promise<{
    jurisdiction?: string;
    q?: string;
    error?: string;
    classified?: string;
  }>;
}) {
  const sp = await searchParams;
  const jurisdiction = sp.jurisdiction || "UNDETERMINED";
  const search = (sp.q || "").trim();

  const [summary, usml, parts] = await Promise.all([
    getExportSummary(),
    getUsmlBreakdown(),
    listClassifiedParts({ jurisdiction, search: search || undefined }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Export control"
        description="ITAR and EAR classification of the part catalogue"
      />

      {sp.error && (
        <div className="rounded-md border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {sp.error}
        </div>
      )}
      {sp.classified && !sp.error && (
        <div className="rounded-md border border-emerald-800/60 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">
          Classification recorded.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Active parts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-slate-100">{summary.total}</p>
          </CardContent>
        </Card>
        <Card className={summary.undetermined > 0 ? "border-amber-800/60" : undefined}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Not yet classified</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-semibold ${
                summary.undetermined > 0 ? "text-amber-300" : "text-slate-100"
              }`}
            >
              {summary.undetermined}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              nobody has ruled on these yet
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-slate-100">
              {pct(summary.coverage)}
            </p>
            <p className="mt-1 text-xs text-slate-500">of the active catalogue</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Controlled</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-slate-100">
              {summary.controlled}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              ITAR or a listed ECCN — EAR99 excluded
            </p>
          </CardContent>
        </Card>
      </div>

      {usml.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">USML categories in use</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Category</th>
                  <th className={th}>Title</th>
                  <th className={`${th} text-right`}>Parts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {usml.map((row) => (
                  <tr key={row.category}>
                    <td className="py-2 font-mono text-slate-200">{row.category}</td>
                    <td className="py-2 text-slate-400">{row.title}</td>
                    <td className="py-2 text-right text-slate-200">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {JURISDICTION_LABELS[jurisdiction] || "All parts"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-400">
              Jurisdiction
              <select
                name="jurisdiction"
                defaultValue={jurisdiction}
                className={`${selectClass} mt-1`}
              >
                <option value="ALL">All</option>
                {EXPORT_JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>
                    {JURISDICTION_LABELS[j]} ({summary.byJurisdiction[j]})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Search
              <Input
                name="q"
                defaultValue={search}
                placeholder="Part, ECCN, category"
                className="mt-1 w-56"
              />
            </label>
            <Button type="submit" variant="outline">
              Filter
            </Button>
          </form>

          {parts.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">
              No parts match. {jurisdiction === "UNDETERMINED" && "Nothing left unclassified in this view."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Part</th>
                    <th className={th}>Description</th>
                    <th className={th}>Current</th>
                    <th className={th}>Classify</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {parts.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 align-top font-mono">
                        <Link
                          href={`/items/${p.id}`}
                          className="text-sky-300 hover:underline"
                        >
                          {p.partNumber}
                        </Link>
                      </td>
                      <td className="max-w-xs py-2 align-top text-slate-300">
                        {p.description}
                      </td>
                      <td className="py-2 align-top">
                        <span
                          className={
                            isExportControlled(p)
                              ? "text-amber-300"
                              : p.exportJurisdiction === "UNDETERMINED"
                                ? "text-slate-500"
                                : "text-slate-300"
                          }
                        >
                          {p.exportJurisdiction === "ITAR"
                            ? `USML ${p.usmlCategory}`
                            : p.exportJurisdiction === "EAR"
                              ? p.eccn
                              : JURISDICTION_LABELS[p.exportJurisdiction]}
                        </span>
                        {p.exportClassifiedBy && (
                          <span className="block text-xs text-slate-500">
                            {p.exportClassifiedBy.name}
                          </span>
                        )}
                      </td>
                      <td className="py-2">
                        <form
                          action={actionClassifyPart}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <input type="hidden" name="partId" value={p.id} />
                          <input
                            type="hidden"
                            name="returnTo"
                            value="/export-control"
                          />
                          <select
                            name="jurisdiction"
                            defaultValue={p.exportJurisdiction}
                            className="w-40 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                          >
                            {EXPORT_JURISDICTIONS.map((j) => (
                              <option key={j} value={j}>
                                {JURISDICTION_LABELS[j]}
                              </option>
                            ))}
                          </select>
                          <Input
                            name="usmlCategory"
                            defaultValue={p.usmlCategory || ""}
                            placeholder="XI(c)"
                            className="h-7 w-24 text-xs"
                          />
                          <Input
                            name="eccn"
                            defaultValue={p.eccn || ""}
                            placeholder="9A610"
                            className="h-7 w-28 text-xs"
                          />
                          <Input
                            name="countryOfOrigin"
                            defaultValue={p.countryOfOrigin || ""}
                            placeholder="US"
                            className="h-7 w-14 text-xs"
                          />
                          <Button type="submit" variant="outline" size="sm">
                            Save
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500">
        USML categories:{" "}
        {Object.entries(USML_CATEGORY_TITLES)
          .slice(0, 6)
          .map(([k, v]) => `${k} ${v}`)
          .join(" · ")}{" "}
        …
      </p>
    </div>
  );
}
