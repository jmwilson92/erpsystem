import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatDate, cn } from "@/lib/utils";
import Link from "next/link";
import { Plus, Lock, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

// CM-style board columns for the WI lifecycle.
const COLUMNS: {
  id: string;
  label: string;
  statuses: string[];
  accent: string;
  tint: string;
}[] = [
  {
    id: "in_work",
    label: "In work",
    statuses: ["DRAFT", "ENGINEERING_REVIEW"],
    accent: "text-slate-300 border-slate-600",
    tint: "bg-slate-500/5",
  },
  {
    id: "cm_review",
    label: "In CM review",
    statuses: ["CM_REVIEW"],
    accent: "text-amber-300 border-amber-500/40",
    tint: "bg-amber-500/5",
  },
  {
    id: "released",
    label: "Released · CM master",
    statuses: ["RELEASED"],
    accent: "text-emerald-300 border-emerald-500/40",
    tint: "bg-emerald-500/5",
  },
  {
    id: "obsolete",
    label: "Obsolete",
    statuses: ["OBSOLETE"],
    accent: "text-slate-500 border-slate-700",
    tint: "bg-slate-500/5",
  },
];

export default async function WorkInstructionsPage() {
  const wis = await prisma.workInstruction.findMany({
    orderBy: [{ documentNumber: "asc" }, { revision: "desc" }],
    include: {
      part: true,
      bomHeader: { include: { part: true } },
      createdBy: true,
      steps: true,
      cmDocuments: { where: { isArchived: false }, select: { id: true } },
      _count: { select: { workOrderLinks: true } },
    },
  });

  const byColumn = (statuses: string[]) =>
    wis.filter((wi) => statuses.includes(wi.status));

  // Hide the Obsolete column entirely when empty (keeps the board tidy).
  const columns = COLUMNS.filter(
    (c) => c.id !== "obsolete" || byColumn(c.statuses).length > 0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work Instructions"
        description="Authoring → Submit to CM → Released & locked · the released revision is retained as the CM-controlled master"
        actions={
          <div className="flex gap-2">
            <Link href="/cm">
              <Button size="sm" variant="outline">
                <FileText className="mr-1 h-4 w-4" />
                CM library
              </Button>
            </Link>
            <Link href="/work-instructions/new">
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                New WI
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {columns.map((col) => {
          const items = byColumn(col.statuses);
          return (
            <div
              key={col.id}
              className={cn(
                "flex flex-col rounded-2xl border border-slate-800",
                col.tint
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-between border-b px-4 py-2.5",
                  col.accent
                )}
              >
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {col.label}
                </span>
                <span className="rounded-full border border-current px-2 py-0.5 text-[10px] tabular-nums">
                  {items.length}
                </span>
              </div>

              <div className="flex-1 space-y-2 p-3">
                {items.length === 0 && (
                  <p className="py-6 text-center text-xs text-slate-600">
                    Nothing here.
                  </p>
                )}
                {items.map((wi) => (
                  <Link
                    key={wi.id}
                    href={`/work-instructions/${wi.id}${wi.status === "RELEASED" ? "?cm=1" : ""}`}
                    className="block rounded-xl border border-slate-800 bg-slate-950/50 p-3 transition-colors hover:border-teal-500/40 hover:bg-slate-900/60"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-sm font-semibold text-teal-400">
                        {wi.documentNumber}
                      </span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                        Rev {wi.revision}
                      </span>
                      {wi.isLocked && (
                        <Lock className="h-3 w-3 text-emerald-400" aria-label="Locked master" />
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-200">
                      {wi.title}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {wi.part?.partNumber || "General"}
                      {` · ${wi.steps.length} steps`}
                      {wi._count.workOrderLinks > 0
                        ? ` · ${wi._count.workOrderLinks} WO`
                        : ""}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <StatusBadge status={wi.status} className="text-[9px]" />
                      {wi.status === "RELEASED" && wi.cmDocuments.length > 0 && (
                        <span className="text-[9px] uppercase tracking-wider text-emerald-500/80">
                          In CM
                        </span>
                      )}
                      {wi.releasedAt && (
                        <span className="text-[10px] text-slate-600">
                          {formatDate(wi.releasedAt)}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {wis.length === 0 && (
        <div className="rounded-2xl border border-slate-800 py-10 text-center text-sm text-slate-500">
          No work instructions.{" "}
          <Link
            href="/work-instructions/new"
            className="text-teal-400 hover:underline"
          >
            Create one
          </Link>
        </div>
      )}
    </div>
  );
}
