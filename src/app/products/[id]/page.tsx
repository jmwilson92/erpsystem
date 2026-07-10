import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  getProductDetail,
  PRODUCT_LIFECYCLE_PHASES,
} from "@/lib/services/products";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import {
  actionUpdateProduct,
  actionAdvanceProductLifecycle,
  actionAddProductPart,
  actionRemoveProductPart,
  actionAddProductDocument,
  actionRemoveProductDocument,
  actionAddProductRequirement,
  actionUpdateProductRequirement,
  actionRemoveProductRequirement,
  actionAddProductVariant,
  actionRemoveProductVariant,
  actionAddProductMilestone,
  actionUpdateProductMilestone,
  actionRemoveProductMilestone,
  actionAddProductMember,
  actionRemoveProductMember,
} from "@/app/actions";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "structure", label: "Structure" },
  { id: "requirements", label: "Requirements" },
  { id: "documents", label: "Documents" },
  { id: "variants", label: "Variants" },
  { id: "projects", label: "Projects / cost" },
  { id: "team", label: "Team" },
  { id: "edit", label: "Edit" },
] as const;

function dateInputValue(d: Date | null | undefined) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tabRaw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = tabRaw || "overview";

  const [product, users, parts, customers, linkedProjects, productEngTasks] =
    await Promise.all([
      getProductDetail(id),
      prisma.user.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, role: true },
      }),
      prisma.part.findMany({
        where: { isActive: true },
        orderBy: { partNumber: "asc" },
        select: {
          id: true,
          partNumber: true,
          description: true,
          itemStructure: true,
        },
        take: 400,
      }),
      prisma.customer.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.project.findMany({
        where: {
          OR: [
            { productId: id },
            { productLinks: { some: { productId: id } } },
          ],
        },
        include: {
          program: { select: { code: true, name: true } },
          costEntries: {
            where: { productId: id },
            orderBy: { entryDate: "desc" },
            take: 20,
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.engTask.findMany({
        where: { productId: id, parentId: null },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          number: true,
          name: true,
          status: true,
          kind: true,
          discipline: true,
          dueDate: true,
        },
      }),
    ]);

  if (!product) notFound();

  const phaseIdx = PRODUCT_LIFECYCLE_PHASES.indexOf(
    product.lifecyclePhase as (typeof PRODUCT_LIFECYCLE_PHASES)[number]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={product.name}
        description={`${product.code} · Rev ${product.revision}${
          product.productFamily ? ` · ${product.productFamily}` : ""
        }`}
        actions={
          <div className="flex flex-wrap gap-2">
            {product.cmFolderId && (
              <Link href={`/cm?tab=library&folder=${product.cmFolderId}`}>
                <Button size="sm" variant="outline">
                  CM library
                </Button>
              </Link>
            )}
            {product.topLevelPartId && (
              <Link href={`/items/${product.topLevelPartId}`}>
                <Button size="sm" variant="outline">
                  Top-level item
                </Button>
              </Link>
            )}
            <Link href="/products">
              <Button size="sm" variant="ghost">
                All products
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={product.lifecyclePhase} />
        <StatusBadge status={product.status} />
        {product.itarControlled && (
          <span className="rounded bg-rose-950/50 px-2 py-0.5 text-[10px] uppercase text-rose-300">
            ITAR
          </span>
        )}
        {product.exportControl && product.exportControl !== "NONE" && (
          <span className="rounded bg-amber-950/40 px-2 py-0.5 text-[10px] uppercase text-amber-300">
            {product.exportControl}
          </span>
        )}
        {product.customer && (
          <span className="text-xs text-slate-400">
            Customer: {product.customer.name}
          </span>
        )}
      </div>

      {/* Lifecycle strip */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <div className="flex min-w-[640px] items-center gap-1">
          {PRODUCT_LIFECYCLE_PHASES.map((p, i) => {
            const done = phaseIdx >= 0 && i <= phaseIdx;
            const current = p === product.lifecyclePhase;
            return (
              <div key={p} className="flex flex-1 items-center gap-1">
                <div
                  className={cn(
                    "flex-1 rounded-md border px-1 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide",
                    current
                      ? "border-teal-500/60 bg-teal-500/15 text-teal-300"
                      : done
                        ? "border-slate-600 bg-slate-800/80 text-slate-300"
                        : "border-slate-800 text-slate-600"
                  )}
                >
                  {p.replace(/_/g, " ")}
                </div>
                {i < PRODUCT_LIFECYCLE_PHASES.length - 1 && (
                  <div
                    className={cn(
                      "h-px w-2 shrink-0",
                      done ? "bg-slate-500" : "bg-slate-800"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/products/${product.id}?tab=${t.id}`}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              tab === t.id
                ? "bg-slate-800 text-slate-50"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="border-slate-800 lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">What it is</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-300">
              {product.description && (
                <p className="text-slate-200">{product.description}</p>
              )}
              {product.overview ? (
                <p className="whitespace-pre-wrap text-slate-400">
                  {product.overview}
                </p>
              ) : (
                <p className="text-slate-500">
                  No overview yet — add one on the Edit tab.
                </p>
              )}
              {product.notes && (
                <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
                  <p className="mb-1 text-[10px] uppercase text-slate-500">
                    Notes
                  </p>
                  {product.notes}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Snapshot</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <Row label="Family" value={product.productFamily} />
                <Row label="Line" value={product.productLine} />
                <Row label="Model" value={product.modelNumber} />
                <Row label="Market" value={product.marketSegment} />
                <Row
                  label="Top-level"
                  value={
                    product.topLevelPart
                      ? `${product.topLevelPart.partNumber} Rev ${product.topLevelPart.revision}`
                      : null
                  }
                />
                <Row
                  label="Target cost"
                  value={
                    product.targetCost != null
                      ? formatCurrency(product.targetCost)
                      : null
                  }
                />
                <Row
                  label="Weight"
                  value={
                    product.estimatedWeight != null
                      ? `${product.estimatedWeight} ${product.weightUom || ""}`
                      : null
                  }
                />
                <Row
                  label="Lead time"
                  value={
                    product.targetLeadDays != null
                      ? `${product.targetLeadDays} days`
                      : null
                  }
                />
                <Row label="Quality" value={product.qualityStandard} />
                <Row label="NSN" value={product.nsn} />
                <Row label="CAGE" value={product.cageCode} />
                <Row
                  label="Dev budget"
                  value={formatCurrency(product.developmentBudget)}
                />
                <Row
                  label="Dev actual"
                  value={formatCurrency(product.developmentActual)}
                />
              </CardContent>
            </Card>

            <Card className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Ownership</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <Row label="Owner" value={product.productOwner?.name} />
                <Row label="Eng lead" value={product.engineeringLead?.name} />
                <Row label="CM" value={product.cmOwner?.name} />
                <Row
                  label="Customer"
                  value={product.customer?.name || product.customerName}
                />
              </CardContent>
            </Card>

            <Card className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Counts</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-center text-xs text-slate-500">
                <div>
                  <p className="text-xl font-semibold text-slate-100">
                    {product.partLinks.length}
                  </p>
                  Parts
                </div>
                <div>
                  <p className="text-xl font-semibold text-slate-100">
                    {product.requirements.length}
                  </p>
                  Reqs
                </div>
                <div>
                  <p className="text-xl font-semibold text-slate-100">
                    {product.documentLinks.length}
                  </p>
                  Docs
                </div>
                <div>
                  <p className="text-xl font-semibold text-slate-100">
                    {product.variants.length}
                  </p>
                  Variants
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── LIFECYCLE ── */}
      {tab === "lifecycle" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Advance phase</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={actionAdvanceProductLifecycle} className="space-y-3">
                <input type="hidden" name="productId" value={product.id} />
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Move to phase
                  </label>
                  <select
                    name="toPhase"
                    className={`${selectClass} mt-1`}
                    required
                    defaultValue={
                      PRODUCT_LIFECYCLE_PHASES[
                        Math.min(
                          phaseIdx + 1,
                          PRODUCT_LIFECYCLE_PHASES.length - 1
                        )
                      ] || "DESIGN"
                    }
                  >
                    {PRODUCT_LIFECYCLE_PHASES.filter(
                      (p) => p !== product.lifecyclePhase
                    ).map((p) => (
                      <option key={p} value={p}>
                        {p.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Gate notes
                  </label>
                  <Textarea
                    name="notes"
                    rows={2}
                    className="mt-1"
                    placeholder="Exit criteria met, review board, etc."
                  />
                </div>
                <Button type="submit" size="sm">
                  Record phase change
                </Button>
              </form>

              <div className="mt-6 space-y-1 text-xs text-slate-500">
                <p className="text-[10px] uppercase text-slate-500">
                  Phase dates
                </p>
                <Row label="Concept" value={formatDate(product.conceptDate)} />
                <Row label="Design" value={formatDate(product.designStartDate)} />
                <Row
                  label="Development"
                  value={formatDate(product.developmentStartDate)}
                />
                <Row
                  label="Qualification"
                  value={formatDate(product.qualificationStartDate)}
                />
                <Row
                  label="First article"
                  value={formatDate(product.firstArticleDate)}
                />
                <Row
                  label="Production"
                  value={formatDate(product.productionReleaseDate)}
                />
                <Row
                  label="Sustainment"
                  value={formatDate(product.sustainmentStartDate)}
                />
                <Row label="EOL" value={formatDate(product.eolDate)} />
                <Row label="Obsolete" value={formatDate(product.obsoleteDate)} />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Milestones / gates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {product.milestones.length === 0 && (
                  <p className="text-xs text-slate-500">No milestones yet.</p>
                )}
                {product.milestones.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 px-2 py-2 text-sm"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-200">{m.name}</span>
                        <StatusBadge status={m.status} />
                        <span className="text-[10px] text-slate-500">
                          {m.kind}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Target {formatDate(m.targetDate)}
                        {m.actualDate
                          ? ` · Actual ${formatDate(m.actualDate)}`
                          : ""}
                      </p>
                    </div>
                    <form action={actionUpdateProductMilestone} className="flex gap-1">
                      <input type="hidden" name="productId" value={product.id} />
                      <input type="hidden" name="id" value={m.id} />
                      <select
                        name="status"
                        defaultValue={m.status}
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                      >
                        <option value="PLANNED">PLANNED</option>
                        <option value="IN_PROGRESS">IN_PROGRESS</option>
                        <option value="COMPLETE">COMPLETE</option>
                        <option value="MISSED">MISSED</option>
                        <option value="CANCELLED">CANCELLED</option>
                      </select>
                      <Button type="submit" size="sm" variant="outline">
                        Save
                      </Button>
                    </form>
                    <form action={actionRemoveProductMilestone}>
                      <input type="hidden" name="productId" value={product.id} />
                      <input type="hidden" name="id" value={m.id} />
                      <Button type="submit" size="sm" variant="ghost" className="text-rose-400">
                        Remove
                      </Button>
                    </form>
                  </div>
                ))}

                <form
                  action={actionAddProductMilestone}
                  className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-3"
                >
                  <input type="hidden" name="productId" value={product.id} />
                  <Input name="name" required placeholder="Milestone name" />
                  <select name="kind" className={selectClass} defaultValue="GATE">
                    <option value="GATE">Gate</option>
                    <option value="REVIEW">Review</option>
                    <option value="RELEASE">Release</option>
                    <option value="OTHER">Other</option>
                  </select>
                  <Input name="targetDate" type="date" />
                  <div className="sm:col-span-3">
                    <Button type="submit" size="sm">
                      Add milestone
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Phase history</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {product.lifecycleEvents.map((e) => (
                  <div
                    key={e.id}
                    className="border-b border-slate-800/80 pb-2 text-xs last:border-0"
                  >
                    <p className="text-slate-300">
                      {e.fromPhase ? (
                        <>
                          <span className="font-mono text-slate-500">
                            {e.fromPhase}
                          </span>
                          {" → "}
                        </>
                      ) : (
                        "Created as "
                      )}
                      <span className="font-mono text-teal-400">{e.toPhase}</span>
                    </p>
                    {e.notes && (
                      <p className="mt-0.5 text-slate-500">{e.notes}</p>
                    )}
                    <p className="mt-0.5 text-[10px] text-slate-600">
                      {formatDate(e.createdAt)}
                      {e.user ? ` · ${e.user.name}` : ""}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── STRUCTURE ── */}
      {tab === "structure" && (
        <div className="space-y-4">
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Product structure (items)
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Part</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {product.partLinks.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-6 text-center text-slate-500"
                      >
                        No structure links yet. Add the top-level assembly and
                        major items.
                      </td>
                    </tr>
                  )}
                  {product.partLinks.map((link) => (
                    <tr
                      key={link.id}
                      className="border-b border-slate-800/80 hover:bg-slate-900/40"
                    >
                      <td className="px-3 py-2">
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                          {link.role}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-teal-400">
                        <Link
                          href={`/items/${link.part.id}`}
                          className="hover:underline"
                        >
                          {link.part.partNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {link.part.description}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {link.part.itemStructure || link.part.partType}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <form action={actionRemoveProductPart}>
                          <input
                            type="hidden"
                            name="productId"
                            value={product.id}
                          />
                          <input type="hidden" name="id" value={link.id} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            className="text-rose-400"
                          >
                            Remove
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Add item to product</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionAddProductPart}
                className="grid gap-3 sm:grid-cols-3"
              >
                <input type="hidden" name="productId" value={product.id} />
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Item
                  </label>
                  <select name="partId" required className={`${selectClass} mt-1`}>
                    <option value="">— Select part —</option>
                    {parts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.partNumber} — {p.description}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Role
                  </label>
                  <select name="role" className={`${selectClass} mt-1`} defaultValue="RELATED">
                    <option value="TOP_LEVEL">Top-level assembly</option>
                    <option value="MAJOR_ASSEMBLY">Major assembly</option>
                    <option value="OPTION">Option</option>
                    <option value="SPARE">Spare</option>
                    <option value="TOOLING">Tooling</option>
                    <option value="RELATED">Related</option>
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <Button type="submit" size="sm">
                    Add to structure
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── REQUIREMENTS ── */}
      {tab === "requirements" && (
        <div className="space-y-4">
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Design requirements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {product.requirements.length === 0 && (
                <p className="text-xs text-slate-500">No requirements yet.</p>
              )}
              {product.requirements.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded border border-slate-800 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-violet-300">
                        {r.number}
                      </span>
                      <StatusBadge status={r.status} />
                      <span className="text-[10px] uppercase text-slate-500">
                        {r.category}
                      </span>
                      <span className="text-[10px] uppercase text-slate-600">
                        {r.priority}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-200">{r.title}</p>
                    {r.description && (
                      <p className="text-xs text-slate-500">{r.description}</p>
                    )}
                    {(r.source || r.verificationMethod) && (
                      <p className="mt-1 text-[11px] text-slate-600">
                        {r.source ? `Source: ${r.source}` : ""}
                        {r.verificationMethod
                          ? ` · Verify: ${r.verificationMethod}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <form action={actionUpdateProductRequirement} className="flex gap-1">
                      <input type="hidden" name="productId" value={product.id} />
                      <input type="hidden" name="id" value={r.id} />
                      <select
                        name="status"
                        defaultValue={r.status}
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                      >
                        <option value="DRAFT">DRAFT</option>
                        <option value="APPROVED">APPROVED</option>
                        <option value="VERIFIED">VERIFIED</option>
                        <option value="WAIVED">WAIVED</option>
                        <option value="OBSOLETE">OBSOLETE</option>
                      </select>
                      <Button type="submit" size="sm" variant="outline">
                        Save
                      </Button>
                    </form>
                    <form action={actionRemoveProductRequirement}>
                      <input type="hidden" name="productId" value={product.id} />
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit" size="sm" variant="ghost" className="text-rose-400">
                        ×
                      </Button>
                    </form>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Add requirement</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionAddProductRequirement}
                className="grid gap-3 sm:grid-cols-2"
              >
                <input type="hidden" name="productId" value={product.id} />
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Number{" "}
                    <span className="normal-case text-slate-600">
                      (auto if blank)
                    </span>
                  </label>
                  <Input name="number" className="mt-1 font-mono" placeholder="REQ-001" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Category
                  </label>
                  <select name="category" className={`${selectClass} mt-1`} defaultValue="FUNCTIONAL">
                    <option value="FUNCTIONAL">Functional</option>
                    <option value="PERFORMANCE">Performance</option>
                    <option value="SAFETY">Safety</option>
                    <option value="REGULATORY">Regulatory</option>
                    <option value="INTERFACE">Interface</option>
                    <option value="ENVIRONMENTAL">Environmental</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Title *
                  </label>
                  <Input name="title" required className="mt-1" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Description
                  </label>
                  <Textarea name="description" rows={2} className="mt-1" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Priority
                  </label>
                  <select name="priority" className={`${selectClass} mt-1`} defaultValue="NORMAL">
                    <option value="LOW">Low</option>
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Verification
                  </label>
                  <select name="verificationMethod" className={`${selectClass} mt-1`}>
                    <option value="">—</option>
                    <option value="TEST">Test</option>
                    <option value="ANALYSIS">Analysis</option>
                    <option value="INSPECTION">Inspection</option>
                    <option value="DEMONSTRATION">Demonstration</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Source
                  </label>
                  <Input name="source" className="mt-1" placeholder="SOW, customer, internal…" />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm">
                    Add requirement
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── DOCUMENTS ── */}
      {tab === "documents" && (
        <div className="space-y-4">
          {product.cmFolder && (
            <p className="text-xs text-slate-500">
              CM library folder:{" "}
              <Link
                href={`/cm?tab=library&folder=${product.cmFolder.id}`}
                className="text-teal-400 underline"
              >
                {product.cmFolder.name}
              </Link>{" "}
              ({product.cmFolder._count.documents} docs,{" "}
              {product.cmFolder._count.children} subfolders). Released drawings
              and policies from ECRs land there.
            </p>
          )}

          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Product document index
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Number</th>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Rev</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {product.documentLinks.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-6 text-center text-slate-500"
                      >
                        No documents indexed on this product yet.
                      </td>
                    </tr>
                  )}
                  {product.documentLinks.map((d) => (
                    <tr
                      key={d.id}
                      className="border-b border-slate-800/80"
                    >
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {d.docType}
                      </td>
                      <td className="px-3 py-2 font-mono text-teal-400">
                        {d.url ? (
                          <a href={d.url} className="hover:underline" target="_blank" rel="noreferrer">
                            {d.number || "—"}
                          </a>
                        ) : (
                          d.number || "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-200">{d.title}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {d.revision || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {d.status ? <StatusBadge status={d.status} /> : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <form action={actionRemoveProductDocument}>
                          <input
                            type="hidden"
                            name="productId"
                            value={product.id}
                          />
                          <input type="hidden" name="id" value={d.id} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            className="text-rose-400"
                          >
                            Remove
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Index a document</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionAddProductDocument}
                className="grid gap-3 sm:grid-cols-3"
              >
                <input type="hidden" name="productId" value={product.id} />
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Type
                  </label>
                  <select name="docType" className={`${selectClass} mt-1`} defaultValue="DRAWING">
                    <option value="DRAWING">Drawing</option>
                    <option value="SPEC">Spec</option>
                    <option value="PROCEDURE">Procedure</option>
                    <option value="WI">Work instruction</option>
                    <option value="BOM">BOM</option>
                    <option value="MANUAL">Manual</option>
                    <option value="CERT">Certificate</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Number
                  </label>
                  <Input name="number" className="mt-1 font-mono" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Rev
                  </label>
                  <Input name="revision" className="mt-1 font-mono" defaultValue="A" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Title *
                  </label>
                  <Input name="title" required className="mt-1" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Status
                  </label>
                  <Input name="status" className="mt-1" placeholder="RELEASED" />
                </div>
                <div className="sm:col-span-3">
                  <label className="text-[10px] uppercase text-slate-500">
                    URL / path
                  </label>
                  <Input name="url" className="mt-1" />
                </div>
                <div className="sm:col-span-3">
                  <Button type="submit" size="sm">
                    Add document
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── VARIANTS ── */}
      {tab === "variants" && (
        <div className="space-y-4">
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Configurations / variants</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {product.variants.length === 0 && (
                <p className="text-xs text-slate-500">No variants defined.</p>
              )}
              {product.variants.map((v) => (
                <div
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 px-3 py-2 text-sm"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-teal-400">{v.code}</span>
                      <span className="text-slate-200">{v.name}</span>
                      {v.isDefault && (
                        <span className="text-[10px] uppercase text-amber-400">
                          default
                        </span>
                      )}
                      {!v.isActive && (
                        <StatusBadge status="INACTIVE" />
                      )}
                    </div>
                    {v.description && (
                      <p className="text-xs text-slate-500">{v.description}</p>
                    )}
                    {v.topLevelPart && (
                      <p className="text-[11px] text-slate-600">
                        TLA {v.topLevelPart.partNumber}
                      </p>
                    )}
                  </div>
                  <form action={actionRemoveProductVariant}>
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="id" value={v.id} />
                    <Button type="submit" size="sm" variant="ghost" className="text-rose-400">
                      Remove
                    </Button>
                  </form>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Add variant</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionAddProductVariant}
                className="grid gap-3 sm:grid-cols-2"
              >
                <input type="hidden" name="productId" value={product.id} />
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Code *
                  </label>
                  <Input name="code" required className="mt-1 font-mono" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Name *
                  </label>
                  <Input name="name" required className="mt-1" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Description
                  </label>
                  <Input name="description" className="mt-1" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Top-level part
                  </label>
                  <select name="topLevelPartId" className={`${selectClass} mt-1`}>
                    <option value="">—</option>
                    {parts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.partNumber} — {p.description}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    name="isDefault"
                    className="rounded border-slate-600"
                  />
                  Default configuration
                </label>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm">
                    Add variant
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── PROJECTS / DEV COST ── */}
      {tab === "projects" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="border-slate-800">
              <CardContent className="p-4 text-center">
                <p className="text-xl font-bold tabular-nums text-slate-100">
                  {formatCurrency(product.developmentBudget)}
                </p>
                <p className="text-xs text-slate-500">
                  Development budget (from PMO projects)
                </p>
              </CardContent>
            </Card>
            <Card className="border-slate-800">
              <CardContent className="p-4 text-center">
                <p className="text-xl font-bold tabular-nums text-teal-300">
                  {formatCurrency(product.developmentActual)}
                </p>
                <p className="text-xs text-slate-500">
                  Development actual / NRE
                </p>
              </CardContent>
            </Card>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Link href={`/engineering/mfg_eng?tab=sustainment`}>
              <Button size="sm" variant="outline">
                MFG_ENG sustainment
              </Button>
            </Link>
            <Link href={`/pmo/projects/new?productId=${product.id}`}>
              <Button size="sm">Start project for this product</Button>
            </Link>
          </div>
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Product eng / sustainment tasks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {productEngTasks.length === 0 && (
                <p className="text-xs text-slate-500">No product tasks yet.</p>
              )}
              {productEngTasks.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    <span className="font-mono text-slate-500">{t.number}</span>{" "}
                    {t.name}
                    <span className="ml-2 text-[10px] text-slate-600">
                      {t.discipline || "—"} · {t.kind}
                    </span>
                  </span>
                  <StatusBadge status={t.status} />
                </div>
              ))}
              <p className="text-[11px] text-slate-600">
                Create BOM/doc/process tasks on the MFG_ENG sustainment board
                without opening a project.
              </p>
            </CardContent>
          </Card>
          {linkedProjects.length === 0 ? (
            <p className="text-sm text-slate-500">
              No PMO projects linked yet. Create a project and set this product
              as primary so PDRs, CDRs, requirements, and NRE costs roll up here.
            </p>
          ) : (
            <div className="space-y-2">
              {linkedProjects.map((p) => (
                <Card key={p.id} className="border-slate-800">
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Link
                          href={`/pmo/projects/${p.id}`}
                          className="font-mono text-sm text-teal-400 hover:underline"
                        >
                          {p.number}
                        </Link>{" "}
                        <span className="font-medium text-slate-100">
                          {p.name}
                        </span>
                        <p className="text-xs text-slate-500">
                          {p.program
                            ? `${p.program.code} · `
                            : ""}
                          {p.methodology} · {p.phase} · Dev{" "}
                          {formatCurrency(p.developmentActual)} /{" "}
                          {formatCurrency(p.developmentBudget)}
                        </p>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                    {p.costEntries.length > 0 && (
                      <ul className="mt-2 space-y-0.5 border-t border-slate-800 pt-2 text-xs text-slate-500">
                        {p.costEntries.slice(0, 5).map((e) => (
                          <li key={e.id} className="flex justify-between">
                            <span>
                              {formatDate(e.entryDate)} · {e.category}{" "}
                              {e.description || ""}
                            </span>
                            <span className="tabular-nums text-slate-300">
                              {formatCurrency(e.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TEAM ── */}
      {tab === "team" && (
        <div className="space-y-4">
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Core ownership</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <p className="text-[10px] uppercase text-slate-500">Owner</p>
                <p className="text-slate-200">
                  {product.productOwner?.name || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500">
                  Engineering lead
                </p>
                <p className="text-slate-200">
                  {product.engineeringLead?.name || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500">CM owner</p>
                <p className="text-slate-200">
                  {product.cmOwner?.name || "—"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Team members</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {product.members.length === 0 && (
                <p className="text-xs text-slate-500">No additional members.</p>
              )}
              {product.members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm"
                >
                  <div>
                    <span className="text-slate-200">{m.user.name}</span>
                    <span className="ml-2 text-[10px] uppercase text-slate-500">
                      {m.role}
                    </span>
                    <span className="ml-2 text-[11px] text-slate-600">
                      {m.user.role}
                    </span>
                  </div>
                  <form action={actionRemoveProductMember}>
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="id" value={m.id} />
                    <Button type="submit" size="sm" variant="ghost" className="text-rose-400">
                      Remove
                    </Button>
                  </form>
                </div>
              ))}

              <form
                action={actionAddProductMember}
                className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-3"
              >
                <input type="hidden" name="productId" value={product.id} />
                <select name="userId" required className={selectClass}>
                  <option value="">— User —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
                <select name="role" className={selectClass} defaultValue="OTHER">
                  <option value="OWNER">Owner</option>
                  <option value="ENG_LEAD">Eng lead</option>
                  <option value="CM">CM</option>
                  <option value="QUALITY">Quality</option>
                  <option value="MANUFACTURING">Manufacturing</option>
                  <option value="SUPPLY_CHAIN">Supply chain</option>
                  <option value="OTHER">Other</option>
                </select>
                <Button type="submit" size="sm">
                  Add member
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── EDIT ── */}
      {tab === "edit" && (
        <form action={actionUpdateProduct} className="space-y-4">
          <input type="hidden" name="id" value={product.id} />
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Identity & description</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Name *
                </label>
                <Input name="name" required defaultValue={product.name} className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Revision
                </label>
                <Input
                  name="revision"
                  defaultValue={product.revision}
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Status
                </label>
                <select
                  name="status"
                  className={`${selectClass} mt-1`}
                  defaultValue={product.status}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="ON_HOLD">On hold</option>
                  <option value="CANCELLED">Cancelled</option>
                  <option value="OBSOLETE">Obsolete</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Short description
                </label>
                <Input
                  name="description"
                  defaultValue={product.description || ""}
                  className="mt-1"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Overview
                </label>
                <Textarea
                  name="overview"
                  rows={5}
                  defaultValue={product.overview || ""}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Family
                </label>
                <Input
                  name="productFamily"
                  defaultValue={product.productFamily || ""}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Line
                </label>
                <Input
                  name="productLine"
                  defaultValue={product.productLine || ""}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Model
                </label>
                <Input
                  name="modelNumber"
                  defaultValue={product.modelNumber || ""}
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Market
                </label>
                <Input
                  name="marketSegment"
                  defaultValue={product.marketSegment || ""}
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Ownership & commercial</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Product owner
                </label>
                <select
                  name="productOwnerId"
                  className={`${selectClass} mt-1`}
                  defaultValue={product.productOwnerId || ""}
                >
                  <option value="">—</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Eng lead
                </label>
                <select
                  name="engineeringLeadId"
                  className={`${selectClass} mt-1`}
                  defaultValue={product.engineeringLeadId || ""}
                >
                  <option value="">—</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  CM owner
                </label>
                <select
                  name="cmOwnerId"
                  className={`${selectClass} mt-1`}
                  defaultValue={product.cmOwnerId || ""}
                >
                  <option value="">—</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Customer
                </label>
                <select
                  name="customerId"
                  className={`${selectClass} mt-1`}
                  defaultValue={product.customerId || ""}
                >
                  <option value="">—</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Customer name (free text)
                </label>
                <Input
                  name="customerName"
                  defaultValue={product.customerName || ""}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Top-level part
                </label>
                <select
                  name="topLevelPartId"
                  className={`${selectClass} mt-1`}
                  defaultValue={product.topLevelPartId || ""}
                >
                  <option value="">—</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.partNumber} — {p.description}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Target cost
                </label>
                <Input
                  name="targetCost"
                  type="number"
                  step="0.01"
                  defaultValue={product.targetCost ?? ""}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Standard cost
                </label>
                <Input
                  name="standardCost"
                  type="number"
                  step="0.01"
                  defaultValue={product.standardCost ?? ""}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Weight
                </label>
                <div className="mt-1 flex gap-2">
                  <Input
                    name="estimatedWeight"
                    type="number"
                    step="0.001"
                    defaultValue={product.estimatedWeight ?? ""}
                    className="flex-1"
                  />
                  <Input
                    name="weightUom"
                    defaultValue={product.weightUom || "LB"}
                    className="w-20 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Lead days
                </label>
                <Input
                  name="targetLeadDays"
                  type="number"
                  defaultValue={product.targetLeadDays ?? ""}
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Compliance & dates</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Export control
                </label>
                <select
                  name="exportControl"
                  className={`${selectClass} mt-1`}
                  defaultValue={product.exportControl || "NONE"}
                >
                  <option value="NONE">None</option>
                  <option value="EAR">EAR</option>
                  <option value="ITAR">ITAR</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    name="itarControlled"
                    defaultChecked={product.itarControlled}
                    className="rounded border-slate-600"
                  />
                  ITAR controlled
                </label>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Quality standard
                </label>
                <Input
                  name="qualityStandard"
                  defaultValue={product.qualityStandard || ""}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">NSN</label>
                <Input
                  name="nsn"
                  defaultValue={product.nsn || ""}
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">CAGE</label>
                <Input
                  name="cageCode"
                  defaultValue={product.cageCode || ""}
                  className="mt-1 font-mono"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="text-[10px] uppercase text-slate-500">
                  Regulatory notes
                </label>
                <Textarea
                  name="regulatoryNotes"
                  rows={2}
                  defaultValue={product.regulatoryNotes || ""}
                  className="mt-1"
                />
              </div>
              {(
                [
                  ["conceptDate", "Concept", product.conceptDate],
                  ["designStartDate", "Design start", product.designStartDate],
                  [
                    "developmentStartDate",
                    "Development",
                    product.developmentStartDate,
                  ],
                  [
                    "qualificationStartDate",
                    "Qualification",
                    product.qualificationStartDate,
                  ],
                  ["firstArticleDate", "First article", product.firstArticleDate],
                  [
                    "productionReleaseDate",
                    "Production release",
                    product.productionReleaseDate,
                  ],
                  [
                    "sustainmentStartDate",
                    "Sustainment",
                    product.sustainmentStartDate,
                  ],
                  ["eolDate", "EOL", product.eolDate],
                  ["obsoleteDate", "Obsolete", product.obsoleteDate],
                ] as const
              ).map(([name, label, val]) => (
                <div key={name}>
                  <label className="text-[10px] uppercase text-slate-500">
                    {label}
                  </label>
                  <Input
                    name={name}
                    type="date"
                    defaultValue={dateInputValue(val)}
                    className="mt-1"
                  />
                </div>
              ))}
              <div className="sm:col-span-3">
                <label className="text-[10px] uppercase text-slate-500">
                  Notes
                </label>
                <Textarea
                  name="notes"
                  rows={2}
                  defaultValue={product.notes || ""}
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>

          <Button type="submit">Save product</Button>
        </form>
      )}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex justify-between gap-2 border-b border-slate-800/60 py-1 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-300">{value || "—"}</span>
    </div>
  );
}
