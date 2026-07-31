import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FORCE_LABELS,
  forceState,
  getDeviation,
  hasBound,
  KIND_LABELS,
} from "@/lib/services/deviations";
import {
  actionAddUnit,
  actionApprove,
  actionClose,
  actionConsume,
  actionCustomerApproval,
  actionReject,
  actionRemoveUnit,
  actionSubmit,
} from "../actions";

export const dynamic = "force-dynamic";

const th = "pb-2 text-left text-xs uppercase tracking-wide text-slate-500";

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

export default async function DeviationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await getDeviation(id);
  if (!d) notFound();

  const state = forceState(d);
  const bounded = hasBound(d);
  const remaining =
    d.quantityLimit != null ? d.quantityLimit - d.quantityUsed : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${d.number} — ${d.title}`}
        description={KIND_LABELS[d.kind]}
      />

      <Link href="/deviations" className="text-sm text-sky-300 hover:underline">
        ← Register
      </Link>

      {sp.error && (
        <div className="rounded-md border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {sp.error}
        </div>
      )}

      {!bounded && (
        <Card className="border-rose-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-rose-300">Unbounded</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-300">
            This authorisation has no quantity limit, no end date and no listed
            units. It cannot be approved until one of those is set — an
            open-ended departure from requirement is the finding an auditor
            writes up first.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold text-slate-100">{d.status}</p>
            <p
              className={`mt-1 text-xs ${
                state === "IN_FORCE"
                  ? "text-emerald-300"
                  : state === "EXPIRED" || state === "EXHAUSTED"
                    ? "text-amber-300"
                    : "text-slate-500"
              }`}
            >
              {FORCE_LABELS[state]}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Quantity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold text-slate-100">
              {d.quantityLimit != null
                ? `${d.quantityUsed} / ${d.quantityLimit}`
                : "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {remaining != null ? `${remaining} remaining` : "no quantity bound"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Window</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-200">
              {fmtDate(d.effectiveFrom)} – {fmtDate(d.effectiveTo)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-200">
              {!d.customerApprovalRequired
                ? "Not required"
                : d.customerApprovedAt
                  ? `Approved ${fmtDate(d.customerApprovedAt)}`
                  : "Outstanding"}
            </p>
            {d.customerReference && (
              <p className="mt-1 font-mono text-xs text-slate-500">
                {d.customerReference}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The departure</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Requirement departed from
            </p>
            <p className="text-slate-200">{d.requirement}</p>
          </div>
          {d.description && (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Description
              </p>
              <p className="text-slate-300">{d.description}</p>
            </div>
          )}
          {d.justification && (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Justification
              </p>
              <p className="text-slate-300">{d.justification}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-4 pt-2 text-xs text-slate-500">
            <span>
              Part:{" "}
              {d.part ? (
                <Link
                  href={`/items/${d.part.id}`}
                  className="font-mono text-sky-300 hover:underline"
                >
                  {d.part.partNumber}
                </Link>
              ) : (
                "—"
              )}
            </span>
            <span>
              Contract:{" "}
              {d.contract ? (
                <Link
                  href={`/contracts/${d.contract.id}`}
                  className="font-mono text-sky-300 hover:underline"
                >
                  {d.contract.number}
                </Link>
              ) : (
                "—"
              )}
            </span>
            <span>NCR: {d.nonConformance?.number || "—"}</span>
            <span>Requested by: {d.requestedBy?.name || "—"}</span>
            <span>
              Approved by: {d.approvedBy?.name || "—"}{" "}
              {d.approvedAt ? `(${fmtDate(d.approvedAt)})` : ""}
            </span>
          </div>
          {d.rejectedReason && (
            <p className="rounded-md border border-rose-800/60 bg-rose-950/20 px-3 py-2 text-rose-200">
              Rejected: {d.rejectedReason}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          {(d.status === "DRAFT" || d.status === "REJECTED") && (
            <form action={actionSubmit}>
              <input type="hidden" name="id" value={d.id} />
              <Button type="submit">Submit for approval</Button>
            </form>
          )}

          {d.status !== "APPROVED" && d.status !== "CLOSED" && (
            <form action={actionApprove}>
              <input type="hidden" name="id" value={d.id} />
              <Button type="submit" variant="outline">
                Approve
              </Button>
            </form>
          )}

          {d.status !== "CLOSED" && (
            <form action={actionReject} className="flex items-end gap-2">
              <input type="hidden" name="id" value={d.id} />
              <label className="text-xs text-slate-400">
                Reason
                <Input name="reason" className="h-8 w-48" />
              </label>
              <Button type="submit" variant="outline">
                Reject
              </Button>
            </form>
          )}

          {d.customerApprovalRequired && !d.customerApprovedAt && (
            <form action={actionCustomerApproval} className="flex items-end gap-2">
              <input type="hidden" name="id" value={d.id} />
              <label className="text-xs text-slate-400">
                Customer reference
                <Input
                  name="customerReference"
                  placeholder="SDR / letter no."
                  className="h-8 w-44"
                />
              </label>
              <Button type="submit" variant="outline">
                Record customer approval
              </Button>
            </form>
          )}

          {state === "IN_FORCE" && (
            <form action={actionConsume} className="flex items-end gap-2">
              <input type="hidden" name="id" value={d.id} />
              <label className="text-xs text-slate-400">
                Consume
                <Input
                  name="qty"
                  type="number"
                  min="1"
                  defaultValue="1"
                  className="h-8 w-20"
                />
              </label>
              <Button type="submit" variant="outline">
                Record use
              </Button>
            </form>
          )}

          {d.status !== "CLOSED" && (
            <form action={actionClose}>
              <input type="hidden" name="id" value={d.id} />
              <Button type="submit" variant="outline">
                Close
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Units covered</CardTitle>
        </CardHeader>
        <CardContent>
          {d.units.length === 0 ? (
            <p className="py-2 text-sm text-slate-500">
              No explicit units listed — the quantity or date bound governs, and
              the authorisation covers any unit of the part it names.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>Serial</th>
                    <th className={th}>Lot</th>
                    <th className={th}>Note</th>
                    <th className={th}>Added</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {d.units.map((u) => (
                    <tr key={u.id}>
                      <td className="py-2 font-mono text-slate-200">
                        {u.serial || "—"}
                      </td>
                      <td className="py-2 font-mono text-slate-400">
                        {u.lotNumber || "—"}
                      </td>
                      <td className="py-2 text-slate-400">{u.note || "—"}</td>
                      <td className="py-2 text-slate-500">{fmtDate(u.addedAt)}</td>
                      <td className="py-2">
                        <form action={actionRemoveUnit}>
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="unitId" value={u.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Remove
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form
            action={actionAddUnit}
            className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-800 pt-4"
          >
            <input type="hidden" name="id" value={d.id} />
            <label className="text-sm text-slate-400">
              Serial
              <Input name="serial" placeholder="SN-00123" className="w-40" />
            </label>
            <label className="text-sm text-slate-400">
              Lot
              <Input name="lotNumber" placeholder="LOT-77" className="w-40" />
            </label>
            <label className="text-sm text-slate-400">
              Note
              <Input name="note" className="w-56" />
            </label>
            <Button type="submit">Bind unit</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
