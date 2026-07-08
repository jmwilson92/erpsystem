import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const columns = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE"] as const;

export default async function EngineeringPage() {
  const [tickets, sprints] = await Promise.all([
    prisma.engineeringTicket.findMany({
      orderBy: { updatedAt: "desc" },
      include: { assignee: true, sprint: true },
    }),
    prisma.sprint.findMany({ orderBy: { startDate: "desc" } }),
  ]);

  const activeSprint = sprints.find((s) => s.status === "ACTIVE");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engineering Tracker"
        description="Agile board linked to BOM, Work Instructions, CM, and Purchasing"
      />

      {activeSprint && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
            <div>
              <p className="text-sm font-semibold text-teal-400">{activeSprint.name}</p>
              <p className="text-xs text-slate-500">{activeSprint.goal}</p>
            </div>
            <StatusBadge status={activeSprint.status} />
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((col) => {
          const colTickets = tickets.filter((t) => t.status === col);
          return (
            <div
              key={col}
              className="w-64 shrink-0 rounded-xl border border-slate-800 bg-slate-900/40"
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {col.replace(/_/g, " ")}
                </span>
                <span className="rounded-full bg-slate-800 px-2 text-xs text-slate-500">
                  {colTickets.length}
                </span>
              </div>
              <div className="space-y-2 p-2">
                {colTickets.map((t) => (
                  <Card
                    key={t.id}
                    className={cn(
                      "border-slate-800",
                      t.priority === "CRITICAL" && "border-red-500/40",
                      t.status === "BLOCKED" && "border-amber-500/40"
                    )}
                  >
                    <CardContent className="space-y-2 p-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-teal-500">{t.number}</span>
                        <StatusBadge status={t.type} />
                      </div>
                      <p className="text-sm font-medium leading-snug text-slate-200">
                        {t.title}
                      </p>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <StatusBadge status={t.priority} />
                        <span>
                          {t.assignee?.name?.split(" ")[0] || "—"}
                          {t.storyPoints != null ? ` · ${t.storyPoints}sp` : ""}
                        </span>
                      </div>
                      {(t.linkedBomId || t.linkedWiId || t.linkedCrId) && (
                        <p className="text-[10px] text-violet-400/80">
                          Linked:{" "}
                          {[t.linkedBomId && "BOM", t.linkedWiId && "WI", t.linkedCrId && "CR"]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
