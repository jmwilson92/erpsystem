import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/utils";
import {
  ALLOCATION_METHODS,
  CHARGE_TYPES,
  getReceiptLandedTotals,
  listLandedCosts,
  previewAllocation,
  type AllocationMethod,
} from "@/lib/services/logistics";
import {
  actionAddLandedCost,
  actionApplyLandedCost,
  actionSetLineWeight,
} from "../../actions";
import { CheckCircle2, Clock, Scale } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

function fmtDateTime(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—";
}

export default async function LandedCostPage({
  params,
  searchParams,
}: {
  params: Promise<{ receiptId: string }>;
  searchParams: Promise<{ preview?: string; method?: string }>;
}) {
  const { receiptId } = await params;
  const { preview, method } = await searchParams;

  const receipt = await prisma.receipt
    .findUnique({ where: { id: receiptId }, include: { lines: true } })
    .catch(() => null);
  if (!receipt) notFound();

  const partIds = [...new Set(receipt.lines.map((l) => l.partId).filter(Boolean))] as string[];
  const [charges, totals, parts] = await Promise.all([
    listLandedCosts(receiptId),
    getReceiptLandedTotals(receiptId),
    partIds.length
      ? prisma.part.findMany({
          where: { id: { in: partIds } },
          select: { id: true, partNumber: true, unitWeight: true, weightUom: true },
        })
      : Promise.resolve([]),
  ]);
  const partById = new Map(parts.map((p) => [p.id, p]));

  // Live preview: type an amount into the form, submit as a GET, and see how it
  // would land before committing anything.
  const previewAmount = Number(preview);
  const previewMethod = (ALLOCATION_METHODS.find((m) => m === method) ??
    "VALUE") as AllocationMethod;
  const alloc =
    Number.isFinite(previewAmount) && previewAmount > 0
      ? await previewAllocation({
          receiptId,
          amount: previewAmount,
          allocation: previewMethod,
        })
      : null;
  const allocations = alloc?.rows ?? [];

  const receiptNo = receipt.number;
  const materialValue = receipt.lines.reduce(
    (n, l) => n + l.quantityReceived * l.unitCost,
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Landed cost · ${receiptNo}`}
        description="Freight, duty, and brokerage spread across this receipt's lines and folded into unit cost. Applying is one-way — a charge can only be applied once."
      />

      <Link href="/logistics" className="inline-block text-xs text-teal-300 hover:underline">
        ← Logistics
      </Link>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Material value" value={formatCurrency(materialValue)} sub={`${receipt.lines.length} lines`} />
        <Metric label="Charges added" value={formatCurrency(totals.total)} sub={`${totals.count} charges`} />
        <Metric label="Applied" value={formatCurrency(totals.applied)} sub="already in unit cost" />
        <Metric
          label="Pending"
          value={formatCurrency(totals.pending)}
          sub={totals.pending > 0 ? "not yet in unit cost" : "nothing outstanding"}
        />
      </div>

      {/* ── Charges ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Charges <span className="text-xs font-normal text-slate-500">({charges.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {charges.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 py-8 text-center text-sm text-slate-500">
              Nothing added yet. Add freight or duty below and it will be spread across the
              lines.
            </p>
          ) : (
            charges.map((c) => (
              <div
                key={c.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${
                  c.appliedAt
                    ? "border-emerald-600/25 bg-emerald-500/[0.04]"
                    : "border-amber-600/30 bg-amber-500/[0.04]"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-200">
                    <span className="font-medium">{c.type}</span>
                    {c.description ? ` · ${c.description}` : ""}
                    {c.vendor ? <span className="text-slate-500"> · {c.vendor}</span> : ""}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {formatCurrency(c.amount)} allocated by {c.allocation.toLowerCase()}
                    {c.appliedAt ? ` · applied ${fmtDateTime(c.appliedAt)}` : ""}
                  </p>
                </div>
                {c.appliedAt ? (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Applied
                  </span>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href={`/logistics/landed/${receiptId}?preview=${c.amount}&method=${c.allocation}`}
                      className="text-[11px] text-teal-300 hover:underline"
                    >
                      Preview
                    </Link>
                    <form action={actionApplyLandedCost}>
                      <input type="hidden" name="chargeId" value={c.id} />
                      <input type="hidden" name="receiptId" value={receiptId} />
                      <Button type="submit" size="sm">
                        Apply to unit cost
                      </Button>
                    </form>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ── Preview ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-slate-400" />
            Allocation preview
          </CardTitle>
          <p className="text-xs text-slate-500">
            See where a charge would land before committing it. Nothing is written.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <form method="GET" className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-slate-500">
              Amount
              <Input
                name="preview"
                type="number"
                step="0.01"
                defaultValue={preview ?? ""}
                className="h-8 w-32"
                placeholder="450.00"
              />
            </label>
            <label className="text-[11px] text-slate-500">
              Allocate by
              <select
                name="method"
                defaultValue={previewMethod}
                className="mt-1 h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
              >
                {ALLOCATION_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm" variant="outline">
              Preview
            </Button>
          </form>

          {allocations.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Line</th>
                    <th className="pb-2 pr-3 font-medium">Qty</th>
                    <th className="pb-2 pr-3 font-medium">Unit cost</th>
                    <th className="pb-2 pr-3 font-medium">Extended</th>
                    <th className="pb-2 pr-3 font-medium">Weight</th>
                    <th className="pb-2 pr-3 font-medium">Allocated</th>
                    <th className="pb-2 font-medium">New unit cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {allocations.map((a) => (
                    <tr key={a.lineId} className="text-slate-300">
                      <td className="max-w-xs truncate py-2 pr-3 text-xs">{a.description}</td>
                      <td className="py-2 pr-3 text-xs tabular-nums">{a.quantity}</td>
                      <td className="py-2 pr-3 text-xs tabular-nums">
                        {formatCurrency(a.unitCost)}
                      </td>
                      <td className="py-2 pr-3 text-xs tabular-nums">
                        {formatCurrency(a.extended)}
                      </td>
                      <td className="py-2 pr-3 text-xs tabular-nums">
                        {a.weight != null ? (
                          <>
                            {a.weight.toLocaleString()}{" "}
                            <span
                              className="text-slate-600"
                              title={
                                a.weightSource === "LINE"
                                  ? "Weighed on this receipt"
                                  : "Quantity x the part's unit weight"
                              }
                            >
                              {a.weightSource === "LINE" ? "actual" : "calc"}
                            </span>
                          </>
                        ) : (
                          <span className="text-rose-400">none</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs tabular-nums text-amber-300">
                        +{formatCurrency(a.allocated)}
                      </td>
                      <td className="py-2 text-xs font-medium tabular-nums text-teal-300">
                        {formatCurrency(a.newUnitCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-800 text-xs text-slate-400">
                    <td className="pt-2" colSpan={5}>
                      Total allocated
                    </td>
                    <td className="pt-2 tabular-nums text-amber-300">
                      {formatCurrency(allocations.reduce((n, a) => n + a.allocated, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              <p className="mt-2 text-[11px] text-slate-600">
                Split by <strong>{alloc?.basis}</strong>. The last line absorbs any
                rounding remainder so the parts sum to the whole.
              </p>
              {alloc?.fellBackToQuantity && (
                <p className="mt-1 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-200">
                  Nothing on this receipt has a weight, so this was split by
                  <strong> quantity</strong> instead. Set a unit weight on the parts, or
                  enter the weighed amounts below, for a real weight split.
                </p>
              )}
              {alloc?.basis === "WEIGHT" && (alloc?.missingWeight ?? 0) > 0 && (
                <p className="mt-1 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-200">
                  {alloc.missingWeight} line{alloc.missingWeight === 1 ? "" : "s"} have no
                  weight and were allocated nothing — they contributed nothing to the
                  freight bill. Enter their weights below if that&apos;s wrong.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Line weights ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-4 w-4 text-slate-400" />
            Line weights
          </CardTitle>
          <p className="text-xs text-slate-500">
            Used when a charge is allocated by weight. A weight entered here is what was
            actually received and beats the part&apos;s unit weight; leave it blank to use
            quantity x unit weight from the item master.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {receipt.lines.map((l) => {
              const part = l.partId ? partById.get(l.partId) : null;
              const calc =
                part?.unitWeight != null ? part.unitWeight * l.quantityReceived : null;
              return (
                <form
                  key={l.id}
                  action={actionSetLineWeight}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
                >
                  <input type="hidden" name="lineId" value={l.id} />
                  <input type="hidden" name="receiptId" value={receiptId} />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
                    {part?.partNumber ? (
                      <span className="font-mono text-slate-400">{part.partNumber} </span>
                    ) : null}
                    {l.description}
                    <span className="text-slate-600"> · qty {l.quantityReceived}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {calc != null
                      ? `master: ${calc.toLocaleString()} ${part?.weightUom ?? "LB"}`
                      : "no unit weight on part"}
                  </span>
                  <Input
                    key={`w-${l.weight ?? ""}`}
                    name="weight"
                    type="number"
                    step="0.01"
                    defaultValue={l.weight != null ? String(l.weight) : ""}
                    placeholder="actual"
                    className="h-8 w-28"
                  />
                  <select
                    name="weightUom"
                    defaultValue={l.weightUom ?? "LB"}
                    className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
                  >
                    <option value="LB">LB</option>
                    <option value="KG">KG</option>
                  </select>
                  <Button type="submit" size="sm" variant="outline">
                    Save
                  </Button>
                </form>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Add ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Add a charge</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionAddLandedCost} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="receiptId" value={receiptId} />
            <label className="text-xs text-slate-500">
              Type
              <select name="type" className={selectClass} defaultValue="FREIGHT">
                {CHARGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Amount *
              <Input name="amount" type="number" step="0.01" required placeholder="450.00" />
            </label>
            <label className="text-xs text-slate-500">
              Allocate by
              <select name="allocation" className={selectClass} defaultValue="VALUE">
                {ALLOCATION_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Vendor
              <Input name="vendor" placeholder="Customs broker" />
            </label>
            <label className="text-xs text-slate-500 sm:col-span-2">
              Description
              <Input name="description" placeholder="Ocean freight, invoice 88213" />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                Add charge
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <p className="text-2xl font-bold tabular-nums text-slate-100">{value}</p>
      <p className="text-xs font-medium text-slate-300">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}
