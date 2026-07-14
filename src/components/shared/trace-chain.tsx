import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/utils";
import type {
  MaterialGenealogyRow,
  TraceChainEvent,
} from "@/lib/services/traceability";
import { GitBranch, PackageSearch } from "lucide-react";

/** WO material genealogy — every kitted lot back to the PO it came in on. */
export function MaterialGenealogyCard({
  rows,
}: {
  rows: MaterialGenealogyRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <Card className="border-teal-900/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageSearch className="h-4 w-4 text-teal-400" />
          Material genealogy
        </CardTitle>
        <p className="text-xs text-slate-500">
          Every kitted lot traced back to the purchase order it was bought
          on — receipt, supplier, and receiving inspections included.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase text-slate-500">
                <th className="pb-2 pr-3">Component</th>
                <th className="pb-2 pr-3">Lot</th>
                <th className="pb-2 pr-3 text-right">Qty</th>
                <th className="pb-2 pr-3">Kit</th>
                <th className="pb-2 pr-3">Bought on</th>
                <th className="pb-2 pr-3">Receipt</th>
                <th className="pb-2">Inspections</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-800/50">
                  <td className="py-1.5 pr-3">
                    <Link
                      href={`/items/${r.partId}`}
                      className="font-mono text-teal-400 hover:underline"
                    >
                      {r.partNumber}
                    </Link>
                    <p className="text-[11px] text-slate-500">
                      {r.description}
                    </p>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs text-slate-300">
                    {r.lotNumber || "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {r.quantity}
                  </td>
                  <td className="py-1.5 pr-3">
                    <Link
                      href="/kitting"
                      className="font-mono text-xs text-teal-300 hover:underline"
                    >
                      {r.kitNumber}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3">
                    {r.poId ? (
                      <>
                        <Link
                          href={`/purchasing/po/${r.poId}`}
                          className="font-mono text-sky-400 hover:underline"
                        >
                          {r.poNumber}
                        </Link>
                        {r.supplier && (
                          <p className="text-[11px] text-slate-500">
                            {r.supplier}
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-slate-600">
                        Built / stock
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-slate-400">
                    {r.receiptNumber || "—"}
                    {r.receivedAt && (
                      <p className="text-[10px] text-slate-600">
                        {formatDate(r.receivedAt)}
                      </p>
                    )}
                  </td>
                  <td className="py-1.5">
                    <span className="flex flex-wrap gap-1">
                      {r.inspections.slice(0, 3).map((insp) => (
                        <span
                          key={insp.number}
                          className="flex items-center gap-1 rounded-full border border-slate-700 px-1.5 py-0.5 text-[10px]"
                        >
                          <span className="font-mono text-slate-300">
                            {insp.number}
                          </span>
                          <StatusBadge status={insp.status} />
                        </span>
                      ))}
                      {r.inspections.length === 0 && (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** Universal "everything that touched this" event chain. */
export function TraceChainCard({
  events,
  title = "Trace chain",
}: {
  events: TraceChainEvent[];
  title?: string;
}) {
  if (events.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="h-4 w-4 text-violet-400" />
          {title} ({events.length})
        </CardTitle>
        <p className="text-xs text-slate-500">
          Every recorded touch — receipts, inspections, kits, issues,
          sign-offs, shipments — with links to each record.
        </p>
      </CardHeader>
      <CardContent>
        <ol className="relative ml-1.5 space-y-0 border-l border-slate-800">
          {events.map((e) => (
            <li key={e.id} className="relative pb-2.5 pl-4 last:pb-0">
              <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full border border-slate-600 bg-slate-900" />
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-200">
                  {e.eventType.replace(/_/g, " ")}
                </span>
                {e.partNumber && (
                  <span className="font-mono text-xs text-teal-400">
                    {e.partNumber}
                  </span>
                )}
                {e.lotNumber && (
                  <span className="font-mono text-[10px] text-slate-500">
                    lot {e.lotNumber}
                  </span>
                )}
                {e.quantity ? (
                  <span className="text-xs text-slate-500">
                    × {e.quantity}
                  </span>
                ) : null}
                {(e.from || e.to) && (
                  <span className="text-[10px] text-slate-600">
                    {e.from || "—"} → {e.to || "—"}
                  </span>
                )}
                {e.links.map((l) => (
                  <Link
                    key={l.href + l.label}
                    href={l.href}
                    className="font-mono text-[11px] text-sky-400 hover:underline"
                  >
                    {l.label}
                  </Link>
                ))}
                <span className="text-[10px] text-slate-600">
                  {formatDate(e.at, "MMM d, HH:mm")}
                </span>
              </p>
              {e.notes && (
                <p className="text-[11px] text-slate-500">{e.notes}</p>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
