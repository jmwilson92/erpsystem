import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { BASE_LABELS } from "@/lib/services/rate-pools";
import { COST_BASES, estimatePart } from "@/lib/services/estimating";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";
const th = "pb-2 text-left text-xs uppercase tracking-wide text-slate-500";

function money(n: number, dp = 2) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export default async function EstimatingPage({
  searchParams,
}: {
  searchParams: Promise<{
    partId?: string;
    qty?: string;
    basis?: string;
    margin?: string;
    markup?: string;
    odc?: string;
  }>;
}) {
  const sp = await searchParams;
  const parts = await prisma.part
    .findMany({ orderBy: { partNumber: "asc" }, take: 500 })
    .catch(() => []);

  const partId = sp.partId || parts[0]?.id;
  const quantity = Number(sp.qty ?? 1) || 1;
  const basis = ((COST_BASES as readonly string[]).includes(sp.basis || "")
    ? sp.basis
    : "STANDARD") as (typeof COST_BASES)[number];
  const margin = sp.margin ? Number(sp.margin) : null;
  const markup = sp.markup ? Number(sp.markup) : null;
  const otherDirect = Number(sp.odc ?? 0) || 0;

  let estimate = null;
  let error: string | null = null;
  if (partId) {
    try {
      estimate = await estimatePart({
        partId,
        quantity,
        basis,
        margin,
        markup,
        otherDirect,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not estimate";
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estimating"
        description="Cost roll from BOM and routing, burdened at your indirect rates"
      />

      {error && (
        <div className="rounded-md border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inputs</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-3 sm:grid-cols-6">
            <label className="text-sm text-slate-400 sm:col-span-2">
              Part
              <select name="partId" defaultValue={partId} className={selectClass}>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Quantity
              <Input name="qty" type="number" min="1" defaultValue={quantity} />
            </label>
            <label className="text-sm text-slate-400">
              Cost basis
              <select name="basis" defaultValue={basis} className={selectClass}>
                {COST_BASES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Margin
              <Input
                name="margin"
                type="number"
                step="any"
                placeholder="0.30"
                defaultValue={sp.margin || ""}
              />
            </label>
            <label className="text-sm text-slate-400">
              Markup
              <Input
                name="markup"
                type="number"
                step="any"
                placeholder="0.30"
                defaultValue={sp.markup || ""}
              />
            </label>
            <label className="text-sm text-slate-400">
              Other direct / unit
              <Input name="odc" type="number" step="any" defaultValue={otherDirect} />
            </label>
            <div className="sm:col-span-5 sm:self-end">
              <Button type="submit">Estimate</Button>
              <span className="ml-3 text-xs text-slate-500">
                Margin comes out of price, markup goes onto cost — 30% margin on
                $100 is $142.86, 30% markup is $130. Margin wins if both are set.
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      {estimate && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-400">Unit cost</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-slate-100">
                  {money(estimate.unitCost)}
                </p>
                <p className="mt-1 text-xs text-slate-500">fully burdened</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-400">Unit price</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-emerald-300">
                  {money(estimate.unitPrice)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {margin ? `${(margin * 100).toFixed(0)}% margin` : markup ? `${(markup * 100).toFixed(0)}% markup` : "at cost"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-400">Total price</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-slate-100">
                  {money(estimate.totalPrice, 0)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {estimate.quantity} unit{estimate.quantity === 1 ? "" : "s"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-400">Wrap</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-slate-100">
                  {estimate.burdened.wrapRate.toFixed(3)}
                </p>
                <p className="mt-1 text-xs text-slate-500">on direct labour</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Material (per unit)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Component</th>
                    <th className={`${th} text-right`}>Qty incl. scrap</th>
                    <th className={`${th} text-right`}>Unit cost</th>
                    <th className={`${th} text-right`}>Extended</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {estimate.material.map((l, i) => (
                    <tr key={`${l.partNumber}-${i}`}>
                      <td className="py-2 font-mono text-slate-200">
                        <span style={{ paddingLeft: l.level * 12 }}>
                          {l.partNumber}
                        </span>
                      </td>
                      <td className="py-2 text-right text-slate-400">
                        {l.effectiveQty.toFixed(4)}
                      </td>
                      <td className="py-2 text-right text-slate-400">
                        {money(l.unitCost)}
                      </td>
                      <td className="py-2 text-right text-slate-200">
                        {money(l.extended)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-700">
                    <td className="py-2 font-medium text-slate-300" colSpan={3}>
                      Material per unit
                    </td>
                    <td className="py-2 text-right font-medium text-slate-100">
                      {money(estimate.materialCost)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">
                Scrap compounds down the levels — a 5% factor over a 5% factor
                is 1.1025, not 1.10.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Labour (per unit)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {estimate.labor.length === 0 ? (
                <p className="py-2 text-sm text-slate-500">
                  No routing steps with estimated minutes for this part.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Work centre</th>
                      <th className={`${th} text-right`}>Standard min</th>
                      <th className={`${th} text-right`}>Paid hours</th>
                      <th className={`${th} text-right`}>Rate</th>
                      <th className={`${th} text-right`}>Extended</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {estimate.labor.map((l) => (
                      <tr key={l.workCenter}>
                        <td className="py-2 font-mono text-slate-200">
                          {l.workCenter}
                        </td>
                        <td className="py-2 text-right text-slate-400">
                          {l.standardMinutes}
                        </td>
                        <td className="py-2 text-right text-slate-400">
                          {l.paidHours.toFixed(3)}
                        </td>
                        <td className="py-2 text-right text-slate-400">
                          {money(l.rate)}
                        </td>
                        <td className="py-2 text-right text-slate-200">
                          {money(l.extended)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-700">
                      <td className="py-2 font-medium text-slate-300" colSpan={4}>
                        Labour per unit
                      </td>
                      <td className="py-2 text-right font-medium text-slate-100">
                        {money(estimate.laborCost)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Paid hours divide standard time by the centre&apos;s efficiency — 60
                minutes at 85% costs 1.176 hours, not 0.85.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Burden</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {estimate.burdened.lines.length === 0 ? (
                <p className="py-2 text-sm text-slate-500">
                  No indirect rates set for this year — cost is unburdened.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Pool</th>
                      <th className={th}>Applied to</th>
                      <th className={`${th} text-right`}>Base</th>
                      <th className={`${th} text-right`}>Rate</th>
                      <th className={`${th} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {estimate.burdened.lines.map((l) => (
                      <tr key={l.code}>
                        <td className="py-2 font-mono text-slate-200">{l.code}</td>
                        <td className="py-2 text-slate-400">
                          {BASE_LABELS[l.allocationBase] || l.allocationBase}
                        </td>
                        <td className="py-2 text-right text-slate-400">
                          {money(l.base, 0)}
                        </td>
                        <td className="py-2 text-right text-slate-400">
                          {(l.rate * 100).toFixed(2)}%
                        </td>
                        <td className="py-2 text-right text-slate-200">
                          {money(l.amount, 0)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-700">
                      <td className="py-2 font-medium text-slate-100" colSpan={4}>
                        Total cost for {estimate.quantity}
                      </td>
                      <td className="py-2 text-right text-lg font-semibold text-slate-100">
                        {money(estimate.totalCost, 0)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
