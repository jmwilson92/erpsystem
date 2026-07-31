import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ALLOCATION_BASES,
  BASE_LABELS,
  POOL_TYPES,
  RATE_BASIS,
  type RateBasis,
  actualRate,
  burden,
  getStack,
  listCostCenters,
  listPools,
} from "@/lib/services/rate-pools";
import {
  actionUpsertCostCenter,
  actionUpsertPool,
  actionUpsertYear,
} from "./actions";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";
const th = "pb-2 text-left text-xs uppercase tracking-wide text-slate-500";

function money(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function pct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

export default async function RatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    fy?: string;
    basis?: string;
    dl?: string;
    dm?: string;
    odc?: string;
    error?: string;
    saved?: string;
  }>;
}) {
  const sp = await searchParams;
  const fy = Number(sp.fy) || new Date().getFullYear();
  const basis = ((RATE_BASIS as readonly string[]).includes(sp.basis || "")
    ? sp.basis
    : "PROVISIONAL") as RateBasis;

  const directLabor = Number(sp.dl ?? 100000) || 0;
  const directMaterial = Number(sp.dm ?? 0) || 0;
  const otherDirect = Number(sp.odc ?? 0) || 0;

  const [pools, stack, costCenters] = await Promise.all([
    listPools(),
    getStack(fy, basis),
    listCostCenters(),
  ]);

  const result = burden({ directLabor, directMaterial, otherDirect }, stack);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indirect rates"
        description="Cost pools, allocation bases and the government cost build-up"
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost build-up</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-400">
              Fiscal year
              <Input name="fy" type="number" defaultValue={fy} className="w-24" />
            </label>
            <label className="text-sm text-slate-400">
              Basis
              <select name="basis" defaultValue={basis} className={selectClass}>
                {RATE_BASIS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Direct labour
              <Input name="dl" type="number" defaultValue={directLabor} className="w-32" />
            </label>
            <label className="text-sm text-slate-400">
              Direct material
              <Input name="dm" type="number" defaultValue={directMaterial} className="w-32" />
            </label>
            <label className="text-sm text-slate-400">
              Other direct
              <Input name="odc" type="number" defaultValue={otherDirect} className="w-32" />
            </label>
            <Button type="submit" variant="outline">
              Recalculate
            </Button>
          </form>

          {stack.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">
              No active pools with rates for FY{fy}. Add a pool below, then set
              its rate for the year.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Element</th>
                    <th className={th}>Applied to</th>
                    <th className={`${th} text-right`}>Base</th>
                    <th className={`${th} text-right`}>Rate</th>
                    <th className={`${th} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  <tr>
                    <td className="py-2 text-slate-200">Direct labour</td>
                    <td className="py-2 text-slate-500">—</td>
                    <td className="py-2 text-right text-slate-500">—</td>
                    <td className="py-2 text-right text-slate-500">—</td>
                    <td className="py-2 text-right text-slate-200">
                      {money(result.directLabor)}
                    </td>
                  </tr>
                  {result.lines.map((l) => (
                    <tr key={l.code}>
                      <td className="py-2 font-mono text-slate-200">{l.code}</td>
                      <td className="py-2 text-slate-400">
                        {BASE_LABELS[l.allocationBase] || l.allocationBase}
                      </td>
                      <td className="py-2 text-right text-slate-400">
                        {money(l.base)}
                      </td>
                      <td className="py-2 text-right text-slate-400">
                        {pct(l.rate)}
                      </td>
                      <td className="py-2 text-right text-slate-200">
                        {money(l.amount)}
                      </td>
                    </tr>
                  ))}
                  {(result.directMaterial > 0 || result.otherDirect > 0) && (
                    <tr>
                      <td className="py-2 text-slate-200">
                        Direct material + other
                      </td>
                      <td className="py-2 text-slate-500">—</td>
                      <td className="py-2 text-right text-slate-500">—</td>
                      <td className="py-2 text-right text-slate-500">—</td>
                      <td className="py-2 text-right text-slate-200">
                        {money(result.directMaterial + result.otherDirect)}
                      </td>
                    </tr>
                  )}
                  <tr className="border-t border-slate-700">
                    <td className="py-2 font-medium text-slate-300" colSpan={4}>
                      Total cost input
                    </td>
                    <td className="py-2 text-right font-medium text-slate-200">
                      {money(result.totalCostInput)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 font-medium text-slate-100" colSpan={4}>
                      Total cost
                    </td>
                    <td className="py-2 text-right text-lg font-semibold text-slate-100">
                      {money(result.totalCost)}
                    </td>
                  </tr>
                </tbody>
              </table>

              <p className="mt-3 text-sm text-slate-400">
                Wrap rate on direct labour:{" "}
                <span className="font-semibold text-slate-100">
                  {result.wrapRate.toFixed(3)}
                </span>
                <span className="ml-2 text-xs text-slate-500">
                  each dollar of direct labour costs{" "}
                  {money(result.wrapRate)} fully burdened — pools compound in
                  sequence, so this is higher than the rates added together
                </span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pools</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {pools.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">No pools defined.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Seq</th>
                  <th className={th}>Code</th>
                  <th className={th}>Type</th>
                  <th className={th}>Base</th>
                  <th className={th}>FY{fy} provisional</th>
                  <th className={th}>FY{fy} actual</th>
                  <th className={th}>Final</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {pools.map((p) => {
                  const y = p.years.find((v) => v.fiscalYear === fy);
                  return (
                    <tr key={p.id}>
                      <td className="py-2 text-slate-400">{p.sequence}</td>
                      <td className="py-2 font-mono text-slate-200">{p.code}</td>
                      <td className="py-2 text-slate-400">{p.poolType}</td>
                      <td className="py-2 text-slate-400">
                        {BASE_LABELS[p.allocationBase] || p.allocationBase}
                      </td>
                      <td className="py-2 text-slate-300">
                        {y ? pct(y.provisionalRate) : "—"}
                      </td>
                      <td className="py-2 text-slate-300">
                        {y && y.baseAmount ? pct(actualRate(y)) : "—"}
                      </td>
                      <td className="py-2 text-slate-300">
                        {y?.finalRate != null ? pct(y.finalRate) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <form
            action={actionUpsertPool}
            className="mt-6 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-5"
          >
            <label className="text-sm text-slate-400">
              Code *
              <Input name="code" required placeholder="OH" />
            </label>
            <label className="text-sm text-slate-400">
              Name *
              <Input name="name" required placeholder="Overhead" />
            </label>
            <label className="text-sm text-slate-400">
              Type
              <select name="poolType" className={selectClass} defaultValue="OVERHEAD">
                {POOL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Allocation base
              <select
                name="allocationBase"
                className={selectClass}
                defaultValue="DIRECT_LABOR_PLUS_FRINGE"
              >
                {ALLOCATION_BASES.map((b) => (
                  <option key={b} value={b}>
                    {BASE_LABELS[b]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Sequence
              <Input name="sequence" type="number" defaultValue="20" />
            </label>
            <div className="sm:col-span-5">
              <Button type="submit">Save pool</Button>
              <span className="ml-3 text-xs text-slate-500">
                Sequence sets application order — fringe first, G&amp;A last.
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Set a rate for a year</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionUpsertYear} className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm text-slate-400">
              Pool
              <select name="ratePoolId" className={selectClass} required>
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Fiscal year
              <Input name="fiscalYear" type="number" defaultValue={fy} />
            </label>
            <label className="text-sm text-slate-400">
              Provisional rate
              <Input
                name="provisionalRate"
                type="number"
                step="any"
                placeholder="0.32"
              />
            </label>
            <label className="text-sm text-slate-400">
              Final rate
              <Input name="finalRate" type="number" step="any" placeholder="0.28" />
            </label>
            <label className="text-sm text-slate-400">
              Pool amount (booked)
              <Input name="poolAmount" type="number" step="any" defaultValue="0" />
            </label>
            <label className="text-sm text-slate-400">
              Base amount (booked)
              <Input name="baseAmount" type="number" step="any" defaultValue="0" />
            </label>
            <label className="text-sm text-slate-400">
              Status
              <select name="status" className={selectClass} defaultValue="PROVISIONAL">
                {["PROVISIONAL", "ACTUALS_BOOKED", "FINAL_NEGOTIATED"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:self-end">
              <Button type="submit">Save rate</Button>
            </div>
            <p className="text-xs text-slate-500 sm:col-span-4">
              Rates are decimals — 32% is 0.32. The actual rate is derived from
              the booked pool over the booked base, so leave those at zero until
              the year is closed.
            </p>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost centres</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {costCenters.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">No cost centres.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Code</th>
                  <th className={th}>Name</th>
                  <th className={th}>Kind</th>
                  <th className={th}>Collects into</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {costCenters.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 font-mono text-slate-200">{c.code}</td>
                    <td className="py-2 text-slate-300">{c.name}</td>
                    <td className="py-2 text-slate-400">{c.kind}</td>
                    <td className="py-2 text-slate-400">
                      {c.ratePool ? c.ratePool.code : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form
            action={actionUpsertCostCenter}
            className="mt-6 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-4"
          >
            <label className="text-sm text-slate-400">
              Code *
              <Input name="code" required placeholder="ENG" />
            </label>
            <label className="text-sm text-slate-400">
              Name *
              <Input name="name" required placeholder="Engineering" />
            </label>
            <label className="text-sm text-slate-400">
              Kind
              <select name="kind" className={selectClass} defaultValue="DIRECT">
                <option value="DIRECT">Direct</option>
                <option value="INDIRECT">Indirect</option>
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Collects into (indirect only)
              <select name="ratePoolId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-4">
              <Button type="submit">Save cost centre</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
