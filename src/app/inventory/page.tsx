import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { AlertTriangle, Shield, Archive, Search, X, Boxes } from "lucide-react";
import {
  actionPutAwayAllReceiving,
  actionPutAwayItem,
  actionRunKanbanReplenishment,
} from "@/app/actions";
import { findKanbanShortages } from "@/lib/services/kanban-replenishment";
import Link from "next/link";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = pick(sp, "q").trim();
  const ownership = pick(sp, "ownership"); // COMPANY | GOVERNMENT | CUSTOMER
  const stock = pick(sp, "stock"); // onhand | low | zero | quarantine | putaway | kanban
  const locationType = pick(sp, "loc");

  const where: Prisma.InventoryItemWhereInput = {};
  if (ownership) where.ownership = ownership;
  if (locationType) where.location = { type: locationType };
  if (q) {
    where.OR = [
      { part: { partNumber: { contains: q } } },
      { part: { description: { contains: q } } },
      { lotNumber: { contains: q } },
      { serialNumber: { contains: q } },
      { location: { code: { contains: q } } },
    ];
  }
  if (stock === "onhand") {
    where.quantityOnHand = { gt: 0 };
  } else if (stock === "zero") {
    where.quantityOnHand = { lte: 0 };
  } else if (stock === "quarantine") {
    where.quantityQuarantine = { gt: 0 };
  } else if (stock === "putaway") {
    where.location = { type: "RECEIVING" };
    where.quantityOnHand = { gt: 0 };
    where.quantityQuarantine = 0;
    where.mrbCaseId = null;
  } else if (stock === "kanban") {
    where.part = { isKanban: true };
  }

  const [items, kanbanShortages] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      include: {
        part: true,
        location: { include: { warehouse: true } },
        mrbCase: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    findKanbanShortages(),
  ]);

  // Low stock: available ≤ 5, or kanban min breached
  let filtered = items;
  if (stock === "low") {
    filtered = items.filter((i) => {
      if (i.part.isKanban && i.part.minStock > 0) {
        return i.quantityAvailable <= i.part.minStock;
      }
      return i.quantityAvailable > 0 && i.quantityAvailable <= 5;
    });
  }

  // Aggregates from full filtered set
  const totalOnHand = filtered.reduce((s, i) => s + i.quantityOnHand, 0);
  const totalValue = filtered.reduce(
    (s, i) => s + i.quantityOnHand * i.unitCost,
    0
  );
  const quarantine = filtered.filter((i) => i.quantityQuarantine > 0);
  const low = filtered.filter((i) => {
    if (i.part.isKanban && i.part.minStock > 0) {
      return i.quantityAvailable <= i.part.minStock;
    }
    return i.quantityAvailable > 0 && i.quantityAvailable <= 5;
  });
  const awaitingPutaway = filtered.filter(
    (i) =>
      i.location.type === "RECEIVING" &&
      i.quantityOnHand > 0 &&
      i.quantityQuarantine === 0 &&
      !i.mrbCaseId
  );
  const gfpCount = filtered.filter((i) => i.ownership === "GOVERNMENT").length;
  const kanbanLow = filtered.filter(
    (i) =>
      i.part.isKanban &&
      i.part.minStock > 0 &&
      i.quantityAvailable <= i.part.minStock
  );

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";
  const hasFilters = Boolean(q || ownership || stock || locationType);

  /** Build inventory URL; empty string values clear that param. */
  const filterHref = (overrides: Record<string, string>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string> = {
      q,
      ownership,
      stock,
      loc: locationType,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    const s = params.toString();
    return s ? `/inventory?${s}` : "/inventory";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="On-hand by location · lot/serial · GFP vs company · quarantine"
        actions={
          <div className="flex flex-wrap gap-2">
            {kanbanShortages.length > 0 && (
              <form action={actionRunKanbanReplenishment}>
                <Button type="submit" size="sm" variant="secondary">
                  Create kanban PRs ({kanbanShortages.length})
                </Button>
              </form>
            )}
            {awaitingPutaway.length > 0 && (
              <form action={actionPutAwayAllReceiving}>
                <Button type="submit" size="sm">
                  Put away all receiving ({awaitingPutaway.length})
                </Button>
              </form>
            )}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Lines shown"
          value={filtered.length}
          icon={Boxes}
          accent="teal"
        />
        <StatCard
          title="Inventory value"
          value={formatCurrency(totalValue)}
          icon={Archive}
          accent="sky"
        />
        <StatCard
          title="GFP lines"
          value={gfpCount}
          icon={Shield}
          accent="violet"
        />
        <StatCard
          title="Low / quarantine"
          value={`${low.length} / ${quarantine.length}`}
          icon={AlertTriangle}
          accent="amber"
        />
      </div>

      {/* Quick chips — click active chip again to clear that filter */}
      <div className="flex flex-wrap gap-2 text-sm">
        {(
          [
            { key: "", label: "All", param: "" as const },
            {
              key: "COMPANY",
              label: "Company inventory",
              param: "ownership" as const,
            },
            { key: "GOVERNMENT", label: "GFP", param: "ownership" as const },
            { key: "onhand", label: "On hand", param: "stock" as const },
            { key: "low", label: "Low stock", param: "stock" as const },
            {
              key: "quarantine",
              label: "Quarantine",
              param: "stock" as const,
            },
            {
              key: "putaway",
              label: "Awaiting putaway",
              param: "stock" as const,
            },
            { key: "kanban", label: "Kanban items", param: "stock" as const },
            { key: "zero", label: "Zero qty", param: "stock" as const },
          ] as const
        ).map((chip) => {
          const active =
            chip.key === ""
              ? !ownership && !stock && !locationType && !q
              : chip.param === "ownership"
                ? ownership === chip.key
                : stock === chip.key;

          let href = "/inventory";
          if (chip.key === "") {
            // Clear ownership + stock chips only; keep search if present
            href = filterHref({ ownership: "", stock: "", loc: "" });
          } else if (chip.param === "ownership") {
            // Toggle off if already selected, else switch ownership
            href = filterHref({
              ownership: ownership === chip.key ? "" : chip.key,
            });
          } else {
            // Toggle stock filter off if already selected
            href = filterHref({
              stock: stock === chip.key ? "" : chip.key,
            });
          }

          return (
            <Link
              key={`${chip.param}-${chip.key || "all"}`}
              href={href}
              className={`rounded border px-3 py-1.5 ${
                active
                  ? "border-teal-500/50 bg-teal-500/10 text-teal-200"
                  : "border-slate-700 text-slate-400 hover:border-slate-600"
              }`}
              title={
                active && chip.key
                  ? "Click again to clear this filter"
                  : undefined
              }
            >
              {chip.label}
              {active && chip.key ? (
                <span className="ml-1 text-[10px] opacity-70">×</span>
              ) : null}
            </Link>
          );
        })}
      </div>

      <form
        method="get"
        className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          <Search className="h-3.5 w-3.5" />
          Search &amp; filters
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <Input
            name="q"
            placeholder="Part #, description, lot, location…"
            defaultValue={q}
            className="h-9 lg:col-span-2"
          />
          <select
            name="ownership"
            className={selectClass}
            defaultValue={ownership}
          >
            <option value="">Ownership: all</option>
            <option value="COMPANY">Company inventory</option>
            <option value="GOVERNMENT">GFP (government)</option>
            <option value="CUSTOMER">Customer-owned</option>
          </select>
          <select name="stock" className={selectClass} defaultValue={stock}>
            <option value="">Stock: all</option>
            <option value="onhand">On hand &gt; 0</option>
            <option value="low">Low stock</option>
            <option value="zero">Zero qty</option>
            <option value="quarantine">Quarantine</option>
            <option value="putaway">Awaiting putaway</option>
            <option value="kanban">Kanban items</option>
          </select>
          <select name="loc" className={selectClass} defaultValue={locationType}>
            <option value="">Location type: all</option>
            <option value="STORAGE">Storage</option>
            <option value="RECEIVING">Receiving</option>
            <option value="QUARANTINE">Quarantine</option>
            <option value="WIP">WIP</option>
            <option value="SHIPPING">Shipping</option>
            <option value="GFP">GFP area</option>
          </select>
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="h-9">
              Apply
            </Button>
            {hasFilters && (
              <Link href="/inventory">
                <Button type="button" size="sm" variant="outline" className="h-9">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </Link>
            )}
          </div>
        </div>
      </form>

      {awaitingPutaway.length > 0 && stock !== "putaway" && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium text-sky-400">
              Receiving dock — inspected material needs putaway
            </p>
            {awaitingPutaway.slice(0, 8).map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 px-3 py-2"
              >
                <div>
                  <span className="font-mono text-teal-400">
                    {item.part.partNumber}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">
                    {item.quantityOnHand} @ {item.location.code} · Lot{" "}
                    {item.lotNumber || "—"}
                  </span>
                </div>
                <form action={actionPutAwayItem}>
                  <input type="hidden" name="inventoryItemId" value={item.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    Put away
                  </Button>
                </form>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(kanbanShortages.length > 0 || kanbanLow.length > 0) && (
        <Card className="border-violet-500/30">
          <CardContent className="p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-violet-300">
                Kanban refill needed (at or below min)
                {kanbanShortages.length > 0
                  ? ` · ${kanbanShortages.length} part(s) ready for auto PR`
                  : ""}
              </p>
              {kanbanShortages.length > 0 && (
                <form action={actionRunKanbanReplenishment}>
                  <Button type="submit" size="sm" variant="secondary">
                    Create purchase requests
                  </Button>
                </form>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(kanbanShortages.length > 0
                ? kanbanShortages.map((s) => (
                    <Link
                      key={s.partId}
                      href={`/items/${s.partId}?tab=inventory`}
                      className="rounded border border-violet-500/30 px-2 py-1 text-xs text-violet-200 hover:bg-violet-500/10"
                    >
                      {s.partNumber}: {s.available} avail · order {s.qtyToOrder}{" "}
                      (min {s.minStock} / max {s.maxStock})
                    </Link>
                  ))
                : kanbanLow.map((i) => (
                    <Link
                      key={i.id}
                      href={`/items/${i.partId}?tab=inventory`}
                      className="rounded border border-violet-500/30 px-2 py-1 text-xs text-violet-200 hover:bg-violet-500/10"
                    >
                      {i.part.partNumber}: {i.quantityAvailable} avail (min{" "}
                      {i.part.minStock} / max {i.part.maxStock})
                    </Link>
                  )))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              PRs also auto-create after kitting, putaway, and ship when stock
              drops to min (skips parts already on open PR/PO).
            </p>
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Part</th>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-right">On hand</th>
              <th className="px-3 py-2 text-right">Available</th>
              <th className="px-3 py-2 text-right">Committed</th>
              <th className="px-3 py-2 text-right">Quarantine</th>
              <th className="px-3 py-2 text-left">Lot / serial</th>
              <th className="px-3 py-2 text-left">Ownership</th>
              <th className="px-3 py-2 text-left">
                Kanban / min-max
                <span className="ml-1 font-normal normal-case text-slate-600">
                  (refill levels)
                </span>
              </th>
              <th className="px-3 py-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const isLow =
                item.part.isKanban && item.part.minStock > 0
                  ? item.quantityAvailable <= item.part.minStock
                  : item.quantityAvailable > 0 && item.quantityAvailable <= 5;
              return (
                <tr
                  key={item.id}
                  className={`border-t border-slate-800/60 ${
                    item.quantityQuarantine > 0 ? "bg-orange-500/5" : ""
                  } ${item.ownership === "GOVERNMENT" ? "bg-violet-500/5" : ""} ${
                    item.location.type === "RECEIVING" ? "bg-sky-500/5" : ""
                  } ${isLow ? "bg-amber-500/5" : ""}`}
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/items/${item.partId}`}
                      className="font-mono text-teal-400 hover:underline"
                    >
                      {item.part.partNumber}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {item.part.description}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    {item.location.warehouse.code}/{item.location.code}
                    <span className="ml-1 text-[10px] text-slate-600">
                      {item.location.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {item.quantityOnHand}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      isLow ? "text-amber-400" : "text-emerald-400"
                    }`}
                  >
                    {item.quantityAvailable}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-sky-400">
                    {item.quantityCommitted}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-orange-400">
                    {item.quantityQuarantine || "—"}
                    {item.mrbCase && (
                      <p className="text-[10px]">{item.mrbCase.number}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {item.lotNumber || item.serialNumber || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={item.ownership} />
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {item.part.isKanban ? (
                      <Link
                        href={`/items/${item.partId}?tab=inventory`}
                        className="text-violet-400 hover:underline"
                        title="Reorder when available ≤ min; refill up to max"
                      >
                        Min {item.part.minStock} → max {item.part.maxStock}
                      </Link>
                    ) : item.part.reorderPoint > 0 ? (
                      <span title="Classic reorder point">
                        Reorder at {item.part.reorderPoint}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                    {formatCurrency(item.quantityOnHand * item.unitCost)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-500">
            No inventory lines match these filters.
          </div>
        )}
      </div>

      <p className="text-xs text-slate-600">
        Showing {filtered.length} line(s) ·{" "}
        {totalOnHand.toLocaleString()} units on hand ·{" "}
        {formatCurrency(totalValue)} value
      </p>
    </div>
  );
}
