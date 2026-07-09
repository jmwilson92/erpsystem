import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { Search, X } from "lucide-react";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function BomPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = pick(sp, "q").trim();
  const status = pick(sp, "status");
  const structure = pick(sp, "structure");

  const where: Prisma.BomHeaderWhereInput = {};
  if (status) where.status = status;
  if (q || structure) {
    where.part = {
      ...(q
        ? {
            OR: [
              { partNumber: { contains: q } },
              { description: { contains: q } },
              { drawingNumber: { contains: q } },
            ],
          }
        : {}),
      ...(structure ? { itemStructure: structure } : {}),
    };
  }

  const boms = await prisma.bomHeader.findMany({
    where,
    orderBy: [{ part: { partNumber: "asc" } }, { revision: "desc" }],
    include: {
      part: true,
      lines: true,
      _count: { select: { workOrders: true } },
    },
  });

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";
  const hasFilters = Boolean(q || status || structure);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bill of Materials"
        description="BOM revisions and structure — item master lives under Items"
        actions={
          <div className="flex gap-2">
            <Link href="/items">
              <Button size="sm" variant="outline">
                Item cards
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
              href="/bom"
              className="ml-auto inline-flex items-center gap-1 normal-case text-sky-400"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </Link>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Input
              name="q"
              defaultValue={q}
              placeholder="Assembly part #, description…"
              className="h-9"
            />
          </div>
          <div>
            <select name="status" defaultValue={status} className={selectClass}>
              <option value="">All statuses</option>
              <option value="PROTOTYPE">Prototype</option>
              <option value="CERTIFIED">Certified</option>
              <option value="PRODUCTION">Production</option>
              <option value="OBSOLETE">Obsolete</option>
            </select>
          </div>
          <div>
            <select
              name="structure"
              defaultValue={structure}
              className={selectClass}
            >
              <option value="">All parent structures</option>
              <option value="TOP_LEVEL_ASSEMBLY">Top-level assembly</option>
              <option value="SUB_ASSEMBLY">Sub-assembly</option>
              <option value="RAW_MATERIAL">Raw material</option>
              <option value="N_A">N/A</option>
            </select>
          </div>
        </div>
        <div className="mt-2">
          <Button type="submit" size="sm">
            Apply
          </Button>
          <span className="ml-3 text-xs text-slate-600">
            {boms.length} BOM{boms.length === 1 ? "" : "s"}
          </span>
        </div>
      </form>

      <div className="grid gap-3">
        {boms.map((bom) => (
          <Link key={bom.id} href={`/bom/${bom.id}`}>
            <Card
              className={`transition-colors hover:border-teal-500/30 ${
                bom.isPrototype || bom.status === "PROTOTYPE"
                  ? "border-amber-500/30"
                  : bom.status === "CERTIFIED"
                    ? "border-emerald-500/20"
                    : ""
              }`}
            >
              <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-semibold text-slate-100">
                      {bom.part.partNumber}
                    </span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-teal-400">
                      Rev {bom.revision}
                    </span>
                    <StatusBadge status={bom.status} />
                    {bom.isPrototype && <StatusBadge status="PROTOTYPE" />}
                    {bom.part.itemStructure !== "N_A" && (
                      <span className="text-[10px] uppercase text-slate-500">
                        {bom.part.itemStructure.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    {bom.part.description}
                  </p>
                  <p className="text-xs text-slate-500">
                    {bom.lines.length} components · {bom._count.workOrders} WO(s)
                    {bom.certifiedAt
                      ? ` · Certified ${formatDate(bom.certifiedAt)}`
                      : ""}
                    {bom.description ? ` · ${bom.description}` : ""}
                    {" · "}
                    <span className="text-sky-500/80">
                      Item card available under Items
                    </span>
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {boms.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-500">
              No BOMs match. Open an assembly under{" "}
              <Link href="/items" className="text-teal-400 hover:underline">
                Items
              </Link>{" "}
              to manage item cards (BOMs link from the item&apos;s BOM tab).
            </CardContent>
          </Card>
        )}
      </div>

      <p className="text-xs text-slate-600">
        Looking for part numbers, costs, vendors, or UOM? Use{" "}
        <Link href="/items" className="text-teal-400 hover:underline">
          Items
        </Link>
        .
      </p>
    </div>
  );
}
