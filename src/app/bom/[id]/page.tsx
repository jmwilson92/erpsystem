import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import {
  actionCertifyBom,
  actionCertifyBomForPrototype,
  actionCreateWoFromBom,
} from "@/app/actions";
import { compareBomRevisions, whereUsed } from "@/lib/services/bom";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BomDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bom = await prisma.bomHeader.findUnique({
    where: { id },
    include: {
      part: true,
      lines: { include: { componentPart: true }, orderBy: { sortOrder: "asc" } },
      workOrders: { take: 5, orderBy: { createdAt: "desc" } },
    },
  });
  if (!bom) notFound();

  const revisions = await prisma.bomHeader.findMany({
    where: { partId: bom.partId },
    orderBy: { revision: "asc" },
  });

  let comparison = null;
  if (revisions.length >= 2) {
    const other = revisions.find((r) => r.id !== bom.id);
    if (other) {
      comparison = await compareBomRevisions(
        revisions[revisions.length - 2].id,
        revisions[revisions.length - 1].id
      );
    }
  }

  const usedIn = await whereUsed(bom.partId);

  const hasCompletedProto =
    (await prisma.workOrder.count({
      where: { bomHeaderId: bom.id, type: "PROTOTYPE", status: "COMPLETED" },
    })) > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${bom.part.partNumber} · Rev ${bom.revision}`}
        description={
          bom.drawingNumber
            ? `Drawing ${bom.drawingNumber}${
                bom.originEcrNumber ? ` · ${bom.originEcrNumber}` : ""
              } — ${bom.description || bom.part.description || ""}`
            : bom.description || bom.part.description
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/items/${bom.partId}`}>
              <Button type="button" size="sm" variant="outline">
                Item card
              </Button>
            </Link>
            <Link href="/bom">
              <Button type="button" size="sm" variant="outline">
                All BOMs
              </Button>
            </Link>
            {["DRAFT", "IN_REVIEW"].includes(bom.status) && (
              <form action={actionCertifyBomForPrototype}>
                <input type="hidden" name="bomHeaderId" value={bom.id} />
                <Button type="submit" size="sm">
                  Certify for Prototype
                </Button>
              </form>
            )}
            {bom.status === "PROTOTYPE" && (
              <>
                <form action={actionCreateWoFromBom}>
                  <input type="hidden" name="bomHeaderId" value={bom.id} />
                  <input type="hidden" name="quantity" value="1" />
                  <input type="hidden" name="type" value="PROTOTYPE" />
                  <Button type="submit" size="sm" variant="amber">
                    Create Prototype WO
                  </Button>
                </form>
                <form action={actionCertifyBom}>
                  <input type="hidden" name="bomHeaderId" value={bom.id} />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!hasCompletedProto}
                    title={
                      hasCompletedProto
                        ? undefined
                        : "Complete a prototype work order first"
                    }
                  >
                    Certify for Production
                  </Button>
                </form>
              </>
            )}
            {bom.status === "CERTIFIED" && (
              <form action={actionCreateWoFromBom}>
                <input type="hidden" name="bomHeaderId" value={bom.id} />
                <input type="hidden" name="quantity" value="1" />
                <input type="hidden" name="type" value="PRODUCTION" />
                <Button type="submit" size="sm">
                  Create Production WO
                </Button>
              </form>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={bom.status} />
        {bom.isPrototype && <StatusBadge status="PROTOTYPE" />}
        {bom.certifiedAt && (
          <span className="text-xs text-slate-500">
            Certified {formatDate(bom.certifiedAt)}
          </span>
        )}
      </div>

      {["DRAFT", "IN_REVIEW"].includes(bom.status) && (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
          <strong>In-work BOM</strong> — edit the components on the item card, then
          <strong> Certify for Prototype</strong>. Prototype certification unlocks
          release of the originating drawing.
        </div>
      )}

      {bom.status === "PROTOTYPE" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <strong>Prototype-certified BOM</strong> — the drawing can be released and a
          prototype work order run.{" "}
          {hasCompletedProto
            ? "The prototype WO is complete — certify this BOM for production to unlock production work orders."
            : "Once the prototype WO reaches COMPLETED, Certify for Production becomes available."}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-slate-500">Revisions:</span>
        {revisions.map((r) => (
          <Link
            key={r.id}
            href={`/bom/${r.id}`}
            className={`rounded border px-2 py-0.5 font-mono text-xs ${
              r.id === bom.id
                ? "border-teal-500 text-teal-400"
                : "border-slate-700 text-slate-400 hover:border-slate-500"
            }`}
          >
            Rev {r.revision} ({r.status})
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Components</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="pb-2">Find</th>
                <th className="pb-2">Part Number</th>
                <th className="pb-2">Description</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Std Cost</th>
              </tr>
            </thead>
            <tbody>
              {bom.lines.map((l) => (
                <tr key={l.id} className="border-t border-slate-800/60">
                  <td className="py-2 font-mono text-xs text-slate-500">{l.findNumber}</td>
                  <td className="py-2 font-mono">
                    <Link
                      href={`/items/${l.componentPart.id}`}
                      className="text-teal-400 hover:underline"
                    >
                      {l.componentPart.partNumber}
                    </Link>
                  </td>
                  <td className="py-2 text-slate-300">{l.componentPart.description}</td>
                  <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2 text-right tabular-nums text-slate-400">
                    ${l.componentPart.standardCost.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {comparison && (
        <Card>
          <CardHeader>
            <CardTitle>
              Revision Diff: {comparison.a.revision} → {comparison.b.revision}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <p className="mb-1 text-xs font-medium text-emerald-400">Added</p>
              {comparison.added.length === 0 && (
                <p className="text-slate-600">None</p>
              )}
              {comparison.added.map((l) => (
                <p key={l.id} className="text-slate-300">
                  + {l.componentPart.partNumber} qty {l.quantity}
                </p>
              ))}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-red-400">Removed</p>
              {comparison.removed.length === 0 && (
                <p className="text-slate-600">None</p>
              )}
              {comparison.removed.map((l) => (
                <p key={l.id} className="text-slate-300">
                  − {l.componentPart.partNumber}
                </p>
              ))}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-amber-400">Qty Changed</p>
              {comparison.changed.length === 0 && (
                <p className="text-slate-600">None</p>
              )}
              {comparison.changed.map((c) => (
                <p key={c.partNumber} className="text-slate-300">
                  {c.partNumber}: {c.fromQty} → {c.toQty}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Where Used (this part as component)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {usedIn.length === 0 && <p className="text-slate-500">Top-level assembly</p>}
            {usedIn.map((u) => (
              <Link
                key={u.id}
                href={`/bom/${u.bomHeaderId}`}
                className="block text-slate-300 hover:text-teal-400"
              >
                {u.bomHeader.part.partNumber} Rev {u.bomHeader.revision} (
                {u.bomHeader.status})
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Work Orders Using This BOM</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {bom.workOrders.length === 0 && (
              <p className="text-slate-500">No work orders yet</p>
            )}
            {bom.workOrders.map((wo) => (
              <Link
                key={wo.id}
                href={`/work-orders/${wo.id}`}
                className="flex items-center justify-between hover:text-teal-400"
              >
                <span className="font-mono">{wo.number}</span>
                <StatusBadge status={wo.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
