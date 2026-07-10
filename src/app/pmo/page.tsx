import Link from "next/link";
import { listPrograms, listProjects } from "@/lib/services/pmo";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { Plus, FolderKanban, Layers } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PmoPage() {
  const [programs, projects] = await Promise.all([
    listPrograms(),
    listProjects(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Project Management Organization (PMO)"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/pmo/pi">
              <Button size="sm" variant="outline">
                PI planning
              </Button>
            </Link>
            <Link href="/pmo/alerts">
              <Button size="sm" variant="outline">
                PM alerts
              </Button>
            </Link>
            <Link href="/pmo/programs/new">
              <Button size="sm" variant="outline">
                <Layers className="mr-1 h-4 w-4" />
                New program
              </Button>
            </Link>
            <Link href="/pmo/projects/new">
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                New project
              </Button>
            </Link>
          </div>
        }
      />

      {/* Programs */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Programs / portfolios
          </h2>
        </div>
        {programs.length === 0 ? (
          <Card className="border-dashed border-slate-800">
            <CardContent className="py-8 text-center text-sm text-slate-500">
              No programs yet. Create a program to group projects.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {programs.map((prg) => {
              const budget = prg.projects.reduce((s, p) => s + p.budgetCost, 0);
              const actual = prg.projects.reduce((s, p) => s + p.actualCost, 0);
              return (
                <Link key={prg.id} href={`/pmo/programs/${prg.id}`}>
                  <Card className="h-full border-l-4 border-l-violet-500 transition-colors hover:border-teal-500/40">
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-violet-300">
                          {prg.code}
                        </span>
                        <StatusBadge status={prg.status} />
                        {prg.portfolio && (
                          <span className="text-[10px] uppercase text-slate-500">
                            {prg.portfolio}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-1 text-lg font-semibold text-slate-100">
                        {prg.name}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {prg._count.projects} project(s) · Owner{" "}
                        {prg.owner?.name || "—"} · Budget{" "}
                        {formatCurrency(budget || prg.budgetCost)} · AC{" "}
                        {formatCurrency(actual || prg.actualCost)}
                      </p>
                      {prg.projects.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
                          {prg.projects.slice(0, 4).map((p) => (
                            <li key={p.id} className="flex justify-between gap-2">
                              <span>
                                <span className="font-mono text-teal-500/80">
                                  {p.number}
                                </span>{" "}
                                {p.name}
                              </span>
                              <StatusBadge status={p.status} />
                            </li>
                          ))}
                          {prg.projects.length > 4 && (
                            <li className="text-slate-600">
                              +{prg.projects.length - 4} more
                            </li>
                          )}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* All projects */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          All projects
        </h2>
        <div className="grid gap-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/pmo/projects/${p.id}`}>
              <Card
                className={cn(
                  "border-l-4 transition-colors hover:border-teal-500/40",
                  p.methodology === "AGILE"
                    ? "border-l-sky-500"
                    : p.methodology === "WATERFALL"
                      ? "border-l-amber-500"
                      : "border-l-teal-500"
                )}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-teal-400">
                          {p.number}
                        </span>
                        <StatusBadge status={p.status} />
                        <StatusBadge status={p.methodology} />
                        <StatusBadge status={p.phase} />
                      </div>
                      <h3 className="mt-1 text-lg font-semibold text-slate-100">
                        {p.name}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {[
                          p.program
                            ? `${p.program.code} ${p.program.name}`
                            : null,
                          p.product
                            ? `Product ${p.product.code}`
                            : null,
                          p.projectManager?.name
                            ? `PM ${p.projectManager.name}`
                            : null,
                          p.customerName,
                        ]
                          .filter(Boolean)
                          .join(" · ") || p.description || "—"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-center text-xs text-slate-500">
                      <div className="w-28">
                        <Progress
                          value={p.percentComplete}
                          className="mb-1 h-1.5"
                        />
                        <p className="tabular-nums text-slate-300">
                          {p.percentComplete.toFixed(0)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold tabular-nums text-slate-200">
                          {formatCurrency(p.budgetCost)}
                        </p>
                        <p>Budget</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold tabular-nums text-slate-200">
                          {formatCurrency(p.developmentActual)}
                        </p>
                        <p>Dev cost</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold tabular-nums text-slate-200">
                          {p._count.risks}/{p._count.issues}
                        </p>
                        <p>Risks / issues</p>
                      </div>
                      <div className="hidden sm:block">
                        <p className="text-slate-400">
                          {formatDate(p.startDate)} – {formatDate(p.endDate)}
                        </p>
                        <p>Schedule</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {projects.length === 0 && (
            <Card className="border-dashed border-slate-800">
              <CardContent className="flex flex-col items-center gap-3 py-12">
                <FolderKanban className="h-10 w-10 text-slate-600" />
                <p className="text-sm text-slate-400">No projects yet.</p>
                <Link href="/pmo/projects/new">
                  <Button size="sm">Create project</Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
