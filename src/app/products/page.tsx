import { listProducts, PRODUCT_LIFECYCLE_PHASES } from "@/lib/services/products";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import Link from "next/link";
import { Plus, Search, X, Package2 } from "lucide-react";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

const PHASE_ACCENT: Record<string, string> = {
  CONCEPT: "border-l-slate-500",
  DESIGN: "border-l-sky-500",
  DEVELOPMENT: "border-l-violet-500",
  QUALIFICATION: "border-l-amber-500",
  PRODUCTION: "border-l-emerald-500",
  SUSTAINMENT: "border-l-teal-500",
  EOL: "border-l-orange-500",
  OBSOLETE: "border-l-rose-500",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = pick(sp, "q").trim();
  const phase = pick(sp, "phase");
  const status = pick(sp, "status");

  const products = await listProducts({
    search: q || undefined,
    phase: phase || undefined,
    status: status || undefined,
  });

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";
  const hasFilters = Boolean(q || phase || status);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="PLM product master — identity, lifecycle, structure, requirements, and configuration links"
        actions={
          <Link href="/products/new">
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" />
              New product
            </Button>
          </Link>
        }
      />

      <form
        method="get"
        className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          <Search className="h-3.5 w-3.5" />
          Search &amp; filters
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <Input
              name="q"
              defaultValue={q}
              placeholder="Code, name, family, model, customer…"
            />
          </div>
          <div>
            <select
              name="phase"
              defaultValue={phase}
              className={`${selectClass} w-[160px]`}
            >
              <option value="">All phases</option>
              {PRODUCT_LIFECYCLE_PHASES.map((p) => (
                <option key={p} value={p}>
                  {p.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <select
              name="status"
              defaultValue={status}
              className={`${selectClass} w-[130px]`}
            >
              <option value="">All status</option>
              <option value="ACTIVE">Active</option>
              <option value="ON_HOLD">On hold</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="OBSOLETE">Obsolete</option>
            </select>
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Apply
          </Button>
          {hasFilters && (
            <Link href="/products">
              <Button type="button" size="sm" variant="ghost">
                <X className="mr-1 h-3.5 w-3.5" />
                Clear
              </Button>
            </Link>
          )}
        </div>
      </form>

      {products.length === 0 ? (
        <Card className="border-dashed border-slate-800">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Package2 className="h-10 w-10 text-slate-600" />
            <p className="text-sm text-slate-400">
              No products yet. Create a product to track lifecycle, structure,
              and CM configuration.
            </p>
            <Link href="/products/new">
              <Button size="sm">New product</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {products.map((p) => (
            <Link key={p.id} href={`/products/${p.id}`}>
              <Card
                className={cn(
                  "border-l-4 transition-colors hover:border-teal-500/40",
                  PHASE_ACCENT[p.lifecyclePhase] || "border-l-slate-600"
                )}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-teal-400">
                          {p.code}
                        </span>
                        <StatusBadge status={p.lifecyclePhase} />
                        <StatusBadge status={p.status} />
                        {p.itarControlled && (
                          <span className="rounded bg-rose-950/50 px-1.5 py-0.5 text-[10px] uppercase text-rose-300">
                            ITAR
                          </span>
                        )}
                      </div>
                      <h3 className="mt-1 truncate text-lg font-semibold text-slate-100">
                        {p.name}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {[
                          p.productFamily,
                          p.modelNumber ? `Model ${p.modelNumber}` : null,
                          p.customer?.name || p.customerName,
                          p.topLevelPart
                            ? `TLA ${p.topLevelPart.partNumber}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || p.description || "—"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-4 text-center text-xs text-slate-500">
                      <div>
                        <p className="text-lg font-semibold tabular-nums text-slate-200">
                          {p._count.partLinks}
                        </p>
                        <p>Parts</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold tabular-nums text-slate-200">
                          {p._count.requirements}
                        </p>
                        <p>Reqs</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold tabular-nums text-slate-200">
                          {p._count.documentLinks}
                        </p>
                        <p>Docs</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold tabular-nums text-slate-200">
                          {p._count.variants}
                        </p>
                        <p>Variants</p>
                      </div>
                      <div className="hidden sm:block">
                        <p className="text-sm text-slate-400">
                          {p.productOwner?.name || "—"}
                        </p>
                        <p>Owner</p>
                      </div>
                      <div className="hidden md:block">
                        <p className="text-sm text-slate-400">
                          {formatDate(p.updatedAt)}
                        </p>
                        <p>Updated</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
