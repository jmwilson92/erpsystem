import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import { listRmas } from "@/lib/services/serialization";
import { actionCreateRma } from "@/app/actions";
import { prisma } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function RmaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const status = pick(sp, "status");

  const [rmas, customers, salesOrders, parts, shippedSerials] =
    await Promise.all([
      listRmas({ status: status || undefined }),
      prisma.customer.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true },
      }),
      prisma.salesOrder.findMany({
        orderBy: { number: "desc" },
        select: { id: true, number: true },
        take: 50,
      }),
      prisma.part.findMany({
        where: { isActive: true },
        orderBy: { partNumber: "asc" },
        select: { id: true, partNumber: true },
        take: 200,
      }),
      prisma.serialNumber.findMany({
        orderBy: { serial: "asc" },
        select: { id: true, serial: true, status: true },
        take: 200,
      }),
    ]);

  const open = rmas.filter(
    (r) => !["CLOSED", "REJECTED"].includes(r.status)
  ).length;
  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="RMA / Customer Returns"
        description="Authorize, receive, evaluate, and disposition customer returns — serialized units land in quarantine on receipt"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="Open RMAs" value={String(open)} />
        <StatCard
          title="Awaiting receipt"
          value={String(rmas.filter((r) => r.status === "AUTHORIZED").length)}
        />
        <StatCard
          title="Awaiting disposition"
          value={String(
            rmas.filter((r) =>
              ["RECEIVED", "IN_EVALUATION"].includes(r.status)
            ).length
          )}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New RMA</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={actionCreateRma}
            className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
          >
            <label className="text-xs text-slate-400">
              Customer *
              <select name="customerId" required className={`mt-1 ${selectClass}`}>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Sales order
              <select name="salesOrderId" className={`mt-1 ${selectClass}`}>
                <option value="">— None —</option>
                {salesOrders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Part
              <select name="partId" className={`mt-1 ${selectClass}`}>
                <option value="">— None —</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Serial (if serialized unit)
              <select name="serialNumberId" className={`mt-1 ${selectClass}`}>
                <option value="">— None —</option>
                {shippedSerials.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.serial} · {s.status}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Quantity
              <Input
                name="quantity"
                type="number"
                min="1"
                step="1"
                defaultValue="1"
                className="mt-1 h-9"
              />
            </label>
            <label className="text-xs text-slate-400 md:col-span-2 lg:col-span-3">
              Reason *
              <Textarea
                name="reason"
                required
                rows={2}
                className="mt-1"
                placeholder="What the customer reported — failure mode, damage, wrong item…"
              />
            </label>
            <div>
              <Button type="submit" size="sm">
                Create RMA
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>RMAs ({rmas.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-2">RMA</th>
                  <th className="pb-2">Customer</th>
                  <th className="pb-2">Part / Serial</th>
                  <th className="pb-2">SO</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Disposition</th>
                  <th className="pb-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {rmas.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800/60">
                    <td className="py-2">
                      <Link
                        href={`/rma/${r.id}`}
                        className="font-mono text-xs text-sky-400 hover:underline"
                      >
                        {r.number}
                      </Link>
                    </td>
                    <td className="py-2 text-xs">{r.customer?.name ?? "—"}</td>
                    <td className="py-2 text-xs">
                      {r.part?.partNumber && (
                        <span className="font-mono text-teal-400">
                          {r.part.partNumber}
                        </span>
                      )}
                      {r.serialNumber && (
                        <Link
                          href={`/serialization/${r.serialNumber.id}`}
                          className="ml-2 font-mono text-sky-400 hover:underline"
                        >
                          {r.serialNumber.serial}
                        </Link>
                      )}
                      {!r.part && !r.serialNumber && "—"}
                    </td>
                    <td className="py-2 text-xs">
                      {r.salesOrder ? (
                        <Link
                          href={`/sales/${r.salesOrder.id}`}
                          className="text-sky-400 hover:underline"
                        >
                          {r.salesOrder.number}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-2 text-xs text-slate-400">
                      {r.disposition || "—"}
                    </td>
                    <td className="py-2 text-xs text-slate-500">
                      {formatDate(r.createdAt)}
                    </td>
                  </tr>
                ))}
                {rmas.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500">
                      No RMAs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
