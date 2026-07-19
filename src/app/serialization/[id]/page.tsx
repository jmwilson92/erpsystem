import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { getSerialGenealogy } from "@/lib/services/serialization";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SerialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const g = await getSerialGenealogy(id);
  if (!g) notFound();
  const { unit, wo, so, traceEvents } = g;

  return (
    <div className="space-y-6">
      <PageHeader
        title={unit.serial}
        description={`${unit.part.partNumber} — ${unit.part.description}`}
        actions={
          <Link href="/serialization">
            <Button size="sm" variant="outline">
              All serials
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={unit.status} />
        {unit.lotNumber && (
          <span className="font-mono text-xs text-slate-400">
            Lot {unit.lotNumber}
          </span>
        )}
        {wo && (
          <Link
            href={`/work-orders/${wo.id}`}
            className="text-xs text-sky-400 hover:underline"
          >
            Built on {wo.number}
          </Link>
        )}
        {so && (
          <Link
            href={`/sales/${so.id}`}
            className="text-xs text-sky-400 hover:underline"
          >
            For {so.number}
          </Link>
        )}
        {unit.rmas.map((r) => (
          <Link
            key={r.id}
            href={`/rma/${r.id}`}
            className="text-xs text-amber-400 hover:underline"
          >
            {r.number} · {r.status}
          </Link>
        ))}
      </div>

      {unit.installedIn.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Installed in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {unit.installedIn.map((link) => (
              <p key={link.id} className="text-sm">
                <Link
                  href={`/serialization/${link.parent.id}`}
                  className="font-mono text-xs text-sky-400 hover:underline"
                >
                  {link.parent.serial}
                </Link>
                <span className="ml-2 text-xs text-slate-500">
                  {link.parent.part.partNumber} — {link.parent.part.description}
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            As-built components ({unit.components.length})
          </CardTitle>
          <p className="text-xs text-slate-500">
            What went into THIS unit — serialized components by exact serial,
            the rest by lot. Written when the work order&apos;s units were
            serialized at putaway.
          </p>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2">Component</th>
                <th className="pb-2">Serialized</th>
                <th className="pb-2">Component serial</th>
                <th className="pb-2">Lot</th>
                <th className="pb-2 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {unit.components.map((c) => (
                <tr key={c.id} className="border-t border-slate-800/60">
                  <td className="py-2">
                    <span className="font-mono text-xs text-teal-400">
                      {c.componentPart.partNumber}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {c.componentPart.description}
                    </span>
                  </td>
                  <td className="py-2 text-xs">
                    {c.componentPart.isSerialized ? (
                      <StatusBadge status="SERIALIZED" />
                    ) : (
                      <span className="text-slate-600">lot-tracked</span>
                    )}
                  </td>
                  <td className="py-2">
                    {c.componentSerial ? (
                      <Link
                        href={`/serialization/${c.componentSerial.id}`}
                        className="font-mono text-xs text-sky-400 hover:underline"
                      >
                        {c.componentSerial.serial}
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="py-2 font-mono text-xs text-slate-400">
                    {c.lotNumber || "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">{c.quantity}</td>
                </tr>
              ))}
              {unit.components.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500">
                    No as-built recorded — this serial predates as-built
                    capture or was registered outside a work order.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {traceEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Trace events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {traceEvents.map((e) => (
              <p key={e.id} className="text-xs text-slate-400">
                <span className="text-slate-500">{formatDate(e.createdAt)}</span>
                <span className="ml-2 font-medium text-slate-300">
                  {e.eventType}
                </span>
                {e.notes && <span className="ml-2">{e.notes}</span>}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
