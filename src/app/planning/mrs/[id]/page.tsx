import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import {
  actionReleaseMaterialRequisition,
  actionUpdateMrsLine,
  actionAddMrsLine,
  actionRemoveMrsLine,
} from "@/app/actions";
import Link from "next/link";
import { Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "h-8 rounded-lg border border-slate-700 bg-slate-950 px-1.5 text-xs text-slate-200";

export default async function MrsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const mrs = await prisma.materialRequisition.findUnique({
    where: { id },
    include: {
      forecast: true,
      lines: {
        include: {
          part: true,
          workOrder: { select: { id: true, number: true, status: true } },
          purchaseRequest: {
            select: {
              id: true,
              number: true,
              status: true,
              purchaseOrders: {
                select: { id: true, number: true, status: true },
              },
            },
          },
        },
        orderBy: [{ action: "asc" }, { id: "asc" }],
      },
      workOrders: {
        include: { part: true },
        orderBy: { createdAt: "desc" },
      },
      purchaseRequests: {
        select: {
          id: true,
          number: true,
          status: true,
          totalEstimate: true,
          purchaseOrders: { select: { id: true, number: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!mrs) notFound();

  const canEdit =
    !!user &&
    !["CLOSED", "CANCELLED"].includes(mrs.status) &&
    (user.role === "ADMIN" ||
      (await userHasPermission(user.id, "planning.mrs.release")));

  const addableParts = canEdit
    ? await prisma.part.findMany({
        where: { isActive: true },
        orderBy: { partNumber: "asc" },
        take: 500,
        select: { id: true, partNumber: true, description: true },
      })
    : [];

  const buildLines = mrs.lines.filter((l) => l.action === "BUILD");
  const buyLines = mrs.lines.filter((l) => l.action === "BUY");
  const stockLines = mrs.lines.filter((l) => l.action === "STOCK");
  const canRelease =
    ["DRAFT", "RELEASED", "IN_PROGRESS"].includes(mrs.status) &&
    (buildLines.some((l) => l.shortQty > 0 && !l.workOrderId) ||
      buyLines.some((l) => l.shortQty > 0 && !l.purchaseRequestId));

  // Rebuild explosion tree order: top-level lines first, each followed by
  // its component lines (nested sub-BOMs indent deeper).
  type MrsLine = (typeof mrs.lines)[number];
  const byParent = new Map<string, MrsLine[]>();
  for (const l of mrs.lines) {
    const key = l.parentPartId || "__root__";
    const list = byParent.get(key) || [];
    list.push(l);
    byParent.set(key, list);
  }
  const treeLines: MrsLine[] = [];
  const seen = new Set<string>();
  function walk(parentKey: string) {
    for (const l of byParent.get(parentKey) || []) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      treeLines.push(l);
      walk(l.partId);
    }
  }
  walk("__root__");
  for (const l of mrs.lines) {
    if (!seen.has(l.id)) treeLines.push(l);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={mrs.number}
        description={mrs.name || "Material requisition sheet"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/planning">
              <Button size="sm" variant="outline">
                Planning
              </Button>
            </Link>
            {mrs.forecast && (
              <Link href={`/planning/forecasts/${mrs.forecast.id}`}>
                <Button size="sm" variant="outline">
                  Forecast {mrs.forecast.number}
                </Button>
              </Link>
            )}
            {canRelease && (
              <form action={actionReleaseMaterialRequisition}>
                <input
                  type="hidden"
                  name="materialRequisitionId"
                  value={mrs.id}
                />
                <Button type="submit" size="sm">
                  Release → create MWOs + PR
                </Button>
              </form>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={mrs.status} />
        {mrs.forecast && (
          <span className="rounded border border-sky-500/30 px-2 py-0.5 text-[10px] text-sky-400">
            From {mrs.forecast.number}
          </span>
        )}
        <span className="text-xs text-slate-500">
          Created {formatDate(mrs.createdAt)}
          {mrs.releasedAt ? ` · Released ${formatDate(mrs.releasedAt)}` : ""}
        </span>
      </div>

      {mrs.notes && <p className="text-sm text-slate-400">{mrs.notes}</p>}

      <p className="text-xs text-slate-500">
        Stock-netted plan:{" "}
        <strong className="text-violet-300">BUILD</strong> lines become{" "}
        <span className="font-mono text-violet-400">MWO-#####</span> and{" "}
        <strong className="text-amber-300">BUY</strong> shorts raise one{" "}
        <span className="font-mono text-amber-400">PR-#####</span> for
        purchasing (its POs link back here).{" "}
        <strong className="text-emerald-300">STOCK</strong> is covered by
        on-hand.
        {canEdit &&
          " The generated plan is a starting point — adjust quantities, switch actions, add or remove lines before release."}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>
            Requisition lines ({mrs.lines.length})
            <span className="ml-2 font-normal text-xs text-slate-500">
              BUILD {buildLines.length} · BUY {buyLines.length} · STOCK{" "}
              {stockLines.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[10px] uppercase text-slate-500">
                  <th className="pb-2">Part</th>
                  <th className="pb-2">Action</th>
                  <th className="pb-2 text-right">Required</th>
                  <th className="pb-2 text-right">On hand</th>
                  <th className="pb-2 text-right">Short</th>
                  <th className="pb-2 pl-5">Fulfillment</th>
                  {canEdit && <th className="pb-2">Adjust</th>}
                </tr>
              </thead>
              <tbody>
                {treeLines.map((l) => {
                  const locked = Boolean(l.workOrderId || l.purchaseRequestId);
                  return (
                    <tr
                      key={l.id}
                      className={`border-b border-slate-800/60 ${
                        l.action === "BUILD"
                          ? "bg-violet-500/5"
                          : l.action === "BUY"
                            ? "bg-amber-500/5"
                            : ""
                      }`}
                    >
                      <td className="py-2">
                        <div
                          style={{
                            paddingLeft: `${Math.min(l.level, 6) * 18}px`,
                          }}
                        >
                          <span className="flex items-center gap-1.5">
                            {l.level > 0 && (
                              <span className="text-slate-600">└</span>
                            )}
                            <Link
                              href={`/items/${l.partId}`}
                              className="font-mono text-teal-400 hover:underline"
                            >
                              {l.part.partNumber}
                            </Link>
                            {l.level > 1 && (
                              <span className="rounded bg-slate-800 px-1 text-[9px] text-slate-400">
                                L{l.level}
                              </span>
                            )}
                          </span>
                          <p className="text-[11px] text-slate-500">
                            {l.part.description}
                          </p>
                        </div>
                      </td>
                      <td className="py-2">
                        <StatusBadge status={l.action} />
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {l.requiredQty}
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-400">
                        {l.onHandQty}
                      </td>
                      <td
                        className={`py-2 text-right tabular-nums ${
                          l.shortQty > 0 ? "text-amber-400" : "text-slate-600"
                        }`}
                      >
                        {l.shortQty}
                      </td>
                      <td className="py-2 pl-5">
                        {l.workOrder ? (
                          <Link
                            href={`/work-orders/${l.workOrder.id}`}
                            className="font-mono text-violet-400 hover:underline"
                          >
                            {l.workOrder.number}
                          </Link>
                        ) : l.purchaseRequest ? (
                          <span className="space-y-0.5">
                            <Link
                              href={`/purchasing/pr/${l.purchaseRequest.id}`}
                              className="font-mono text-amber-400 hover:underline"
                            >
                              {l.purchaseRequest.number}
                            </Link>
                            <span className="ml-1.5 text-[10px] text-slate-500">
                              {l.purchaseRequest.status}
                            </span>
                            {l.purchaseRequest.purchaseOrders.map((po) => (
                              <Link
                                key={po.id}
                                href={`/purchasing/po/${po.id}`}
                                className="block font-mono text-[11px] text-sky-400 hover:underline"
                              >
                                → {po.number}{" "}
                                <span className="text-slate-500">
                                  {po.status}
                                </span>
                              </Link>
                            ))}
                          </span>
                        ) : (l.action === "BUILD" || l.action === "BUY") &&
                          l.shortQty > 0 ? (
                          <span className="text-[11px] text-slate-600">
                            Pending release
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      {canEdit && (
                        <td className="py-2">
                          {locked ? (
                            <span className="text-[10px] text-slate-600">
                              Released
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <form
                                action={actionUpdateMrsLine}
                                className="flex items-center gap-1.5"
                              >
                                <input
                                  type="hidden"
                                  name="lineId"
                                  value={l.id}
                                />
                                <input
                                  type="hidden"
                                  name="materialRequisitionId"
                                  value={mrs.id}
                                />
                                <Input
                                  name="requiredQty"
                                  type="number"
                                  min={0}
                                  step="any"
                                  defaultValue={l.requiredQty}
                                  className="h-8 w-20 text-xs"
                                />
                                <select
                                  name="action"
                                  className={selectClass}
                                  defaultValue={l.action}
                                >
                                  <option value="BUILD">BUILD</option>
                                  <option value="BUY">BUY</option>
                                  <option value="STOCK">STOCK</option>
                                </select>
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2 text-xs"
                                >
                                  Save
                                </Button>
                              </form>
                              <form action={actionRemoveMrsLine}>
                                <input
                                  type="hidden"
                                  name="lineId"
                                  value={l.id}
                                />
                                <input
                                  type="hidden"
                                  name="materialRequisitionId"
                                  value={mrs.id}
                                />
                                <button
                                  type="submit"
                                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 text-slate-500 hover:border-rose-500/40 hover:text-rose-400"
                                  aria-label="Remove line"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </form>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <Card className="border-teal-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Add line</CardTitle>
            <p className="text-xs text-slate-500">
              Supplement the generated plan — netted against current stock on
              add.
            </p>
          </CardHeader>
          <CardContent>
            <form
              action={actionAddMrsLine}
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
            >
              <input
                type="hidden"
                name="materialRequisitionId"
                value={mrs.id}
              />
              <select
                name="partId"
                required
                className={`${selectClass} h-9 lg:col-span-2`}
                defaultValue=""
              >
                <option value="" disabled>
                  Part…
                </option>
                {addableParts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNumber} — {p.description}
                  </option>
                ))}
              </select>
              <Input
                name="requiredQty"
                type="number"
                min={0}
                step="any"
                required
                placeholder="Qty"
                className="h-9"
              />
              <select name="action" className={`${selectClass} h-9`} defaultValue="">
                <option value="">Auto (by sourcing)</option>
                <option value="BUILD">BUILD</option>
                <option value="BUY">BUY</option>
                <option value="STOCK">STOCK</option>
              </select>
              <Button type="submit" size="sm" className="h-9">
                Add line
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Linked work orders ({mrs.workOrders.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {mrs.workOrders.length === 0 && (
              <p className="text-sm text-slate-500">
                No MWOs yet. Release this sheet to create them.
              </p>
            )}
            {mrs.workOrders.map((wo) => (
              <Link
                key={wo.id}
                href={`/work-orders/${wo.id}`}
                className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 hover:border-violet-500/30"
              >
                <div>
                  <span className="font-mono text-violet-400">{wo.number}</span>
                  <StatusBadge status={wo.status} className="ml-2" />
                  <p className="text-xs text-slate-400">
                    {wo.part?.partNumber} · qty {wo.quantity}
                  </p>
                </div>
                <span className="text-[11px] text-slate-600">
                  MRS {mrs.number}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Purchase requests ({mrs.purchaseRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {mrs.purchaseRequests.length === 0 && (
              <p className="text-sm text-slate-500">
                No PRs yet. Releasing with BUY shorts raises one automatically.
              </p>
            )}
            {mrs.purchaseRequests.map((pr) => (
              <Link
                key={pr.id}
                href={`/purchasing/pr/${pr.id}`}
                className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 hover:border-amber-500/30"
              >
                <div>
                  <span className="font-mono text-amber-400">{pr.number}</span>
                  <StatusBadge status={pr.status} className="ml-2" />
                  {pr.purchaseOrders.length > 0 && (
                    <p className="text-xs text-sky-400">
                      {pr.purchaseOrders
                        .map((po) => `${po.number} (${po.status})`)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <span className="text-[11px] text-slate-600">
                  MRS {mrs.number}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
