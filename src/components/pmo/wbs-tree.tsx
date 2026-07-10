"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, ChevronDown, FolderTree, FileBox } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, cn } from "@/lib/utils";

export type WbsNode = {
  id: string;
  code: string;
  name: string;
  kind: string;
  parentId: string | null;
  level: number;
  status: string;
  budgetCost: number;
  actualCost: number;
  percentComplete: number;
  description?: string | null;
  _count?: { children: number; campaigns: number; tasks: number };
  campaigns?: { id: string; number: string; name: string; status: string }[];
};

export function WbsTree({
  projectId,
  nodes,
}: {
  projectId: string;
  nodes: WbsNode[];
}) {
  const roots = useMemo(
    () => nodes.filter((n) => !n.parentId).sort((a, b) => a.code.localeCompare(b.code)),
    [nodes]
  );
  const byParent = useMemo(() => {
    const m = new Map<string, WbsNode[]>();
    for (const n of nodes) {
      if (!n.parentId) continue;
      const list = m.get(n.parentId) || [];
      list.push(n);
      m.set(n.parentId, list);
    }
    for (const [, list] of m) list.sort((a, b) => a.code.localeCompare(b.code));
    return m;
  }, [nodes]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const r of roots) init[r.id] = true;
    return init;
  });

  function toggle(id: string) {
    setExpanded((p) => ({ ...p, [id]: !p[id] }));
  }

  function Row({ node, depth }: { node: WbsNode; depth: number }) {
    const kids = byParent.get(node.id) || [];
    const hasKids = kids.length > 0 || (node._count?.children || 0) > 0;
    const open = expanded[node.id];

    return (
      <div className="border-b border-slate-800/60 last:border-0">
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 py-2 pr-2 hover:bg-slate-900/40",
            depth === 0 && "bg-slate-950/30"
          )}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <button
            type="button"
            className="shrink-0 text-slate-500 hover:text-slate-200"
            onClick={() => hasKids && toggle(node.id)}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {hasKids ? (
              open ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )
            ) : (
              <span className="inline-block w-4" />
            )}
          </button>
          {depth === 0 ? (
            <FolderTree className="h-3.5 w-3.5 shrink-0 text-violet-400" />
          ) : (
            <FileBox className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          )}
          <Link
            href={`/pmo/wbs/${node.id}`}
            className="min-w-0 flex-1 hover:underline"
          >
            <span className="font-mono text-xs text-teal-400">{node.code}</span>{" "}
            <span className="text-sm text-slate-200">{node.name}</span>
            <span className="ml-2 text-[10px] uppercase text-slate-600">
              {node.kind.replace(/_/g, " ")}
            </span>
          </Link>
          <StatusBadge status={node.status} />
          <div className="hidden w-24 sm:block">
            <Progress value={node.percentComplete} className="h-1" />
          </div>
          <span className="hidden text-xs tabular-nums text-slate-500 md:inline">
            {formatCurrency(node.actualCost)} / {formatCurrency(node.budgetCost)}
          </span>
          {(node._count?.campaigns || 0) > 0 && (
            <span className="text-[10px] text-violet-400">
              {node._count!.campaigns} cmp
            </span>
          )}
        </div>
        {open &&
          kids.map((c) => <Row key={c.id} node={c} depth={depth + 1} />)}
        {open &&
          !kids.length &&
          (node.campaigns?.length || 0) > 0 &&
          node.campaigns!.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 py-1.5 text-xs text-slate-400"
              style={{ paddingLeft: 32 + depth * 16 }}
            >
              <span className="font-mono text-violet-400/80">{c.number}</span>
              <span>{c.name}</span>
              <StatusBadge status={c.status} />
            </div>
          ))}
      </div>
    );
  }

  if (!roots.length) {
    return (
      <p className="p-4 text-sm text-slate-500">
        No WBS elements yet. Add a root control account or work package below.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800">
      {roots.map((r) => (
        <Row key={r.id} node={r} depth={0} />
      ))}
      <p className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-600">
        Click a WBS code/name for full detail. Expand rows to see sub-elements and
        linked campaigns. Hierarchy follows the 100% rule (all project work is
        represented).
      </p>
    </div>
  );
}
