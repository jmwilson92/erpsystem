import Link from "next/link";
import { notFound } from "next/navigation";
import {
  findSerial,
  getSerialTree,
  whereUsedSerial,
  type SerialTreeNode,
} from "@/lib/services/serials";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

function Tree({ node, depth = 0 }: { node: SerialTreeNode; depth?: number }) {
  return (
    <div className={depth ? "ml-4 border-l border-slate-800 pl-3" : ""}>
      <div className="flex flex-wrap items-center gap-2 py-1 text-sm">
        <span className="font-mono text-teal-400">
          {node.serial || "—"}
        </span>
        <span className="text-xs text-slate-500">
          {node.partNumber} · {node.partName}
        </span>
        {node.quantity && node.quantity !== 1 && (
          <span className="text-xs text-amber-400">×{node.quantity}</span>
        )}
        <StatusBadge status={node.status} />
        {node.serialId && node.serialId !== "" && depth > 0 && (
          <Link
            href={`/trace/serials/${encodeURIComponent(node.serial)}`}
            className="text-[10px] text-sky-400 hover:underline"
          >
            open
          </Link>
        )}
      </div>
      {node.children.map((c, i) => (
        <Tree key={c.installId || `${c.serial}-${i}`} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

export default async function SerialDetailPage({
  params,
}: {
  params: Promise<{ serial: string }>;
}) {
  const { serial: raw } = await params;
  const serial = decodeURIComponent(raw);
  const sn = await findSerial(serial);
  if (!sn) notFound();

  const [tree, used] = await Promise.all([
    getSerialTree(sn.id, { includeRemoved: true }),
    whereUsedSerial(sn.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={sn.serial}
        description={`${sn.part.partNumber} · ${sn.part.description}`}
        actions={
          <Link href="/trace/serials">
            <Button size="sm" variant="outline">
              All serials
            </Button>
          </Link>
        }
      />
      <div className="flex flex-wrap gap-3 text-sm text-slate-400">
        <StatusBadge status={sn.status} />
        {sn.warrantyEnd && (
          <span>
            Warranty through{" "}
            <span className="text-slate-200">
              {sn.warrantyEnd.toISOString().slice(0, 10)}
            </span>
          </span>
        )}
        {sn.customer && (
          <span>
            Customer {sn.customer.code} · {sn.customer.name}
          </span>
        )}
      </div>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">As-built tree</CardTitle>
          <p className="text-xs text-slate-500">
            All serials (and lot qty) currently or previously installed under
            this unit
          </p>
        </CardHeader>
        <CardContent>
          {tree ? (
            <Tree node={tree} />
          ) : (
            <p className="text-sm text-slate-500">No tree data</p>
          )}
          {tree && !tree.children.length && (
            <p className="mt-2 text-xs text-slate-600">
              No components installed yet — use WO as-built / kit assignment
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Where used</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {used.map((u) => (
            <div key={u.id} className="flex flex-wrap gap-2">
              <StatusBadge status={u.status} />
              <Link
                href={`/trace/serials/${encodeURIComponent(u.parentSerial.serial)}`}
                className="font-mono text-teal-400 hover:underline"
              >
                {u.parentSerial.serial}
              </Link>
              <span className="text-slate-500">
                {u.parentSerial.part.partNumber}
              </span>
            </div>
          ))}
          {!used.length && (
            <p className="text-slate-500">Not installed in any parent</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
