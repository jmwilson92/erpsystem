import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, cn } from "@/lib/utils";
import Link from "next/link";
import { Plus, Search, X } from "lucide-react";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = pick(sp, "q").trim();
  const sourcing = pick(sp, "sourcing");
  const structure = pick(sp, "structure");
  const active = pick(sp, "active"); // "", "1", "0"

  const where: Prisma.PartWhereInput = {};
  if (q) {
    where.OR = [
      { partNumber: { contains: q } },
      { description: { contains: q } },
      { drawingNumber: { contains: q } },
      { notes: { contains: q } },
      {
        vendors: {
          some: {
            OR: [
              { vendorPartNumber: { contains: q } },
              { vendorSku: { contains: q } },
              { supplier: { name: { contains: q } } },
            ],
          },
        },
      },
    ];
  }
  if (sourcing) where.sourcingMethod = sourcing;
  if (structure) where.itemStructure = structure;
  if (active === "1") where.isActive = true;
  if (active === "0") where.isActive = false;

  const parts = await prisma.part.findMany({
    where,
    orderBy: { partNumber: "asc" },
    include: {
      uomUnit: true,
      vendors: {
        where: { isPreferred: true },
        take: 1,
        include: { supplier: true },
      },
      _count: { select: { bomHeaders: true } },
    },
  });

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";
  const hasFilters = Boolean(q || sourcing || structure || active);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Items"
        description="Item master — part numbers, sourcing, costs, vendors (separate from BOMs)"
        actions={
          <div className="flex gap-2">
            <Link href="/uom">
              <Button size="sm" variant="outline">
                UOM master
              </Button>
            </Link>
            <Link href="/print/labels?kind=parts">
              <Button size="sm" variant="outline">
                Print labels
              </Button>
            </Link>
            <a href="/api/export?entity=parts">
              <Button size="sm" variant="outline">
                Export CSV
              </Button>
            </a>
            <Link href="/admin/import">
              <Button size="sm" variant="outline">
                Import
              </Button>
            </Link>
            <Link href="/items/new">
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                New item
              </Button>
            </Link>
          </div>
        }
      />

      <form
        method="get"
        className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          <Search className="h-3.5 w-3.5" />
          Search &amp; filters
          {hasFilters && (
            <Link
              href="/items"
              className="ml-auto inline-flex items-center gap-1 normal-case text-sky-400"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </Link>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Input
              name="q"
              defaultValue={q}
              placeholder="Part #, description, vendor PN, SKU…"
              className="h-9"
            />
          </div>
          <div>
            <select
              name="sourcing"
              defaultValue={sourcing}
              className={selectClass}
            >
              <option value="">All sourcing</option>
              <option value="PURCHASE">Purchase (PO)</option>
              <option value="BUILD">Build (WO)</option>
            </select>
          </div>
          <div>
            <select
              name="structure"
              defaultValue={structure}
              className={selectClass}
            >
              <option value="">All structures</option>
              <option value="RAW_MATERIAL">Raw material</option>
              <option value="SUB_ASSEMBLY">Sub-assembly</option>
              <option value="TOP_LEVEL_ASSEMBLY">Top-level assembly</option>
              <option value="N_A">N/A</option>
            </select>
          </div>
          <div>
            <select name="active" defaultValue={active} className={selectClass}>
              <option value="">Active + inactive</option>
              <option value="1">Active only</option>
              <option value="0">Inactive only</option>
            </select>
          </div>
        </div>
        <div className="mt-2">
          <Button type="submit" size="sm">
            Apply
          </Button>
          <span className="ml-3 text-xs text-slate-600">
            {parts.length} item{parts.length === 1 ? "" : "s"}
          </span>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-800" data-tour="items-table">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-900/90 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Part #</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-left">Sourcing</th>
              <th className="px-3 py-2 text-left">Structure</th>
              <th className="px-3 py-2 text-left">UOM</th>
              <th className="px-3 py-2 text-right">Std cost</th>
              <th className="px-3 py-2 text-left">Preferred vendor</th>
              <th className="px-3 py-2 text-left">Flags</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr
                key={p.id}
                className={cn(
                  "border-t border-slate-800/70 hover:bg-slate-900/50",
                  !p.isActive && "opacity-50"
                )}
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/items/${p.id}`}
                    className="font-mono font-medium text-teal-400 hover:underline"
                  >
                    {p.partNumber}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-300">{p.description}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={p.sourcingMethod} />
                </td>
                <td className="px-3 py-2 text-xs text-slate-400">
                  {p.itemStructure === "N_A"
                    ? "—"
                    : p.itemStructure.replace(/_/g, " ")}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400">
                  {p.uom}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                  {formatCurrency(p.standardCost)}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400">
                  {p.vendors[0]?.supplier.name || "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {p.requiresGdtInspection && (
                      <span className="rounded border border-sky-500/30 px-1 text-[10px] text-sky-400">
                        GD&amp;T
                      </span>
                    )}
                    {p.requiresFunctionalTest && (
                      <span className="rounded border border-violet-500/30 px-1 text-[10px] text-violet-400">
                        Func
                      </span>
                    )}
                    {p._count.bomHeaders > 0 && (
                      <span className="rounded border border-slate-700 px-1 text-[10px] text-slate-500">
                        {p._count.bomHeaders} BOM
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {parts.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-500">
            No items match.{" "}
            <Link href="/items/new" className="text-teal-400 hover:underline">
              Create one
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
