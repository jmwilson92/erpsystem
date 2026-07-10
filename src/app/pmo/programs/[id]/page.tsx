import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const program = await prisma.program.findUnique({
    where: { id },
    include: {
      owner: true,
      projects: {
        include: {
          product: { select: { code: true, name: true } },
          projectManager: { select: { name: true } },
          _count: { select: { risks: true, issues: true, tasks: true } },
        },
        orderBy: { number: "asc" },
      },
    },
  });
  if (!program) notFound();

  const budget = program.projects.reduce((s, p) => s + p.budgetCost, 0);
  const actual = program.projects.reduce((s, p) => s + p.actualCost, 0);
  const dev = program.projects.reduce((s, p) => s + p.developmentActual, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={program.name}
        description={`${program.code}${program.portfolio ? ` · ${program.portfolio}` : ""}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/pmo/projects/new?programId=${program.id}`}>
              <Button size="sm">Add project</Button>
            </Link>
            <Link href="/pmo">
              <Button size="sm" variant="outline">
                PMO home
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={program.status} />
        <span className="text-xs text-slate-500">
          Owner {program.owner?.name || "—"} · {formatDate(program.startDate)} –{" "}
          {formatDate(program.endDate)}
        </span>
      </div>

      {program.description && (
        <p className="text-sm text-slate-400">{program.description}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-slate-800">
          <CardContent className="p-4 text-center">
            <p className="text-xl font-bold tabular-nums text-slate-100">
              {formatCurrency(budget || program.budgetCost)}
            </p>
            <p className="text-xs text-slate-500">Budget</p>
          </CardContent>
        </Card>
        <Card className="border-slate-800">
          <CardContent className="p-4 text-center">
            <p className="text-xl font-bold tabular-nums text-slate-100">
              {formatCurrency(actual || program.actualCost)}
            </p>
            <p className="text-xs text-slate-500">Actual</p>
          </CardContent>
        </Card>
        <Card className="border-slate-800">
          <CardContent className="p-4 text-center">
            <p className="text-xl font-bold tabular-nums text-slate-100">
              {formatCurrency(dev)}
            </p>
            <p className="text-xs text-slate-500">Dev / NRE actual</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-800">
        <CardHeader>
          <CardTitle className="text-base">
            Projects in this program ({program.projects.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {program.projects.length === 0 && (
            <p className="text-sm text-slate-500">
              No projects yet.{" "}
              <Link
                href={`/pmo/projects/new?programId=${program.id}`}
                className="text-teal-400 underline"
              >
                Create one
              </Link>
            </p>
          )}
          {program.projects.map((p) => (
            <Link
              key={p.id}
              href={`/pmo/projects/${p.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 hover:bg-slate-900/50"
            >
              <div>
                <span className="font-mono text-sm text-teal-400">{p.number}</span>{" "}
                <span className="text-slate-200">{p.name}</span>
                <p className="text-[11px] text-slate-500">
                  {p.methodology} · PM {p.projectManager?.name || "—"}
                  {p.product ? ` · ${p.product.code}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={p.status} />
                <span className="text-xs tabular-nums text-slate-500">
                  {formatCurrency(p.budgetCost)}
                </span>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
