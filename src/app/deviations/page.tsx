import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { prisma } from "@/lib/db";
import { actionCreateDeviation } from "./actions";
import {
  DEVIATION_KINDS,
  DEVIATION_STATUSES,
  FORCE_LABELS,
  forceState,
  getDeviationSummary,
  KIND_LABELS,
  listDeviations,
} from "@/lib/services/deviations";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";
const th = "pb-2 text-left text-xs uppercase tracking-wide text-slate-500";

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

export default async function DeviationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    status?: string;
    q?: string;
    error?: string;
  }>;
}) {
  const sp = await searchParams;
  const kind = sp.kind || "ALL";
  const status = sp.status || "ALL";
  const search = (sp.q || "").trim();

  const [summary, rows, parts, contracts, ncrs] = await Promise.all([
    getDeviationSummary(),
    listDeviations({ kind, status, search: search || undefined }),
    prisma.part
      .findMany({ orderBy: { partNumber: "asc" }, take: 500 })
      .catch(() => []),
    prisma.contract
      .findMany({ orderBy: { number: "asc" }, take: 200 })
      .catch(() => []),
    prisma.nonConformance
      .findMany({ orderBy: { createdAt: "desc" }, take: 100 })
      .catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deviations & waivers"
        description="Bounded authorisation to depart from a requirement"
      />

      {sp.error && (
        <div className="rounded-md border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {sp.error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">In force</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-emerald-300">
              {summary.inForce}
            </p>
            <p className="mt-1 text-xs text-slate-500">approved and still usable</p>
          </CardContent>
        </Card>
        <Card className={summary.lapsed > 0 ? "border-amber-800/60" : undefined}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Lapsed</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-semibold ${
                summary.lapsed > 0 ? "text-amber-300" : "text-slate-100"
              }`}
            >
              {summary.lapsed}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              expired or exhausted, still cited by habit
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Awaiting approval</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-slate-100">
              {summary.awaiting}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Split</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-slate-100">
              {summary.deviations} / {summary.waivers}
            </p>
            <p className="mt-1 text-xs text-slate-500">deviations / waivers</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-400">
              Kind
              <select name="kind" defaultValue={kind} className={selectClass}>
                <option value="ALL">All</option>
                {DEVIATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Status
              <select name="status" defaultValue={status} className={selectClass}>
                <option value="ALL">All</option>
                {DEVIATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Search
              <Input
                name="q"
                defaultValue={search}
                placeholder="Number, title, requirement"
                className="mt-1 w-56"
              />
            </label>
            <Button type="submit" variant="outline">
              Filter
            </Button>
          </form>

          {rows.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">Nothing on the register.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Number</th>
                    <th className={th}>Kind</th>
                    <th className={th}>Title</th>
                    <th className={th}>Part</th>
                    <th className={th}>Bounds</th>
                    <th className={th}>Status</th>
                    <th className={th}>In force</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {rows.map((d) => {
                    const state = forceState(d);
                    return (
                      <tr key={d.id}>
                        <td className="py-2 font-mono">
                          <Link
                            href={`/deviations/${d.id}`}
                            className="text-sky-300 hover:underline"
                          >
                            {d.number}
                          </Link>
                        </td>
                        <td className="py-2 text-slate-400">{d.kind}</td>
                        <td className="py-2 text-slate-300">{d.title}</td>
                        <td className="py-2 font-mono text-slate-400">
                          {d.part?.partNumber || "—"}
                        </td>
                        <td className="py-2 text-xs text-slate-400">
                          {[
                            d.quantityLimit != null
                              ? `${d.quantityUsed}/${d.quantityLimit} units`
                              : null,
                            d.effectiveTo ? `to ${fmtDate(d.effectiveTo)}` : null,
                            d.units.length ? `${d.units.length} listed` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || (
                            <span className="text-rose-300">unbounded</span>
                          )}
                        </td>
                        <td className="py-2 text-slate-300">{d.status}</td>
                        <td className="py-2">
                          <span
                            className={
                              state === "IN_FORCE"
                                ? "text-emerald-300"
                                : state === "EXPIRED" || state === "EXHAUSTED"
                                  ? "text-amber-300"
                                  : "text-slate-500"
                            }
                          >
                            {FORCE_LABELS[state]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request a departure</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionCreateDeviation} className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm text-slate-400">
              Kind
              <select name="kind" className={selectClass} defaultValue="DEVIATION">
                {DEVIATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400 sm:col-span-3">
              Title *
              <Input name="title" required placeholder="Substitute connector shell" />
            </label>
            <label className="text-sm text-slate-400 sm:col-span-2">
              Requirement departed from *
              <Input
                name="requirement"
                required
                placeholder="Drawing 12345 note 4 / ATP para 3.2"
              />
            </label>
            <label className="text-sm text-slate-400">
              Part
              <select name="partId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Contract
              <select name="contractId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.number}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400 sm:col-span-2">
              Description
              <Textarea name="description" rows={2} />
            </label>
            <label className="text-sm text-slate-400 sm:col-span-2">
              Justification
              <Textarea
                name="justification"
                rows={2}
                placeholder="Why this is acceptable — form, fit, function, safety"
              />
            </label>
            <label className="text-sm text-slate-400">
              Originating NCR
              <select name="nonConformanceId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {ncrs.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.number}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Quantity limit
              <Input name="quantityLimit" type="number" min="1" placeholder="25" />
            </label>
            <label className="text-sm text-slate-400">
              Effective from
              <Input name="effectiveFrom" type="date" />
            </label>
            <label className="text-sm text-slate-400">
              Effective to
              <Input name="effectiveTo" type="date" />
            </label>
            <label className="text-sm text-slate-400">
              Customer approval
              <select
                name="customerApprovalRequired"
                className={selectClass}
                defaultValue="1"
              >
                <option value="1">Required</option>
                <option value="0">Not required</option>
              </select>
            </label>
            <div className="sm:col-span-3 sm:self-end">
              <Button type="submit">Create request</Button>
              <span className="ml-3 text-xs text-slate-500">
                Bounds can be added before approval — an unbounded request cannot
                be approved.
              </span>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
