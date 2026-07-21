import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { getPartCommitments, getPartCommittedTotal } from "@/lib/services/commitments";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionReleaseCommitment } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function CommittedInventoryPage({
  params,
}: {
  params: Promise<{ partId: string }>;
}) {
  const { partId } = await params;
  const part = await prisma.part.findUnique({
    where: { id: partId },
    select: { id: true, partNumber: true, description: true },
  });
  if (!part) notFound();

  const user = await getCurrentUser();
  const canRelease = await userHasPermission(user?.id, "inventory.putaway");

  const [commitments, total] = await Promise.all([
    getPartCommitments(partId),
    getPartCommittedTotal(partId),
  ]);
  const accountedFor = commitments.reduce((s, c) => s + c.committedQty, 0);
  const unlinked = Math.max(0, total - accountedFor);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Committed stock · ${part.partNumber}`}
        description={`${part.description || ""} — ${total} unit(s) reserved. Release frees stock so material shortage (MRS) and kitting can use it.`}
        actions={
          <Link href={`/items/${part.id}`}>
            <Button size="sm" variant="outline">
              Part detail
            </Button>
          </Link>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Commitments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {commitments.length === 0 && unlinked === 0 && (
            <p className="text-sm text-slate-500">
              Nothing committed — all on-hand stock is available.
            </p>
          )}

          {commitments.map((c) => (
            <div
              key={c.salesOrderId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 p-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-slate-200">
                  {c.salesOrderId ? (
                    <Link
                      href={`/sales/${c.salesOrderId}`}
                      className="font-mono text-teal-400 hover:underline"
                    >
                      {c.salesOrderNumber || "SO"}
                    </Link>
                  ) : (
                    "Unlinked"
                  )}
                  <span className="ml-2 text-xs text-slate-500">
                    {c.customerName || ""}
                    {c.projectNumber ? ` · project ${c.projectNumber}` : ""}
                  </span>
                </p>
                <p className="text-xs text-sky-400">
                  {c.committedQty} unit(s) reserved
                </p>
              </div>
              {canRelease && (
                <form
                  action={actionReleaseCommitment}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <input type="hidden" name="partId" value={part.id} />
                  <input type="hidden" name="salesOrderId" value={c.salesOrderId || ""} />
                  <Input
                    name="qty"
                    type="number"
                    min="1"
                    step="any"
                    max={c.committedQty}
                    defaultValue={c.committedQty}
                    className="h-8 w-20 text-right text-xs"
                  />
                  <Input
                    name="reason"
                    required
                    placeholder="Reason (owner sees this)"
                    className="h-8 w-52 text-xs"
                  />
                  <Button type="submit" size="sm" variant="outline" className="h-8">
                    Release
                  </Button>
                </form>
              )}
            </div>
          ))}

          {unlinked > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div>
                <p className="text-sm text-slate-300">Unlinked reservation</p>
                <p className="text-xs text-sky-400">
                  {unlinked} unit(s) committed with no traceable sales order
                </p>
              </div>
              {canRelease && (
                <form
                  action={actionReleaseCommitment}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <input type="hidden" name="partId" value={part.id} />
                  <Input
                    name="qty"
                    type="number"
                    min="1"
                    step="any"
                    max={unlinked}
                    defaultValue={unlinked}
                    className="h-8 w-20 text-right text-xs"
                  />
                  <Input
                    name="reason"
                    required
                    placeholder="Reason"
                    className="h-8 w-52 text-xs"
                  />
                  <Button type="submit" size="sm" variant="outline" className="h-8">
                    Release
                  </Button>
                </form>
              )}
            </div>
          )}

          {!canRelease && total > 0 && (
            <p className="text-[11px] text-slate-500">
              Releasing reserved stock needs inventory authority (owner approval).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
