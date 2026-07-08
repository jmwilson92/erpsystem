import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { actionVoteCm } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function CmPage() {
  const crs = await prisma.changeRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      boardMembers: true,
      bomHeader: { include: { part: true } },
      workInstruction: true,
    },
  });

  // Resolve user names for board
  const userIds = [...new Set(crs.flatMap((c) => c.boardMembers.map((m) => m.userId)))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuration Management"
        description="Engineering change requests, impact analysis, and formal review board"
      />

      <div className="grid gap-4">
        {crs.map((cr) => (
          <Card key={cr.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="font-mono text-teal-400">{cr.number}</CardTitle>
                <StatusBadge status={cr.status} />
                <StatusBadge status={cr.type} />
                <StatusBadge status={cr.priority} />
              </div>
              <p className="text-sm text-slate-200">{cr.title}</p>
              <p className="text-xs text-slate-500">
                {formatDate(cr.createdAt)}
                {cr.boardDate ? ` · Board ${formatDate(cr.boardDate)}` : ""}
                {cr.bomHeader
                  ? ` · BOM ${cr.bomHeader.part.partNumber} Rev ${cr.bomHeader.revision}`
                  : ""}
                {cr.workInstruction
                  ? ` · WI ${cr.workInstruction.documentNumber}`
                  : ""}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-400">{cr.description}</p>
              {cr.impactAnalysis && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-sm text-slate-300">
                  <p className="mb-1 text-xs font-medium uppercase text-slate-500">
                    Impact Analysis
                  </p>
                  {cr.impactAnalysis}
                </div>
              )}

              {cr.boardMembers.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase text-slate-500">
                    Review Board
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {cr.boardMembers.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm"
                      >
                        <div>
                          <p className="text-slate-200">
                            {userMap[m.userId]?.name || m.userId}
                          </p>
                          <p className="text-xs text-slate-500">{m.role}</p>
                        </div>
                        {m.vote ? (
                          <StatusBadge status={m.vote} />
                        ) : cr.status === "REVIEW_BOARD" ? (
                          <div className="flex gap-1">
                            <form action={actionVoteCm}>
                              <input type="hidden" name="memberId" value={m.id} />
                              <input type="hidden" name="vote" value="APPROVE" />
                              <Button type="submit" size="sm" variant="default">
                                Approve
                              </Button>
                            </form>
                            <form action={actionVoteCm}>
                              <input type="hidden" name="memberId" value={m.id} />
                              <input type="hidden" name="vote" value="REJECT" />
                              <Button type="submit" size="sm" variant="destructive">
                                Reject
                              </Button>
                            </form>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-600">Pending</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cr.decisionNotes && (
                <p className="text-xs text-emerald-400">{cr.decisionNotes}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
