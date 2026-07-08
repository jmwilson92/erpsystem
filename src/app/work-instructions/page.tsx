import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function WorkInstructionsPage() {
  const wis = await prisma.workInstruction.findMany({
    orderBy: [{ documentNumber: "asc" }, { revision: "desc" }],
    include: {
      part: true,
      createdBy: true,
      steps: true,
      _count: { select: { workOrderLinks: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work Instructions"
        description="Version-controlled shop floor instructions with CM approval workflow"
      />

      <div className="grid gap-3">
        {wis.map((wi) => (
          <Link key={wi.id} href={`/work-instructions/${wi.id}`}>
            <Card className="transition-colors hover:border-teal-500/30">
              <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-teal-400">
                      {wi.documentNumber}
                    </span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs">
                      Rev {wi.revision}
                    </span>
                    <StatusBadge status={wi.status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-200">{wi.title}</p>
                  <p className="text-xs text-slate-500">
                    {wi.part?.partNumber || "General"}
                    {wi.bomRevision ? ` · BOM Rev ${wi.bomRevision}` : ""}
                    {` · ${wi.steps.length} steps`}
                    {` · ${wi._count.workOrderLinks} WO links`}
                    {wi.workCenter ? ` · ${wi.workCenter}` : ""}
                    {wi.releasedAt ? ` · Released ${formatDate(wi.releasedAt)}` : ""}
                  </p>
                </div>
                <p className="text-xs text-slate-500">{wi.createdBy?.name}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
