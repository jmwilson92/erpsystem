import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import { listSerials } from "@/lib/services/serialization";
import { prisma } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STATUSES = [
  "IN_STOCK",
  "ISSUED",
  "INSTALLED",
  "SHIPPED",
  "QUARANTINE",
  "SCRAPPED",
];

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function SerializationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = pick(sp, "q").trim();
  const status = pick(sp, "status");

  const [serials, counts] = await Promise.all([
    listSerials({ search: q || undefined, status: status || undefined }),
    prisma.serialNumber.groupBy({ by: ["status"], _count: true }),
  ]);
  const countBy = Object.fromEntries(counts.map((c) => [c.status, c._count]));

  const selectClass =
    "flex h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Serial Registry"
        description="Every serialized unit — status, build source, and per-unit as-built genealogy"
        actions={
          <Link href="/reports/export?key=serial-genealogy">
            <Button size="sm" variant="outline">
              Export genealogy CSV
            </Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard title="In stock" value={String(countBy.IN_STOCK || 0)} />
        <StatCard title="Installed" value={String(countBy.INSTALLED || 0)} />
        <StatCard title="Shipped" value={String(countBy.SHIPPED || 0)} />
        <StatCard title="Quarantine" value={String(countBy.QUARANTINE || 0)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Serials ({serials.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="GET" className="mb-4 flex flex-wrap gap-2">
            <Input
              name="q"
              defaultValue={q}
              placeholder="Search serial / part / lot…"
              className="h-9 w-64"
            />
            <select name="status" defaultValue={status} className={selectClass}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="outline">
              Filter
            </Button>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-2">Serial</th>
                  <th className="pb-2">Part</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Lot</th>
                  <th className="pb-2 text-right">As-built lines</th>
                  <th className="pb-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {serials.map((s) => (
                  <tr key={s.id} className="border-t border-slate-800/60">
                    <td className="py-2">
                      <Link
                        href={`/serialization/${s.id}`}
                        className="font-mono text-xs text-sky-400 hover:underline"
                      >
                        {s.serial}
                      </Link>
                    </td>
                    <td className="py-2">
                      <span className="font-mono text-xs text-teal-400">
                        {s.part.partNumber}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {s.part.description}
                      </span>
                    </td>
                    <td className="py-2">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="py-2 font-mono text-xs text-slate-400">
                      {s.lotNumber || "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {s._count.components || "—"}
                    </td>
                    <td className="py-2 text-xs text-slate-500">
                      {formatDate(s.createdAt)}
                    </td>
                  </tr>
                ))}
                {serials.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      No serials yet — complete a work order for a serialized
                      part and its units will register here.
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
