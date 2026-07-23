import Link from "next/link";
import { listSerials } from "@/lib/services/serials";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function SerialsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q) || "";
  const serials = await listSerials({ q: q || undefined, take: 100 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Serial traceability"
        description="Lookup top-level serials and walk the as-built install tree"
      />
      <form method="get" className="flex flex-wrap gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Serial or lot…"
          className="max-w-xs"
        />
        <Button type="submit" size="sm">
          Search
        </Button>
      </form>
      <Card className="border-slate-800" data-tour="serial-list">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Serial</th>
                <th className="px-3 py-2 text-left">Part</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Warranty end</th>
              </tr>
            </thead>
            <tbody>
              {serials.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-slate-800/60 hover:bg-slate-900/40"
                >
                  <td className="px-3 py-2 font-mono text-teal-400">
                    <Link
                      href={`/trace/serials/${encodeURIComponent(s.serial)}`}
                      className="hover:underline"
                    >
                      {s.serial}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-slate-400">
                      {s.part.partNumber}
                    </span>{" "}
                    {s.part.description}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {s.customer
                      ? `${s.customer.code} · ${s.customer.name}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums text-slate-400">
                    {s.warrantyEnd
                      ? s.warrantyEnd.toISOString().slice(0, 10)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!serials.length && (
            <p className="p-6 text-center text-sm text-slate-500">
              No serials match. Mint serials on WO complete or receive.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
