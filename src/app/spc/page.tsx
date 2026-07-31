import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { analyse, listCharacteristics } from "@/lib/services/spc";
import { actionUpsertCharacteristic } from "./actions";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";
const th = "pb-2 text-left text-xs uppercase tracking-wide text-slate-500";

function fmt(n: number | null | undefined, dp = 3) {
  return n == null ? "—" : n.toFixed(dp);
}

/** Verdict wording follows the usual thresholds without pretending precision. */
function capabilityVerdict(cpk: number | null) {
  if (cpk == null) return { label: "No index", tone: "text-slate-500" };
  if (cpk < 1) return { label: "Incapable", tone: "text-rose-300" };
  if (cpk < 1.33) return { label: "Marginal", tone: "text-amber-300" };
  return { label: "Capable", tone: "text-emerald-300" };
}

/**
 * Control chart as inline SVG. Spec limits are drawn dashed and in a different
 * colour from the control limits, and labelled as such, because conflating the
 * two is the mistake the chart exists to prevent.
 */
function Chart({
  points,
  centerLine,
  ucl,
  lcl,
  usl,
  lsl,
  violationIndexes,
}: {
  points: number[];
  centerLine: number;
  ucl: number;
  lcl: number;
  usl?: number | null;
  lsl?: number | null;
  violationIndexes: Set<number>;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-slate-500">No measurements yet.</p>;
  }

  const w = 720;
  const h = 260;
  const pad = { l: 56, r: 16, t: 16, b: 28 };
  const candidates = [...points, ucl, lcl, centerLine];
  if (usl != null) candidates.push(usl);
  if (lsl != null) candidates.push(lsl);
  let min = Math.min(...candidates);
  let max = Math.max(...candidates);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;

  const x = (i: number) =>
    pad.l +
    (points.length === 1
      ? (w - pad.l - pad.r) / 2
      : (i / (points.length - 1)) * (w - pad.l - pad.r));
  const y = (v: number) =>
    pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);

  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p)}`).join(" ");

  const line = (
    v: number,
    stroke: string,
    label: string,
    dash?: string
  ) => (
    <g key={label}>
      <line
        x1={pad.l}
        x2={w - pad.r}
        y1={y(v)}
        y2={y(v)}
        stroke={stroke}
        strokeWidth="1"
        strokeDasharray={dash}
      />
      <text x={4} y={y(v) + 4} fontSize="10" fill={stroke}>
        {label}
      </text>
    </g>
  );

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h} role="img" aria-label="Control chart">
        <rect x={0} y={0} width={w} height={h} fill="transparent" />
        {lsl != null && line(lsl, "#f59e0b", "LSL", "6 3")}
        {usl != null && line(usl, "#f59e0b", "USL", "6 3")}
        {line(lcl, "#f87171", "LCL")}
        {line(ucl, "#f87171", "UCL")}
        {line(centerLine, "#64748b", "CL")}
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="1.5" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p)}
            r={violationIndexes.has(i) ? 4 : 2.5}
            fill={violationIndexes.has(i) ? "#f43f5e" : "#38bdf8"}
          />
        ))}
      </svg>
      <p className="mt-2 text-xs text-slate-500">
        Solid red is the control limit, computed from the process itself. Dashed
        amber is the drawing tolerance. They are unrelated: a process can sit
        inside tolerance and still be out of control, and a stable process can
        be incapable.
      </p>
    </div>
  );
}

export default async function SpcPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; error?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const [characteristics, parts] = await Promise.all([
    listCharacteristics(),
    prisma.part.findMany({ orderBy: { partNumber: "asc" }, take: 500 }).catch(() => []),
  ]);

  const selectedId = sp.id || characteristics[0]?.id;
  const result = selectedId ? await analyse(selectedId) : null;
  const verdict = capabilityVerdict(result?.capability.cpk ?? null);
  const violationIndexes = new Set((result?.violations || []).map((v) => v.index));

  return (
    <div className="space-y-6">
      <PageHeader
        title="SPC"
        description="Control charts and process capability over recorded inspection measurements"
      />

      {sp.error && (
        <div className="rounded-md border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {sp.error}
        </div>
      )}
      {sp.saved && !sp.error && (
        <div className="rounded-md border border-emerald-800/60 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">
          Saved.
        </div>
      )}

      {characteristics.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {characteristics.map((c) => (
            <Link
              key={c.id}
              href={`/spc?id=${c.id}`}
              className={`rounded-md border px-3 py-1 text-sm ${
                c.id === selectedId
                  ? "border-sky-700 bg-sky-950/40 text-sky-200"
                  : "border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
            >
              {c.part?.partNumber ? `${c.part.partNumber} · ` : ""}
              {c.name}
            </Link>
          ))}
        </div>
      )}

      {result && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-400">Cpk</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-semibold ${verdict.tone}`}>
                  {fmt(result.capability.cpk, 2)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {verdict.label} · Cp {fmt(result.capability.cp, 2)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-400">Ppk</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-slate-100">
                  {fmt(result.capability.ppk, 2)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  long-term, includes drift
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-400">Control</CardTitle>
              </CardHeader>
              <CardContent>
                <p
                  className={`text-2xl font-semibold ${
                    result.violations.length === 0
                      ? "text-emerald-300"
                      : "text-rose-300"
                  }`}
                >
                  {result.violations.length === 0 ? "In control" : "Out"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {result.violations.length} rule violation
                  {result.violations.length === 1 ? "" : "s"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-400">Samples</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-slate-100">
                  {result.values.length}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {result.chart.chartType === "I_MR"
                    ? "individuals"
                    : `X-bar/R, n=${result.chart.subgroupSize}`}
                  {result.skipped > 0 && ` · ${result.skipped} unparseable`}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {result.characteristic.name}
                {result.characteristic.unit
                  ? ` (${result.characteristic.unit})`
                  : ""}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Chart
                points={result.chart.points}
                centerLine={result.chart.centerLine}
                ucl={result.chart.ucl}
                lcl={result.chart.lcl}
                usl={result.characteristic.usl}
                lsl={result.characteristic.lsl}
                violationIndexes={violationIndexes}
              />

              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
                <div>
                  <dt className="text-slate-500">Centre</dt>
                  <dd>{fmt(result.chart.centerLine)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">UCL / LCL</dt>
                  <dd>
                    {fmt(result.chart.ucl)} / {fmt(result.chart.lcl)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Sigma within</dt>
                  <dd>{fmt(result.capability.sigmaWithin)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Sigma overall</dt>
                  <dd>{fmt(result.capability.sigmaOverall)}</dd>
                </div>
              </dl>

              {result.violations.length > 0 && (
                <ul className="mt-4 space-y-1 text-sm text-rose-200">
                  {result.violations.slice(0, 10).map((v, i) => (
                    <li key={i}>
                      Rule {v.rule} at point {v.index + 1} — {v.description}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Characteristics under control</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {characteristics.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">
              Nothing monitored yet. Add a characteristic whose name matches the
              one recorded on inspections.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Part</th>
                  <th className={th}>Characteristic</th>
                  <th className={th}>LSL</th>
                  <th className={th}>Target</th>
                  <th className={th}>USL</th>
                  <th className={th}>Subgroup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {characteristics.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 font-mono text-slate-400">
                      {c.part?.partNumber || "—"}
                    </td>
                    <td className="py-2 text-slate-200">{c.name}</td>
                    <td className="py-2 text-slate-400">{fmt(c.lsl)}</td>
                    <td className="py-2 text-slate-400">{fmt(c.target)}</td>
                    <td className="py-2 text-slate-400">{fmt(c.usl)}</td>
                    <td className="py-2 text-slate-400">{c.subgroupSize}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form
            action={actionUpsertCharacteristic}
            className="mt-6 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-4"
          >
            <label className="text-sm text-slate-400">
              Part
              <select name="partId" className={selectClass} defaultValue="">
                <option value="">— any part</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400 sm:col-span-2">
              Characteristic name *
              <Input name="name" required placeholder="Bore diameter" />
            </label>
            <label className="text-sm text-slate-400">
              Unit
              <Input name="unit" placeholder="mm" />
            </label>
            <label className="text-sm text-slate-400">
              LSL
              <Input name="lsl" type="number" step="any" />
            </label>
            <label className="text-sm text-slate-400">
              Target
              <Input name="target" type="number" step="any" />
            </label>
            <label className="text-sm text-slate-400">
              USL
              <Input name="usl" type="number" step="any" />
            </label>
            <label className="text-sm text-slate-400">
              Subgroup size
              <Input name="subgroupSize" type="number" min="1" max="10" defaultValue="1" />
            </label>
            <div className="sm:col-span-4">
              <Button type="submit">Save characteristic</Button>
              <span className="ml-3 text-xs text-slate-500">
                The name must match what inspectors record, since that is how
                the measurements are found.
              </span>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
